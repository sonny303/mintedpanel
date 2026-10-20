import { test as clientTest, type BrowserContext } from "@playwright/test";
import { test, expect, type Route } from "./fixtures/legacy-access-context";

// The Reporting Guide (/reporting/guide) and the per-report "About this
// report" sheet. Static content, so the mock harness only has to boot the
// shell: the guide renders, one search filters articles and terms together,
// a report's About sheet opens with its article and a link to the full
// guide, and a client-audience user sees the reduced set (Enrollment
// Explorer only, no internal reports, no review chips).

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_A = "22222222-2222-4222-8222-222222222222";
const CLIENT_ORG = "55555555-5555-4555-8555-555555555555";
const GROUP_A = "77777777-7777-4777-8777-777777777777";

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
    email: "guide.reader@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Guide Reader" },
    created_at: "2026-07-09T00:00:00Z",
  },
};

const ORG_ROW = {
  id: ORG_A,
  name: "Rose City Rehab Collective",
  lifecycle_state: "active",
  created_at: "2026-07-01T00:00:00Z",
};

function staffHandler() {
  return async function fulfillSupabase(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);
    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const rows: unknown[] =
      table === "memberships"
        ? [{ org_id: ORG_A, role: "admin", organizations: ORG_ROW }]
        : table === "organizations"
          ? [ORG_ROW]
          : [];
    if ((req.headers()["accept"] ?? "").includes("vnd.pgrst.object")) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  };
}

async function seedStaff(context: BrowserContext) {
  await context.route(/\/(rest|auth)\/v1\//, staffHandler());
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

test("the Reporting Center links to the guide, which renders Getting started", async ({
  context,
  page,
}) => {
  await seedStaff(context);
  await page.goto("/reporting");
  await page.getByRole("link", { name: "Guide & definitions" }).click({ timeout: 30000 });
  await expect(page.getByRole("heading", { name: "Guide & definitions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How the Reporting Center works" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Guide sections" });
  await expect(nav.getByRole("link", { name: "Denials" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Data dictionary" })).toBeVisible();
  // Internal users see what is still unvalidated.
  await expect(page.getByText("Draft definition").first()).toBeVisible();
});

test("a report article deep-links and links back to its report", async ({ context, page }) => {
  await seedStaff(context);
  await page.goto("/reporting/guide?topic=denials");
  await expect(page.getByRole("heading", { name: "Denials", level: 2 })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole("heading", { name: "How to read it" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Denials" })).toHaveAttribute(
    "href",
    "/reporting/denials",
  );
});

test("one search filters articles and terms together", async ({ context, page }) => {
  await seedStaff(context);
  await page.goto("/reporting/guide");
  const search = page.getByRole("searchbox", { name: "Search the guide" });
  await search.fill("primary source", { timeout: 30000 });
  const results = page.getByTestId("guide-search-results");
  await expect(results.getByTestId("guide-term-psv")).toBeVisible();
  await expect(results.getByTestId("guide-term-tin")).toHaveCount(0);
  await search.fill("zzzz-no-such-term");
  await expect(results.getByText("Nothing matches", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).first().click();
  await expect(page.getByTestId("guide-search-results")).toHaveCount(0);
});

test("a dictionary term deep-links", async ({ context, page }) => {
  await seedStaff(context);
  await page.goto("/reporting/guide?topic=dictionary&term=caqh");
  await expect(page.getByRole("heading", { name: "Data dictionary" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("guide-term-caqh")).toBeInViewport();
});

test("the About sheet opens on a report with its article and the full-guide link", async ({
  context,
  page,
}) => {
  await seedStaff(context);
  await page.goto("/reporting/denials");
  await page.getByRole("button", { name: "About this report" }).click({ timeout: 30000 });
  const sheet = page.getByTestId("about-report-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Denials" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Terms in this report" })).toBeVisible();
  await sheet.getByRole("link", { name: "Open full guide" }).click();
  await expect(page).toHaveURL(/\/reporting\/guide\?topic=denials/);
});

// Client users resolve their access context from /api/me/access-context, so
// this block uses the plain Playwright test (the legacy fixture would answer
// that call with a staff context).
clientTest.describe("client audience", () => {
  const clientContext = {
    actorUserId: USER_ID,
    email: "client@example.test",
    audience: "client",
    selectedOrgId: CLIENT_ORG,
    staffOrgs: [],
    clientOrgs: [
      {
        orgId: CLIENT_ORG,
        orgName: "Client Alpha",
        groups: [{ groupId: GROUP_A, groupName: "Alpha Providers" }],
      },
    ],
    globalTraining: false,
    restrictedExternal: true,
    contextRevision: "rev-client-guide",
  };

  async function seedClient(context: BrowserContext) {
    await context.route(/\/(rest|auth)\/v1\//, async (route) => {
      const url = new URL(route.request().url());
      const json = (body: unknown, status = 200) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (url.pathname.includes("/auth/v1/")) return json(SESSION);
      if (url.pathname.includes("/rest/v1/rpc/")) return json(0);
      if ((route.request().headers()["accept"] ?? "").includes("vnd.pgrst.object")) {
        return json({ code: "PGRST116", message: "no rows" }, 406);
      }
      return json([]);
    });
    await context.route("**/api/me/access-context**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "X-Minted-Context-Revision": clientContext.contextRevision },
        body: JSON.stringify({ data: clientContext, error: null }),
      }),
    );
    await context.addInitScript(
      ([authKey, session]) => {
        localStorage.setItem(authKey as string, JSON.stringify(session));
      },
      [AUTH_KEY, SESSION] as const,
    );
  }

  clientTest(
    "sees Enrollment Explorer and the basics only, with no review chips",
    async ({ context, page }) => {
      await seedClient(context);
      await page.goto("/reporting");
      await page.getByRole("link", { name: "Guide & definitions" }).click({ timeout: 30000 });
      const nav = page.getByRole("navigation", { name: "Guide sections" });
      await expect(nav.getByRole("link", { name: "Enrollment Explorer" })).toBeVisible();
      for (const internal of ["Denials", "Portfolio", "Audit Log", "Inbound Leads", "Launches"]) {
        await expect(nav.getByRole("link", { name: internal })).toHaveCount(0);
      }
      await expect(page.getByText("Draft definition")).toHaveCount(0);

      // An internal report's deep link falls back to Getting started.
      await page.goto("/reporting/guide?topic=audit-log");
      await expect(
        page.getByRole("heading", { name: "How the Reporting Center works" }),
      ).toBeVisible();

      // The dictionary keeps the basics and case statuses, not internal records.
      await page.goto("/reporting/guide?topic=dictionary");
      await expect(page.getByTestId("guide-term-psv")).toBeVisible();
      await expect(page.getByTestId("guide-term-denied")).toBeVisible();
      await expect(page.getByTestId("guide-term-touch")).toHaveCount(0);
    },
  );
});
