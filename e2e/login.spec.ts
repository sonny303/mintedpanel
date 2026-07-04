import { test, expect } from "@playwright/test";

// Minimal render check — no real auth. The login page is a public route that
// renders a static sign-in form; the app reaches it even with an unreachable
// Supabase backend (auth-store.init() always resolves `initialized: true`, and
// getSession() reads localStorage with no network when no session is stored).
test("login page renders the sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.locator("#email")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});
