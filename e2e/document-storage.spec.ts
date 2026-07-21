import { test, expect, type Route, type BrowserContext } from "@playwright/test";

// E4.5 Document Storage — TS-88/89/90 over the mock harness. The browser's
// metadata reads ride /rest/v1 under RLS (mocked here with filter-honoring
// fixtures); the SIGNED actions ride the app's own /api/documents/* endpoints
// (mocked same-origin with a write-through into the fixtures, so the
// invalidate-and-refetch loop runs for real) and the upload bytes PUT straight
// to the mocked /storage/v1 signed target. Fixture files are GENERATED
// non-PHI bytes — never a real document.
//
//   TS-88  two-grain upload (provider State License / group W-9), typed kinds
//          per grain, required expiration for dated kinds, re-upload versions
//          (prior retained, current marked), org-scoped + signed wire calls
//   TS-89  expiring-credentials table sorts by expiration with derived
//          expired / expiring-soon / current states; the group's readiness
//          view carries the advisory COI warning (never a gap)
//   TS-90  case-side required-document verification (present / missing /
//          expired) + one-click short-lived signed download

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const PROVIDER_ID = "44444444-4444-4444-8444-444444444444";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";
const CASE_ID = "66666666-6666-4666-8666-666666666666";
const PAYER_ID = "77777777-7777-4777-8777-777777777777";

const SESSION = {
  access_token: "fake-access-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 9999999999,
  refresh_token: "fake-refresh-token",
  user: {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "sowmya.seed@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Sowmya Seed" },
    created_at: "2026-07-09T00:00:00Z",
  },
};

// Date-only helpers relative to the REAL clock (the app classifies against
// local today).
function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function providerRow(over: Record<string, unknown> = {}) {
  return {
    id: PROVIDER_ID,
    org_id: ORG_ID,
    first_name: "Brooke",
    last_name: "Ostrander",
    credentials: "PT",
    npi: "1093817465",
    caqh_id: "16224897",
    caqh_last_attested_date: isoDaysFromNow(-10),
    specialty: "Physical Therapy",
    taxonomy_code: null,
    dea_number: null,
    date_of_birth: "1990-01-01",
    ssn_last4: "6789",
    email: "brooke@example.test",
    phone: "252-555-0101",
    start_date: "2026-06-01",
    home_street: "1 Sandbar Ln",
    home_city: "Nags Head",
    home_state: "NC",
    home_zip: "27959",
    malpractice_coverage_end: isoDaysFromNow(400),
    status: "active",
    verification_state: "verified",
    is_test_provider: false,
    reference_only: false,
    group_id: null,
    created_at: "2026-07-10T00:00:00Z",
    updated_at: "2026-07-10T00:00:00Z",
    ...over,
  };
}

function groupRow() {
  return {
    id: GROUP_ID,
    org_id: ORG_ID,
    name: "Outer Banks Rehab Group LLC",
    tin: "123456789",
    states: ["NC"],
    is_active: true,
    created_at: "2026-07-10T00:00:00Z",
  };
}

interface DocRowInput {
  id: string;
  docType: string;
  providerId?: string | null;
  groupId?: string | null;
  expirationDate?: string | null;
  familyId?: string;
  versionNumber?: number;
  supersedes?: string | null;
  fileName?: string;
}

// A snake_case provider_documents fixture row in the POST-migration shape.
function docRow(input: DocRowInput) {
  const family = input.familyId ?? `fam-${input.id}`;
  return {
    id: input.id,
    org_id: ORG_ID,
    provider_id: input.providerId ?? null,
    group_id: input.groupId ?? null,
    case_id: null,
    doc_type: input.docType,
    file_name: input.fileName ?? `${input.docType}.pdf`,
    file_path: `org/${ORG_ID}/${input.providerId ? "provider" : "group"}/${
      input.providerId ?? input.groupId
    }/${family}/${input.versionNumber ?? 1}/${input.fileName ?? `${input.docType}.pdf`}`,
    effective_date: null,
    expiration_date: input.expirationDate ?? null,
    uploaded_by: USER_ID,
    created_at: "2026-07-15T00:00:00Z",
    document_family_id: family,
    version_number: input.versionNumber ?? 1,
    supersedes_document_id: input.supersedes ?? null,
  };
}

