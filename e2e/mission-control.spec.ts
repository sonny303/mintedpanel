import {
  test,
  expect,
  type BrowserContext,
  type Page,
  type Route,
} from "./fixtures/legacy-access-context";

// Mission Control M2 — the /mission-control shell over the mock harness.
// The two RPCs are pinned to Milestone 1's contract:
//   is_platform_admin() -> boolean
//   platform_metrics()  -> { generatedAt, organizations{…}, users{…},
//                            providers{…}, cases{…}, pendingInvites }
// Covers:
//   (a) a platform admin hard-loads /mission-control: breadcrumb, section
//       navigation, the six tiles with the fixture numbers, the sidebar entry
//   (b) a non-admin hard-load gets the generic not-found view (identical to an
//       unknown URL) and no sidebar entry; a client-side navigation is
//       redirected back to /
//   (c) an is_platform_admin() error behaves exactly like false
//   (d) a platform admin with zero memberships reaches Mission Control (and
//       lands there from /) without the first-run NoOrgScreen
//   (e) a failed metrics load shows Retry, and Retry refetches
//   (f) phone width: the tiles stack in one column with no horizontal scroll

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Rose City Rehab Collective",
};

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
    email: "platform.admin@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Pat Platform" },
    created_at: "2026-07-09T00:00:00Z",
  },
};

const METRICS = {
  generatedAt: "2026-10-30T13:15:00.000Z",
  organizations: { total: 6, active: 4, prospect: 1, inactive: 1 },
  users: { total: 1284, platformAdmins: 2 },
  providers: { total: 3105, active: 2900, onboarding: 140, pendingVerification: 65 },
  cases: { total: 12480, open: 8312 },
  pendingInvites: 3,
};

// What the tiles must show for METRICS (en-US grouping; 140 + 65 in pipeline).
const TILES: Array<{ label: string; value: string; detail: string }> = [
  { label: "Organizations", value: "6", detail: "4 active · 1 prospect · 1 inactive" },
  { label: "Users", value: "1,284", detail: "2 platform admins" },
  {
    label: "Providers in pipeline",
    value: "205",
    detail: "Onboarding or awaiting verification, of 3,105 providers",
  },
  { label: "Pending verifications", value: "65", detail: "Providers awaiting verification" },
  { label: "Open cases", value: "8,312", detail: "of 12,480 cases in total" },
  { label: "Pending invites", value: "3", detail: "Invites not yet accepted" },
];

const SECTIONS: Array<{ name: string; href: string }> = [
  { name: "Home", href: "/mission-control" },
  { name: "Organizations", href: "/mission-control/organizations" },
  { name: "Users", href: "/mission-control/users" },
  { name: "Audit", href: "/mission-control/audit" },
  { name: "Cashboard", href: "/mission-control/cashboard" },
];

type Scenario = {
  platformAdmin: boolean | "error";
  withMembership: boolean;
  /** platform_metrics() fails this many times before it answers. */
  metricsFailures?: number;
};

type Row = Record<string, unknown>;

// This spec answers is_platform_admin() itself instead of the shared fixture's
// in-page "false" default.
test.use({ platformAdminRpc: "passthrough", locale: "en-US", timezoneId: "UTC" });

function fixtures(scenario: Scenario): Record<string, Row[]> {
  return {
    memberships: scenario.withMembership
      ? [
          {
            org_id: ORG.id,
            user_id: USER_ID,
            role: "admin",
            organizations: {
              name: ORG.name,
              lifecycle_state: "active",
              created_at: "2026-07-01T00:00:00Z",
            },
          },
        ]
      : [],
    profiles: [{ id: USER_ID, full_name: "Pat Platform", email: SESSION.user.email }],
    notes: [],
    user_table_prefs: [],
  };
}

function matchesFilters(row: Row, params: URLSearchParams): boolean {
  for (const [key, raw] of params.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) continue;
    if (!(key in row)) continue;
    const value = row[key];
    if (raw.startsWith("eq.") && String(value) !== raw.slice(3)) return false;
    if (raw.startsWith("neq.") && String(value) === raw.slice(4)) return false;
    if (raw.startsWith("in.(")) {
      const list = raw.slice(4, -1).split(",");
      if (!list.includes(String(value))) return false;
    }
    if (raw === "is.null" && value !== null) return false;
  }
  return true;
}

