#!/usr/bin/env node
// Local mock of the /api surface + the Supabase token endpoint, for running
// the org-isolation gate in-sandbox (the "mock-and-run" pattern): a host
// without prod credentials (the Claude sandbox, a laptop) can validate the
// gate against a known-good server (pass mode) and against deliberately
// broken servers (leak modes) to prove each assertion actually goes red.
//
// This mocks the CONTRACT of the real API (envelope shape, camelCase keys,
// org scoping, status codes), not its implementation. Keep it in sync with
// src/server/api.ts + the route handlers when endpoints change.
//
// Run directly:  node scripts/mock-api-server.mjs [--port 8787] [--leak <mode>]
// Or in-process: import { createMockApiServer, FIXTURES } (see
//                scripts/verify-isolation-local.mjs).
//
// Leak modes (each makes specific gate assertions fail):
//   providers   cross-org provider rows leak into lists, GET-by-id, and PATCH (1, 1b, 2c, 3, 12)
//   spoof       x-org-id honored without a membership check          (4)
//   fieldmaps   another org's field-map rows leak into the catalog   (5b, 5c)
//   profile     cross-org provider profile served instead of 404     (6)
//   fillevents  cross-org fill-event accepted and stored             (7, 7b)
//   cases       cross-org provider's case list served instead of 404 (8b)
//   casesearch  cross-org case rows leak into ?q= search results      (15b)
//   touches     cross-org submission touch accepted and stored       (9, 9b)
//   tasks       cross-org task_id closed by a submission touch        (13)
//   casecontext cross-org case context served instead of 404         (14b)
//   meorgs      other users' membership rows leak into /api/me/orgs  (10, 10b)
//   facility    cross-org profile facilityId honored instead of 404  (11)
//   ssnrelease  cross-org fill-only SSN released instead of 404       (16)
//   documentdownload cross-org signed document download served instead of 404 (17b)
import { createServer } from "node:http";

// Same fixture ids as the workflow env block, so the gate script needs no
// special-casing between mock runs and real runs.
export const FIXTURES = {
  KANSAS_ORG: "20563fd6-8e95-46a0-8e1c-cb3b968b3c3d",
  SOUTHPARK_ORG: "d0e40000-0000-4000-a000-000000000001",
  KANSAS_PROVIDER_ID: "49ad83a8-d8b6-419d-8dcc-88c04a54c4da",
  SOUTHPARK_PROVIDER_ID: "d0e40000-0000-4000-a000-000000000021",
  SOUTHPARK_FIELDMAP_ID: "468238fc-ab35-4a4d-9569-bb7960f40328",
  SOUTHPARK_CASE_ID: "d0e40000-0000-4000-a000-000000000065",
  KANSAS_CASE_ID: "b7a90000-0000-4000-a000-0000000000c1",
  KANSAS_FACILITY_ID: "5f190f0d-2c5c-49f7-8953-aa05cd0a9d64",
  SOUTHPARK_FACILITY_ID: "d0e40000-0000-4000-a000-000000000011",
  // Tasks for the submission-touch task-ownership assertion (13). The South
  // Park task is the cross-org task_id a Kansas caller must be denied.
  KANSAS_TASK_ID: "b7a90000-0000-4000-a000-0000000000d1",
  SOUTHPARK_TASK_ID: "d0e40000-0000-4000-a000-000000000071",
  // E4.5 documents for the signed-download assertion pair (17/17b). The South
  // Park document is the cross-org id a Kansas caller must be denied.
  KANSAS_DOCUMENT_ID: "b7a90000-0000-4000-a000-0000000000e1",
  SOUTHPARK_DOCUMENT_ID: "d0e40000-0000-4000-a000-000000000081",
  KANSAS_EMAIL: "testkansas@minted.com",
  SPVIEW_EMAIL: "testsouthpark@minted.com",
};

export const LEAK_MODES = [
  "providers",
  "spoof",
  "fieldmaps",
  "profile",
  "fillevents",
  "cases",
  "casesearch",
  "touches",
  "tasks",
  "casecontext",
  "meorgs",
  "facility",
  "ssnrelease",
  "documentdownload",
];

