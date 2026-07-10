import { test, expect, type Route } from "@playwright/test";

// E0.7 F0.7.1 TE-6 — Abuse probe coverage (TS-16). Validates that ALL public
// anon RPCs produce uniform, indistinguishable responses for invalid/bogus
// tokens. No org name, recipient name, or token state detail leaks. This
// mirrors the TE-2 manual audit with browser-level assertions.

function rpcMock(rpcPath: string, body: unknown) {
  return async (route: Route) => {
    const url = new URL(route.request().url());
    const json = (b: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (url.pathname.endsWith(rpcPath)) return json(body);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);
    if (url.pathname.includes("/auth/v1/")) return json({});
    return json([]);
  };
}

test.describe("capture route abuse probes (validate_capture_token)", () => {
  const LOCKDOWN_TEXT = "This link is no longer valid";

  test("invalid token shows generic lockdown", async ({ context, page }) => {
    await context.route(
      /\/(rest|auth)\/v1\//,
      rpcMock("/rpc/validate_capture_token", { state: "invalid" }),
    );
    await page.goto("/capture/totally-bogus-probe");
    await expect(page.getByText(LOCKDOWN_TEXT)).toBeVisible({ timeout: 30000 });
    await expect(page.locator("body")).not.toContainText("Rose City");
    await expect(page.locator("body")).not.toContainText("Candace");
  });

  test("revoked token is indistinguishable from invalid", async ({ context, page }) => {
    await context.route(
      /\/(rest|auth)\/v1\//,
      rpcMock("/rpc/validate_capture_token", {
        state: "revoked",
        org_name: "Rose City Rehab Collective",
        recipient_name: "Candace Devereaux",
      }),
    );
    await page.goto("/capture/revoked-probe");
    await expect(page.getByText(LOCKDOWN_TEXT)).toBeVisible({ timeout: 30000 });
  });
});

test.describe("share route abuse probes (validate_report_share)", () => {
  test("invalid token shows generic lockdown and leaks no data", async ({ context, page }) => {
    await context.route(
      /\/(rest|auth)\/v1\//,
      rpcMock("/rpc/validate_report_share", { state: "invalid" }),
    );
    await page.goto("/share/totally-bogus-probe");
    await expect(page.getByText("This link is no longer valid")).toBeVisible({ timeout: 30000 });
    await expect(page.locator("body")).not.toContainText("Portfolio");
  });

  test("revoked share is indistinguishable from invalid", async ({ context, page }) => {
    await context.route(
      /\/(rest|auth)\/v1\//,
      rpcMock("/rpc/validate_report_share", { state: "revoked" }),
    );
    await page.goto("/share/revoked-probe");
    await expect(page.getByText("This link is no longer valid")).toBeVisible({ timeout: 30000 });
  });

  test("expired share shows distinct expired message (legitimate holder info)", async ({
    context,
    page,
  }) => {
    await context.route(
      /\/(rest|auth)\/v1\//,
      rpcMock("/rpc/validate_report_share", { state: "expired" }),
    );
    await page.goto("/share/expired-probe");
    await expect(page.getByText("This link has expired")).toBeVisible({ timeout: 30000 });
  });
});

test.describe("contact route (submit_inbound_lead)", () => {
  test("contact form renders and validates without any token (TS-16)", async ({
    context,
    page,
  }) => {
    await context.route(/\/(rest|auth)\/v1\//, async (route: Route) => {
      const url = new URL(route.request().url());
      const json = (b: unknown) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
      if (url.pathname.includes("/auth/v1/")) return json({});
      return json([]);
    });
    await page.goto("/contact");
    await expect(page.getByRole("heading", { name: "Get in touch" })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator("body")).not.toContainText("token");
    await expect(page.locator("body")).not.toContainText("invalid");
  });
});
