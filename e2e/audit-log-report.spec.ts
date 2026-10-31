import { test, expect, type Route } from "./fixtures/legacy-access-context";

// MINT-99 — the Audit Log report's entity links, labels, and keyboard expand
// (/reporting/audit-log). Uses the mock harness: seed the GoTrue session +
// active org in localStorage, answer the Supabase HTTP layer from fixtures.
// The F6.6.4 render test (filters + immutability banner) stays in
// reporting-center.spec.ts.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_A = "22222222-2222-4222-8222-222222222222";

const SESSION = {
  access_token: "fake-access-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 9999999999,
  refresh_token: "fake-refresh-token",
  user: {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "sowmya.seed@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Sowmya Seed" },
    created_at: "2026-07-09T00:00:00Z",
  },
};

const ORG_ROW = {
  id: ORG_A,
  name: "Rose City Rehab Collective",
  lifecycle_state: "prospect",
  created_at: "2026-07-01T00:00:00Z",
};

const auditRow = (id: string, over: Record<string, unknown>) => ({
  id,
  org_id: ORG_A,
  ts: "2026-07-18T12:00:00Z",
  user_id: USER_ID,
  user_name: "Sowmya Seed",
  description: null,
  before: null,
  after: null,
  ...over,
});

const FIXTURES: Record<string, unknown[]> = {
  organizations: [ORG_ROW],
  memberships: [{ org_id: ORG_A, role: "admin", organizations: ORG_ROW }],
  profiles: [
    {
      id: USER_ID,
      full_name: "Sowmya Seed",
      email: "sowmya.seed@example.test",
      created_at: "2026-07-09T00:00:00Z",
    },
  ],
  audit_log: [
    // No description: the expand button falls back to the entity label.
    auditRow("aud-provider", {
      action_type: "UPDATE",
      entity_type: "provider",
      entity_id: "p-1",
      before: { npi: "1234567890" },
      after: { npi: "1234567891" },
    }),
    // SOP generation: one task row per batch, keyed by the CASE id.
    auditRow("aud-batch", {
      action_type: "CREATE",
      entity_type: "task",
      entity_id: "c-batch",
      description: "Auto-generated 2 SOP tasks for case",
      after: { caseId: "c-batch", count: 2, taskIds: ["t-1", "t-2"] },
    }),
    auditRow("aud-task", {
      action_type: "UPDATE",
      entity_type: "task",
      entity_id: "t-solo",
      description: "Task completed by extension fill",
      before: { status: "in_progress" },
      after: { status: "completed" },
    }),
    auditRow("aud-status", {
      action_type: "STATUS_CHANGE",
      entity_type: "credential_case",
      entity_id: "c-status",
      description: "Case status changed",
      before: { case_status: "in_progress" },
      after: { case_status: "approved" },
    }),
  ],
};

async function fulfillSupabase(route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (url.pathname.includes("/auth/v1/")) return json(SESSION);
  if (url.pathname.includes("/rest/v1/rpc/")) return json(0);
  const table = url.pathname.split("/rest/v1/")[1] ?? "";
  const rows = FIXTURES[table] ?? [];
  const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
  if (wantsObject) {
    if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
    return json(rows[0]);
  }
  return json(rows);
}

async function seed(context: import("@playwright/test").BrowserContext) {
  await context.route(/\/(rest|auth)\/v1\//, fulfillSupabase);
  await context.addInitScript(
    ([authKey, session, orgId]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_A] as const,
  );
}

test("MINT-99 — Audit Log rows link to the right page, read as words, and expand from the keyboard", async ({
  context,
  page,
}) => {
  await seed(context);
  await page.goto("/reporting/audit-log");
  await expect(page.getByText("Auto-generated 2 SOP tasks for case")).toBeVisible({
    timeout: 30000,
  });

  // A batch task row opens its case; a single-task row still opens the task;
  // credential_case rows link at all.
  const batch = page.locator("tr", { hasText: "Auto-generated 2 SOP tasks" });
  await expect(batch.getByRole("link")).toHaveAttribute("href", "/cases/c-batch");
  const solo = page.locator("tr", { hasText: "Task completed by extension fill" });
  await expect(solo.getByRole("link")).toHaveAttribute("href", "/tasks/t-solo");
  const status = page.locator("tr", { hasText: "Case status changed" });
  await expect(status.getByRole("link")).toHaveAttribute("href", "/cases/c-status");

  // Labels, not raw keys; the raw key stays on hover.
  await expect(status.getByText("Status changed", { exact: true })).toBeVisible();
  await expect(status.getByTitle("credential_case")).toHaveText(/^Credentialing case/);
  await expect(page.getByText("STATUS_CHANGE", { exact: true })).toHaveCount(0);

  // The filters are labelled controls.
  await expect(page.getByLabel("From", { exact: true })).toHaveAttribute("type", "date");
  await expect(page.getByLabel("Action", { exact: true })).toHaveText("All actions");

  // Each expand button names its row (description, else the entity label).
  await expect(page.getByRole("button", { name: /^Show changes: / })).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Show changes: Provider" })).toBeVisible();

  // The last visible row keeps TableBody's no-bottom-border rule.
  const lastRow = page.locator("tbody > tr").last();
  await expect(lastRow).toContainText("Case status changed");
  await expect(lastRow).toHaveCSS("border-bottom-width", "0px");

  // Enter opens the row from its button, Space closes it. aria-controls points
  // at the detail row only while it exists.
  const toggle = status.getByRole("button", { name: "Show changes: Case status changed" });
  const detail = page.locator("#audit-detail-aud-status");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).not.toHaveAttribute("aria-controls");
  await expect(detail).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAttribute("aria-controls", "audit-detail-aud-status");
  await expect(detail).toBeVisible();
  // listAuditLog camelizes before / after, so the hover key is caseStatus.
  await expect(detail.getByTitle("caseStatus")).toHaveText("Case status");
  await expect(detail.getByText("caseStatus", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(detail).toHaveCount(0);
});
