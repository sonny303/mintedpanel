import { test, expect, type Page, type Route } from "@playwright/test";

// E4.2 unified payer setup (TE-19/TE-20) — the complete setup funnel on the
// Payer Setup workspace, over the mock harness:
//   1–3  zero payers → open Catalog → add a canonical payer → the payer
//        appears on Setup with ZERO targets (the acceptance-critical case)
//        and "Configure scope" as its dominant action;
//   4–5  targets configured → "Needs payer SOP" links the PREFILLED template
//        wizard (payerId + state carried);
//   6    a payer SOP flips SOP coverage to covered and the funnel advances;
//   7    a provider failing the SOP's profile gate surfaces as a blocker with
//        a direct link;
//   8    an extension-fill SOP with no registered portal → "Register portal"
//        carries payer context into /admin/portals (the Add dialog opens
//        preselected);
//   9    incomplete mappings → the exact training deck; complete mappings
//        with no dry run → the test runner;
//   10   generation preview receives the payer scope;
//   11   generic-fallback generation is visibly a WARNING, never hidden.
// (12 — the legacy /admin/payers deep link — is pinned in
// admin-payers.spec.ts; non-admin denial + keyboard traversal in
// payer-admin-module.spec.ts.)

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "00000000-0000-4000-a000-000000000005";
const PAYER_ID = "00000000-0000-4000-a000-0000000000aa";
const GROUP_ID = "00000000-0000-4000-a000-0000000000b1";
const FACILITY_ID = "00000000-0000-4000-a000-0000000000c1";
const PROVIDER_ID = "00000000-0000-4000-a000-0000000000d1";

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

const CATALOG_PAYER = {
  id: PAYER_ID,
  org_id: null,
  name: "Aetna (CVS Health)",
  is_active: true,
  avg_decision_days: 45,
  payer_kind: "commercial",
  payer_slug: "aetna",
  aliases: ["Aetna"],
  states: ["NC"],
  status: "active",
  merged_into_id: null,
  resolution_id_label: null,
  resolution_id_expected: null,
  created_at: "2026-07-12T00:00:00Z",
};

const ASSIGNMENT = {
  id: "assign-1",
  org_id: ORG_ID,
  payer_id: PAYER_ID,
  starter: false,
  status: "active",
  created_at: "2026-07-12T00:00:00Z",
};

const TARGET = {
  id: "tgt-1",
  org_id: ORG_ID,
  payer_id: PAYER_ID,
  group_id: GROUP_ID,
  state: "NC",
  status: "active",
  created_at: "2026-07-12T00:00:00Z",
};

function sopTemplate(over: Record<string, unknown> = {}) {
  return {
    id: "tpl-1",
    org_id: ORG_ID,
    payer_id: PAYER_ID,
    state: "NC",
    group_id: null,
    specialty: null,
    name: "Aetna NC enrollment SOP",
    archived: false,
    current_version: 1,
    required_profile_attributes: [],
    task_definitions: [
      {
        title: "Submit enrollment",
        dueOffsetDays: 0,
        steps: [{ label: "Portal form", stepType: "online_form", dataFields: [] }],
      },
    ],
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-07-12T00:00:00Z",
    ...over,
  };
}

const EXTENSION_TEMPLATE = sopTemplate({
  task_definitions: [
    {
      title: "Fill the enrollment form",
      dueOffsetDays: 0,
      executionType: "extension_fill",
      steps: [
        {
          label: "Portal form",
          stepType: "online_form",
          dataFields: [],
          portalKey: "aetna_enroll",
        },
      ],
    },
  ],
});

const PORTAL = {
  id: "portal-1",
  org_id: ORG_ID,
  portal_key: "aetna_enroll",
  name: "Aetna Enrollment",
  payer_id: PAYER_ID,
  form_url: "https://portal.example/enroll",
  is_verified: false,
  last_verified_at: null,
  url_changed_at: null,
  created_at: "2026-07-12T00:00:00Z",
  updated_at: "2026-07-12T00:00:00Z",
};

function fieldMap(over: Record<string, unknown> = {}) {
  return {
    id: `map-${JSON.stringify(over).length}`,
    org_id: ORG_ID,
    portal_key: "aetna_enroll",
    url_pattern: null,
    page_step: null,
    map_type: "web",
    selector: "#first-name",
    selector_fallbacks: null,
    source: "token",
    token: "provider.firstName",
    hardcoded_value: null,
    transform: null,
    field_type: "text",
    notes: null,
    status: "approved",
    field_label: "First name",
    form_section: null,
    confidence: null,
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-07-12T00:00:00Z",
    ...over,
  };
}

