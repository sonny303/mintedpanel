import { test, expect, type Route } from "@playwright/test";

// E1.4 TE-8 — Assignments wizard-section coverage over the mock harness:
//   TS-39 Tree Hill assignment gap: two providers, one assigned → unassigned
//         provider listed first with "Assign locations" → section In progress
//   TS-40 Shelby two-group provider: picker offers ONLY the provider's
//         groups' facilities; start date required to save; primary swap
//         leaves exactly one primary (via the atomic RPC)

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_TREE_HILL = "22222222-2222-4222-8222-222222222222";
const ORG_SHELBY = "33333333-3333-4333-8333-333333333333";

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

const party = (over: Record<string, unknown>) => ({
  id: "p",
  party_type: "person",
  name: "",
  first_name: null,
  last_name: null,
  title: null,
  email: null,
  phone_office: null,
  phone_extension: null,
  phone_mobile: null,
  fax: null,
  address_line1: null,
  address_line2: null,
  city: null,
  state: null,
  postal_code: null,
  country: null,
  created_by: USER_ID,
  created_at: "2026-07-09T00:00:00Z",
  ...over,
});

const contactAssignments = (orgId: string, slug: string) => [
  {
    org_id: orgId,
    role_key: "owner",
    parties: party({
      id: `p-owner-${slug}`,
      name: `Owner ${slug}`,
      email: `owner.${slug}@example.test`,
    }),
  },
  {
    org_id: orgId,
    role_key: "customer_escalation_contact",
    parties: party({
      id: `p-cust-${slug}`,
      name: `Contact ${slug}`,
      email: `contact.${slug}@example.test`,
      phone_office: "704-555-0142",
      address_line1: "100 Main St",
      city: "Charlotte",
      state: "NC",
      postal_code: "28280",
      country: "US",
    }),
  },
];

const groupRow = (orgId: string, id: string, name: string) => ({
  id,
  org_id: orgId,
  name,
  tin: "123456789",
  states: ["NC"],
  is_active: true,
  created_at: "2026-07-10T00:00:00Z",
  billing_phone: "704-555-0100",
});

const facilityRow = (orgId: string, id: string, groupId: string | null, name: string) => ({
  id,
  org_id: orgId,
  group_id: groupId,
  name,
  street: "1 Main St",
  city: "Charlotte",
  state: "NC",
  zip: "28280",
  phone: "704-555-0100",
  is_active: true,
  hours: {},
  ada_compliance: {},
  languages_offered: [],
  interpreter_languages: [],
  status_id: null,
  effective_date: null,
  reference_only: false,
  created_at: "2026-07-10T00:00:00Z",
});

const providerRow = (orgId: string, id: string, first: string, last: string, groupId: string) => ({
  id,
  org_id: orgId,
  group_id: groupId,
  first_name: first,
  last_name: last,
  credentials: "PT",
  npi: "1234567893",
  status: "onboarding",
  reference_only: false,
  home_state: "NC",
  caqh_id: null,
  caqh_last_attested_date: null,
  taxonomy_code: null,
  specialty: "Physical Therapy",
  email: null,
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
});

function makeFixtures(over: Record<string, unknown[]>) {
  const orgs = [
    { id: ORG_TREE_HILL, name: "Tree Hill Sports Therapy", lifecycle_state: "prospect" },
    { id: ORG_SHELBY, name: "Shelby Sports Rehab", lifecycle_state: "active" },
  ];
  return {
    organizations: orgs.map((o) => ({ ...o, created_at: "2026-07-01T00:00:00Z" })),
    memberships: orgs.map((o) => ({
      org_id: o.id,
      role: "admin",
      organizations: {
        name: o.name,
        lifecycle_state: o.lifecycle_state,
        created_at: "2026-07-01T00:00:00Z",
      },
    })),
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
    credential_cases: [],
    status_configs: [],
    audit_log: [],
    party_role_assignments: [],
    provider_groups: [],
    facilities: [],
    providers: [],
    state_licenses: [],
    provider_group_assignments: [],
    provider_facility_assignments: [],
    ...over,
  } as Record<string, unknown[]>;
}