const USERS = {
  [FIXTURES.KANSAS_EMAIL]: {
    token: "tok-kansas",
    userId: "user-kansas",
    email: FIXTURES.KANSAS_EMAIL,
    fullName: "Test Kansas",
    orgId: FIXTURES.KANSAS_ORG,
    orgName: "Kansas Fitness Physio",
    role: "admin",
  },
  [FIXTURES.SPVIEW_EMAIL]: {
    token: "tok-southpark",
    userId: "user-southpark",
    email: FIXTURES.SPVIEW_EMAIL,
    fullName: "Test South Park",
    orgId: FIXTURES.SOUTHPARK_ORG,
    orgName: "South Park Physician Group",
    role: "billing",
  },
};

// One facility per org (mirrors the live fixtures: the Kansas gate provider has
// exactly one assigned facility, so its profile auto-selects it). Address
// fields ride along for the case-context selectedFacility projection (E4.3).
const FACILITIES = [
  {
    id: FIXTURES.KANSAS_FACILITY_ID,
    orgId: FIXTURES.KANSAS_ORG,
    name: "Fitness Physio - Leavenworth",
    street: "100 Main St",
    suite: null,
    city: "Leavenworth",
    state: "KS",
    zip: "66048",
  },
  {
    id: FIXTURES.SOUTHPARK_FACILITY_ID,
    orgId: FIXTURES.SOUTHPARK_ORG,
    name: "Casa Bonita Clinic",
    street: "6715 W Colfax Ave",
    suite: "Ste 2",
    city: "Lakewood",
    state: "CO",
    zip: "80214",
  },
];

// Every provider is assigned all of its org's facilities.
function facilitiesOf(provider) {
  return FACILITIES.filter((f) => f.orgId === provider.orgId);
}

function provider(id, orgId, firstName, lastName) {
  return { id, orgId, firstName, lastName, status: "active" };
}

const PROVIDERS = [
  provider(FIXTURES.KANSAS_PROVIDER_ID, FIXTURES.KANSAS_ORG, "Kay", "One"),
  provider("k-prov-2", FIXTURES.KANSAS_ORG, "Kay", "Two"),
  provider("k-prov-3", FIXTURES.KANSAS_ORG, "Kay", "Three"),
  provider("k-prov-4", FIXTURES.KANSAS_ORG, "Kay", "Four"),
  provider("k-prov-5", FIXTURES.KANSAS_ORG, "Kay", "Five"),
  provider("k-prov-6", FIXTURES.KANSAS_ORG, "Kay", "Six"),
  provider(FIXTURES.SOUTHPARK_PROVIDER_ID, FIXTURES.SOUTHPARK_ORG, "Eric", "Cartman"),
  provider("sp-prov-2", FIXTURES.SOUTHPARK_ORG, "Kenny", "McCormick"),
  provider("sp-prov-3", FIXTURES.SOUTHPARK_ORG, "Kyle", "Broflovski"),
  provider("sp-prov-4", FIXTURES.SOUTHPARK_ORG, "Stan", "Marsh"),
];

// Case rows carry the dropdown projection of GET /api/cases (open cases only —
// the mock serves them all as open).
const CASES = [
  {
    id: FIXTURES.SOUTHPARK_CASE_ID,
    orgId: FIXTURES.SOUTHPARK_ORG,
    providerId: FIXTURES.SOUTHPARK_PROVIDER_ID,
    // The case's explicit facility link — the ONLY source the context
    // endpoint's selectedFacility resolves from (never the provider's set).
    facilityId: FIXTURES.SOUTHPARK_FACILITY_ID,
    payerName: "South Park Health",
    state: "CO",
    status: "In Progress",
    submittedDate: null,
    // Phase 4: a portal-linked open task. Its task_id must never leak into a
    // Kansas caller's response (assertion 8d) — same isolation as the row.
    portalTasks: [
      {
        taskId: FIXTURES.SOUTHPARK_TASK_ID,
        title: "SP portal enrollment",
        portalKey: "sp_test_portal",
        status: "in_progress",
      },
    ],
  },
  {
    id: FIXTURES.KANSAS_CASE_ID,
    orgId: FIXTURES.KANSAS_ORG,
    providerId: FIXTURES.KANSAS_PROVIDER_ID,
    facilityId: FIXTURES.KANSAS_FACILITY_ID,
    payerName: "BCBS of Kansas",
    state: "KS",
    status: "Submitted",
    submittedDate: "2026-06-01",
    portalTasks: [
      {
        taskId: FIXTURES.KANSAS_TASK_ID,
        title: "Enroll on BCBS portal",
        portalKey: "bcbs_ks_enrollment",
        status: "in_progress",
      },
    ],
  },
];

