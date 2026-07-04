import { test, expect } from "@playwright/test";

// Route reality check for the post-login work surface.
//
// There is no `/dashboard` route in this app. The primary authenticated work
// view is `/cases` (the sidebar's first work item; the welcome flow navigates
// there after onboarding). `/home` is the action-queue landing. Both are
// protected: the root shell (src/routes/__root.tsx) redirects an unauthenticated
// visitor to `/login`.
//
// Without a seeded test tenant we cannot sign in, so the only deterministic,
// honest assertion is the guard itself: hitting `/cases` unauthenticated lands
// on `/login`. This confirms the route exists (not a 404) and the auth redirect
// works. The authenticated dashboard render needs the seeded tenant (see the
// skipped write specs) and is out of scope for this skeleton.
test("cases work view redirects unauthenticated visitors to login", async ({ page }) => {
  await page.goto("/cases");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