function makeFixtures(over: Record<string, unknown[]> = {}) {
  return {
    organizations: [
      {
        id: ORG_ID,
        name: "Outer Banks Rehab Group",
        lifecycle_state: "active",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    memberships: [
      {
        org_id: ORG_ID,
        role: "admin",
        organizations: {
          name: "Outer Banks Rehab Group",
          lifecycle_state: "active",
          created_at: "2026-07-01T00:00:00Z",
        },
      },
    ],
    profiles: [
      {
        id: USER_ID,
        full_name: "Sowmya Seed",
        email: "sowmya.seed@example.test",
        created_at: "2026-07-09T00:00:00Z",
      },
    ],
    notes: [],
    user_table_prefs: [],
    audit_log: [],
    credential_cases: [],
    status_configs: [],
    contracts: [],
    payers: [],
    msos: [],
    mso_routing_rules: [],
    tasks: [],
    touches: [],
    status_history: [],
    payer_pipeline_history: [],
    denial_reason_codes: [],
    portals: [],
    party_role_assignments: [],
    provider_groups: [],
    facilities: [],
    providers: [],
    state_licenses: [],
    provider_group_assignments: [],
    provider_facility_assignments: [],
    org_payer_assignments: [],
    payer_network_targets: [],
    provider_documents: [],
    group_insurance_policies: [],
    import_runs: [],
    sop_templates: [],
    next_best_action_configs: [],
    case_generation_exclusions: [],
    ...over,
  } as Record<string, unknown[]>;
}

interface Recorder {
  apiCalls: Array<{ method: string; path: string; body: unknown }>;
  storagePuts: string[];
  documentQueries: string[];
}

// PostgREST-ish filter matcher over fixture rows (eq/neq/in/is.null/
// not.is.null + order=col.dir) — the house harness idiom, plus the E4.5
// document filters (.not("group_id","is",null) and .in("doc_type", ...)).
function applyQuery(rows: unknown[], url: URL): unknown[] {
  const SKIP = new Set(["select", "order", "limit", "offset", "on_conflict", "or", "apikey"]);
  let out = rows.filter((r) => {
    const row = r as Record<string, unknown>;
    for (const [key, raw] of url.searchParams.entries()) {
      if (SKIP.has(key)) continue;
      if (!(key in row)) continue;
      if (raw.startsWith("eq.")) {
        if (String(row[key]) !== raw.slice(3)) return false;
      } else if (raw.startsWith("neq.")) {
        if (String(row[key]) === raw.slice(4)) return false;
      } else if (raw.startsWith("in.(")) {
        const vals = raw
          .slice(4, -1)
          .split(",")
          .map((s) => s.replace(/^"|"$/g, ""));
        if (!vals.includes(String(row[key]))) return false;
      } else if (raw === "is.null") {
        if (row[key] != null) return false;
      } else if (raw === "not.is.null") {
        if (row[key] == null) return false;
      }
    }
    return true;
  });
  const order = url.searchParams.get("order");
  if (order) {
    const [col, dir] = order.split(".");
    out = [...out].sort((a, b) => {
      const av = String((a as Record<string, unknown>)[col] ?? "");
      const bv = String((b as Record<string, unknown>)[col] ?? "");
      return dir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv);
    });
  }
  return out;
}

// camelCase view of a snake_case document fixture row (what the /api envelope
// carries — the server camelizes before responding).
function camelDoc(row: Record<string, unknown>) {
  return {
    id: row.id,
    orgId: row.org_id,
    providerId: row.provider_id,
    groupId: row.group_id,
    caseId: row.case_id,
    docType: row.doc_type,
    fileName: row.file_name,
    filePath: row.file_path,
    effectiveDate: row.effective_date,
    expirationDate: row.expiration_date,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    documentFamilyId: row.document_family_id,
    versionNumber: row.version_number,
    supersedesDocumentId: row.supersedes_document_id,
  };
}

// Mount all three mock layers: /rest+auth (fixtures), /api/documents/*
// (write-through signed actions), /storage/v1 (signed PUT/GET).
async function mountAll(context: BrowserContext, fixtures: Record<string, unknown[]>) {
  const rec: Recorder = { apiCalls: [], storagePuts: [], documentQueries: [] };

  await context.route(/\/(rest|auth)\/v1\//, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.includes("/rest/v1/rpc/get_sop_field_tokens")) return json([]);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
    if (table === "provider_documents") rec.documentQueries.push(url.search);
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (req.method() !== "GET") return json(wantsObject ? {} : [{}], 201);

    let rows = applyQuery(fixtures[table] ?? [], url);
    // getCase embeds (the case-creation harness gotcha: synthesize on the
    // ARRAY path too — this repo's maybeSingle fetches arrays).
    if (table === "credential_cases") {
      rows = rows.map((r) => {
        const c = r as Record<string, unknown>;
        return {
          ...c,
          provider: (fixtures.providers ?? []).find(
            (p) => (p as Record<string, unknown>).id === c.provider_id,
          ),
          payer:
            (fixtures.payers ?? []).find((p) => (p as Record<string, unknown>).id === c.payer_id) ??
            null,
          mso: null,
          group:
            (fixtures.provider_groups ?? []).find(
              (g) => (g as Record<string, unknown>).id === c.group_id,
            ) ?? null,
          facility: null,
          credentialing_status: null,
          tasks: (fixtures.tasks ?? []).filter(
            (t) => (t as Record<string, unknown>).case_id === c.id,
          ),
          touches: [],
          status_history: [],
          payer_pipeline_history: [],
        };
      });
    }
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  });

  // The app's own signed-action endpoints (same-origin nitro routes in prod;
  // mocked here with the SAME contract + a write-through into the fixtures).
  await context.route(/\/api\/documents\//, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ data, error: null, meta: null }),
      });
    let body: Record<string, unknown> = {};
    try {
      body = req.postData()
        ? (JSON.parse(req.postData() as string) as Record<string, unknown>)
        : {};
    } catch {
      body = {};
    }
    rec.apiCalls.push({ method: req.method(), path: url.pathname, body });

    if (url.pathname.endsWith("/upload-intent")) {
      const familyId = (body.familyId as string | null) ?? `fam-new-${rec.apiCalls.length}`;
      const family = (fixtures.provider_documents ?? []).filter(
        (d) => (d as Record<string, unknown>).document_family_id === familyId,
      );
      const versionNumber =
        family.reduce(
          (max, d) => Math.max(max, Number((d as Record<string, unknown>).version_number ?? 1)),
          0,
        ) + 1;
      const path = `org/${ORG_ID}/${body.ownerType}/${body.ownerId}/${familyId}/${versionNumber}/${body.fileName}`;
      return json({
        familyId,
        versionNumber,
        path,
        uploadUrl: `https://example.supabase.co/storage/v1/object/upload/sign/provider-documents/${path}?token=up`,
        token: "up",
      });
    }
    if (url.pathname.endsWith("/finalize")) {
      const familyId = body.familyId as string;
      const family = (fixtures.provider_documents ?? []).filter(
        (d) => (d as Record<string, unknown>).document_family_id === familyId,
      );
      const superseded = new Set(
        family
          .map((d) => (d as Record<string, unknown>).supersedes_document_id)
          .filter((id) => typeof id === "string"),
      );
      const head = family.find((d) => !superseded.has((d as Record<string, unknown>).id)) as
        Record<string, unknown> | undefined;
      const row = docRow({
        id: `doc-${familyId}-v${body.versionNumber}`,
        docType: body.kind as string,
        providerId: body.ownerType === "provider" ? (body.ownerId as string) : null,
        groupId: body.ownerType === "group" ? (body.ownerId as string) : null,
        expirationDate: (body.expirationDate as string | null) ?? null,
        familyId,
        versionNumber: body.versionNumber as number,
        supersedes: (head?.id as string | undefined) ?? null,
        fileName: body.fileName as string,
      });
      fixtures.provider_documents = [...(fixtures.provider_documents ?? []), row];
      return json(camelDoc(row), 201);
    }
    const downloadMatch = url.pathname.match(/\/api\/documents\/([^/]+)\/download\/?$/);
    if (downloadMatch) {
      const d = (fixtures.provider_documents ?? []).find(
        (r) => (r as Record<string, unknown>).id === downloadMatch[1],
      ) as Record<string, unknown> | undefined;
      if (!d) return json(null, 404);
      return json({
        url: `https://example.supabase.co/storage/v1/object/sign/provider-documents/${d.file_path}?token=signed`,
        fileName: d.file_name,
        expiresIn: 120,
      });
    }
    return json(null, 404);
  });

  // Storage: the signed byte PUT and the signed download GET.
  await context.route(/\/storage\/v1\//, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "PUT") {
      rec.storagePuts.push(url.pathname);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ Key: url.pathname }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/pdf", body: "FAKEPDF" });
  });

  await context.addInitScript(
    ([authKey, session, orgId]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_ID] as const,
  );
  return rec;
}

