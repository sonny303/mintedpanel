import { test, expect, type Route } from "@playwright/test";

// E6.5 — the consolidated Payer Setup module over the mock harness
// (TS-114/131/132/133/134). Supersedes e2e/fix-it.spec.ts (drift repair moved
// into the SOP editor — TS-132 here) and e2e/payer-setup-funnel.spec.ts (the
// org-grain setup list retired; the funnel is the global Ready-for-business
// ladder asserted here).
//
//   TS-114 — the module head is the SINGLE-VIEW Payer Setup page (payer-and-
//            cases screen 1 — Slice A retarget: the tab strip + Ready-for-
//            business funnel are superseded by the KPI-card table; the SOPs
//            segment stays a shareable legacy URL with the governance note
//            until Slice G folds it); global SOP authoring still hits
//            author_global_sop on the wire, entered via the SOPs segment.
//   TS-131 — the portal picker offers the payer's registered portals first
//            (shared registry reuse), "Show all portals" reveals the rest.
//   TS-132 — real-fill drift telemetry → Sidebar badge + SOPs-tab banner →
//            repair in the editor (train_global_field_map) → badge clears
//            (repaired-since rule); nothing is ever blocked by drift.
//   TS-133 — delegation renders as a curated catalog fact; NO request ever
//            touches the retired MSO routing tables.
//   TS-134 — failing mock dry run lists the unmatched field → train → re-run
//            green → proven_at flips via set_global_portal_flags. The dry run
//            records is_test with provider_id NULL (synthetic profile — no
//            provider row involved).

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "00000000-0000-4000-a000-000000000005";
const AETNA_ID = "00000000-0000-4000-a000-0000000000aa";
const BCBS_ID = "00000000-0000-4000-a000-0000000000bb";
const BCBS_TPL_ID = "00000000-0000-4000-a000-00000000t0b1";

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
    email: "owner.dillon@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Owner Dillon" },
    created_at: "2026-07-09T00:00:00Z",
  },
};

type Row = Record<string, unknown>;
type Scenario = "authoring" | "form-setup" | "drift";

const FIELD_NOT_FOUND = "field not found on this page";

function payerRow(id: string, name: string, extra: Row = {}): Row {
  return {
    id,
    org_id: null,
    name,
    is_active: true,
    avg_decision_days: null,
    payer_kind: "commercial",
    payer_slug: name.toLowerCase().split(" ")[0],
    aliases: [],
    states: ["NC"],
    status: "active",
    delegation_note: null,
    resolution_id_label: null,
    resolution_id_expected: null,
    created_at: "2026-07-12T00:00:00Z",
    ...extra,
  };
}

