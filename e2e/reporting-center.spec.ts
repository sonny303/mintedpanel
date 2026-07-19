import { test, expect, type Route } from "@playwright/test";

// E0.6 TE-7 + E6.6 F6.6.1–F6.6.4 — the Reporting Center (authenticated,
// cross-org). Uses the mock harness: seed the GoTrue session + active org in
// localStorage, answer the Supabase HTTP layer from fixtures. Covers the
// four-group report index (Performance / Credentialing / Compliance / Intake)
// with the new-leads badge, the Portfolio report, the /portfolio redirect
// (TD-1), the TS-135 Launches report (date-only + at-risk rule), the TS-136
// Denials report (both pivots + CSV + standing/reapplied cycle states), the
// two counts reports, and the relocated Audit Log.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_A = "22222222-2222-4222-8222-222222222222";
const ORG_B = "33333333-3333-4333-8333-333333333333";

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

const orgRow = (id: string, name: string, lifecycle: string, created: string) => ({
  id,
  name,
  lifecycle_state: lifecycle,
  created_at: created,
});

// Date-only offsets from the real clock (the reports read localTodayIso).
// Offsets sit ≥2 days from every window boundary so UTC-vs-local day skew
// can't flip a bucket.
function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const GROUP_ID = "44444444-4444-4444-8444-444444444444";

const facilityRow = (
  id: string,
  name: string,
  effective: string | null,
  over: Record<string, unknown> = {},
) => ({
  id,
  org_id: ORG_A,
  group_id: GROUP_ID,
  name,
  city: "Shelby",
  state: "TX",
  is_active: true,
  reference_only: false,
  effective_date: effective,
  created_at: "2026-07-01T00:00:00Z",
  ...over,
});

const caseRow = (
  id: string,
  providerId: string,
  payerId: string,
  state: string,
  caseStatus: string,
) => ({
  id,
  org_id: ORG_A,
  provider_id: providerId,
  group_id: GROUP_ID,
  facility_id: null,
  payer_id: payerId,
  state,
  case_status: caseStatus,
  payer_pipeline_state: "not_started",
  credentialing_status_id: null,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
});

const providerRow = (id: string, first: string, last: string) => ({
  id,
  org_id: ORG_A,
  first_name: first,
  last_name: last,
  status: "active",
  verification_state: "verified",
  reference_only: false,
  is_test_provider: false,
  created_at: "2026-07-01T00:00:00Z",
});

const BASE_FIXTURES: Record<string, unknown[]> = {
  organizations: [
    orgRow(ORG_A, "Rose City Rehab Collective", "prospect", "2026-07-01T00:00:00Z"),
    orgRow(ORG_B, "Dillon Sports Medicine", "active", "2026-06-01T00:00:00Z"),
  ],
  memberships: [
    {
      org_id: ORG_A,
      role: "admin",
      organizations: orgRow(
        ORG_A,
        "Rose City Rehab Collective",
        "prospect",
        "2026-07-01T00:00:00Z",
      ),
    },
    {
      org_id: ORG_B,
      role: "admin",
      organizations: orgRow(ORG_B, "Dillon Sports Medicine", "active", "2026-06-01T00:00:00Z"),
    },
  ],
  party_role_assignments: [
    { org_id: ORG_A, role_key: "customer_escalation_contact", parties: { state: "OR" } },
    { org_id: ORG_B, role_key: "customer_escalation_contact", parties: { state: "TX" } },
  ],
  report_shares: [],
  profiles: [
    {
      id: USER_ID,
      full_name: "Sowmya Seed",
      email: "sowmya.seed@example.test",
      created_at: "2026-07-09T00:00:00Z",
    },
  ],
  notes: [],
  user_table_prefs: [],
  inbound_leads: [],
  provider_groups: [],
  facilities: [],
  provider_facility_assignments: [],
  credential_cases: [],
  case_status_history: [],
  denial_reason_codes: [],
  providers: [],
  payers: [],
  audit_log: [],
  status_configs: [],
};

function makeHandler(overrides: Record<string, unknown[]> = {}) {
  const fixtures = { ...BASE_FIXTURES, ...overrides };
  return async function fulfillSupabase(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);
    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const rows = fixtures[table] ?? [];
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  };
}

async function seed(
  context: import("@playwright/test").BrowserContext,
  overrides: Record<string, unknown[]> = {},
) {
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(overrides));
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

