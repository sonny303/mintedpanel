import { test, expect, type Route } from "@playwright/test";

// E0.6 TE-6/TE-7 — the PUBLIC read-only report share (/share/:token). No session.
// The scope filter is enforced server-side; here we mock validate_report_share to
// assert the recipient view shows exactly the in-scope orgs and the lockdowns.

function mock(validateBody: unknown) {
  return async (route: Route) => {
    const url = new URL(route.request().url());
    const json = (b: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (url.pathname.endsWith("/rpc/validate_report_share")) return json(validateBody);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);
    if (url.pathname.includes("/auth/v1/")) return json({});
    return json([]);
  };
}

const org = (id: string, name: string, lifecycle = "active") => ({
  id,
  name,
  lifecycle_state: lifecycle,
  created_at: "2026-07-01T00:00:00Z",
});

test("full share shows every org in the portfolio (TS-4)", async ({ context, page }) => {
  await context.route(
    /\/(rest|auth)\/v1\//,
    mock({
      state: "active",
      report_key: "portfolio",
      scope: "full",
      orgs: [
        org("o1", "Rose City Rehab Collective", "prospect"),
        org("o2", "Dillon Sports Medicine"),
        org("o3", "Point Place Physical Therapy"),
      ],
    }),
  );
  await page.goto("/share/fulltoken");
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Rose City Rehab Collective")).toBeVisible();
  await expect(page.getByText("Dillon Sports Medicine")).toBeVisible();
  await expect(page.getByText("Point Place Physical Therapy")).toBeVisible();
});

test("single-org share shows ONLY that org, no other org leaks (filtered share)", async ({
  context,
  page,
}) => {
  await context.route(
    /\/(rest|auth)\/v1\//,
    mock({
      state: "active",
      report_key: "portfolio",
      scope: "single_org",
      orgs: [org("o1", "Rose City Rehab Collective", "prospect")],
    }),
  );
  await page.goto("/share/singletoken");
  await expect(page.getByText("Rose City Rehab Collective")).toBeVisible({ timeout: 30000 });
  // No other seeded org appears in a single-org share.
  await expect(page.getByText("Dillon Sports Medicine")).toHaveCount(0);
  await expect(page.getByText("Point Place Physical Therapy")).toHaveCount(0);
});

test("a revoked share shows the revoked lockdown", async ({ context, page }) => {
  await context.route(/\/(rest|auth)\/v1\//, mock({ state: "revoked" }));
  await page.goto("/share/revokedtoken");
  await expect(page.getByText("This link was revoked")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Rose City", { exact: false })).toHaveCount(0);
});

test("an expired share shows the expired lockdown", async ({ context, page }) => {
  await context.route(/\/(rest|auth)\/v1\//, mock({ state: "expired" }));
  await page.goto("/share/expiredtoken");
  await expect(page.getByText("This link has expired")).toBeVisible({ timeout: 30000 });
});