function makeHandler(fixtures: Record<string, unknown[]>) {
  let seq = 900;
  const STATEFUL = new Set(["provider_facility_assignments"]);
  const rpcCalls: Array<{ name: string; body: Record<string, unknown> }> = [];
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.endsWith("/rpc/claim_invites")) return json(0);
    if (url.pathname.endsWith("/rpc/set_primary_assignment")) {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      rpcCalls.push({ name: "set_primary_assignment", body });
      // Mirror the RPC's atomic demote+promote against the fixture rows.
      const rows = fixtures.provider_facility_assignments as Array<Record<string, unknown>>;
      for (const r of rows) {
        if (r.provider_id === body.p_provider_id) {
          r.is_primary = r.id === body.p_assignment_id;
        }
      }
      return json(null);
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

    const matchFilters = (row: Record<string, unknown>): boolean => {
      for (const [key, raw] of url.searchParams.entries()) {
        if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) continue;
        if (!(key in row)) continue;
        if (raw.startsWith("eq.")) {
          if (String(row[key]) !== raw.slice(3)) return false;
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

    if (STATEFUL.has(table) && req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "[]") as
        Record<string, unknown> | Record<string, unknown>[];
      const rows = Array.isArray(body) ? body : [body];
      const created = rows.map((r) => ({
        id: `pfa-${seq++}`,
        created_at: "2026-07-12T00:00:00Z",
        ...r,
      }));
      fixtures[table]!.push(...created);
      return json(wantsObject ? created[0] : created, 201);
    }
    if (STATEFUL.has(table) && req.method() === "PATCH") {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      const targets = (fixtures[table] as Record<string, unknown>[]).filter(matchFilters);
      for (const t of targets) Object.assign(t, body);
      return json(wantsObject ? (targets[0] ?? {}) : targets);
    }
    if (STATEFUL.has(table) && req.method() === "DELETE") {
      const rows = fixtures[table] as Record<string, unknown>[];
      const removed = rows.filter(matchFilters);
      fixtures[table] = rows.filter((r) => !removed.includes(r));
      return json(removed);
    }
    if (req.method() === "POST" || req.method() === "PATCH") {
      const prefer = req.headers()["prefer"] ?? "";
      if (prefer.includes("return=representation")) return json(wantsObject ? {} : [{}]);
      return json(null, 201);
    }

    const rows = (fixtures[table] ?? []).filter((r) => matchFilters(r as Record<string, unknown>));
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  };
  return { handler, rpcCalls };
}

function seedAuth(
  context: {
    addInitScript: (fn: (args: unknown[]) => void, args: unknown[]) => Promise<void>;
  },
  orgId: string,
) {
  return context.addInitScript(
    ([authKey, session, activeOrg]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: activeOrg }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, orgId] as const,
  );
}

test("TS-39: assignment gap — unassigned provider first, section In progress", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures({
    party_role_assignments: contactAssignments(ORG_TREE_HILL, "tree-hill"),
    provider_groups: [groupRow(ORG_TREE_HILL, "g-th", "Tree Hill Sports Therapy LLC")],
    facilities: [facilityRow(ORG_TREE_HILL, "f-th", "g-th", "Tree Hill Riverfront Clinic")],
    providers: [
      providerRow(ORG_TREE_HILL, "pr-a", "Nathan", "Scott", "g-th"),
      providerRow(ORG_TREE_HILL, "pr-b", "Haley", "James", "g-th"),
    ],
    provider_group_assignments: [
      {
        id: "ga-a",
        org_id: ORG_TREE_HILL,
        provider_id: "pr-a",
        group_id: "g-th",
        is_primary: true,
      },
      {
        id: "ga-b",
        org_id: ORG_TREE_HILL,
        provider_id: "pr-b",
        group_id: "g-th",
        is_primary: true,
      },
    ],
    provider_facility_assignments: [
      {
        id: "pfa-a",
        org_id: ORG_TREE_HILL,
        provider_id: "pr-a",
        facility_id: "f-th",
        is_primary: true,
        start_date: "2026-01-05",
        created_at: "2026-07-10T00:00:00Z",
      },
    ],
  });
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_TREE_HILL);

  await page.goto("/onboarding/wizard");
  const card = page.locator("#wizard-assignments");
  await expect(card).toContainText("In progress", { timeout: 30000 });

  // Unassigned provider (Haley) is flagged and listed FIRST.
  const rows = card.locator("ul > li");
  await expect(rows.first()).toContainText("Haley James");
  await expect(rows.first()).toContainText("No locations");
  await expect(rows.first().getByRole("button", { name: "Assign locations" })).toBeVisible();
  // Assigned provider shows the facility chip with start date + primary.
  await expect(rows.nth(1)).toContainText("Tree Hill Riverfront Clinic");
  await expect(rows.nth(1)).toContainText("Primary");
});

