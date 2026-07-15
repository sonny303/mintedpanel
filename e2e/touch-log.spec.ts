import { test, expect } from "@playwright/test";

// E4.1 Structured Touches & Follow-up Cadence. These mirror the repo's e2e
// convention: skipped placeholders that document the intended flow and are
// enabled once a seeded, disposable test tenant with an authenticated session
// exists. They are WRITES through logTouch / correctTouch / bulkLogTouch and
// must never run against KFP prod data. The pure follow-up / ranking logic and
// the service behaviour are already covered by the vitest suites
// (followUps.test.ts, followUpQueue.test.ts, touchTypes.test.ts,
// touches.di.test.ts, touchesExport.test.ts).

// F4.1.1/F4.1.4/F4.1.5 — the structured entry form on a case's Touchlog.
test.skip("logging a structured touch records type, disposition, and recipient", async ({
  page,
}) => {
  // open a case → Touchlog → Add touch → pick a type (e.g. Provider Outreach),
  // an optional disposition (Successful), a recipient name + contact → Save.
  // Assert the new row shows the type pill, the disposition, and the recipient.
  await page.goto("/cases");
  expect(page).toBeTruthy();
});

// F4.1.2 — a date-less touch carries the prior follow-up forward; only the
// explicit clear control ends it.
test.skip("a date-less touch carries the follow-up forward; clearing is explicit", async ({
  page,
}) => {
  await page.goto("/cases");
  expect(page).toBeTruthy();
});

// Edge Cases & Corrections — a correction appends and renders the pair.
test.skip("correcting a touch appends a new entry marked 'Correction of …'", async ({ page }) => {
  await page.goto("/cases");
  expect(page).toBeTruthy();
});

// F4.1.7 — bulk logging from the Cases work-view writes one touch per case and
// links to the filtered view of exactly the affected cases.
test.skip("bulk logging writes one touch per case and links to those cases", async ({ page }) => {
  await page.goto("/cases");
  expect(page).toBeTruthy();
});