// A candidate provider (in the group, assigned to the group's facility) whose
// profile is missing its CAQH ID — the F4.2.6 gate fixture.
const GATED_PROVIDER = {
  id: PROVIDER_ID,
  org_id: ORG_ID,
  first_name: "Riley",
  last_name: "Nolan",
  credentials: "PT",
  npi: "1234567890",
  caqh_id: null,
  caqh_last_attested_date: null,
  date_of_birth: "1990-01-01",
  ssn_last4: "1234",
  home_street: "1 Main St",
  home_city: "Dillon",
  home_state: "NC",
  home_zip: "28000",
  malpractice_coverage_end: null,
  specialty: "Physical Therapy",
  email: "riley@example.test",
  taxonomy_code: null,
  status: "active",
  verification_state: "verified",
  is_test_provider: false,
  reference_only: false,
  group_id: GROUP_ID,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
};

const GROUP = {
  id: GROUP_ID,
  org_id: ORG_ID,
  name: "Dillon PT Group",
  is_active: true,
  created_at: "2026-07-01T00:00:00Z",
};

const FACILITY = {
  id: FACILITY_ID,
  org_id: ORG_ID,
  group_id: GROUP_ID,
  name: "Dillon Clinic",
  street: "2 Main St",
  city: "Dillon",
  state: "NC",
  zip: "28000",
  is_active: true,
  created_at: "2026-07-01T00:00:00Z",
};

type Db = Record<string, Record<string, unknown>[]>;

function baseDb(): Db {
  return {
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
    global_payers: [CATALOG_PAYER],
    payers: [],
    org_payer_assignments: [],
    payer_network_targets: [],
    sop_templates: [],
    provider_groups: [GROUP],
    portals: [],
    portal_field_maps: [],
    fill_sessions: [],
    org_payer_settings: [],
  };
}

const writes: Array<{ method: string; table: string; body: string }> = [];

function makeHandler(db: Db) {
  return async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.endsWith("/rpc/claim_invites")) return json(0);
    if (url.pathname.endsWith("/rpc/list_global_payers")) return json(db.global_payers ?? []);
    if (url.pathname.endsWith("/rpc/get_sop_field_tokens")) return json([]);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(null);

    const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

    if (req.method() !== "GET") {
      writes.push({ method: req.method(), table, body: req.postData() ?? "" });
      const parsed = JSON.parse(req.postData() || "{}") as Record<string, unknown>;
      const first = (Array.isArray(parsed) ? parsed[0] : parsed) as Record<string, unknown>;
      const row = { id: `new-${table}-${(db[table] ?? []).length}`, ...first };
      // Write-through for the add-payer subscription so the invalidate →
      // refetch loop sees the new state (assignment + RLS-visible payer row).
      if (req.method() === "POST" && table === "org_payer_assignments") {
        const full = { ...ASSIGNMENT, ...row, id: "assign-live" };
        db.org_payer_assignments.push(full);
        if (!db.payers.some((p) => p.id === full.payer_id)) {
          const payer = (db.global_payers ?? []).find((p) => p.id === full.payer_id);
          if (payer) db.payers.push(payer);
        }
        return json(wantsObject ? full : [full], 201);
      }
      return json(wantsObject ? row : [row], 201);
    }

    // Generic PostgREST filter emulation: eq./neq./is./in. over fixture rows.
    const matches = (row: Record<string, unknown>): boolean => {
      for (const [key, raw] of url.searchParams.entries()) {
        if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(key)) continue;
        if (!(key in row)) continue;
        if (raw.startsWith("eq.")) {
          if (String(row[key]) !== raw.slice(3)) return false;
        } else if (raw.startsWith("neq.")) {
          if (String(row[key]) === raw.slice(4)) return false;
        } else if (raw === "is.null") {
          if (row[key] != null) return false;
        } else if (raw.startsWith("in.(")) {
          const list = raw.slice(4, -1).split(",");
          if (!list.includes(String(row[key]))) return false;
        }
      }
      return true;
    };
    const rows = (db[table] ?? []).filter(matches);
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  };
}