// PR C read fields (Stories 5/10/11) ride on the same dropdown row. The mock
// serves stable values so the extension contract stays pinned; isolation is
// what the gate checks, not the exact note text.
function caseListRow(c) {
  return {
    id: c.id,
    payerName: c.payerName,
    state: c.state,
    status: c.status,
    submittedDate: c.submittedDate,
    payerReferenceId: c.payerReferenceId ?? null,
    latestNote: c.latestNote ?? null,
    lastSubmittedAt: c.lastSubmittedAt ?? null,
    portalTasks: c.portalTasks ?? [],
  };
}

// Tasks for the submission-touch task-ownership assertion (13): a Kansas caller
// naming the South Park task_id must be denied before any write.
const TASKS = [
  { id: FIXTURES.KANSAS_TASK_ID, orgId: FIXTURES.KANSAS_ORG },
  { id: FIXTURES.SOUTHPARK_TASK_ID, orgId: FIXTURES.SOUTHPARK_ORG },
];

// E4.5 — one document per org for the signed-download pair (17/17b). Paths
// follow the org-bound contract; the mock never signs anything real.
const DOCUMENTS = [
  {
    id: FIXTURES.KANSAS_DOCUMENT_ID,
    orgId: FIXTURES.KANSAS_ORG,
    fileName: "license.pdf",
    filePath: `org/${FIXTURES.KANSAS_ORG}/provider/${FIXTURES.KANSAS_PROVIDER_ID}/fam-1/1/license.pdf`,
  },
  {
    id: FIXTURES.SOUTHPARK_DOCUMENT_ID,
    orgId: FIXTURES.SOUTHPARK_ORG,
    fileName: "w9.pdf",
    filePath: `org/${FIXTURES.SOUTHPARK_ORG}/group/sp-group/fam-2/1/w9.pdf`,
  },
];

function fieldMapRow(id, orgId, portalKey, selector) {
  return {
    id,
    orgId,
    portalKey,
    urlPattern: null,
    pageStep: "1",
    mapType: "web",
    selector,
    selectorFallbacks: null,
    source: "token",
    token: "provider.firstName",
    hardcodedValue: null,
    transform: null,
    fieldType: "text",
    notes: null,
    status: "approved",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };
}

const FIELD_MAPS = [
  fieldMapRow("fm-global-1", null, "bcbs_ks_enrollment", "#firstName"),
  fieldMapRow("fm-global-2", null, "bcbs_ks_enrollment", "#lastName"),
  fieldMapRow("fm-global-3", null, "bcbs_ks_enrollment", "#npi"),
  fieldMapRow(
    FIXTURES.SOUTHPARK_FIELDMAP_ID,
    FIXTURES.SOUTHPARK_ORG,
    "sp_test_portal",
    "#sp-test-field",
  ),
];

function envelope(res, status, data, error = null, meta = null) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ data, error, meta }));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
  });
}

function profileFor(p, user, { facilities, selectedFacilityId }) {
  const selected = FACILITIES.find((f) => f.id === selectedFacilityId) ?? null;
  return {
    provider: { ...p, npi: "1234567890", ssnLast4: "0000", dateOfBirth: "1980-01-01" },
    tokens: [
      { token: "provider.firstName", value: p.firstName },
      { token: "provider.lastName", value: p.lastName },
      // facility.* resolves from the selected facility only — never a guess.
      { token: "facility.name", value: selected ? selected.name : null },
      { token: "payer.name", value: null },
      // {{user.*}} rides along, resolved from the caller's JWT metadata.
      { token: "user.name", value: user.fullName },
      { token: "user.email", value: user.email },
    ],
    unresolved: [
      { token: "payer.name", reason: "case-scoped source (payers); resolve at fill time" },
    ],
    facilities: facilities.map(({ id, name }) => ({ id, name })),
    selected_facility_id: selectedFacilityId,
  };
}

