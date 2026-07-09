import { test, expect, type Route } from "@playwright/test";

// E0.4 F0.4.2 / TE-3 + TD-4 — Playwright coverage of the all-inactive Portfolio
// fallback (TS-12). This path is reachable only when every org the caller can see
// is inactive, so without a test it would silently rot. The sandbox/CI can't
// reach *.supabase.co, so this uses the mock harness documented in CLAUDE.md:
// seed the GoTrue session + minted-panel-active-org in localStorage, and answer
// the Supabase HTTP layer from fixtures. TS-12 flips every seeded org to
// `lifecycle_state: 'inactive'`; the fixture below bakes that mutation in.

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

const FIXTURES: Record<string, unknown[]> = {
  // Every org inactive — the TS-12 mutation state.
  organizations: [
    {
      id: ORG_A,
      name: "Rose City Rehab Collective",
      lifecycle_state: "inactive",
      created_at: "2026-07-01T00:00:00Z",
    },
    {
      id: ORG_B,
      name: "Outer Banks Rehab Group",
      lifecycle_state: "inactive",
      created_at: "2026-06-01T00:00:00Z",
    },
  ],
  memberships: [
    {
      org_id: ORG_A,
      role: "admin",
      organizations: {
        name: "Rose City Rehab Collective",
        lifecycle_state: "inactive",
        created_at: "2026-07-01T00:00:00Z",
      },
    },
    {
      org_id: ORG_B,
      role: "admin",
      organizations: {
        name: "Outer Banks Rehab Group",
        lifecycle_state: "inactive",
        created_at: "2026-06-01T00:00:00Z",
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

test("all-inactive portfolio shows the Inactive group + create CTA (TS-12)", async ({
  context,
  page,
}) => {
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

  await page.goto("/portfolio");

  // Cold dev-server compile + SSR/hydrate + auth init + fetch resolve on the first
  // assertion; the rest are immediate.
  await expect(page.getByRole("heading", { name: "Inactive" })).toBeVisible({ timeout: 30000 });
  // Scope to the row buttons (the org name also appears in the sidebar's
  // active-org header, so a bare getByText would match multiple elements).
  await expect(page.getByRole("button", { name: "Open Rose City Rehab Collective" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Outer Banks Rehab Group" })).toBeVisible();
  // Never a dead end: the create-org next action is present.
  await expect(page.getByRole("button", { name: "Create organization" })).toBeVisible();
  await expect(page.getByText("No organizations in motion")).toBeVisible();
});