function buildDb(scenario: Scenario): Record<string, Row[]> {
  const db: Record<string, Row[]> = {
    memberships: [
      {
        org_id: ORG_ID,
        role: "admin",
        organizations: {
          name: "Dillon Sports Medicine",
          lifecycle_state: "active",
          created_at: "2026-07-01T00:00:00Z",
        },
      },
    ],
    profiles: [{ id: USER_ID, full_name: "Owner Dillon", email: "owner.dillon@example.test" }],
    payers: [
      payerRow(AETNA_ID, "Aetna (CVS Health)"),
      payerRow(BCBS_ID, "BCBS Kansas", {
        // TS-133 — delegation is a curated catalog fact (no app writer).
        delegation_note: "Delegated to Availity — submit through the Availity portal, not BCBS.",
      }),
    ],
    org_payer_assignments: [
      { id: "as-1", org_id: ORG_ID, payer_id: AETNA_ID, starter: false, status: "active" },
      { id: "as-2", org_id: ORG_ID, payer_id: BCBS_ID, starter: false, status: "active" },
    ],
    sop_templates: [],
    sop_template_versions: [],
    portals: [],
    portal_field_maps: [],
    fill_sessions: [],
    field_dictionary: [],
    provider_groups: [],
    denial_reason_codes: [],
    org_payer_settings: [],
    notes: [],
    user_table_prefs: [],
  };

  if (scenario !== "authoring") {
    db.sop_templates.push({
      id: BCBS_TPL_ID,
      org_id: null,
      name: "BCBS Kansas NC Enrollment",
      payer_id: BCBS_ID,
      state: "NC",
      specialty: null,
      group_id: null,
      archived: false,
      current_version: 1,
      required_profile_attributes: [],
      task_definitions: [
        {
          title: "Submit the enrollment form",
          sortOrder: 0,
          steps: [
            {
              label: "Fill the portal form",
              stepType: "online_form",
              portalKey: "bcbs_ks_enrollment",
              dataFields: [],
            },
          ],
        },
      ],
      created_at: "2026-07-13T00:00:00Z",
      updated_at: "2026-07-13T00:00:00Z",
    });
    db.portals.push(
      {
        id: "portal-bcbs",
        org_id: null,
        portal_key: "bcbs_ks_enrollment",
        name: "BCBS KS Enrollment",
        payer_id: BCBS_ID,
        form_url: "https://portal.example/bcbs",
        is_verified: true,
        last_verified_at: "2026-07-14T00:00:00Z",
        proven_at: null,
        url_changed_at: null,
        created_at: "2026-07-13T00:00:00Z",
        updated_at: "2026-07-13T00:00:00Z",
      },
      {
        id: "portal-aetna",
        org_id: null,
        portal_key: "aetna_enroll",
        name: "Aetna Portal",
        payer_id: AETNA_ID,
        form_url: "https://portal.example/aetna",
        is_verified: false,
        last_verified_at: null,
        proven_at: null,
        url_changed_at: null,
        created_at: "2026-07-13T00:00:00Z",
        updated_at: "2026-07-13T00:00:00Z",
      },
    );
    db.portal_field_maps.push(
      {
        id: "m1",
        org_id: null,
        portal_key: "bcbs_ks_enrollment",
        url_pattern: null,
        page_step: null,
        map_type: "web",
        selector: "label:NPI Number",
        selector_fallbacks: null,
        source: "token",
        token: "provider.npi",
        hardcoded_value: null,
        transform: null,
        field_type: "text",
        notes: null,
        status: "approved",
        field_label: "NPI Number",
        form_section: null,
        confidence: 90,
        created_at: "2026-07-13T00:00:00Z",
        updated_at: "2026-07-13T00:00:00Z",
      },
      {
        id: "m2",
        org_id: null,
        portal_key: "bcbs_ks_enrollment",
        url_pattern: null,
        page_step: null,
        map_type: "web",
        selector: "#caqh",
        selector_fallbacks: null,
        source: "token",
        token: "provider.caqhId",
        hardcoded_value: null,
        transform: null,
        field_type: "text",
        notes: null,
        status: "proposed",
        field_label: "CAQH ID",
        form_section: null,
        confidence: 55,
        created_at: "2026-07-13T00:00:00Z",
        updated_at: "2026-07-13T00:00:00Z",
      },
    );
  }

  if (scenario === "drift") {
    // The last REAL fill reported the trained NPI selector missing (the locked
    // extension telemetry: kind "skipped" + the exact not-found wording +
    // mapId). Newer than m1.updated_at, so the repaired-since rule keeps it
    // drifted until the editor retrains it.
    db.fill_sessions.push({
      id: "fill-real-1",
      org_id: ORG_ID,
      case_id: "case-1",
      provider_id: "prov-1",
      portal_key: "bcbs_ks_enrollment",
      fill_mode: "web",
      started_at: "2026-07-18T12:00:00Z",
      completed_at: "2026-07-18T12:01:00Z",
      fields_filled: 7,
      fields_skipped: [
        { label: "NPI Number", reason: FIELD_NOT_FOUND, kind: "skipped", mapId: "m1" },
      ],
      docs_attached: null,
      performed_by: USER_ID,
      is_test: false,
    });
  }

  return db;
}

const TOKEN_CATALOG = [
  { table: "providers", token: "provider.npi", column: "npi" },
  { table: "providers", token: "provider.caqhId", column: "caqh_id" },
  { table: "providers", token: "provider.firstName", column: "first_name" },
  { table: "providers", token: "provider.lastName", column: "last_name" },
];

interface RecordedCall {
  kind: "rpc" | "rest";
  path: string;
  method: string;
  body: unknown;
}

let scenario: Scenario = "authoring";
let db: Record<string, Row[]> | null = null;
const calls: RecordedCall[] = [];
let seq = 0;

function nowIso(): string {
  return new Date().toISOString();
}