const FAKE_PDF = {
  name: "license.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("FAKEPDF"),
};

test("TS-88: provider-grain upload requires the expiration for dated kinds, versions on re-upload, and stays org-scoped + signed", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures({ providers: [providerRow()] });
  const rec = await mountAll(context, fixtures);

  await page.goto(`/providers/${PROVIDER_ID}`);
  await expect(page.getByRole("heading", { name: /Brooke Ostrander/ })).toBeVisible({
    timeout: 30000,
  });
  const panel = page.locator("section", { hasText: "Documents" }).last();
  await expect(panel).toContainText("No documents on file");

  // Upload a State License — a dated kind: submitting without an expiration
  // date is blocked client-side (and would be a 422 server-side + DB CHECK).
  await panel.getByRole("button", { name: "Upload" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").click();
  // The provider grain offers provider kinds only — no W-9/CMS-460 (D1).
  await expect(page.getByRole("option", { name: "State License" })).toBeVisible();
  await expect(page.getByRole("option", { name: "W-9" })).toHaveCount(0);
  await page.getByRole("option", { name: "State License" }).click();
  await dialog.locator("#doc-file").setInputFiles(FAKE_PDF);
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(dialog).toContainText("State License requires an expiration date");

  // Pick an expiration day from the calendar (current month).
  await dialog.getByRole("button", { name: "Expiration date" }).click();
  const monthName = new Date().toLocaleString("en-US", { month: "long" });
  await page
    .getByRole("button", { name: new RegExp(`${monthName} 28th`) })
    .first()
    .click();
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();

  // v1 lands: intent -> signed PUT -> finalize, and the table re-derives.
  await expect(panel).toContainText("State License", { timeout: 15000 });
  await expect(panel).toContainText("v1");
  const intent = rec.apiCalls.find((c) => c.path.endsWith("/upload-intent"));
  expect(intent?.body).toMatchObject({
    ownerType: "provider",
    ownerId: PROVIDER_ID,
    kind: "state_license",
  });
  expect(rec.storagePuts.length).toBe(1);
  expect(rec.storagePuts[0]).toContain(`/org/${ORG_ID}/provider/${PROVIDER_ID}/`);
  const finalize = rec.apiCalls.find((c) => c.path.endsWith("/finalize"));
  expect(finalize?.body).toMatchObject({ kind: "state_license", versionNumber: 1 });
  // Every metadata read the panel made was org-scoped.
  expect(rec.documentQueries.length).toBeGreaterThan(0);
  for (const q of rec.documentQueries) expect(q).toContain(`org_id=eq.${ORG_ID}`);

  // Re-upload (replace): version 2 supersedes v1; prior version retained and
  // the current one marked in history.
  await panel.getByRole("button", { name: "Replace State License" }).click();
  const replaceDialog = page.getByRole("dialog");
  await replaceDialog.locator("#doc-file").setInputFiles(FAKE_PDF);
  await replaceDialog.getByRole("button", { name: "Expiration date" }).click();
  await page
    .getByRole("button", { name: new RegExp(`${monthName} 28th`) })
    .first()
    .click();
  await replaceDialog.getByRole("button", { name: "Upload new version" }).click();

  await expect(panel).toContainText("v2 · history", { timeout: 15000 });
  const replayIntent = rec.apiCalls.filter((c) => c.path.endsWith("/upload-intent"))[1];
  expect(replayIntent?.body).toMatchObject({ kind: "state_license" });
  expect((replayIntent?.body as { familyId?: string }).familyId).toBeTruthy();

  await panel.getByRole("button", { name: "v2 · history" }).click();
  const history = page.getByRole("dialog");
  await expect(history).toContainText("version history");
  await expect(history.getByRole("row")).toHaveCount(3); // header + v2 + v1
  await expect(history.getByRole("row").nth(1)).toContainText("v2");
  await expect(history.getByRole("row").nth(1)).toContainText("Current");
  await expect(history.getByRole("row").nth(2)).toContainText("v1");
});

test("TS-88: the group grain offers group kinds and stores a W-9 on the group record", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures({ provider_groups: [groupRow()] });
  const rec = await mountAll(context, fixtures);

  await page.goto("/onboarding/wizard");
  const groupCard = page.locator("#wizard-provider-group");
  await expect(groupCard).toContainText("Outer Banks Rehab Group LLC", { timeout: 30000 });

  await groupCard.getByRole("button", { name: "Documents" }).click();
  const panel = groupCard.locator("section", { hasText: "Documents" }).last();
  await panel.getByRole("button", { name: "Upload" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").click();
  // The group grain: W-9/CMS-460/Voided Check/COI — never State License (D1).
  await expect(page.getByRole("option", { name: "W-9" })).toBeVisible();
  await expect(page.getByRole("option", { name: "CMS-460" })).toBeVisible();
  await expect(page.getByRole("option", { name: "State License" })).toHaveCount(0);
  await page.getByRole("option", { name: "W-9" }).click();
  await dialog.locator("#doc-file").setInputFiles({ ...FAKE_PDF, name: "w9.pdf" });
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();

  await expect(panel).toContainText("W-9", { timeout: 15000 });
  const intent = rec.apiCalls.find((c) => c.path.endsWith("/upload-intent"));
  expect(intent?.body).toMatchObject({ ownerType: "group", ownerId: GROUP_ID, kind: "w9" });
  expect(rec.storagePuts[0]).toContain(`/org/${ORG_ID}/group/${GROUP_ID}/`);
});

test("TS-89: the expiring-credentials table sorts by expiration with derived states, and readiness carries the COI advisory", async ({
  context,
  page,
}) => {
  const expired = docRow({
    id: "doc-expired",
    docType: "state_license",
    providerId: PROVIDER_ID,
    expirationDate: isoDaysFromNow(-10),
    fileName: "old-license.pdf",
  });
  const soonCoi = docRow({
    id: "doc-soon",
    docType: "coi",
    groupId: GROUP_ID,
    expirationDate: isoDaysFromNow(21),
    fileName: "group-coi.pdf",
  });
  const currentDea = docRow({
    id: "doc-current",
    docType: "dea",
    providerId: PROVIDER_ID,
    expirationDate: isoDaysFromNow(200),
    fileName: "dea.pdf",
  });
  const fixtures = makeFixtures({
    providers: [providerRow()],
    provider_groups: [groupRow()],
    facilities: [
      {
        id: "fac-1",
        org_id: ORG_ID,
        group_id: GROUP_ID,
        name: "Nags Head Clinic",
        street: "1 Main St",
        city: "Nags Head",
        state: "NC",
        zip: "27959",
        is_active: true,
        status_id: null,
        effective_date: null,
        reference_only: false,
        created_at: "2026-07-10T00:00:00Z",
      },
    ],
    provider_group_assignments: [
      {
        id: "ga-1",
        org_id: ORG_ID,
        provider_id: PROVIDER_ID,
        group_id: GROUP_ID,
        is_primary: true,
      },
    ],
    state_licenses: [
      {
        id: "lic-1",
        org_id: ORG_ID,
        provider_id: PROVIDER_ID,
        state: "NC",
        license_number: "PT-48213",
        expiration_date: isoDaysFromNow(300),
        verified_status: "verified",
      },
    ],
    payers: [
      {
        id: PAYER_ID,
        org_id: null,
        name: "Blue Cross and Blue Shield of North Carolina",
        payer_kind: "commercial",
        states: ["NC"],
        aliases: [],
        status: "active",
        payer_slug: "bcbs-nc",
        is_active: true,
        created_at: "2026-07-10T00:00:00Z",
      },
    ],
    org_payer_assignments: [{ id: "opa-1", org_id: ORG_ID, payer_id: PAYER_ID, starter: false }],
    payer_network_targets: [
      {
        id: "pnt-1",
        org_id: ORG_ID,
        payer_id: PAYER_ID,
        group_id: GROUP_ID,
        state: "NC",
        status: "active",
        created_at: "2026-07-12T00:00:00Z",
      },
    ],
    provider_documents: [
      expired,
      soonCoi,
      currentDea,
      // Dateless w9 + voided check keep the other group checks green so the
      // advisory is the ONLY amber note on the readiness row.
      docRow({ id: "doc-w9", docType: "w9", groupId: GROUP_ID }),
      docRow({ id: "doc-vc", docType: "voided_check", groupId: GROUP_ID }),
    ],
  });
  await mountAll(context, fixtures);

  // The org-level table: sorted soonest-first with derived states.
  await page.goto("/reporting/expiring-credentials");
  await expect(page.getByRole("heading", { name: "Expiring Credentials" })).toBeVisible({
    timeout: 30000,
  });
  const dataRows = page.getByRole("row");
  await expect(dataRows).toHaveCount(4); // header + 3 dated documents
  await expect(dataRows.nth(1)).toContainText("State License");
  await expect(dataRows.nth(1)).toContainText("Expired");
  await expect(dataRows.nth(2)).toContainText("COI");
  await expect(dataRows.nth(2)).toContainText("Expiring soon");
  await expect(dataRows.nth(3)).toContainText("DEA");
  await expect(dataRows.nth(3)).toContainText("Current");
  // Owner resolution: the provider links; the group names.
  await expect(dataRows.nth(1)).toContainText("Brooke Ostrander");
  await expect(dataRows.nth(2)).toContainText("Outer Banks Rehab Group LLC");

  // The readiness view (the provider record's section since 2026-07-21)
  // carries the advisory warning: COI passes (21 days out) WITH the amber
  // note — never a gap, nothing disabled.
  await page.goto(`/providers/${PROVIDER_ID}`);
  const card = page.locator("#readiness");
  await expect(card).toContainText("Ready", { timeout: 30000 });
  await card.locator("tbody tr").first().click();
  await expect(card).toContainText("Group COI current");
  await expect(card).toContainText(`COI expires ${isoDaysFromNow(21)}`);
  // Advisory, not a gap: no fix-here affordance for the COI check.
  await expect(card.getByRole("button", { name: /Fix.*COI/ })).toHaveCount(0);
  await expect(card.getByRole("link", { name: /Fix.*COI/ })).toHaveCount(0);
});

test("TS-90: case detail derives required-document status live and downloads the current version via a short-lived signed URL", async ({
  context,
  page,
}) => {
  const providerLicense = docRow({
    id: "doc-lic",
    docType: "state_license",
    providerId: PROVIDER_ID,
    expirationDate: isoDaysFromNow(300),
    fileName: "license.pdf",
  });
  const expiredGroupCoi = docRow({
    id: "doc-coi",
    docType: "coi",
    groupId: GROUP_ID,
    expirationDate: isoDaysFromNow(-5),
    fileName: "coi.pdf",
  });
  const fixtures = makeFixtures({
    providers: [providerRow()],
    provider_groups: [groupRow()],
    payers: [
      {
        id: PAYER_ID,
        org_id: null,
        name: "Blue Cross and Blue Shield of North Carolina",
        payer_kind: "commercial",
        states: ["NC"],
        aliases: [],
        status: "active",
        payer_slug: "bcbs-nc",
        is_active: true,
        created_at: "2026-07-10T00:00:00Z",
      },
    ],
    credential_cases: [
      {
        id: CASE_ID,
        org_id: ORG_ID,
        provider_id: PROVIDER_ID,
        group_id: GROUP_ID,
        payer_id: PAYER_ID,
        state: "NC",
        facility_id: null,
        credentialing_status_id: null,
        payer_pipeline_state: "assigned",
        payer_reference_id: null,
        submitted_date: null,
        confirmed_effective_date: null,
        specialty: null,
        assigned_to: null,
        generation_run_id: null,
        created_by: USER_ID,
        created_at: "2026-07-14T00:00:00Z",
        updated_at: "2026-07-14T00:00:00Z",
      },
    ],
    tasks: [
      {
        id: "task-1",
        org_id: ORG_ID,
        case_id: CASE_ID,
        provider_id: PROVIDER_ID,
        title: "Submit enrollment packet",
        description: null,
        sop_content: [
          {
            id: "s1",
            order: 1,
            label: "Gather documents",
            isCompleted: false,
            stepType: "online_form",
            requiredArtifacts: ["state_license", "W-9", "coi", "Submission confirmation PDF"],
          },
        ],
        status: "pending",
        sort_order: 1,
        due_date: null,
        completed_date: null,
        is_auto_generated: true,
        sop_template_id: null,
        sop_version: null,
        execution_type: null,
        sop_resolution_tier: null,
        created_at: "2026-07-14T00:00:00Z",
        updated_at: "2026-07-14T00:00:00Z",
      },
    ],
    provider_documents: [providerLicense, expiredGroupCoi],
  });
  const rec = await mountAll(context, fixtures);

  await page.goto(`/cases/${CASE_ID}`);
  const panel = page.locator("section", { hasText: "Required documents" }).last();
  await expect(panel).toBeVisible({ timeout: 30000 });

  // Derived live from the store: present / expired / missing; the free-form
  // artifact name never becomes a document requirement.
  await expect(panel).toContainText("1 of 3 ready");
  const licenseRow = panel.locator("li", { hasText: "State License" });
  await expect(licenseRow).toContainText("Present");
  const coiRow = panel.locator("li", { hasText: "COI" });
  await expect(coiRow).toContainText("Expired");
  const w9Row = panel.locator("li", { hasText: "W-9" });
  await expect(w9Row).toContainText("Missing");
  await expect(panel).not.toContainText("Submission confirmation PDF");

  // One-click download of the current version rides the audited signed-URL
  // endpoint (short-lived by contract).
  const popupPromise = page.waitForEvent("popup");
  await licenseRow.getByRole("button", { name: "Download license.pdf" }).click();
  await popupPromise;
  const download = rec.apiCalls.find((c) => c.path.endsWith("/doc-lic/download"));
  expect(download).toBeTruthy();
  // The missing W-9 offers no download.
  await expect(w9Row.getByRole("button", { name: /Download/ })).toHaveCount(0);
});