test("TS-40: group-scoped picker, required start date, primary swap stays single", async ({
  context,
  page,
}) => {
  // Shelby: Group 1 has one facility; Group 2 has two. The provider belongs
  // ONLY to Group 1 at first assignment; a second provider in both groups
  // exercises the swap.
  const fixtures = makeFixtures({
    party_role_assignments: contactAssignments(ORG_SHELBY, "shelby"),
    provider_groups: [
      groupRow(ORG_SHELBY, "g-1", "Shelby Sports Rehab LLC"),
      groupRow(ORG_SHELBY, "g-2", "Shelby Performance Group LLC"),
    ],
    facilities: [
      facilityRow(ORG_SHELBY, "f-1", "g-1", "Shelby Main Clinic"),
      facilityRow(ORG_SHELBY, "f-2", "g-2", "Performance North"),
      facilityRow(ORG_SHELBY, "f-3", "g-2", "Performance South"),
    ],
    providers: [providerRow(ORG_SHELBY, "pr-q", "Quinn", "James", "g-1")],
    provider_group_assignments: [
      { id: "ga-q1", org_id: ORG_SHELBY, provider_id: "pr-q", group_id: "g-1", is_primary: true },
    ],
  });
  const { handler, rpcCalls } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_SHELBY);

  await page.goto("/onboarding/wizard");
  const card = page.locator("#wizard-assignments");
  await card.getByRole("button", { name: "Assign locations" }).click({ timeout: 30000 });
  const dialog = page.getByRole("dialog", { name: /Locations for Quinn James/ });

  // Group-scoped picker: only Group 1's facility is offered.
  await expect(dialog).toContainText("Shelby Main Clinic");
  await expect(dialog).not.toContainText("Performance North");
  await expect(dialog).not.toContainText("Performance South");

  // Start date is required to save.
  await dialog.getByLabel("Assign Shelby Main Clinic").click();
  await dialog.getByRole("button", { name: "Save assignments" }).click();
  await expect(dialog).toContainText("Every assignment needs a start date");

  await dialog.getByRole("button", { name: "Start date at Shelby Main Clinic" }).click();
  // The calendar popover portals outside the dialog; day buttons carry full
  // accessible dates. Pick a day in the visible month rather than pinning July
  // forever — this flow starts with no preselected date.
  await page.getByRole("button", { name: /15th/ }).first().click();
  await dialog.getByRole("button", { name: "Save assignments" }).click();
  await expect(card).toContainText("Complete", { timeout: 15000 });
  await expect(card).toContainText("Shelby Main Clinic");

  // Widen the provider to Group 2 (fixture-level outside edit), then add a
  // second location and swap primary — exactly one primary remains and the
  // swap ran through the atomic RPC.
  fixtures.provider_group_assignments!.push({
    id: "ga-q2",
    org_id: ORG_SHELBY,
    provider_id: "pr-q",
    group_id: "g-2",
    is_primary: false,
  });
  await page.reload();
  await card.getByRole("button", { name: "Edit locations" }).click({ timeout: 30000 });
  const dialog2 = page.getByRole("dialog", { name: /Locations for Quinn James/ });
  await expect(dialog2).toContainText("Performance North");
  await dialog2.getByLabel("Assign Performance North").click();
  await dialog2.getByRole("button", { name: "Start date at Performance North" }).click();
  await page.getByRole("button", { name: /20th/ }).first().click();
  await dialog2.getByLabel("Performance North is the primary location").click();
  await dialog2.getByRole("button", { name: "Save assignments" }).click();

  await expect(card).toContainText("Performance North", { timeout: 15000 });
  const rows = fixtures.provider_facility_assignments as Array<{
    is_primary: boolean;
    facility_id: string;
  }>;
  expect(rows.filter((r) => r.is_primary)).toHaveLength(1);
  expect(rows.find((r) => r.is_primary)?.facility_id).toBe("f-2");
  expect(rpcCalls.some((c) => c.name === "set_primary_assignment")).toBe(true);
});
