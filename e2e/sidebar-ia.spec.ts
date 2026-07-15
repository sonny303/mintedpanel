import { test, expect, type Route } from "@playwright/test";

// E0.9 F0.9.3 / TS-22 — Sidebar IA v2 + lifecycle-grouped org switcher over
// the mock harness, using the 11-org seed universe (seed-universe.md). Covers:
//   - nav shows exactly Workspace (Home, My Cases — the E2.3 queue —, Cases +
//     count) / Payers (Payer Management) / Reporting Center; no Tasks, SOP,
//     Setup/Config, or "Org space" label
//   - the org switcher tile (ORGANIZATION eyebrow) opens a lifecycle-grouped
//     menu (Active / Prospects / Inactive) with a check on the active org and
//     NO per-org lifecycle status label (E0.0 locked decision)
//   - footer actions: Add organization (→ /onboarding) + View all
//     organizations (→ /reporting/portfolio)
//   - the search field renders above the 10-org threshold (the approved mock
//     shows it with the 11-org universe)
//   - user menu carries Settings above Sign out

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";

// The 11-org seed universe (names + lifecycle per seed-universe.md).
const UNIVERSE: Array<{ id: string; name: string; lifecycle: string }> = [
  {
    id: "00000000-0000-4000-a000-000000000001",
    name: "Outer Banks Rehab Group",
    lifecycle: "active",
  },
  { id: "00000000-0000-4000-a000-000000000002", name: "Shelby Sports Rehab", lifecycle: "active" },
  {
    id: "00000000-0000-4000-a000-000000000003",
    name: "Gemstone Family Rehab",
    lifecycle: "active",
  },
  {
    id: "00000000-0000-4000-a000-000000000004",
    name: "South Park Physical Therapy",
    lifecycle: "active",
  },
  {
    id: "00000000-0000-4000-a000-000000000005",
    name: "Dillon Sports Medicine",
    lifecycle: "active",
  },
  {
    id: "00000000-0000-4000-a000-000000000006",
    name: "Point Place Physical Therapy",
    lifecycle: "active",
  },
  {
    id: "00000000-0000-4000-a000-000000000007",
    name: "Tree Hill Sports Therapy",
    lifecycle: "prospect",
  },
  {
    id: "00000000-0000-4000-a000-000000000008",
    name: "Lowcountry Charm PT",
    lifecycle: "prospect",
  },
  {
    id: "00000000-0000-4000-a000-000000000009",
    name: "Lone Star Rehab Group",
    lifecycle: "prospect",
  },
  {
    id: "00000000-0000-4000-a000-00000000000a",
    name: "Rose City Rehab Collective",
    lifecycle: "prospect",
  },
  {
    id: "00000000-0000-4000-a000-00000000000b",
    name: "Outer Banks Therapy Group",
    lifecycle: "inactive",
  },
];
const ACTIVE_ORG = UNIVERSE[0];

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
  memberships: UNIVERSE.map((o) => ({
    org_id: o.id,
    role: "admin",
    organizations: {
      name: o.name,
      lifecycle_state: o.lifecycle,
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

test.beforeEach(async ({ context }) => {
  await context.route(/\/(rest|auth)\/v1\//, fulfillSupabase);
  await context.addInitScript(
    ([authKey, session, orgId]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ACTIVE_ORG.id] as const,
  );
});

test("IA v2 nav shows exactly the approved destinations", async ({ page }) => {
  await page.goto("/get-started");
  const rail = page.locator("aside").first();

  await expect(rail.getByText("Workspace", { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(rail.getByRole("link", { name: /^Home$/ })).toBeVisible();
  // E2.3 TE-8: the queue's Workspace entry ("My Cases", [r4-review] Q9)
  // alongside the existing Cases work view.
  await expect(rail.getByRole("link", { name: "My Cases" })).toBeVisible();
  await expect(rail.getByRole("link", { name: /^Cases/ })).toBeVisible();
  await expect(rail.getByText("Payers", { exact: true })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Payer Management" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Reporting Center" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Account Detail" })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Facilities" })).toBeVisible();
  const providersLink = rail.getByRole("link", { name: "Providers" });
  await expect(providersLink).toBeVisible();
  await expect(providersLink).toHaveAttribute("href", "/onboarding/wizard?section=providers");

  // Retired items and labels are gone.
  await expect(rail.getByText("Org space")).toHaveCount(0);
  await expect(rail.getByText("Setup / Config")).toHaveCount(0);
  await expect(rail.getByRole("link", { name: "Tasks" })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: "SOP", exact: true })).toHaveCount(0);

  // The org zone header is the switcher tile with the ORGANIZATION eyebrow.
  await expect(rail.getByText("Organization", { exact: true })).toBeVisible();
  await expect(rail.getByText(ACTIVE_ORG.name)).toBeVisible();

  await providersLink.click();
  await expect(page).toHaveURL(/\/onboarding\/wizard\?section=providers$/);
  await expect(page.locator("#wizard-providers-heading")).toBeFocused();
});

test("org switcher groups by lifecycle with no per-org status label; footer actions work", async ({
  page,
}) => {
  await page.goto("/get-started");
  const rail = page.locator("aside").first();
  await rail.getByRole("button", { name: /Switch organization/ }).click({ timeout: 30000 });

  const menu = page.getByRole("menu");
  // Lifecycle group headings only (Portfolio precedent) — never a per-org label.
  await expect(menu.getByText("Active", { exact: true })).toBeVisible();
  await expect(menu.getByText("Prospects", { exact: true })).toBeVisible();
  await expect(menu.getByText("Inactive", { exact: true })).toBeVisible();
  await expect(menu.getByText("Tree Hill Sports Therapy")).toBeVisible();
  await expect(menu.getByText("Outer Banks Therapy Group")).toBeVisible();

  // 11 orgs > 10 → the search field renders (per the approved Sidebar Nav mock).
  const search = menu.getByLabel("Search organizations");
  await expect(search).toBeVisible();
  await search.fill("Lone Star");
  await expect(menu.getByText("Lone Star Rehab Group")).toBeVisible();
  await expect(menu.getByText("Shelby Sports Rehab")).toHaveCount(0);
  await search.fill("");

  // Footer actions.
  await expect(menu.getByText("Add organization")).toBeVisible();
  await expect(menu.getByText("View all organizations")).toBeVisible();
  await menu.getByText("View all organizations").click();
  await expect(page).toHaveURL(/\/reporting\/portfolio\/?$/, { timeout: 15000 });
});

test("switching orgs from the grouped menu updates the tile", async ({ page }) => {
  await page.goto("/get-started");
  const rail = page.locator("aside").first();
  await rail.getByRole("button", { name: /Switch organization/ }).click({ timeout: 30000 });
  await page.getByRole("menu").getByText("Shelby Sports Rehab").click();
  await expect(rail.getByText("Shelby Sports Rehab")).toBeVisible({ timeout: 15000 });
});

test("user menu offers Settings above Sign out", async ({ page }) => {
  await page.goto("/get-started");
  const rail = page.locator("aside").first();
  await rail.getByRole("button", { name: "Account menu" }).click({ timeout: 30000 });

  const menu = page.getByRole("menu");
  await expect(menu.getByText("sowmya.seed@example.test")).toBeVisible();
  const items = menu.getByRole("menuitem");
  await expect(items.filter({ hasText: "Settings" })).toBeVisible();
  await expect(items.filter({ hasText: "Sign out" })).toBeVisible();
  await menu.getByText("Settings").click();
  await expect(page).toHaveURL(/\/admin\/settings\/?$/, { timeout: 15000 });
});
