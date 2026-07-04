import { test, expect } from "@playwright/test";

// TODO(seeded-tenant): open a case task (or a SOP step), mark it complete, and
// assert the task status flips and any dependent case-status roll-forward fires.
// This is a WRITE against tasks/credential_cases and requires a seeded,
// disposable test tenant with an authenticated session. Never run it against
// KFP prod data.
test.skip("completing a task updates its status", async ({ page }) => {
  await page.goto("/cases");
  expect(page).toBeTruthy();
});
