// E6.2 F6.2.1/F6.2.2 — TS-108 (Groups hub + facilities list treatment) and
// TS-123 (shared street address entered once per group; one group per
// facility). Shelby Sports Rehab: two groups exercise the A→Z list + the
// per-group hub scoping; one group's facilities span two states to exercise
// the state-grouped A→Z treatment, filters, provider counts, and the
// zero-provider flag. Go-live is a PLAIN date — no location status machine
// anywhere. The mock harness is the CLAUDE.md recipe (localStorage session,
// PostgREST fixture filters, write-through POST/PATCH).
import { test, expect, type Route } from "@playwright/test";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "77777777-7777-4777-8777-777777777777";

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

const GROUP_A = {
  id: "g-a",
  org_id: ORG_ID,
  name: "Carolina Coast Rehab LLC",
  tin: "123456789",
  npi_type2: null,
  states: ["NC", "SC"],
  is_active: true,
  created_at: "2026-07-01T00:00:00Z",
};
const GROUP_B = {
  id: "g-b",
  org_id: ORG_ID,
  name: "Shelby Sports Rehab LLC",
  tin: "987654321",
  npi_type2: null,
  states: ["NC"],
  is_active: true,
  created_at: "2026-07-02T00:00:00Z",
};

const facility = (id: string, over: Record<string, unknown>) => ({
  id,
  org_id: ORG_ID,
  group_id: "g-a",
  name: "",
  street: "1 Main St",
  city: "Shelby",
  state: "NC",
  zip: "28150",
  is_active: true,
  status_id: null,
  effective_date: null,
  reference_only: false,
  suite: null,
  county: null,
  phone: "704-555-0100",
  fax: null,
  email: null,
  appointment_phone: null,
  contact_name: null,
  accepting_new_patients: true,
  languages_offered: null,
  interpreter_languages: null,
  hours: {},
  ada_compliance: null,
  created_at: "2026-07-05T00:00:00Z",
  ...over,
});

