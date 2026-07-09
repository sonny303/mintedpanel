import { test, expect, type Route } from "@playwright/test";

// E0.5 TE-3/TE-6 — the PUBLIC one-time capture route (/capture/:token). No
// session (BD-1). The sandbox/CI can't reach *.supabase.co, so this mocks the
// two anon RPCs (validate_capture_token, submit_capture) via context.route.
// Fixture: Rose City Rehab Collective alt recipient (TS-13), Candace Devereaux.

const VALIDATE = "/rpc/validate_capture_token";
const SUBMIT = "/rpc/submit_capture";

function mock(validateBody: unknown, submitBody: unknown = { ok: true, state: "used" }) {
  return async (route: Route) => {
    const url = new URL(route.request().url());
    const json = (b: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (url.pathname.endsWith(VALIDATE)) return json(validateBody);
    if (url.pathname.endsWith(SUBMIT)) return json(submitBody);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);
    if (url.pathname.includes("/auth/v1/")) return json({});
    return json([]);
  };
}

const ACTIVE = {
  state: "active",
  org_name: "Rose City Rehab Collective",
  recipient_name: "Candace Devereaux",
  recipient_email: "contact.rose-city@example.test",
  expires_at: "2026-07-12T17:00:00Z",
  required_fields: [
    "name",
    "email",
    "phone_office",
    "address_line1",
    "city",
    "state",
    "postal_code",
  ],
  current: {
    name: "Candace Devereaux",
    email: "contact.rose-city@example.test",
    phone_office: null,
    phone_mobile: null,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    postal_code: null,
    country: null,
  },
};

test("active link renders the form and completes to the done state (TS-7/TS-13)", async ({
  context,
  page,
}) => {
  await context.route(/\/(rest|auth)\/v1\//, mock(ACTIVE));
  await page.goto("/capture/testtoken123");

  await expect(page.getByRole("heading", { name: "Confirm your details" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText("Rose City Rehab Collective", { exact: false })).toBeVisible();

  // Name + email prefilled from `current`; complete the remaining required fields.
  await page.locator("#capture-phone").fill("503-555-0121");
  await page.locator("#capture-line1").fill("3550 N Mississippi Ave");
  await page.locator("#capture-city").fill("Portland");
  await page.locator("#capture-state").fill("OR");
  await page.locator("#capture-zip").fill("97227");

  await page.getByRole("button", { name: "Submit details" }).click();
  await expect(page.getByText("Thank you — you're all set")).toBeVisible();
});

test("a used link shows the already-completed lockdown (F0.5.2)", async ({ context, page }) => {
  await context.route(
    /\/(rest|auth)\/v1\//,
    mock({
      state: "used",
      org_name: "Rose City Rehab Collective",
      recipient_name: "Candace Devereaux",
    }),
  );
  await page.goto("/capture/usedtoken");
  await expect(page.getByText("This form is already completed")).toBeVisible({ timeout: 30000 });
});

test("an expired link shows the expired lockdown (F0.5.2)", async ({ context, page }) => {
  await context.route(
    /\/(rest|auth)\/v1\//,
    mock({
      state: "expired",
      org_name: "Rose City Rehab Collective",
      recipient_name: "Candace Devereaux",
    }),
  );
  await page.goto("/capture/expiredtoken");
  await expect(page.getByText("This link has expired")).toBeVisible({ timeout: 30000 });
});

test("an invalid token never reveals an org (TD-1)", async ({ context, page }) => {
  await context.route(/\/(rest|auth)\/v1\//, mock({ state: "invalid" }));
  await page.goto("/capture/bogus");
  await expect(page.getByText("This link is no longer valid")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Rose City", { exact: false })).toHaveCount(0);
});
