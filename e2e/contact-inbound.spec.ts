import { test, expect, type Route } from "@playwright/test";

// E0.5 TE-7/TE-6 — the PUBLIC inbound "contact us" route (/contact). No token, no
// session. Mocks the anon submit_inbound_lead RPC. A submitted inquiry becomes a
// triaged lead (verified server-side elsewhere); here we assert the public form
// validates required fields and reaches the thank-you state.

async function fulfill(route: Route) {
  const url = new URL(route.request().url());
  const json = (b: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
  if (url.pathname.endsWith("/rpc/submit_inbound_lead")) return json({ ok: true });
  if (url.pathname.includes("/rest/v1/rpc/")) return json(0);
  if (url.pathname.includes("/auth/v1/")) return json({});
  return json([]);
}

test("public contact form submits to a lead and shows the thank-you state (F0.5.5)", async ({
  context,
  page,
}) => {
  await context.route(/\/(rest|auth)\/v1\//, fulfill);
  await page.goto("/contact");

  await expect(page.getByRole("heading", { name: "Get in touch" })).toBeVisible({ timeout: 30000 });

  // Required-field gate: submitting empty surfaces errors and does not advance.
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Organization name is required")).toBeVisible();

  await page.locator("#lead-org").fill("Dillon Sports Medicine");
  await page.locator("#lead-name").fill("Coach Eric Taylor");
  await page.locator("#lead-email").fill("coach@dillon.example.test");
  await page.locator("#lead-phone").fill("432-555-0118");

  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Thanks for reaching out")).toBeVisible();
});