function makeFixtures(): Record<string, Record<string, unknown>[]> {
  return {
    organizations: [
      {
        id: ORG_ID,
        name: "Shelby Sports Rehab",
        lifecycle_state: "active",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    memberships: [
      {
        id: "m-1",
        org_id: ORG_ID,
        user_id: USER_ID,
        role: "admin",
        created_at: "2026-07-01T00:00:00Z",
        organizations: {
          name: "Shelby Sports Rehab",
          lifecycle_state: "active",
          created_at: "2026-07-01T00:00:00Z",
        },
        profiles: { full_name: "Sowmya Seed", email: "sowmya.seed@example.test" },
      },
    ],
    profiles: [
      {
        id: USER_ID,
        full_name: "Sowmya Seed",
        email: "sowmya.seed@example.test",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    provider_groups: [GROUP_A, GROUP_B],
    facilities: [
      // Group A spans two states; Uptown has zero providers.
      facility("f-1", { name: "Boiling Springs Clinic", city: "Boiling Springs", state: "NC" }),
      facility("f-2", { name: "Asheville Annex", city: "Asheville", state: "NC" }),
      facility("f-3", {
        name: "Charleston Waterfront",
        city: "Charleston",
        state: "SC",
        effective_date: "2026-09-01",
      }),
      facility("f-4", { name: "Uptown Zero Clinic", city: "Shelby", state: "NC" }),
    ],
    providers: [
      {
        id: "pr-1",
        org_id: ORG_ID,
        first_name: "Jane",
        last_name: "Whitaker",
        credentials: "PT",
        npi: "1093817465",
        status: "onboarding",
        verification_state: "verified",
        reference_only: false,
        home_state: "NC",
        specialty: "Physical Therapy",
        email: null,
        group_id: null,
        start_date: "2026-01-01",
        created_at: "2026-07-05T00:00:00Z",
        updated_at: "2026-07-05T00:00:00Z",
      },
    ],
    provider_group_assignments: [],
    provider_facility_assignments: [
      // Jane covers f-1, f-2, f-3 — f-4 stays zero-provider.
      { id: "fa-1", org_id: ORG_ID, provider_id: "pr-1", facility_id: "f-1", is_primary: true },
      { id: "fa-2", org_id: ORG_ID, provider_id: "pr-1", facility_id: "f-2", is_primary: false },
      { id: "fa-3", org_id: ORG_ID, provider_id: "pr-1", facility_id: "f-3", is_primary: false },
    ],
    state_licenses: [],
    payers: [],
    org_payer_assignments: [],
    payer_network_targets: [],
    case_generation_exclusions: [],
    enrollment_facts: [],
    credential_cases: [],
    case_status_history: [],
    denial_reason_codes: [],
    contracts: [],
    tasks: [],
    status_configs: [],
    sop_templates: [],
    provider_documents: [],
    group_insurance_policies: [],
    import_runs: [],
    import_rows: [],
    party_role_assignments: [],
    party_role_types: [],
    parties: [],
    pending_invites: [],
    inbound_leads: [],
    notes: [],
    user_table_prefs: [],
    audit_log: [],
    touches: [],
  };
}

interface RecordedWrite {
  method: string;
  table: string;
  body: Record<string, unknown> | null;
}

function makeHandler(fixtures: Record<string, Record<string, unknown>[]>) {
  const writes: RecordedWrite[] = [];
  let seq = 0;
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.includes("/rest/v1/rpc/list_global_payers")) return json([]);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

    const matchFilters = (row: Record<string, unknown>): boolean => {
      for (const [key, raw] of url.searchParams.entries()) {
        if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(key)) continue;
        if (!(key in row)) continue;
        if (raw.startsWith("eq.")) {
          if (String(row[key]) !== raw.slice(3)) return false;
        } else if (raw.startsWith("in.(")) {
          const ids = raw
            .slice(4, -1)
            .split(",")
            .map((s) => s.replace(/^"|"$/g, ""));
          if (!ids.includes(String(row[key]))) return false;
        } else if (raw.startsWith("neq.")) {
          if (String(row[key]) === raw.slice(4)) return false;
        } else if (raw.startsWith("is.")) {
          const want = raw.slice(3);
          if (want === "null" && row[key] !== null) return false;
        }
      }
      return true;
    };

    if (req.method() === "POST") {
      let body: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = req.postDataJSON();
        body = Array.isArray(parsed)
          ? ((parsed[0] ?? null) as Record<string, unknown> | null)
          : (parsed as Record<string, unknown> | null);
      } catch {
        body = null;
      }
      writes.push({ method: "POST", table, body });
      const row = { id: `new-${(seq += 1)}`, created_at: "2026-07-19T00:00:00Z", ...(body ?? {}) };
      if (fixtures[table]) fixtures[table].push(row);
      return json(wantsObject ? row : [row], 201);
    }
    if (req.method() === "PATCH") {
      let body: Record<string, unknown> | null = null;
      try {
        body = req.postDataJSON() as Record<string, unknown>;
      } catch {
        body = null;
      }
      writes.push({ method: "PATCH", table, body });
      const rows = (fixtures[table] ?? []).filter((r) => matchFilters(r));
      for (const r of rows) Object.assign(r, body ?? {});
      if (wantsObject) {
        if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
        return json(rows[0]);
      }
      return json(rows);
    }
    if (req.method() !== "GET") {
      writes.push({ method: req.method(), table, body: null });
      return json([]);
    }

    const rows = (fixtures[table] ?? []).filter((r) => matchFilters(r));
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  };
  return { handler, writes };
}

function seedAuth(context: {
  addInitScript: (fn: (args: unknown[]) => void, args: unknown[]) => Promise<void>;
}) {
  return context.addInitScript(
    ([authKey, session, activeOrg]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: activeOrg }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_ID] as const,
  );
}

