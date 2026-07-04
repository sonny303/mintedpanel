import { test, expect } from "@playwright/test";

// TODO(seeded-tenant): drive Cases → open a case → change credentialing status →
// assert the status pill and status_history update. This is a WRITE against
// credential_cases/status_history and requires a seeded, disposable test tenant
// with an authenticated session. Never run it against KFP prod data.
test.skip("case status update persists and reflects in the UI", async ({ page }) => {
  await page.goto("/cases");
  expect(page).toBeTruthy();
});