test("the index renders the four groups with their reports (F6.6.1 / TS-115)", async ({
  context,
  page,
}) => {
  await seed(context);
  await page.goto("/reporting");
  await expect(page.getByRole("heading", { name: "Reporting Center" })).toBeVisible({
    timeout: 30000,
  });
  // Four group headings, in the stated membership.
  await expect(page.getByRole("heading", { name: "Performance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Credentialing" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Compliance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Intake" })).toBeVisible();
  await expect(
    page.getByText("Your organizations across the business", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Launches", { exact: true })).toBeVisible();
  await expect(page.getByText("Denials", { exact: true })).toBeVisible();
  await expect(page.getByText("Expiring Credentials", { exact: true })).toBeVisible();
  await expect(page.getByText("Audit Log", { exact: true })).toBeVisible();
  await expect(page.getByText("Inbound Leads", { exact: true })).toBeVisible();
  await expect(page.getByText("Facilities Without Providers", { exact: true })).toBeVisible();
  await expect(page.getByText("Locations per Group", { exact: true })).toBeVisible();
  // No new leads → no badge.
  await expect(page.getByTestId("report-badge-leads")).toHaveCount(0);
});

test("the Intake card badges the new-lead count only when leads await (F6.6.1)", async ({
  context,
  page,
}) => {
  await seed(context, {
    inbound_leads: [
      {
        id: "lead-1",
        org_name: "Capeside Physical Therapy",
        contact_name: "Dawson Leery",
        contact_email: "dawson@capeside.example.test",
        contact_phone: null,
        status: "new",
        created_at: "2026-07-18T00:00:00Z",
      },
      {
        id: "lead-2",
        org_name: "Dismissed Clinic",
        contact_name: "N N",
        contact_email: "n@example.test",
        contact_phone: null,
        status: "dismissed",
        created_at: "2026-07-18T00:00:00Z",
      },
    ],
  });
  await page.goto("/reporting");
  await expect(page.getByTestId("report-badge-leads")).toHaveText("1", { timeout: 30000 });
});

test("Portfolio report renders metrics, state breakdown, org list, and share panel", async ({
  context,
  page,
}) => {
  await seed(context);
  await page.goto("/reporting/portfolio");
  // "In motion"/"Prospects" appear in the metric tile, the reused PortfolioContent
  // section, and the all-orgs table — assert presence with .first() to avoid the
  // strict-mode multi-match, then the unique report headings.
  await expect(page.getByText("In motion").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Prospects").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "By state" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "All organizations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Share this report" })).toBeVisible();
});

test("/portfolio redirects into the Reporting Center (no dead-end, TD-1)", async ({
  context,
  page,
}) => {
  await seed(context);
  await page.goto("/portfolio");
  await expect(page).toHaveURL(/\/reporting\/portfolio$/, { timeout: 30000 });
  await expect(page.getByRole("heading", { name: "Share this report" })).toBeVisible();
});

test("TS-135 — the Launches report groups by group, sorts by date, and flags at-risk by the stated rule", async ({
  context,
  page,
}) => {
  await seed(context, {
    provider_groups: [{ id: GROUP_ID, org_id: ORG_A, name: "Shelby Sports Rehab" }],
    facilities: [
      // +10d, zero providers → at risk (no providers assigned).
      facilityRow("f-soon", "Eastside Clinic", daysFromNow(10)),
      // +12d, staffed but its provider still has an open case → at risk.
      facilityRow("f-soon2", "Westside Clinic", daysFromNow(12)),
      // +90d, zero providers — outside the approaching window → NOT at risk.
      facilityRow("f-far", "Northside Clinic", daysFromNow(90)),
      // -10d, recently launched → shows, never at risk.
      facilityRow("f-recent", "Downtown Clinic", daysFromNow(-10)),
      // -60d and dateless → excluded from the report entirely.
      facilityRow("f-old", "Bygone Clinic", daysFromNow(-60)),
      facilityRow("f-dateless", "Someday Clinic", null),
    ],
    provider_facility_assignments: [
      { id: "a-1", org_id: ORG_A, provider_id: "p-1", facility_id: "f-soon2", is_primary: true },
      { id: "a-2", org_id: ORG_A, provider_id: "p-2", facility_id: "f-recent", is_primary: true },
    ],
    credential_cases: [caseRow("c-open", "p-1", "pay-anthem", "TX", "in_progress")],
  });
  await page.goto("/reporting/launches");
  await expect(page.getByRole("heading", { name: "Launches", exact: true })).toBeVisible({
    timeout: 30000,
  });
  // The at-risk rule is explained inline (F6.6.2 AC).
  await expect(
    page.getByText(
      "At risk = go-live within 30 days with open cases still pending or no providers assigned.",
    ),
  ).toBeVisible();
  // Grouped by group.
  await expect(page.getByRole("heading", { name: "Shelby Sports Rehab" })).toBeVisible();
  // Date order within the group: soonest first; old/dateless excluded.
  const names = page.locator("tbody tr td:first-child");
  await expect(names.first()).toContainText("Downtown Clinic");
  await expect(page.getByText("Bygone Clinic")).toHaveCount(0);
  await expect(page.getByText("Someday Clinic")).toHaveCount(0);
  // At-risk flags per the stated rule.
  const eastside = page.locator("tr", { hasText: "Eastside Clinic" });
  await expect(eastside.getByText("At risk — no providers assigned")).toBeVisible();
  const westside = page.locator("tr", { hasText: "Westside Clinic" });
  await expect(westside.getByText("At risk — open cases still pending")).toBeVisible();
  const northside = page.locator("tr", { hasText: "Northside Clinic" });
  await expect(northside.getByText("At risk", { exact: false })).toHaveCount(0);
  const downtown = page.locator("tr", { hasText: "Downtown Clinic" });
  await expect(downtown.getByText("At risk", { exact: false })).toHaveCount(0);
});

test("TS-136 — the Denials report: provider-first rows, payer pivot, cycle states, CSV export", async ({
  context,
  page,
}) => {
  await seed(context, {
    providers: [providerRow("p-1", "Tim", "Riggins"), providerRow("p-2", "Matt", "Saracen")],
    payers: [
      { id: "pay-anthem", org_id: null, name: "Anthem", status: "active" },
      { id: "pay-cigna", org_id: null, name: "Cigna", status: "active" },
    ],
    credential_cases: [
      caseRow("c-d1", "p-1", "pay-anthem", "NC", "denied"),
      caseRow("c-d2", "p-1", "pay-anthem", "SC", "in_progress"),
      caseRow("c-ok", "p-2", "pay-cigna", "NC", "approved"),
    ],
    case_status_history: [
      {
        case_id: "c-d1",
        reason_code_id: "rc-net",
        note: null,
        changed_at: "2026-07-10T00:00:00Z",
      },
      {
        case_id: "c-d2",
        reason_code_id: "rc-doc",
        note: null,
        changed_at: "2026-06-20T00:00:00Z",
      },
    ],
    denial_reason_codes: [
      { id: "rc-net", org_id: null, code: "network_closed", label: "Network Closed", active: true },
      {
        id: "rc-doc",
        org_id: null,
        code: "missing_documentation",
        label: "Missing Documentation",
        active: true,
      },
    ],
  });
  await page.goto("/reporting/denials");
  await expect(page.getByRole("heading", { name: "Denials", exact: true })).toBeVisible({
    timeout: 30000,
  });

  // Provider-first by default: Tim Riggins' two denial-carrying cases, with
  // the fixed word-list reason and the cycle state; the clean approved case
  // never appears (TS-118 reactivity is derivation — a denial shows
  // immediately, a never-denied case never does).
  await expect(page.getByRole("heading", { name: /Tim Riggins/ })).toBeVisible();
  const standing = page.locator("tr", { hasText: "Network Closed" });
  await expect(standing.getByText("Standing")).toBeVisible();
  const reapplied = page.locator("tr", { hasText: "Missing Documentation" });
  await expect(reapplied.getByText("Reapplied — now In Progress")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Matt Saracen/ })).toHaveCount(0);

  // Payer pivot: the same two rows under Anthem ("Anthem denied N…").
  await page.getByRole("tab", { name: "By payer" }).click();
  await expect(page.getByRole("heading", { name: /Anthem/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Anthem/ })).toContainText("2 denials");

  // CSV export downloads via the shared csv machinery.
  const downloadP = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadP;
  expect(download.suggestedFilename()).toBe("denials.csv");
});

test("F6.6.4 — the two counts reports derive live from existing data", async ({
  context,
  page,
}) => {
  await seed(context, {
    provider_groups: [{ id: GROUP_ID, org_id: ORG_A, name: "Shelby Sports Rehab" }],
    facilities: [
      facilityRow("f-unstaffed", "Eastside Clinic", daysFromNow(10)),
      facilityRow("f-staffed", "Westside Clinic", daysFromNow(12)),
      facilityRow("f-inactive", "Closed Clinic", null, { is_active: false }),
    ],
    provider_facility_assignments: [
      { id: "a-1", org_id: ORG_A, provider_id: "p-1", facility_id: "f-staffed", is_primary: true },
    ],
  });

  await page.goto("/reporting/facilities-without-providers");
  await expect(page.getByRole("heading", { name: "Facilities Without Providers" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText("Eastside Clinic")).toBeVisible();
  await expect(page.getByText("Westside Clinic")).toHaveCount(0);
  await expect(page.getByText("Closed Clinic")).toHaveCount(0);

  await page.goto("/reporting/locations-per-group");
  await expect(page.getByRole("heading", { name: "Locations per Group" })).toBeVisible({
    timeout: 30000,
  });
  const groupRow = page.locator("tr", { hasText: "Shelby Sports Rehab" });
  // Two active locations (the inactive one never counts).
  await expect(groupRow.getByText("2", { exact: true })).toBeVisible();
});

test("F6.6.4 — the Audit Log renders inside the Center with its filters and immutability banner", async ({
  context,
  page,
}) => {
  await seed(context, {
    audit_log: [
      {
        id: "aud-1",
        org_id: ORG_A,
        ts: "2026-07-18T12:00:00Z",
        user_id: USER_ID,
        user_name: "Sowmya Seed",
        action_type: "UPDATE",
        entity_type: "case",
        entity_id: "c-d1",
        description: "Updated case",
        before: { state: "NC" },
        after: { state: "SC" },
      },
    ],
  });
  await page.goto("/reporting/audit-log");
  await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByText("Audit entries can never be edited or deleted, by anyone, including admins."),
  ).toBeVisible();
  // The existing filter set relocated intact.
  await expect(page.getByText("All actions")).toBeVisible();
  await expect(page.getByText("All entities")).toBeVisible();
  await expect(page.getByText("Updated case")).toBeVisible();
});