async function installMocks(context: BrowserContext, scenario: Scenario) {
  const tables = fixtures(scenario);
  const rpcCalls: string[] = [];
  let metricsFailuresLeft = scenario.metricsFailures ?? 0;

  await context.route(/\/(rest|auth)\/v1\//, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);

    if (url.pathname.includes("/rest/v1/rpc/")) {
      const fn = url.pathname.split("/rpc/")[1] ?? "";
      rpcCalls.push(fn);
      if (fn === "claim_invites") return json(0);
      if (fn === "is_platform_admin") {
        if (scenario.platformAdmin === "error") {
          return json(
            {
              code: "PGRST202",
              message: "Could not find the function public.is_platform_admin without parameters",
            },
            404,
          );
        }
        return json(scenario.platformAdmin);
      }
      if (fn === "platform_metrics") {
        if (scenario.platformAdmin !== true) {
          return json({ code: "42501", message: "Not a platform admin" }, 403);
        }
        if (metricsFailuresLeft > 0) {
          metricsFailuresLeft -= 1;
          return json({ code: "XX000", message: "Synthetic metrics failure" }, 500);
        }
        return json(METRICS);
      }
      // Any other RPC: an empty array, never a bare 0 a render loop could choke on.
      return json([]);
    }

    const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
    const rows = (tables[table] ?? []).filter((row) => matchesFilters(row, url.searchParams));
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (wantsObject) {
      if (rows.length !== 1) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  });

  await context.addInitScript(
    ([authKey, session, orgId]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, scenario.withMembership ? ORG.id : null] as const,
  );

  return { rpcCalls };
}

async function expectTiles(page: Page) {
  for (const tile of TILES) {
    const group = page.getByRole("group", { name: tile.label, exact: true });
    await expect(group).toBeVisible();
    await expect(group).toContainText(tile.value);
    await expect(group).toContainText(tile.detail);
  }
}

async function expectNotFound(page: Page) {
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Mission Control sections" })).toHaveCount(0);
}

function sidebar(page: Page) {
  return page.locator("aside").first();
}