async function boot(page: Page, db: Db) {
  writes.length = 0;
  await page.context().route(/\/(rest|auth)\/v1\//, makeHandler(db));
  await page.context().addInitScript(
    ([authKey, session, orgId]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_ID] as const,
  );
}

test("steps 1–3: zero payers → Catalog → add → the zero-target payer is VISIBLE with Configure scope", async ({
  page,
}) => {
  const db = baseDb();
  await boot(page, db);

  await page.goto("/admin/payer-admin");
  // Empty state carries its direct fix (TE-20a) — into the Catalog tab.
  await expect(page.getByText("No payers have been added to this organization yet.")).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("link", { name: "Open the payer catalog" }).click();
  await expect(page).toHaveURL(/tab=catalog/);

  // Add the canonical payer from the catalog (the e4-2a assignment mutation).
  const catalogRow = page.locator("tr", { hasText: "Aetna (CVS Health)" });
  await expect(catalogRow).toBeVisible();
  await catalogRow.getByRole("button", { name: "Add to organization" }).click();
  await expect(page.getByText(/added — configure credentialing scope next/)).toBeVisible({
    timeout: 15000,
  });
  expect(writes.some((w) => w.method === "POST" && w.table === "org_payer_assignments")).toBe(true);

  // Back on Setup: the payer appears DESPITE having zero targets — scope reads
  // "Not configured", generation is Blocked, and the ONE dominant action is
  // Configure scope (funnel state 2).
  await page.getByRole("tab", { name: "Setup" }).click();
  const setupRow = page.locator("tr", { hasText: "Aetna (CVS Health)" }).first();
  await expect(setupRow).toBeVisible({ timeout: 15000 });
  await expect(setupRow.getByText("Not configured")).toBeVisible();
  await expect(setupRow.getByText("Blocked")).toBeVisible();
  const action = setupRow.getByRole("link", { name: "Configure scope" });
  await expect(action).toBeVisible();
  await expect(action).toHaveAttribute("href", "/onboarding/wizard?section=payer_network");
});

test("steps 4–5 + 11: scope with no payer SOP → Needs payer SOP, prefilled create link, visible fallback warning", async ({
  page,
}) => {
  const db = baseDb();
  db.payers = [CATALOG_PAYER];
  db.org_payer_assignments = [ASSIGNMENT];
  db.payer_network_targets = [TARGET];
  await boot(page, db);

  await page.goto("/admin/payer-admin");
  const row = page.locator("tr", { hasText: "Aetna (CVS Health)" }).first();
  await expect(row).toBeVisible({ timeout: 30000 });
  await expect(row.getByText("1 target")).toBeVisible();
  await expect(row.getByText("Needs payer SOP")).toBeVisible();

  // Generic-fallback generation is visibly a warning, never a hidden default.
  await expect(row.getByText("Warning")).toBeVisible();
  await expect(row.getByText("Generic fallback SOP would be used")).toBeVisible();

  // The dominant action links the PREFILLED template wizard — payer, state,
  // AND the uncovered target's group all carried.
  const create = row.getByRole("link", { name: "Create payer SOP" });
  await expect(create).toBeVisible();
  await expect(create).toHaveAttribute(
    "href",
    `/admin/templates/new?payerId=${PAYER_ID}&state=NC&groupId=${GROUP_ID}`,
  );
});

test("step 6: a payer SOP flips coverage to covered and the funnel advances", async ({ page }) => {
  const db = baseDb();
  db.payers = [CATALOG_PAYER];
  db.org_payer_assignments = [ASSIGNMENT];
  db.payer_network_targets = [TARGET];
  db.sop_templates = [sopTemplate()];
  await boot(page, db);

  await page.goto("/admin/payer-admin");
  const row = page.locator("tr", { hasText: "Aetna (CVS Health)" }).first();
  await expect(row).toBeVisible({ timeout: 30000 });
  await expect(row.getByText("Covered")).toBeVisible();
  await expect(row.getByText("Needs payer SOP")).toHaveCount(0);
  // Manual-only SOP → no form dimension; next step in priority order is the
  // resolution identifier (nothing upstream remains).
  await expect(row.getByRole("button", { name: "Configure payer ID" })).toBeVisible();
});

test("step 7: a provider failing the SOP's profile gate is a blocker with a direct payer-scoped link", async ({
  page,
}) => {
  const db = baseDb();
  db.payers = [CATALOG_PAYER];
  db.org_payer_assignments = [ASSIGNMENT];
  db.payer_network_targets = [TARGET];
  db.sop_templates = [sopTemplate({ required_profile_attributes: ["caqh_id"] })];
  db.providers = [GATED_PROVIDER];
  db.provider_group_assignments = [
    {
      id: "pga-1",
      org_id: ORG_ID,
      provider_id: PROVIDER_ID,
      group_id: GROUP_ID,
      is_primary: true,
      end_date: null,
      created_at: "2026-07-01T00:00:00Z",
    },
  ];
  db.facilities = [FACILITY];
  db.provider_facility_assignments = [
    {
      id: "pfa-1",
      org_id: ORG_ID,
      provider_id: PROVIDER_ID,
      facility_id: FACILITY_ID,
      is_primary: true,
      start_date: "2026-07-01",
      created_at: "2026-07-01T00:00:00Z",
    },
  ];
  await boot(page, db);

  await page.goto("/admin/payer-admin");
  const row = page.locator("tr", { hasText: "Aetna (CVS Health)" }).first();
  await expect(row).toBeVisible({ timeout: 30000 });
  await expect(row.getByText("1 blocked")).toBeVisible();
  const action = row.getByRole("link", { name: "Resolve blockers (1)" });
  await expect(action).toBeVisible();

  // E6.3 — /generation is ALIVE again: the blocker link opens the shared
  // grid payer-scoped (the legacy ?payerId spelling stays honored).
  await action.click();
  await expect(page).toHaveURL(/\/generation\?.*payerId=/, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: "Review & generate" })).toBeVisible({
    timeout: 30000,
  });
});

