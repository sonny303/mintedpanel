import { test, expect, type Route } from "@playwright/test";

// E6.1 F6.1.1 / TS-106 + TS-121 — the six-item sidebar over the mock harness,
// using the 11-org seed universe (seed-universe.md). Supersedes the E0.9 IA
// v2 pins. Covers:
//   - exactly six primary items in the stated zones and order: Workspace
//     (Cases + open-case count, Payer Setup, Reporting Center) / org zone
//     (Org Detail, Groups, Providers) — for BOTH admin and specialist (the
//     TS-121 role sweep; Payer Setup is visible to all roles for now)
//   - NO Admin section, no Home, no My Cases, no reserved Facilities slot
//   - branding untouched: the white layered-jack mark + wordmark (F6.1.1 AC)
//   - the org switcher tile keeps the E0.9 lifecycle-grouped menu (headings
//     only, never a per-org status label) + footer actions
//   - narrow viewport: no horizontal scroll (existing shell rules)
//   - user menu: Settings lands on Org Detail (member management's home)

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

function makeFixtures(role: string): Record<string, unknown[]> {
  return {
    memberships: UNIVERSE.map((o) => ({
      org_id: o.id,
      role,
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
}

function fulfillWith(fixtures: Record<string, unknown[]>) {
  return async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
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

async function seedAuth(context: {
  addInitScript: (fn: (args: unknown[]) => void, args: unknown[]) => Promise<void>;
}) {
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
}

const SIX_ITEMS = [
  "Cases",
  "Payer Setup",
  "Reporting Center",
  "Org Detail",
  "Groups",
  "Providers",
] as const;

async function assertSixItems(page: import("@playwright/test").Page) {
  const rail = page.locator("aside").first();
  await expect(rail.getByText("Workspace", { exact: true })).toBeVisible({ timeout: 30000 });

  // The six, with their stated destinations.
  const expectHref = async (name: string, href: string) => {
    const link = rail.getByRole("link", { name: new RegExp(`^${name}`) });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", href);
  };
  await expectHref("Cases", "/cases");
  await expectHref("Payer Setup", "/admin/payer-admin");
  await expectHref("Reporting Center", "/reporting");
  await expectHref("Org Detail", "/org-detail");
  await expectHref("Groups", "/groups");
  await expectHref("Providers", "/providers");

  // Exactly six primary nav links across the two nav zones (the switcher and
  // user footer are buttons/menus, not nav links).
  const navLinks = rail.locator("nav a");
  await expect(navLinks).toHaveCount(SIX_ITEMS.length);

  // Retired entries and labels are gone — no Admin section for any role.
  for (const gone of [
    "Home",
    "My Cases",
    "Account Detail",
    "Facilities",
    "Payer Management",
    "Payer & SOP Setup",
    "Templates",
    "Portals",
    "Statuses",
    "MSO Routing",
    "Data Import",
    "Audit Log",
    "Fix-it queue",
    "Client Progress",
  ]) {
    await expect(rail.getByRole("link", { name: gone, exact: true })).toHaveCount(0);
  }
  // No Admin SECTION exists — the only zone label on the rail is Workspace
  // (the "Admin" text in the user footer is the role display, not a section).
  await expect(rail.locator("nav").getByText("Admin", { exact: true })).toHaveCount(0);

  // Branding untouched (F6.1.1 AC): the shipped white layered-jack mark.
  const logo = rail.getByRole("img", { name: "Minted Panel" });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", /logo-white/);
  await expect(rail.getByText("Minted Panel", { exact: true })).toBeVisible();
}

test.describe("admin (P1)", () => {
  test.beforeEach(async ({ context }) => {
    await context.route(/\/(rest|auth)\/v1\//, fulfillWith(makeFixtures("admin")));
    await seedAuth(context);
  });

  test("TS-106: exactly the six items render, in zones, with untouched branding", async ({
    page,
  }) => {
    await page.goto("/org-detail");
    await assertSixItems(page);

    // Zone order: the Workspace zone precedes the org switcher tile; the org
    // zone items sit under it.
    const rail = page.locator("aside").first();
    await expect(rail.getByText("Organization", { exact: true })).toBeVisible();
    await expect(rail.getByText(ACTIVE_ORG.name)).toBeVisible();
  });

  test("org switcher groups by lifecycle with no per-org status label; footer actions work", async ({
    page,
  }) => {
    await page.goto("/org-detail");
    const rail = page.locator("aside").first();
    await rail.getByRole("button", { name: /Switch organization/ }).click({ timeout: 30000 });

    const menu = page.getByRole("menu");
    // Lifecycle group headings only (Portfolio precedent) — never a per-org label.
    await expect(menu.getByText("Active", { exact: true })).toBeVisible();
    await expect(menu.getByText("Prospects", { exact: true })).toBeVisible();
    await expect(menu.getByText("Inactive", { exact: true })).toBeVisible();
    await expect(menu.getByText("Tree Hill Sports Therapy")).toBeVisible();
    await expect(menu.getByText("Outer Banks Therapy Group")).toBeVisible();

    // 11 orgs > 10 → the search field renders.
    const search = menu.getByLabel("Search organizations");
    await expect(search).toBeVisible();
    await search.fill("Lone Star");
    await expect(menu.getByText("Lone Star Rehab Group")).toBeVisible();
    await expect(menu.getByText("Shelby Sports Rehab")).toHaveCount(0);
    await search.fill("");

    // Footer actions: Add organization (the wizard's one-time entry, F6.1.5)
    // + View all organizations.
    await expect(menu.getByText("Add organization")).toBeVisible();
    await expect(menu.getByText("View all organizations")).toBeVisible();
    await menu.getByText("View all organizations").click();
    await expect(page).toHaveURL(/\/reporting\/portfolio\/?$/, { timeout: 15000 });
  });

  test("switching orgs from the grouped menu updates the tile", async ({ page }) => {
    await page.goto("/org-detail");
    const rail = page.locator("aside").first();
    await rail.getByRole("button", { name: /Switch organization/ }).click({ timeout: 30000 });
    await page.getByRole("menu").getByText("Shelby Sports Rehab").click();
    await expect(rail.getByText("Shelby Sports Rehab")).toBeVisible({ timeout: 15000 });
  });

  test("user menu offers Settings (→ Org Detail) above Sign out", async ({ page }) => {
    await page.goto("/cases");
    const rail = page.locator("aside").first();
    await rail.getByRole("button", { name: "Account menu" }).click({ timeout: 30000 });

    const menu = page.getByRole("menu");
    await expect(menu.getByText("sowmya.seed@example.test")).toBeVisible();
    const items = menu.getByRole("menuitem");
    await expect(items.filter({ hasText: "Settings" })).toBeVisible();
    await expect(items.filter({ hasText: "Sign out" })).toBeVisible();
    await menu.getByText("Settings").click();
    await expect(page).toHaveURL(/\/org-detail\/?$/, { timeout: 15000 });
  });

  test("TS-121: narrow viewport follows the shell rules with no horizontal scroll", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto("/cases");
    await expect(page.locator("main h1, h1").first()).toBeVisible({ timeout: 30000 });
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("specialist (P2) — TS-121 role sweep", () => {
  test.beforeEach(async ({ context }) => {
    await context.route(/\/(rest|auth)\/v1\//, fulfillWith(makeFixtures("specialist")));
    await seedAuth(context);
  });

  test("the identical six items render — Payer Setup visible to all roles, no admin-only section", async ({
    page,
  }) => {
    await page.goto("/cases");
    await assertSixItems(page);
  });
});
