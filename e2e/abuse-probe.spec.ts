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

test.describe("throttle probe (E0.8 F0.8.8 / TS-16)", () => {
  test("throttled validation of a REAL token is indistinguishable from invalid, then validates once the window passes", async ({
    context,
    page,
  }) => {
    // Mock the RPC boundary the way the throttled DB behaves (TE-9: the raw
    // token is ephemeral, so TS-16 runs against the contract, not live data):
    // while the caller is over the 20-failed/15-min cap, validate_capture_token
    // returns the SAME generic { state: 'invalid' } it returns for a wrong
    // token — no org name, no recipient, no state detail (no oracle). Once the
    // window passes, the identical token validates and the form renders.
    let throttled = true;
    await context.route(/\/(rest|auth)\/v1\//, async (route: Route) => {
      const url = new URL(route.request().url());
      const json = (b: unknown) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
      if (url.pathname.endsWith("/rpc/validate_capture_token")) {
        if (throttled) return json({ state: "invalid" });
        return json({
          state: "active",
          org_name: "Lone Star Rehab Group",
          recipient_name: "Owen Strand",
          recipient_email: "contact.lone-star@example.test",
          expires_at: "2026-07-13T00:00:00Z",
          current: { name: "Owen Strand", email: "contact.lone-star@example.test" },
        });
      }
      if (url.pathname.includes("/rest/v1/rpc/")) return json(0);
      if (url.pathname.includes("/auth/v1/")) return json({});
      return json([]);
    });

    // Over-threshold: the real Lone Star token gets the generic invalid
    // lockdown — indistinguishable from a bogus token, nothing leaks.
    await page.goto("/capture/real-lone-star-token");
    await expect(page.getByText("This link is no longer valid")).toBeVisible({ timeout: 30000 });
    await expect(page.locator("body")).not.toContainText("Lone Star");
    await expect(page.locator("body")).not.toContainText("Owen Strand");
    await expect(page.locator("body")).not.toContainText("expired");

    // Window passed: the SAME token validates and the branded form renders.
    throttled = false;
    await page.goto("/capture/real-lone-star-token");
    await expect(page.getByRole("heading", { name: "Confirm your details" })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("Lone Star Rehab Group", { exact: false }).first()).toBeVisible();
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
