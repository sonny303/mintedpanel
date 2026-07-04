import { test, expect } from "@playwright/test";

// TODO(seeded-tenant): open a provider → New Case modal → pick payer/state →
// create the case, and assert the case appears in Cases with its initial
// credentialing status and auto-seeded SOP tasks. This is a WRITE that goes
// through createCase → the create_case_with_tasks RPC (credential_cases +
// status_history + tasks + audit_log) and requires a seeded, disposable test
// tenant with an authenticated session. Never run it against KFP prod data.
test.skip("creating a case seeds its status and SOP tasks", async ({ page }) => {
  await page.goto("/cases");
  expect(page).toBeTruthy();
});
