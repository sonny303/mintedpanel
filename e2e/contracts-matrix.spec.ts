import { expect, test, type Route } from "./fixtures/legacy-access-context";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_1 = "33333333-3333-4333-8333-333333333333";
const PAYER_BCBS = "44444444-4444-4444-8444-444444444444";
const PAYER_HUMANA = "55555555-5555-4555-8555-555555555555";
const STATUS_SIGNED = "66666666-6666-4666-8666-666666666666";

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
    email: "operator@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Test Operator" },
    created_at: "2026-07-09T00:00:00Z",
  },
};

test("renders Group Contracts Matrix, displays cells, and opens edit drawer", async ({
  context,
  page,
}) => {
  await context.addInitScript(
    ({ authKey, session, orgId }) => {
      localStorage.setItem(authKey, JSON.stringify(session));
      localStorage.setItem("active_org_id", orgId);
    },
    { authKey: AUTH_KEY, session: SESSION, orgId: ORG_ID },
  );

  const fixtures: Record<string, unknown[]> = {
    organizations: [{ id: ORG_ID, name: "Acme Health", lifecycle_state: "active" }],
    memberships: [
      {
        org_id: ORG_ID,
        role: "admin",
        organizations: { id: ORG_ID, name: "Acme Health", lifecycle_state: "active" },
      },
    ],
    provider_groups: [
      {
        id: GROUP_1,
        org_id: ORG_ID,
        name: "Kansas Fitness Physio",
        tin: "48-1158557",
        is_active: true,
      },
    ],
    facilities: [
      {
        id: "f-1",
        org_id: ORG_ID,
        group_id: GROUP_1,
        name: "Wichita Clinic",
        state: "KS",
        is_active: true,
      },
      {
        id: "f-2",
        org_id: ORG_ID,
        group_id: GROUP_1,
        name: "Overland Clinic",
        state: "MO",
        is_active: true,
      },
    ],
    payers: [
      { id: PAYER_BCBS, org_id: ORG_ID, name: "BCBS", status: "active", is_active: true },
      { id: PAYER_HUMANA, org_id: ORG_ID, name: "Humana", status: "active", is_active: true },
    ],
    payer_network_targets: [
      {
        id: "t-1",
        org_id: ORG_ID,
        group_id: GROUP_1,
        payer_id: PAYER_BCBS,
        state: "KS",
        status: "active",
      },
    ],
    status_configs: [
      {
        id: STATUS_SIGNED,
        org_id: ORG_ID,
        track: "contracting",
        label: "In Progress (Contract Signed)",
        color: "#EAB308",
        sort_order: 30,
      },
      {
        id: "stat-net",
        org_id: ORG_ID,
        track: "contracting",
        label: "In-Network",
        color: "#059669",
        sort_order: 40,
      },
    ],
    contracts: [
      {
        id: "c-1",
        org_id: ORG_ID,
        group_id: GROUP_1,
        payer_id: PAYER_BCBS,
        state: "KS",
        contracting_status_id: STATUS_SIGNED,
        tentative_effective_date: "2026-10-01",
        notes: "BCBS executed contract pending final loading",
      },
    ],
    credential_cases: [],
    touches: [],
    inbound_leads: [],
    user_table_prefs: [],
  };

  await page.route("**/rest/v1/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/").pop() ?? "";
    const method = route.request().method();

    if (method === "GET") {
      const rows = fixtures[table] ?? [];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rows),
      });
    }

    if (method === "POST" || method === "PATCH") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "mock-id" }),
      });
    }

    return route.continue();
  });

  await page.goto("/reporting/contracts-matrix");

  // Verify PageHeader and Group selector
  await expect(page.getByRole("heading", { name: "Group Contracts Matrix" })).toBeVisible();
  await expect(page.getByText("Kansas Fitness Physio")).toBeVisible();

  // Verify Table headers
  await expect(page.getByRole("columnheader", { name: "Payer" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "KS" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "MO" })).toBeVisible();

  // Verify Cell shows 'x' for the signed BCBS KS contract
  const cell = page.getByRole("cell", { name: "x tent Oct 1, 2026" });
  await expect(cell).toBeVisible();

  // Verify Footer Notes Card shows the cross-payer dependency
  await expect(page.getByText("Cross-Payer Dependencies & Contract Notes")).toBeVisible();
  await expect(page.getByText("BCBS executed contract pending final loading")).toBeVisible();

  // Click cell to open Drawer
  await cell.click();

  // Drawer is visible
  await expect(page.getByRole("heading", { name: "BCBS — KS" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Contract" })).toBeVisible();
});
