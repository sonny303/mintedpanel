import { test, expect, type Route } from "@playwright/test";

// Provider onboarding slice 1 — the PUBLIC intake route (/intake/:token). No
// Supabase session. /api/intake/* is mocked: a live link, a code request that
// always answers sent, a session that opens only for code 123456, and /me
// that reads only once that session exists. Synthetic canvas names.

function intakeApi({ failMeOnce = false } = {}) {
  let signedIn = false;
  let meFailuresLeft = failMeOnce ? 1 : 0;
  return async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postDataJSON?.() as Record<string, string> | null;
    const json = (status: number, data: unknown, error: string | null = null) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ data, error, meta: null }),
      });
    if (path.endsWith("/link")) {
      return body?.t === "live-token"
        ? json(200, { practiceName: "Shelby Sports Rehab", email: "anita.rao@example.test" })
        : json(404, null, "invalid_link");
    }
    if (path.endsWith("/code")) return json(200, { sent: true });
    if (path.endsWith("/session")) {
      if (body?.code !== "123456") return json(400, null, "code_invalid");
      signedIn = true;
      return json(200, { signedIn: true });
    }
    if (path.endsWith("/me")) {
      if (signedIn && meFailuresLeft > 0) {
        meFailuresLeft -= 1;
        return json(500, null, "Internal server error");
      }
      return signedIn
        ? json(200, {
            practiceName: "Shelby Sports Rehab",
            firstName: "Anita",
            lastName: "Rao",
            email: "anita.rao@example.test",
          })
        : json(401, null, "signed_out");
    }
    return json(404, null, "Not found");
  };
}

test("a provider signs in with the emailed code and reaches consent, then the form", async ({
  context,
  page,
}) => {
  await context.route("**/api/intake/**", intakeApi());
  await page.goto("/intake/live-token");

  await expect(page.getByRole("heading", { name: "Confirm it's you" })).toBeVisible();
  await expect(page.getByText("Shelby Sports Rehab").first()).toBeVisible();
  await expect(page.getByText("anita.rao@example.test")).toBeVisible();
  await page.getByRole("button", { name: "Send me a code" }).click();

  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  const code = page.getByLabel("6-digit code");
  await code.fill("999999");
  await expect(page.getByRole("alert")).toContainText("That code didn't work");
  await code.fill("123456");

  await expect(page.getByRole("heading", { name: "Your consent" })).toBeVisible();
  await expect(page.getByText("We at Shelby Sports Rehab recognize")).toBeVisible();
  const sign = page.getByRole("button", { name: "Sign and continue" });
  await expect(sign).toBeDisabled();
  await page.getByLabel("Type your full name to sign *").fill("Anita Rao");
  await sign.click();

  await expect(page.getByRole("heading", { name: "Your credentialing details" })).toBeVisible();
  await expect(page.getByText("Signed in as anita.rao@example.test")).toBeVisible();
});

test("a failed details read after sign-in offers Try again instead of an endless spinner", async ({
  context,
  page,
}) => {
  await context.route("**/api/intake/**", intakeApi({ failMeOnce: true }));
  await page.goto("/intake/live-token");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("6-digit code").fill("123456");

  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Your consent" })).toBeVisible();
});

test("an unknown, expired or revoked link shows one invalid-link screen", async ({
  context,
  page,
}) => {
  await context.route("**/api/intake/**", intakeApi());
  await page.goto("/intake/dead-token");
  await expect(
    page.getByRole("heading", { name: "This invitation is no longer valid" }),
  ).toBeVisible();
});