test("step 8: extension-fill SOP with no portal → Register portal carries payer context", async ({
  page,
}) => {
  const db = baseDb();
  db.payers = [CATALOG_PAYER];
  db.org_payer_assignments = [ASSIGNMENT];
  db.payer_network_targets = [TARGET];
  db.sop_templates = [EXTENSION_TEMPLATE];
  await boot(page, db);

  await page.goto("/admin/payer-admin");
  const row = page.locator("tr", { hasText: "Aetna (CVS Health)" }).first();
  await expect(row).toBeVisible({ timeout: 30000 });
  await expect(row.getByText("Unregistered")).toBeVisible();
  const action = row.getByRole("link", { name: "Register portal" });
  await expect(action).toHaveAttribute("href", `/admin/portals?payerId=${PAYER_ID}`);

  // The portals page opens the Add dialog with the payer preselected.
  await action.click();
  await expect(page.getByRole("heading", { name: "Add portal" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("combobox").filter({ hasText: "Aetna (CVS Health)" })).toBeVisible();
});

test("step 9: incomplete mappings → the exact training deck; complete + no dry run → the test runner", async ({
  page,
}) => {
  const db = baseDb();
  db.payers = [CATALOG_PAYER];
  db.org_payer_assignments = [ASSIGNMENT];
  db.payer_network_targets = [TARGET];
  db.sop_templates = [EXTENSION_TEMPLATE];
  db.portals = [PORTAL];
  db.portal_field_maps = [fieldMap(), fieldMap({ id: "map-2", status: "proposed" })];
  await boot(page, db);

  await page.goto("/admin/payer-admin");
  const row = page.locator("tr", { hasText: "Aetna (CVS Health)" }).first();
  await expect(row).toBeVisible({ timeout: 30000 });
  await expect(row.getByText("50% mapped")).toBeVisible();
  await expect(row.getByRole("link", { name: "Train form fields" })).toHaveAttribute(
    "href",
    "/portals/aetna_enroll/train",
  );

  // Approve the remaining map → the next gap is the missing dry run.
  db.portal_field_maps = [fieldMap(), fieldMap({ id: "map-2", status: "approved" })];
  await page.reload();
  const row2 = page.locator("tr", { hasText: "Aetna (CVS Health)" }).first();
  await expect(row2).toBeVisible({ timeout: 30000 });
  await expect(row2.getByText("100% mapped · no dry run")).toBeVisible();
  await expect(row2.getByRole("link", { name: "Run form dry test" })).toHaveAttribute(
    "href",
    `/admin/payer-admin/forms/${PAYER_ID}`,
  );
});