test("(a) a platform admin hard-loads Mission Control: header, sections, six tiles, sidebar entry", async ({
  context,
  page,
}) => {
  const { rpcCalls } = await installMocks(context, { platformAdmin: true, withMembership: true });

  await page.goto("/mission-control");

  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs).toBeVisible({ timeout: 30000 });
  await expect(crumbs).toContainText("Mission Control");
  await expect(crumbs.getByText("Home", { exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1, name: "Mission Control" })).toBeVisible();

  const sections = page.getByRole("navigation", { name: "Mission Control sections" });
  await expect(sections.getByRole("link")).toHaveCount(SECTIONS.length);
  for (const section of SECTIONS) {
    await expect(sections.getByRole("link", { name: section.name, exact: true })).toHaveAttribute(
      "href",
      section.href,
    );
  }
  await expect(sections.getByRole("link", { name: "Home", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await expectTiles(page);
  await expect(page.getByText("Generated Oct 30, 2026 · 1:15 PM")).toBeVisible();

  const entry = sidebar(page).getByRole("link", { name: "Mission Control" });
  await expect(entry).toHaveAttribute("href", "/mission-control");
  await expect(entry).toHaveAttribute("aria-current", "page");
  // Seven primary items for a platform admin: the six plus Mission Control.
  await expect(sidebar(page).locator("nav a")).toHaveCount(7);

  expect(rpcCalls).toContain("is_platform_admin");
  expect(rpcCalls).toContain("platform_metrics");

  // The section navigation is client-side and keeps the shell.
  await sections.getByRole("link", { name: "Organizations", exact: true }).click();
  await expect(page).toHaveURL(/\/mission-control\/organizations$/);
  await expect(crumbs.getByText("Organizations", { exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("This page arrives with Mission Control milestone 3.")).toBeVisible();
  await expect(crumbs.getByRole("link", { name: "Mission Control" })).toHaveAttribute(
    "href",
    "/mission-control",
  );
  // Exactly one current page in each nav: a parent path never claims it.
  await expect(crumbs.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(sections.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(sections.getByRole("link", { name: "Organizations", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(sections.getByRole("link", { name: "Home", exact: true })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("(b) a non-admin gets the generic not-found view, no sidebar entry, and client navigation lands on /", async ({
  context,
  page,
}) => {
  const { rpcCalls } = await installMocks(context, { platformAdmin: false, withMembership: true });

  // An unknown URL first, for comparison: Mission Control must look the same.
  await page.goto("/no-such-page");
  await expectNotFound(page);
  const unknownText = await page.locator("main").innerText();

  await page.goto("/mission-control");
  await expectNotFound(page);
  expect(await page.locator("main").innerText()).toBe(unknownText);
  await expect(page.getByText(/mission control/i)).toHaveCount(0);

  await expect(sidebar(page).getByText("Workspace", { exact: true })).toBeVisible();
  await expect(sidebar(page).getByRole("link", { name: "Mission Control" })).toHaveCount(0);
  await expect(sidebar(page).locator("nav a")).toHaveCount(6);
  expect(rpcCalls).toContain("is_platform_admin");
  expect(rpcCalls).not.toContain("platform_metrics");

  // Client-side navigation attempt from a loaded workspace page: the layout's
  // beforeLoad redirects to / (which lands a member on /cases), so the
  // not-found backstop never even renders.
  await page.goto("/cases");
  await expect(sidebar(page).getByText("Workspace", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.evaluate(() => {
    window.history.pushState(window.history.state, "", "/mission-control");
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  });
  await expect(page).toHaveURL(/\/cases$/, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: "Page not found" })).toHaveCount(0);
  expect(rpcCalls).not.toContain("platform_metrics");
});

test("(c) an is_platform_admin() error is treated exactly like false", async ({
  context,
  page,
}) => {
  const { rpcCalls } = await installMocks(context, {
    platformAdmin: "error",
    withMembership: true,
  });

  await page.goto("/mission-control");
  await expectNotFound(page);
  // The app itself still loaded (not the "Can't reach Minted Panel" screen).
  await expect(sidebar(page).getByText("Workspace", { exact: true })).toBeVisible();
  await expect(sidebar(page).getByRole("link", { name: "Mission Control" })).toHaveCount(0);
  expect(rpcCalls).toContain("is_platform_admin");
  expect(rpcCalls).not.toContain("platform_metrics");
});

test("(d) a platform admin with no organization reaches Mission Control, never the first-run screen", async ({
  context,
  page,
}) => {
  await installMocks(context, { platformAdmin: true, withMembership: false });

  await page.goto("/mission-control");
  await expect(page.getByRole("heading", { level: 1, name: "Mission Control" })).toBeVisible({
    timeout: 30000,
  });
  await expectTiles(page);
  await expect(page.getByText("Create your first organization")).toHaveCount(0);
  await expect(sidebar(page).getByRole("link", { name: "Mission Control" })).toBeVisible();
  await expect(sidebar(page).getByText("Select an organization to see its details.")).toBeVisible();

  // The authenticated root lands such a user in Mission Control too.
  await page.goto("/");
  await expect(page).toHaveURL(/\/mission-control$/, { timeout: 30000 });
  await expect(page.getByRole("heading", { level: 1, name: "Mission Control" })).toBeVisible();
  await expect(page.getByText("Create your first organization")).toHaveCount(0);
});

test("(e) a failed metrics load offers Retry, and Retry refetches", async ({ context, page }) => {
  // The app retries a failed query twice on its own; fail all three attempts.
  const { rpcCalls } = await installMocks(context, {
    platformAdmin: true,
    withMembership: true,
    metricsFailures: 3,
  });

  await page.goto("/mission-control");
  await expect(page.getByText("The counts didn't load")).toBeVisible({ timeout: 30000 });
  expect(rpcCalls.filter((fn) => fn === "platform_metrics")).toHaveLength(3);

  await page.getByRole("button", { name: "Retry" }).click();
  await expectTiles(page);
  await expect(page.getByText("The counts didn't load")).toHaveCount(0);
  expect(rpcCalls.filter((fn) => fn === "platform_metrics")).toHaveLength(4);
});

test("(f) at phone width the tiles stack in one column with no horizontal scroll", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await installMocks(context, { platformAdmin: true, withMembership: true });

  await page.goto("/mission-control");
  await expectTiles(page);

  const lefts = await Promise.all(
    TILES.map(async (tile) => {
      const box = await page.getByRole("group", { name: tile.label, exact: true }).boundingBox();
      return Math.round(box?.x ?? -1);
    }),
  );
  expect(new Set(lefts).size).toBe(1);

  const overflow = await page
    .locator("main")
    .evaluate((main) => main.scrollWidth - main.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
