import { test, expect, type Route } from "@playwright/test";

// E0.6 TE-7 — the Reporting Center (authenticated, cross-org). Uses the mock
// harness: seed the GoTrue session + active org in localStorage, answer the
// Supabase HTTP layer from fixtures. Covers the report registry, the Portfolio
// report (metrics + state breakdown + all-orgs list + share panel), and the
// /portfolio → /reporting/portfolio redirect (TD-1 no dead-ends).

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_A = "22222222-2222-4222-8222-222222222222";
const ORG_B = "33333333-3333-4333-8333-333333333333";

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

const orgRow = (id: string, name: string, lifecycle: string, created: string) => ({
  id,
  name,
  lifecycle_state: lifecycle,
  created_at: created,
});

const FIXTURES: Record<string, unknown[]> = {
  organizations: [
    orgRow(ORG_A, "Rose City Rehab Collective", "prospect", "2026-07-01T00:00:00Z"),
    orgRow(ORG_B, "Dillon Sports Medicine", "active", "2026-06-01T00:00:00Z"),
  ],
  memberships: [
    {
      org_id: ORG_A,
      role: "admin",
      organizations: orgRow(
        ORG_A,
        "Rose City Rehab Collective",
        "prospect",
        "2026-07-01T00:00:00Z",
      ),
    },
    {
      org_id: ORG_B,
      role: "admin",
      organizations: orgRow(ORG_B, "Dillon Sports Medicine", "active", "2026-06-01T00:00:00Z"),
    },
  ],
  party_role_assignments: [
    { org_id: ORG_A, role_key: "customer_escalation_contact", parties: { state: "OR" } },
    { org_id: ORG_B, role_key: "customer_escalation_contact", parties: { state: "TX" } },
  ],
  report_shares: [],
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
};

async function fulfillSupabase(route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (url.pathname.includes("/auth/v1/")) return json(SESSION);
  if (url.pathname.includes("/rest/v1/rpc/")) return json(0);
  const table = url.pathname.split("/rest/v1/")[1] ?? "";
  const rows = FIXTURES[table] ?? [];
  const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
  if (wantsObject) {
    if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
    return json(rows[0]);
  }
  return json(rows);
}

async function seed(context: import("@playwright/test").BrowserContext) {
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
}

test("Reporting Center lists the Portfolio report (F0.6.1)", async ({ context, page }) => {
  await seed(context);
  await page.goto("/reporting");
  await expect(page.getByRole("heading", { name: "Reporting Center" })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByText("Your organizations across the business", { exact: false }),
  ).toBeVisible();
});

test("Portfolio report renders metrics, state breakdown, org list, and share panel", async ({
  context,
  page,
}) => {
  await seed(context);
  await page.goto("/reporting/portfolio");
  // "In motion"/"Prospects" appear in the metric tile, the reused PortfolioContent
  // section, and the all-orgs table — assert presence with .first() to avoid the
  // strict-mode multi-match, then the unique report headings.
  await expect(page.getByText("In motion").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Prospects").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "By state" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "All organizations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Share this report" })).toBeVisible();
});

test("/portfolio redirects into the Reporting Center (no dead-end, TD-1)", async ({
  context,
  page,
}) => {
  await seed(context);
  await page.goto("/portfolio");
  await expect(page).toHaveURL(/\/reporting\/portfolio$/, { timeout: 30000 });
  await expect(page.getByRole("heading", { name: "Share this report" })).toBeVisible();
});
