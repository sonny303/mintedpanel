import { test, expect, type Route } from "@playwright/test";

// E0.9 F0.9.6 / TS-23 — legacy-route sweep over the mock harness. The IA v2
// restructure (F0.9.3) re-homed /cases, /admin/payers and /admin/settings into
// the nav; every other flat route that leaves or never had a nav entry must
// stay URL-reachable (renders) or redirect — no dead ends (E0.0 TD-2 / E0.6
// TD-1 close-out). This spec pins that behavior so it cannot rot.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

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
};

async function fulfillSupabase(route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  if (url.pathname.includes("/auth/v1/")) return json(SESSION);
  if (url.pathname.endsWith("/rpc/get_sop_field_tokens")) return json([]);
  if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

  const table = url.pathname.split("/rest/v1/")[1] ?? "";
  const rows = FIXTURES[table] ?? [];
  const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
  if (wantsObject) {
    if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
    return json(rows[0]);
  }
  if (req.method() === "POST" || req.method() === "PATCH") return json(null, 201);
  return json(rows);
}

function seedAuth(context: {
  addInitScript: (fn: (args: unknown[]) => void, args: unknown[]) => Promise<void>;
}) {
  return context.addInitScript(
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

// Routes that must RENDER (a page heading appears, no router dead end).
// /cases, /admin/payers, /admin/settings are the F0.9.6 re-homed nav routes;
// the rest are the enumerated legacy set that stays URL-reachable on purpose.
const RENDERING_ROUTES = [
  "/cases",
  "/admin/settings",
  "/home",
  "/providers",
  "/launches",
  "/reports",
  "/fix-it",
  "/client-progress",
  "/admin/audit",
  "/admin/import",
  "/admin/mso-routing",
  "/admin/portals",
  "/admin/statuses",
  "/admin/templates",
  // E2.3 activated the reserved /work slot as the My Cases queue.
  "/work",
];

// Routes that must REDIRECT (old links live — E0.4 rule).
const REDIRECTING_ROUTES: Array<{ from: string; to: RegExp }> = [
  { from: "/portfolio", to: /\/reporting\/portfolio\/?$/ },
  { from: "/progress", to: /\/client-progress\/?$/ },
  { from: "/admin/sops", to: /\/admin\/templates\/?$/ },
  // E4.2 TE-18/TE-19 — Admin → Payers consolidated into the Payer Setup
  // workspace (the /admin/sops redirect-shell precedent).
  { from: "/admin/payers", to: /\/admin\/payer-admin\/?$/ },
];

// Reserved destinations render the shared not-yet-available state.
const RESERVED_ROUTES = [
  { path: "/soon?title=Facilities", title: "Facilities" },
  { path: "/soon?title=Providers", title: "Providers" },
  { path: "/scope", title: "Scope" },
  { path: "/outcomes", title: "Outcomes" },
];

test.describe("legacy-route sweep (F0.9.6 / TS-23)", () => {
  test.beforeEach(async ({ context }) => {
    await context.route(/\/(rest|auth)\/v1\//, fulfillSupabase);
    await seedAuth(context);
  });

  for (const path of RENDERING_ROUTES) {
    test(`${path} renders a page (no dead end)`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main h1, h1").first()).toBeVisible({ timeout: 30000 });
      await expect(page.locator("body")).not.toContainText("Not Found");
    });
  }

  for (const { from, to } of REDIRECTING_ROUTES) {
    test(`${from} redirects (old links live)`, async ({ page }) => {
      await page.goto(from);
      await expect(page).toHaveURL(to, { timeout: 30000 });
    });
  }

  for (const { path, title } of RESERVED_ROUTES) {
    test(`${path} shows the shared not-yet-available state`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByText(`${title} isn't available yet`)).toBeVisible({
        timeout: 30000,
      });
    });
  }
});
