import { test, expect, type Route } from "@playwright/test";

// E0.7 F0.7.4 TE-5 — Regression coverage for the only-sales-rep removal block
// (F0.2.2 / F0.3.3). When the org's sole sales rep tries to have their role
// removed (chip X or full Remove), the app must block it. The server-side check
// (count of sales_rep assignments == 1) is mocked here.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_A = "22222222-2222-4222-8222-222222222222";
const PARTY_ZEB = "55555555-5555-4555-8555-555555555555";
const PARTY_OWNER = "66666666-6666-4666-8666-666666666666";

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
    email: "test@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Test User" },
    created_at: "2026-07-09T00:00:00Z",
  },
};

const FIXTURES: Record<string, unknown[]> = {
  organizations: [
    {
      id: ORG_A,
      name: "Rose City Rehab Collective",
      lifecycle_state: "active",
      created_at: "2026-07-01T00:00:00Z",
    },
  ],
  memberships: [
    {
      org_id: ORG_A,
      role: "admin",
      organizations: {
        name: "Rose City Rehab Collective",
        lifecycle_state: "active",
        created_at: "2026-07-01T00:00:00Z",
      },
    },
  ],
  profiles: [
    {
      id: USER_ID,
      full_name: "Test User",
      email: "test@example.test",
      created_at: "2026-07-09T00:00:00Z",
    },
  ],
  notes: [],
  user_table_prefs: [],
  parties: [
    {
      id: PARTY_ZEB,
      name: "Zeb Loewenstine",
      email: "zeb@mintedpanel.example.test",
      phone_office: "704-555-0100",
      phone_mobile: null,
      party_type: "person",
      created_by: USER_ID,
      created_at: "2026-07-01T00:00:00Z",
      address_line1: "101 S Tryon St",
      address_line2: null,
      city: "Charlotte",
      state: "NC",
      postal_code: "28280",
      country: null,
    },
    {
      id: PARTY_OWNER,
      name: "Jane Owner",
      email: "jane@example.test",
      phone_office: "555-555-0100",
      phone_mobile: null,
      party_type: "person",
      created_by: USER_ID,
      created_at: "2026-07-01T00:00:00Z",
      address_line1: "123 Main St",
      address_line2: null,
      city: "Portland",
      state: "OR",
      postal_code: "97201",
      country: null,
    },
  ],
  party_role_assignments: [
    {
      id: "a1",
      org_id: ORG_A,
      party_id: PARTY_ZEB,
      role_key: "sales_rep",
      scope_type: "org",
      scope_id: null,
      created_at: "2026-07-01T00:00:00Z",
      party_role_types: { role_key: "sales_rep", label: "Sales Rep", is_active: true },
    },
    {
      id: "a2",
      org_id: ORG_A,
      party_id: PARTY_OWNER,
      role_key: "owner",
      scope_type: "org",
      scope_id: null,
      created_at: "2026-07-01T00:00:00Z",
      party_role_types: { role_key: "owner", label: "Owner", is_active: true },
    },
  ],
  party_role_types: [
    { role_key: "owner", label: "Owner", is_active: true },
    {
      role_key: "customer_escalation_contact",
      label: "Customer Escalation Contact",
      is_active: true,
    },
    { role_key: "sales_rep", label: "Sales Rep", is_active: true },
    { role_key: "billing_contact", label: "Billing Contact", is_active: false },
    { role_key: "contracting_signer", label: "Contracting Signer", is_active: false },
    { role_key: "credentialing_contact", label: "Credentialing Contact", is_active: false },
  ],
  inbound_leads: [],
  party_capture_links: [],
};

async function fulfillSupabase(route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  if (url.pathname.includes("/auth/v1/")) return json(SESSION);
  if (url.pathname.endsWith("/rpc/claim_invites")) return json(0);
  if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

  const table = url.pathname.split("/rest/v1/")[1] ?? "";

  if (table === "party_role_assignments") {
    const isHead = req.method() === "HEAD";
    const qs = url.searchParams.toString();
    const selectParam = url.searchParams.get("select") ?? "";

    if (isHead && qs.includes("role_key=eq.sales_rep")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: "null",
      });
    }

    if (req.method() === "DELETE") {
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          message: "This is the only sales rep. Add another before removing this role.",
        }),
      });
    }

    if (selectParam.includes("parties")) {
      const partyMap = Object.fromEntries(
        (FIXTURES.parties as Array<{ id: string }>).map((p) => [p.id, p]),
      );
      const embedded = (
        FIXTURES.party_role_assignments as Array<{ party_id: string; role_key: string }>
      ).map((a) => ({
        role_key: a.role_key,
        parties: partyMap[a.party_id] ?? null,
      }));
      return json(embedded);
    }
  }

  const rows = FIXTURES[table] ?? [];
  const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
  if (wantsObject) {
    if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
    return json(rows[0]);
  }
  return json(rows);
}

test("removing the only sales rep role is blocked (F0.2.2 / F0.3.3)", async ({ context, page }) => {
  await context.route(/\/(rest|auth)\/v1\//, fulfillSupabase);
  await context.addInitScript(
    ([authKey, session, orgId]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_A] as const,
  );

  await page.goto("/get-started");

  await expect(page.getByText("Zeb Loewenstine")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Sales Rep")).toBeVisible();

  const zebCard = page.locator("[class*='rounded']").filter({ hasText: "Zeb Loewenstine" }).first();
  const removeRoleBtn = zebCard.getByLabel("Remove Sales Rep role");
  await removeRoleBtn.click();

  await expect(page.getByText("This is the only sales rep", { exact: false })).toBeVisible({
    timeout: 10000,
  });
});