async function fulfillSupabase(route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  db ??= buildDb(scenario);

  if (url.pathname.includes("/auth/v1/")) return json(SESSION);

  if (url.pathname.includes("/rest/v1/rpc/")) {
    const fn = url.pathname.split("/rpc/")[1] ?? "";
    const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    calls.push({ kind: "rpc", path: fn, method: "POST", body });

    if (fn === "list_global_payers") return json(db.payers.filter((p) => p.org_id === null));
    if (fn === "get_sop_field_tokens") return json(TOKEN_CATALOG);
    if (fn === "author_global_sop") {
      if (body.p_id) {
        const row = db.sop_templates.find((t) => t.id === body.p_id);
        if (!row) return json({ message: "Template not found" }, 400);
        Object.assign(row, {
          payer_id: body.p_payer_id ?? null,
          state: body.p_state ?? null,
          group_id: body.p_group_id ?? null,
          archived: Boolean(body.p_archived),
          updated_at: nowIso(),
        });
        return json(row);
      }
      const row: Row = {
        id: `tpl-new-${(seq += 1)}`,
        org_id: null,
        name: body.p_name,
        payer_id: body.p_payer_id ?? null,
        state: body.p_state ?? null,
        specialty: null,
        group_id: body.p_group_id ?? null,
        archived: Boolean(body.p_archived),
        current_version: 1,
        required_profile_attributes: body.p_required_profile_attributes ?? [],
        task_definitions: body.p_task_definitions ?? [],
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      db.sop_templates.push(row);
      return json(row);
    }
    if (fn === "publish_sop_template_version") {
      const row = db.sop_templates.find((t) => t.id === body.p_template_id);
      if (!row) return json({ message: "Template not found" }, 400);
      const next = Number(row.current_version ?? 1) + 1;
      Object.assign(row, {
        name: body.p_name,
        task_definitions: body.p_task_definitions,
        current_version: next,
        updated_at: nowIso(),
      });
      return json({ template_id: row.id, version: next });
    }
    if (fn === "upsert_global_portal") {
      const key = String(body.p_portal_key ?? "").toLowerCase();
      const row: Row = {
        id: `portal-new-${(seq += 1)}`,
        org_id: null,
        portal_key: key,
        name: body.p_name,
        payer_id: body.p_payer_id ?? null,
        form_url: body.p_form_url ?? null,
        is_verified: false,
        last_verified_at: null,
        proven_at: null,
        url_changed_at: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      db.portals.push(row);
      return json(row);
    }
    if (fn === "set_global_portal_flags") {
      const row = db.portals.find((p) => p.id === body.p_id && p.org_id === null);
      if (!row) return json({ message: "Portal not found" }, 400);
      if (body.p_verified === true) {
        row.is_verified = true;
        row.last_verified_at = nowIso();
      }
      if (body.p_proven === true) row.proven_at = nowIso();
      if (body.p_proven === false) row.proven_at = null;
      return json(row);
    }
    if (fn === "train_global_field_map") {
      const row = db.portal_field_maps.find((m) => m.id === body.p_id && m.org_id === null);
      if (!row) return json({ message: "Field map not found" }, 400);
      Object.assign(row, {
        status: body.p_status,
        source: body.p_source,
        token: body.p_token ?? null,
        updated_at: nowIso(),
      });
      if (body.p_source === "manual" && row.notes == null) row.notes = "Marked manual";
      return json(row);
    }
    if (fn === "claim_invites") return json(0);
    return json(null);
  }

  const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
  const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

  const matchFilters = (row: Row): boolean => {
    for (const [key, raw] of url.searchParams.entries()) {
      if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(key)) continue;
      if (!(key in row)) continue;
      if (raw.startsWith("eq.")) {
        if (String(row[key]) !== raw.slice(3)) return false;
      } else if (raw.startsWith("neq.")) {
        if (String(row[key]) === raw.slice(4)) return false;
      } else if (raw.startsWith("is.")) {
        if (raw.slice(3) === "null" && row[key] !== null) return false;
      } else if (raw.startsWith("in.(")) {
        const ids = raw
          .slice(4, -1)
          .split(",")
          .map((s) => s.replace(/^"|"$/g, ""));
        if (!ids.includes(String(row[key]))) return false;
      }
    }
    return true;
  };

  if (req.method() === "HEAD") {
    const n = (db[table] ?? []).filter(matchFilters).length;
    return route.fulfill({ status: 200, headers: { "content-range": `*/${n}` }, body: "" });
  }
  if (req.method() === "POST") {
    let parsed: unknown = null;
    try {
      parsed = req.postDataJSON();
    } catch {
      parsed = null;
    }
    const bodyRow = (Array.isArray(parsed) ? parsed[0] : parsed) as Row | null;
    calls.push({ kind: "rest", path: table, method: "POST", body: bodyRow });
    const row: Row = { id: `new-${(seq += 1)}`, created_at: nowIso(), ...(bodyRow ?? {}) };
    if (table === "fill_sessions") row.started_at = row.started_at ?? nowIso();
    if (db[table]) {
      // fill_sessions reads are newest-first; keep the array in that order.
      if (table === "fill_sessions") db[table].unshift(row);
      else db[table].push(row);
    }
    return json(wantsObject ? row : [row], 201);
  }
  if (req.method() === "PATCH") {
    let body: Row | null = null;
    try {
      body = req.postDataJSON() as Row;
    } catch {
      body = null;
    }
    calls.push({ kind: "rest", path: table, method: "PATCH", body });
    const rows = (db[table] ?? []).filter(matchFilters);
    for (const r of rows) Object.assign(r, body ?? {}, { updated_at: nowIso() });
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  }

  const rows = (db[table] ?? []).filter(matchFilters);
  if (wantsObject) {
    if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
    return json(rows[0]);
  }
  return json(rows);
}

test.beforeEach(async ({ context }) => {
  scenario = "authoring";
  db = null;
  calls.length = 0;
  await context.route(/\/(rest|auth)\/v1\//, fulfillSupabase);
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
});

test("TS-114a — the single-view Payer Setup page heads the module; the SOPs segment stays shareable", async ({
  page,
}) => {
  scenario = "form-setup";
  await page.goto("/admin/payer-admin/catalog");
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({ timeout: 30000 });

  // Screen 1 is ONE view: no tab strip and no Ready-for-business funnel —
  // per-payer state is the single Template-status badge in the table.
  await expect(page.getByRole("navigation", { name: "Payer Setup areas" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ready for business" })).toHaveCount(0);
  const aetnaRow = page.locator("tbody tr", { hasText: "Aetna (CVS Health)" }).first();
  await expect(aetnaRow.getByText("Needs template")).toBeVisible();
  const bcbsRow = page.locator("tbody tr", { hasText: "BCBS Kansas" }).first();
  await expect(bcbsRow.getByText("Published")).toBeVisible();

  // The SOPs segment is its own shareable URL with the templates list + the
  // F6.5.6 interim-governance note (the authoring machinery lives there
  // until Slice G folds the segment).
  await page.goto("/admin/payer-admin/sops");
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/authored once and inherited by every organization/i)).toBeVisible();
  await expect(page.getByText("BCBS Kansas NC Enrollment")).toBeVisible();
  await expect(page.getByRole("button", { name: "New global SOP" })).toBeVisible();
});

test("TS-114b — authoring a global SOP writes through author_global_sop (org_id NULL head)", async ({
  page,
}) => {
  scenario = "authoring";
  // Slice A retarget: the funnel's per-row author CTA is gone (screen 1 keeps
  // one Template-status badge); a payer needing a template shows the honest
  // badge, and authoring enters through the SOPs segment's New-global-SOP.
  await page.goto("/admin/payer-admin/catalog");
  const aetnaRow = page.locator("tbody tr", { hasText: "Aetna (CVS Health)" }).first();
  await expect(aetnaRow.getByText("Needs template")).toBeVisible({ timeout: 30000 });
  await page.goto("/admin/payer-admin/sops");
  const newSopButton = page.getByRole("button", { name: "New global SOP" });
  await expect(newSopButton).toBeVisible({ timeout: 30000 });
  await newSopButton.click();

  // The wizard opens in GLOBAL mode with the shared-blast banner visible.
  await expect(page).toHaveURL(/\/admin\/templates\/new\?.*tier=global/, { timeout: 30000 });
  await expect(page.getByText(/Global SOP — authored once and inherited/i)).toBeVisible();

  await page
    .locator('div:has(> label:text-is("Template name"))')
    .first()
    .locator("input")
    .fill("Aetna NC Enrollment");
  // Match-key selects: Payer / State / Group — pick Aetna + NC.
  await page.locator('div:has(> label:text-is("Payer"))').first().getByRole("combobox").click();
  await page.getByRole("option", { name: "Aetna (CVS Health)" }).click();
  await page.locator('div:has(> label:text-is("State"))').first().getByRole("combobox").click();
  await page.getByRole("option", { name: "NC", exact: true }).click();

  // Step 2: one named task; Step 3: one named step (the lint minimum).
  await page.getByRole("button", { name: /^2 Tasks$/ }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  await page
    .locator('div:has(> label:text-is("Task 1 title"))')
    .first()
    .locator("input")
    .fill("Submit enrollment");
  await page.getByRole("button", { name: /^3 Steps & fields$/ }).click();
  await page.getByRole("button", { name: "Add step" }).click();
  await page
    .locator('div:has(> label:text-is("Step 1 instruction"))')
    .first()
    .locator("textarea")
    .fill("Fill the Aetna portal form");

  await page.getByRole("button", { name: /^4 Review$/ }).click();
  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page.getByText("Global SOP created")).toBeVisible({ timeout: 15000 });

  const authored = calls.filter((c) => c.kind === "rpc" && c.path === "author_global_sop");
  expect(authored).toHaveLength(1);
  const body = authored[0].body as Record<string, unknown>;
  expect(body.p_id ?? null).toBeNull();
  expect(body.p_payer_id).toBe(AETNA_ID);
  expect(body.p_state).toBe("NC");
  expect(body.p_archived).toBe(false);
  expect(Array.isArray(body.p_task_definitions)).toBe(true);
  // No direct table write ever carried the head (RPC-only path).
  expect(calls.filter((c) => c.kind === "rest" && c.path === "sop_templates")).toEqual([]);
});

test("TS-131 — the step's portal picker offers the payer's registered portals first, all on demand", async ({
  page,
}) => {
  scenario = "form-setup";
  await page.goto(`/admin/templates/${BCBS_TPL_ID}`);
  await expect(page.getByRole("heading", { name: "BCBS Kansas NC Enrollment" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: /^3 Steps & fields$/ }).click();

  // Payer-filtered by default: the BCBS portal is offered, the Aetna one is not.
  const portalTrigger = page.getByRole("combobox").filter({ hasText: "BCBS KS Enrollment" });
  await expect(portalTrigger).toBeVisible();
  await portalTrigger.click();
  await expect(page.getByRole("option", { name: "BCBS KS Enrollment" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Aetna Portal" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The shared registry is one click away (cross-payer reuse).
  await page.getByRole("button", { name: "Show all portals" }).click();
  await portalTrigger.click();
  await expect(page.getByRole("option", { name: "Aetna Portal" })).toBeVisible();
  await page.keyboard.press("Escape");

  // The form panel resolves the SAME registry row (reused, not re-registered).
  await page.getByRole("button", { name: /Form setup/ }).click();
  await expect(page.getByText("BCBS KS Enrollment").last()).toBeVisible();
});

test("TS-132 — drift: badge + banner + in-editor repair clears it; never blocks", async ({
  page,
}) => {
  scenario = "drift";
  await page.goto("/admin/payer-admin/sops");

  // The Sidebar chip is DRIFT-ONLY (one broken mapping).
  await expect(page.getByLabel("1 broken form mappings").first()).toBeVisible({
    timeout: 30000,
  });

  // Queue-first banner names the portal + the field and deep-links the OWNING
  // SOP editor; the tab stays fully operable (warn, never block).
  const banner = page.getByText(/1 mapping broke on the last real fill of BCBS KS Enrollment/);
  await expect(banner).toBeVisible();
  await expect(
    page.getByRole("link", { name: "BCBS Kansas NC Enrollment", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "New global SOP" })).toBeEnabled();

  await page.getByRole("link", { name: /Open BCBS Kansas NC Enrollment/ }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/templates/${BCBS_TPL_ID}$`), { timeout: 30000 });

  // Step 3 → the form panel queues the broken mapping FIRST, labeled.
  await page.getByRole("button", { name: /^3 Steps & fields$/ }).click();
  await page.getByRole("button", { name: /Form setup/ }).click();
  const brokenRow = page
    .locator("div", { hasText: "NPI Number" })
    .filter({ has: page.getByRole("button", { name: "Approve" }) })
    .last();
  await expect(brokenRow.getByText("Broken")).toBeVisible();

  // Repair: retrain to a token → train_global_field_map on the wire (global
  // row) → the repaired-since rule re-derives the drift away.
  await brokenRow.getByRole("combobox").click();
  await page.getByRole("option", { name: "provider.npi", exact: true }).click();
  await brokenRow.getByRole("button", { name: "Approve" }).click();

  await expect
    .poll(
      () =>
        calls.filter(
          (c) =>
            c.kind === "rpc" &&
            c.path === "train_global_field_map" &&
            (c.body as Record<string, unknown>).p_id === "m1",
        ).length,
      { timeout: 15000 },
    )
    .toBe(1);

  // Badge clears once the caches re-derive (map edited after the fill).
  await expect(page.getByLabel(/broken form mappings/)).toHaveCount(0, { timeout: 15000 });
});

test("TS-133 — delegation renders as a catalog fact; the MSO routing engine is never consulted", async ({
  page,
}) => {
  scenario = "form-setup";
  await page.goto("/admin/payer-admin/catalog");
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({ timeout: 30000 });

  // Slice A retarget: the list keeps the four browse columns; the curated
  // delegation fact lives on the payer detail behind the name link.
  await page.getByLabel("Search payers").fill("BCBS");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("link", { name: "BCBS Kansas" }).click();
  await expect(
    page.getByText(/Delegated to Availity — submit through the Availity portal/),
  ).toBeVisible({ timeout: 30000 });

  // The retired routing engine is never consulted anywhere in the module.
  await page.goto("/admin/payer-admin/sops");
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({ timeout: 30000 });
  const msoCalls = calls.filter(
    (c) => c.path.includes("mso_routing_rules") || c.path === "msos" || c.path.includes("/msos"),
  );
  expect(msoCalls).toEqual([]);
});

test("TS-134 — mock dry run: fail lists the unmatched field, train, re-run green flips proven", async ({
  page,
}) => {
  scenario = "form-setup";
  await page.goto(`/admin/templates/${BCBS_TPL_ID}`);
  await expect(page.getByRole("heading", { name: "BCBS Kansas NC Enrollment" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: /^3 Steps & fields$/ }).click();
  await page.getByRole("button", { name: /Form setup/ }).click();

  // Run 1: the proposed CAQH mapping is undecided → the run fails honestly and
  // records a synthetic-profile dry run (is_test, provider_id NULL — no
  // provider row involved).
  await page.getByRole("button", { name: "Run mock dry run" }).click();
  await expect(page.getByText(/1 field unmatched — train them, then re-run/)).toBeVisible({
    timeout: 15000,
  });
  const dryRuns = () =>
    calls.filter((c) => c.kind === "rest" && c.path === "fill_sessions" && c.method === "POST");
  await expect.poll(() => dryRuns().length).toBe(1);
  const firstRun = dryRuns()[0].body as Record<string, unknown>;
  expect(firstRun.is_test).toBe(true);
  expect(firstRun.provider_id).toBeNull();
  expect(firstRun.case_id).toBeNull();
  const skipped = firstRun.fields_skipped as Array<Record<string, unknown>>;
  expect(skipped).toHaveLength(1);
  expect(skipped[0]).toMatchObject({ label: "CAQH ID", reason: "unmapped" });
  // No proven flip on a failing run.
  expect(calls.filter((c) => c.path === "set_global_portal_flags")).toEqual([]);
  await expect(page.getByText(/Last run: 1 filled.*1 unmatched/)).toBeVisible();

  // Train the unmatched field (suggestion prefilled from the captured token).
  const trainRow = page
    .locator("div", { hasText: "CAQH ID" })
    .filter({ has: page.getByRole("button", { name: "Approve" }) })
    .last();
  await trainRow.getByRole("button", { name: "Approve" }).click();
  await expect
    .poll(
      () => calls.filter((c) => c.kind === "rpc" && c.path === "train_global_field_map").length,
      { timeout: 15000 },
    )
    .toBe(1);

  // Run 2: everything decided → pass, and proven_at flips through the RPC.
  await page.getByRole("button", { name: "Run mock dry run" }).click();
  await expect(page.getByText(/Mock dry run passed — 2 fields filled/)).toBeVisible({
    timeout: 15000,
  });
  await expect
    .poll(
      () =>
        calls.filter(
          (c) =>
            c.kind === "rpc" &&
            c.path === "set_global_portal_flags" &&
            (c.body as Record<string, unknown>).p_proven === true,
        ).length,
      { timeout: 15000 },
    )
    .toBe(1);
  await expect(page.getByText("Proven").first()).toBeVisible({ timeout: 15000 });
});