test("TS-108: multi-group A→Z list → hub with editable group facts + navigating breadcrumb", async ({
  context,
  page,
}) => {
  const { handler, writes } = makeHandler(makeFixtures());
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/groups");
  await expect(page.getByRole("heading", { name: "Groups", exact: true })).toBeVisible({
    timeout: 30000,
  });

  // A→Z: Carolina Coast before Shelby Sports.
  const cards = page.locator("main ul > li a");
  await expect(cards.first()).toContainText("Carolina Coast Rehab LLC");
  await expect(cards.nth(1)).toContainText("Shelby Sports Rehab LLC");

  // Open the hub — facts card renders name / TIN XX-XXXXXXX / states.
  await cards.first().click();
  await expect(page).toHaveURL(/\/groups\/g-a\/?$/);
  await expect(page.getByRole("heading", { name: "Carolina Coast Rehab LLC" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Group facts" })).toBeVisible();
  await expect(page.getByText("12-3456789")).toBeVisible();
  await expect(page.getByText("NC, SC")).toBeVisible();

  // Facts are editable inline (admin) through the audited group update.
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Legal name").fill("Carolina Coast Rehab, LLC");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => writes.filter((w) => w.method === "PATCH" && w.table === "provider_groups").length)
    .toBeGreaterThan(0);
  const patch = writes.find((w) => w.method === "PATCH" && w.table === "provider_groups");
  expect(patch?.body?.name).toBe("Carolina Coast Rehab, LLC");

  // Breadcrumb: Groups › {Group} › {Area}; every crumb navigates.
  await page.getByRole("link", { name: /Facilities/ }).click();
  await expect(page).toHaveURL(/\/groups\/g-a\/facilities\/?$/);
  const crumbs = page.getByLabel("Breadcrumb");
  await expect(crumbs).toContainText("Groups");
  await expect(crumbs).toContainText("Facilities");
  await crumbs.getByRole("link", { name: "Carolina Coast Rehab, LLC" }).click();
  await expect(page).toHaveURL(/\/groups\/g-a\/?$/);
  await page.getByLabel("Breadcrumb").getByRole("link", { name: "Groups" }).click();
  await expect(page).toHaveURL(/\/groups\/?$/);
});

test("TS-108: facilities render state-grouped A→Z with search/filters, provider counts, the zero-provider flag, and a plain go-live date", async ({
  context,
  page,
}) => {
  const { handler } = makeHandler(makeFixtures());
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/groups/g-a/facilities");
  await expect(page.getByRole("heading", { name: "Facilities" })).toBeVisible({ timeout: 30000 });

  // State groups with counts, A→Z within state (NC before SC; Asheville
  // before Boiling Springs before Uptown).
  await expect(page.getByText("NC — 3 locations")).toBeVisible();
  await expect(page.getByText("SC — 1 location")).toBeVisible();
  const ncRows = page.locator("main li", { hasText: /provider/ });
  await expect(ncRows.first()).toContainText("Asheville Annex");

  // Provider counts + the informational zero-provider flag.
  await expect(
    page.locator("li", { hasText: "Uptown Zero Clinic" }).getByText("0 providers"),
  ).toBeVisible();
  await expect(page.getByText(/No providers — can't generate cases/)).toBeVisible();

  // Go-live renders as a plain date; no location status machine anywhere.
  await expect(page.getByText(/Go-live Sep 1, 2026/)).toBeVisible();
  await expect(page.getByText(/Ready for Launch|Pending Fulfillment/)).toHaveCount(0);

  // Search and filters compose.
  await page.getByLabel("Search facilities").fill("charleston");
  await expect(page.getByText("Charleston Waterfront")).toBeVisible();
  await expect(page.getByText("Asheville Annex")).toHaveCount(0);
  await page.getByLabel("Search facilities").fill("");
  await page.getByLabel("Filter by providers").click();
  await page.getByRole("option", { name: "Without providers" }).click();
  await expect(page.getByText("Uptown Zero Clinic")).toBeVisible();
  await expect(page.getByText("Charleston Waterfront")).toHaveCount(0);

  // The facility edit dialog carries the plain go-live date field and no
  // status picker.
  await page.getByLabel("Filter by providers").click();
  await page.getByRole("option", { name: "All locations" }).click();
  await page
    .locator("li", { hasText: "Charleston Waterfront" })
    .getByRole("button", { name: "Edit" })
    .click();
  await expect(page.getByText("Go-live date (optional)")).toBeVisible();
  await expect(page.getByText(/no location status machine/i)).toBeVisible();
  await expect(page.getByText(/Ready for Launch|Interviewing|Prospect/)).toHaveCount(0);
});

test("TS-123: the same street address saves independently under both groups; one group per facility; the CSV documents the per-group rule", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  const addFacility = async (groupId: string) => {
    await page.goto(`/groups/${groupId}/facilities`);
    await page.getByRole("button", { name: "Add facility" }).click({ timeout: 30000 });
    await page.getByLabel("Facility name").fill("Shared Address Clinic");
    await page.getByLabel("Street").fill("42 Shared Way");
    await page.getByLabel("City").fill("Shelby");
    await page.getByLabel("State", { exact: true }).click();
    await page.getByRole("option", { name: "NC", exact: true }).click();
    await page.getByLabel("ZIP").fill("28150");
    await page.getByLabel("Phone", { exact: true }).fill("704-555-0199");
    await page
      .getByRole("button", { name: /Save|Add facility/ })
      .last()
      .click();
    await expect(page.getByText("Facility saved")).toBeVisible({ timeout: 15000 });
  };

  await addFacility("g-a");
  await addFacility("g-b");

  const posts = writes.filter((w) => w.method === "POST" && w.table === "facilities");
  expect(posts).toHaveLength(2);
  expect(posts[0].body?.street).toBe("42 Shared Way");
  expect(posts[1].body?.street).toBe("42 Shared Way");
  // Entered once PER GROUP — two independent records, one group each (the
  // form's single owning-group select is the only linkage; no M:N exists).
  expect(posts[0].body?.group_id).toBe("g-a");
  expect(posts[1].body?.group_id).toBe("g-b");

  // The rule is stated on the page and documented with the CSV template.
  await expect(page.getByText(/entered once per group/).first()).toBeVisible();
  await expect(page.getByText(/per-TIN service locations/).first()).toBeVisible();
});