// Start the mock server. options: { port = 0, leak = null }. Returns
// { server, port, baseUrl, close() }.
export async function createMockApiServer(options = {}) {
  const leak = options.leak ?? null;
  if (leak && !LEAK_MODES.includes(leak)) {
    throw new Error(`Unknown leak mode "${leak}" (valid: ${LEAK_MODES.join(", ")})`);
  }
  // In-memory fill_sessions/touches stores, keyed `${orgId}:${id}` (org-scoped
  // idempotency, like the real handlers).
  const fillSessions = new Map();
  const touches = new Map();
  // In-memory extension quick-card layout prefs, keyed by userId (the route is
  // USER-scoped — prefs follow the user across orgs, so never org-keyed).
  const viewPrefs = new Map();
  // A representative slice of the schema-derived quick-card catalog the real
  // GET serves. Only needs to exercise the contract: an offered field, the
  // now-offered ssnLast4, and (by absence) an excluded internal column and a
  // case-scoped payer token, both of which must 422 on PUT.
  const QUICK_CARD_CATALOG = [
    { key: "provider.npi", label: "NPI (Type 1)", group: "provider", groupLabel: "Provider" },
    { key: "provider.firstName", label: "First name", group: "provider", groupLabel: "Provider" },
    { key: "provider.ssnLast4", label: "SSN (last 4)", group: "provider", groupLabel: "Provider" },
    { key: "group.tin", label: "Tax ID (TIN)", group: "group", groupLabel: "Provider group" },
    {
      key: "license.licenseNumber",
      label: "License number",
      group: "license",
      groupLabel: "State license",
    },
  ];
  // Per-server provider creates from POST /api/providers, so a create lands in
  // the caller's org (and is only visible to that org). Kept separate from the
  // shared PROVIDERS fixture so it never drifts the count assertions across runs.
  const createdProviders = [];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const method = req.method.toUpperCase();

    // --- mock GoTrue: password grant only ---
    if (url.pathname === "/auth/v1/token" && method === "POST") {
      const body = await readBody(req);
      const user = USERS[body?.email];
      if (!user) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ access_token: user.token, token_type: "bearer" }));
      return;
    }

    if (!url.pathname.startsWith("/api")) return envelope(res, 404, null, "Not found");
    if (method === "OPTIONS") {
      res.writeHead(204, { vary: "Origin" });
      res.end();
      return;
    }
    if (url.pathname === "/api/health") return envelope(res, 200, "ok");

    // --- auth: resolve the caller, then the org (x-org-id needs membership) ---
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    const user = Object.values(USERS).find((u) => u.token === token);
    if (!user) return envelope(res, 401, null, "Missing or malformed Authorization header");

    // --- /api/me/orgs (user-scoped: sits BEFORE org resolution, like the real
    // route runs on authenticateUser — x-org-id is irrelevant to it) ---
    if (/^\/api\/me\/orgs\/?$/.test(url.pathname)) {
      if (method !== "GET") return envelope(res, 405, null, "Method not allowed");
      let rows = [{ orgId: user.orgId, orgName: user.orgName, role: user.role }];
      if (leak === "meorgs") {
        // Broken server: other users' membership rows leak into the response.
        rows = rows.concat(
          Object.values(USERS)
            .filter((u) => u.orgId !== user.orgId)
            .map((u) => ({ orgId: u.orgId, orgName: u.orgName, role: u.role })),
        );
      }
      return envelope(res, 200, rows, null, { total: rows.length });
    }

    // --- /api/me/view-prefs (user-scoped, BEFORE org resolution, like
    // /api/me/orgs — the layout follows the user across orgs) ---
    if (/^\/api\/me\/view-prefs\/?$/.test(url.pathname)) {
      if (method === "GET") {
        // GET serves the layout AND the schema-derived catalog the picker
        // renders (one round trip; same set the PUT validates against).
        return envelope(res, 200, {
          fields: viewPrefs.get(user.userId) ?? null,
          catalog: QUICK_CARD_CATALOG,
        });
      }
      if (method === "PUT") {
        const body = await readBody(req);
        const fields = body?.fields;
        // Contract mirror: a deduped, ordered array of DERIVED catalog keys.
        // ssnLast4 is a legitimate field now; case-scoped payer/mso/contract
        // tokens and internal/audit columns are not in the catalog, so naming
        // one is a 422. No length cap — the closed key set bounds the body.
        const allowed = new Set(QUICK_CARD_CATALOG.map((f) => f.key));
        if (
          !Array.isArray(fields) ||
          new Set(fields).size !== fields.length ||
          fields.some((f) => typeof f !== "string" || !allowed.has(f))
        ) {
          return envelope(res, 422, null, "invalid fields");
        }
        viewPrefs.set(user.userId, fields);
        return envelope(res, 200, { fields });
      }
      return envelope(res, 405, null, "Method not allowed");
    }

    const requestedOrg = req.headers["x-org-id"] ?? url.searchParams.get("orgId");
    let orgId = user.orgId;
    if (requestedOrg) {
      if (requestedOrg !== user.orgId && leak !== "spoof") {
        return envelope(res, 403, null, "Not a member of that org");
      }
      orgId = requestedOrg; // leak "spoof": honored without a membership check
    }

    // --- /api/providers/:id/profile ---
    const profileMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/profile\/?$/);
    if (profileMatch) {
      if (method !== "GET") return envelope(res, 405, null, "Method not allowed");
      const p = PROVIDERS.find((row) => row.id === profileMatch[1]);
      const visible = p && (p.orgId === orgId || leak === "profile");
      if (!visible) return envelope(res, 404, null, "Provider not found");
      // Facility awareness: ?facilityId must be in the caller's org AND the
      // provider's facility set (else 404); the sole facility auto-selects;
      // several without a choice -> tokens empty + meta.needs_facility. Leak
      // "facility": the checks are skipped and a cross-org facility is served.
      const requestedFacility = url.searchParams.get("facilityId");
      const provFacilities = facilitiesOf(p);
      let selectedFacilityId = null;
      let needsFacility = false;
      if (requestedFacility) {
        const okFacility = provFacilities.some(
          (f) => f.id === requestedFacility && f.orgId === orgId,
        );
        if (!okFacility && leak !== "facility") {
          return envelope(res, 404, null, "Facility not found for this provider");
        }
        selectedFacilityId = requestedFacility;
      } else if (provFacilities.length === 1) {
        selectedFacilityId = provFacilities[0].id;
      } else if (provFacilities.length > 1) {
        needsFacility = true;
      }
      res.setHeader("cache-control", "no-store");
      return envelope(
        res,
        200,
        profileFor(p, user, { facilities: provFacilities, selectedFacilityId }),
        null,
        needsFacility ? { needs_facility: true } : null,
      );
    }

    // --- /api/providers/:id/ssn-release?caseId= (E4.4 fill-only SSN release) ---
    // Matched before the generic providers route. Writer-only; caseId required;
    // the case must be this org's AND this provider's (an active fill context) or
    // it's a 404 — cross-org indistinguishable from missing. Leak "ssnrelease":
    // the org check is skipped and a cross-org SSN is released. The value is a
    // FAKE fixture (never a real vault/decrypt) — the gate checks isolation only.
    const ssnReleaseMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/ssn-release\/?$/);
    if (ssnReleaseMatch) {
      if (method !== "GET") return envelope(res, 405, null, "Method not allowed");
      if (user.role === "billing") {
        return envelope(res, 403, null, "Your role cannot release an SSN for fill");
      }
      const providerId = ssnReleaseMatch[1];
      const caseId = url.searchParams.get("caseId");
      if (!caseId) {
        return envelope(res, 422, null, "caseId is required to release an SSN for fill");
      }
      const c = CASES.find((row) => row.id === caseId && row.providerId === providerId);
      const visible = c && (c.orgId === orgId || leak === "ssnrelease");
      if (!visible) return envelope(res, 404, null, "Case not found for this provider");
      res.setHeader("cache-control", "no-store");
      return envelope(res, 200, { ssn: "900000000", ssnLast4: "0000" });
    }

    // --- /api/documents/:id/download (E4.5 signed document download) ---
    // Any org member may download (billing included — the TE-2 read rule); the
    // document must be the caller's org's or it's a 404 — cross-org
    // indistinguishable from missing. Leak "documentdownload": the org check
    // is skipped and a cross-org signed URL is served. The URL is a FAKE
    // fixture value — the gate checks isolation, never real storage.
    const documentDownloadMatch = url.pathname.match(/^\/api\/documents\/([^/]+)\/download\/?$/);
    if (documentDownloadMatch) {
      if (method !== "GET") return envelope(res, 405, null, "Method not allowed");
      const d = DOCUMENTS.find((row) => row.id === documentDownloadMatch[1]);
      const visible = d && (d.orgId === orgId || leak === "documentdownload");
      if (!visible) return envelope(res, 404, null, "Document not found");
      res.setHeader("cache-control", "no-store");
      return envelope(res, 200, {
        url: `https://example.supabase.co/storage/v1/object/sign/provider-documents/${d.filePath}?token=fake-signed-token`,
        fileName: d.fileName,
        expiresIn: 120,
      });
    }

    // --- /api/providers and /api/providers/:id (GET list/by-id, POST create,
    // PATCH update) ---
    const providersMatch = url.pathname.match(/^\/api\/providers(?:\/([^/]+))?\/?$/);
    if (providersMatch) {
      const id = providersMatch[1];
      const allProviders = () => PROVIDERS.concat(createdProviders);

      // POST /api/providers — create in the caller's org. Writers only; the
      // body's org_id is stripped so a create can never plant a row in another
      // tenant, and the created row is only visible to the caller's org (GET
      // list below filters by orgId). No real-gate assertion exercises this
      // (see verify-org-isolation.mjs) — the contract is pinned here + in the
      // handler unit tests.
      if (!id && method === "POST") {
        if (user.role === "billing") {
          return envelope(res, 403, null, "Your role cannot modify providers");
        }
        const body = await readBody(req);
        if (!body || typeof body !== "object" || !body.firstName || !body.lastName) {
          return envelope(res, 422, null, "firstName and lastName are required");
        }
        // org_id comes from the authenticated membership only, never the body.
        const created = provider(
          `new-${orgId}-${createdProviders.length + 1}`,
          orgId,
          body.firstName,
          body.lastName,
        );
        createdProviders.push(created);
        return envelope(res, 201, created);
      }

      // PATCH /api/providers/:id — update within the caller's org. Writers
      // only; a cross-org (or nonexistent) id is a 404 (mirrors GET-by-id), so
      // it is never a cross-org write. Leak "providers": the org check is
      // skipped and the write lands on another tenant's row (assertion 12 red).
      if (id && method === "PATCH") {
        if (user.role === "billing") {
          return envelope(res, 403, null, "Your role cannot modify providers");
        }
        const body = await readBody(req);
        if (!body || typeof body !== "object") {
          return envelope(res, 422, null, "Request body must be a JSON object");
        }
        const p = allProviders().find((row) => row.id === id);
        const visible = p && (p.orgId === orgId || leak === "providers");
        if (!visible) return envelope(res, 404, null, "Provider not found");
        // org_id/id in the body are stripped; the row never moves tenants.
        const { orgId: _b1, org_id: _b2, id: _b3, ...clean } = body;
        Object.assign(p, clean);
        return envelope(res, 200, p);
      }

      if (method !== "GET") return envelope(res, 405, null, "Method not allowed");
      if (!id) {
        let rows = allProviders().filter((p) => p.orgId === orgId);
        if (leak === "providers" && orgId === FIXTURES.KANSAS_ORG) {
          rows = rows.concat(PROVIDERS.filter((p) => p.orgId === FIXTURES.SOUTHPARK_ORG));
        }
        return envelope(res, 200, rows, null, { total: rows.length, page: 1, pageSize: 100 });
      }
      const p = allProviders().find((row) => row.id === id);
      const visible = p && (p.orgId === orgId || leak === "providers");
      if (!visible) return envelope(res, 404, null, "Provider not found");
      return envelope(res, 200, p);
    }

    // --- /api/next-best-action (E4.3 TE-6: org-scoped queue-top read) ---
    if (/^\/api\/next-best-action\/?$/.test(url.pathname)) {
      if (method !== "GET") return envelope(res, 405, null, "Method not allowed");
      // Org-scoped: the queue-top of the caller's own org. Stable fixture item
      // for the caller's first case; { item: null } when the org has none.
      const own = CASES.find((c) => c.orgId === orgId);
      if (!own) return envelope(res, 200, { item: null });
      const p = PROVIDERS.find((row) => row.id === own.providerId);
      return envelope(res, 200, {
        item: {
          caseId: own.id,
          providerId: own.providerId,
          providerName: p ? `${p.firstName} ${p.lastName}`.trim() : "",
          payerName: own.payerName,
          groupName: "Demo Group",
          state: own.state,
          actionKind: "review",
          action: "Review case — no open tasks",
          reason: "No deadline signal on this case — ranked after dated work.",
          deadline: null,
          deepLink: `/cases/${own.id}`,
        },
      });
    }

    // --- /api/cases?providerId= (open-case dropdown) or ?q= (E4.3 case search) ---
    if (/^\/api\/cases\/?$/.test(url.pathname)) {
      if (method !== "GET") return envelope(res, 405, null, "Method not allowed");
      const providerId = url.searchParams.get("providerId");
      const q = url.searchParams.get("q");
      if (providerId) {
        const p = PROVIDERS.find((row) => row.id === providerId);
        // Real contract: a provider outside the caller's org is a 404, no rows.
        const visible = p && (p.orgId === orgId || leak === "cases");
        if (!visible) return envelope(res, 404, null, "Provider not found");
        const rows = CASES.filter((c) => c.providerId === providerId).map(caseListRow);
        return envelope(res, 200, rows, null, { total: rows.length });
      }
      if (q != null) {
        // E4.3 TE-11 — case search: org-scoped, matching payer name / provider
        // name / tracking id. Leak "casesearch": the org filter is skipped and
        // another org's case leaks into the results (assertion 15b red).
        const needle = q.trim().toLowerCase();
        const rows =
          needle === ""
            ? []
            : CASES.filter((c) => c.orgId === orgId || leak === "casesearch")
                .map((c) => {
                  const p = PROVIDERS.find((row) => row.id === c.providerId);
                  const providerName = p ? `${p.firstName} ${p.lastName}`.trim() : "";
                  return {
                    id: c.id,
                    providerId: c.providerId,
                    providerName,
                    payerName: c.payerName,
                    state: c.state,
                    status: c.status,
                    payerReferenceId: c.payerReferenceId ?? null,
                    payerPipelineState: c.payerPipelineState ?? "not_started",
                  };
                })
                .filter((r) => {
                  const hay =
                    `${r.providerName} ${r.payerName ?? ""} ${r.payerReferenceId ?? ""}`.toLowerCase();
                  return hay.includes(needle);
                });
        return envelope(res, 200, rows, null, { total: rows.length });
      }
      return envelope(res, 422, null, "providerId or q query parameter is required");
    }

    // --- /api/cases/:id/touches (submission touch, idempotent) ---
    const touchesMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/touches\/?$/);
    if (touchesMatch) {
      if (method !== "POST") return envelope(res, 405, null, "Method not allowed");
      if (user.role === "billing") {
        return envelope(res, 403, null, "Your role cannot log touches");
      }
      const body = await readBody(req);
      if (!body || typeof body !== "object") {
        return envelope(res, 422, null, "Request body must be a JSON object");
      }
      if (leak !== "touches") {
        // Real contract: validate case ownership BEFORE the idempotency
        // lookup or any write. A cross-org case is a 404, nothing stored.
        const caseOk = CASES.some((c) => c.id === touchesMatch[1] && c.orgId === orgId);
        if (!caseOk) return envelope(res, 404, null, "Case not found");
      }
      // PR C Story 7: an optional task_id is validated the same way — a
      // cross-org task_id is a 404 before any write (assertion 13). Leak
      // "tasks": the check is skipped and the cross-org task is accepted.
      if (body.task_id != null && leak !== "tasks") {
        const taskOk = TASKS.some((t) => t.id === body.task_id && t.orgId === orgId);
        if (!taskOk) return envelope(res, 404, null, "Task not found");
      }
      const key = `${orgId}:${body.idempotency_id}`;
      if (touches.has(key)) return envelope(res, 200, touches.get(key));
      const touch = {
        id: body.idempotency_id,
        orgId,
        caseId: touchesMatch[1],
        touchDate: "2026-07-05",
        touchType: "portal",
        outcome: "submitted",
        nextFollowUpDate: null,
        notes: `Application submitted via ${body.portal_key}`,
        coordinatorId: user.userId,
        source: "extension",
        createdAt: "2026-07-05T00:00:00Z",
      };
      touches.set(key, touch);
      return envelope(res, 201, touch);
    }

    // --- /api/cases/:id/context (Workbench post-selection read) ---
    const contextMatch = url.pathname.match(/^\/api\/cases\/([^/]+)\/context\/?$/);
    if (contextMatch) {
      if (method !== "GET") return envelope(res, 405, null, "Method not allowed");
      const c = CASES.find((row) => row.id === contextMatch[1]);
      // Real contract: a case outside the caller's org is a 404, no data. Leak
      // "casecontext": the org check is skipped and a cross-org case is served.
      const visible = c && (c.orgId === orgId || leak === "casecontext");
      if (!visible) return envelope(res, 404, null, "Case not found");
      // E4.3: selectedFacility resolves from the case's explicit facilityId
      // only, org-scoped against the caller — never the provider's facility
      // set and never a fallback-to-first. No link (or no org-visible row) is
      // an explicit null, matching src/services/caseContext.ts.
      const facility = c.facilityId
        ? (FACILITIES.find((f) => f.id === c.facilityId && f.orgId === orgId) ?? null)
        : null;
      return envelope(res, 200, {
        referenceNumbers: c.payerReferenceId ? [c.payerReferenceId] : [],
        payerPipelineState: c.payerPipelineState ?? "not_started",
        selectedFacility: facility
          ? {
              id: facility.id,
              name: facility.name,
              street: facility.street,
              suite: facility.suite,
              city: facility.city,
              state: facility.state,
              zip: facility.zip,
            }
          : null,
        latestNote: c.latestNote ?? null,
        latestTouch: c.latestTouch ?? null,
      });
    }

    // --- /api/portal-field-maps ---
    if (/^\/api\/portal-field-maps\/?$/.test(url.pathname)) {
      if (method !== "GET") return envelope(res, 405, null, "Method not allowed");
      const portalKey = url.searchParams.get("portal_key");
      let rows = FIELD_MAPS.filter(
        (r) => r.orgId === null || r.orgId === orgId || leak === "fieldmaps",
      );
      if (portalKey) rows = rows.filter((r) => r.portalKey === portalKey);
      return envelope(res, 200, rows, null, { total: rows.length });
    }

    // --- /api/fill-events ---
    if (/^\/api\/fill-events\/?$/.test(url.pathname)) {
      if (method !== "POST") return envelope(res, 405, null, "Method not allowed");
      if (user.role === "billing") {
        return envelope(res, 403, null, "Your role cannot record fill events");
      }
      const body = await readBody(req);
      if (!body || typeof body !== "object") {
        return envelope(res, 422, null, "Request body must be a JSON object");
      }
      const key = `${orgId}:${body.id}`;
      if (leak !== "fillevents") {
        // Real contract: validate ownership BEFORE the idempotency lookup or
        // any write. A cross-org case/provider is a 404, nothing stored.
        const caseOk = CASES.some((c) => c.id === body.caseId && c.orgId === orgId);
        if (!caseOk) return envelope(res, 404, null, "Case not found");
        const providerOk =
          body.providerId == null ||
          PROVIDERS.some((p) => p.id === body.providerId && p.orgId === orgId);
        if (!providerOk) return envelope(res, 404, null, "Provider not found");
      }
      if (fillSessions.has(key)) return envelope(res, 200, fillSessions.get(key));
      const session = {
        id: body.id,
        orgId,
        caseId: body.caseId,
        providerId: body.providerId ?? null,
        portalKey: body.portalKey,
        fillMode: body.fillMode ?? "web",
        startedAt: body.startedAt ?? new Date().toISOString(),
        completedAt: body.completedAt ?? null,
        fieldsFilled: body.fieldsFilled ?? 0,
        fieldsSkipped: body.fieldsSkipped ?? null,
        docsAttached: body.docsAttached ?? null,
        performedBy: user.userId,
      };
      fillSessions.set(key, session);
      return envelope(res, 201, session);
    }

    return envelope(res, 404, null, "Not found");
  });

  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve(server.address().port));
  });
  return {
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// CLI entry: `node scripts/mock-api-server.mjs [--port N] [--leak mode]`
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const { baseUrl } = await createMockApiServer({
    port: Number(flag("port") ?? 8787),
    leak: flag("leak") ?? process.env.LEAK_MODE ?? null,
  });
  console.log(`mock api server listening on ${baseUrl} (leak=${flag("leak") ?? "none"})`);
}
