import { test, expect, type Route } from "@playwright/test";

// E0.7 F0.7.4 TE-5 — Regression coverage for the landing resolver states (E0.4):
//   1. first-run (zero orgs) → NoOrgScreen
//   2. workspace (valid active org) → workspace redirect
//   3. portfolio (all inactive) → /reporting/portfolio redirect
// The TS-12 all-inactive path is covered in portfolio-inactive-fallback.spec.ts;
// this file adds coverage for first-run and workspace-redirect.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_A = "22222222-2222-4222-8222-222222222222";

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

function makeFulfill(fixtures: Record<string, unknown[]>) {
  return async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.endsWith("/rpc/claim_invites")) return json(0);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const rows = fixtures[table] ?? [];
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  };
}

const PROFILE = {
  id: USER_ID,
  full_name: "Test User",
  email: "test@example.test",
  created_at: "2026-07-09T00:00:00Z",
};

test("first-run (zero orgs) renders NoOrgScreen with the create form (F0.4.1)", async ({
  context,
  page,
}) => {
  const fixtures: Record<string, unknown[]> = {
    organizations: [],
    memberships: [],
    profiles: [PROFILE],
    notes: [],
    user_table_prefs: [],
  };

  await context.route(/\/(rest|auth)\/v1\//, makeFulfill(fixtures));
  await context.addInitScript(
    ([authKey, session]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: null }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION] as const,
  );

  await page.goto("/get-started");

  await expect(page.getByText("Create your first organization")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button", { name: "Create your first organization" })).toBeVisible();
});

test("workspace (valid active org) renders the workspace page (F0.4.1)", async ({
  context,
  page,
}) => {
  const fixtures: Record<string, unknown[]> = {
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
    profiles: [PROFILE],
    notes: [],
    user_table_prefs: [],
    parties: [],
    party_role_assignments: [],
    party_role_types: [],
    inbound_leads: [],
    party_capture_links: [],
  };

  await context.route(/\/(rest|auth)\/v1\//, makeFulfill(fixtures));
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

  await expect(page.getByText("Rose City Rehab Collective").first()).toBeVisible({ timeout: 30000 });
});
