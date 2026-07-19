// E6.1 F6.1.3 / TS-119 — the merged Cases surface's three pivots over the
// mock harness (fixture idiom shared with next-best-action-queue.spec.ts):
//   - the to-do pivot (default) ranks overdue follow-ups → task due dates →
//     provider start dates, with the top card naming WHY it is first
//   - pivots are URL states that restore exactly (deep-linkable slices)
//   - the by-payer pivot lists every open case for the payer under one group
//     header; the by-provider pivot re-slices the SAME cases per provider
//     with the x-of-y approved rollup
//   - legacy /cases list params (?chip=) land on the list, never the queue
import { test, expect, type Route } from "@playwright/test";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "33333333-3333-4333-8333-333333333333";

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

const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const providerRow = (id: string, first: string, last: string, startDate: string | null) => ({
  id,
  org_id: ORG_ID,
  first_name: first,
  last_name: last,
  credentials: "PT",
  npi: "1093817465",
  status: "onboarding",
  reference_only: false,
  home_state: "NC",
  specialty: "Physical Therapy",
  taxonomy_code: null,
  email: null,
  group_id: null,
  start_date: startDate,
  caqh_id: "16224897",
  caqh_last_attested_date: daysFromNow(-10),
  date_of_birth: "1990-01-01",
  ssn_last4: "1234",
  home_street: "4104 S Croatan Hwy",
  home_city: "Nags Head",
  home_zip: "27959",
  malpractice_coverage_end: "2028-12-31",
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
});

const caseRow = (id: string, providerId: string, over: Partial<Record<string, unknown>> = {}) => ({
  id,
  org_id: ORG_ID,
  provider_id: providerId,
  payer_id: "pay-bcbsnc",
  state: "NC",
  group_id: "g-1",
  facility_id: null,
  specialty: null,
  mso_id: null,
  assigned_to: null,
  credentialing_status_id: "st-inprog",
  case_status: "in_progress",
  submitted_date: null,
  approved_date: null,
  confirmed_effective_date: null,
  expected_effective_date: null,
  termination_date: null,
  payer_reference_id: null,
  generation_run_id: null,
  case_email_token: `tok-${id}`,
  created_by: USER_ID,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  ...over,
});

const taskRow = (
  id: string,
  caseId: string,
  providerId: string,
  over: Partial<Record<string, unknown>> = {},
) => ({
  id,
  org_id: ORG_ID,
  case_id: caseId,
  provider_id: providerId,
  title: "Submit application",
  description: null,
  sop_content: [],
  status: "not_started",
  sort_order: 0,
  due_date: null,
  completed_date: null,
  is_auto_generated: true,
  sop_template_id: null,
  sop_version: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  ...over,
});

function makeFixtures() {
  return {
    organizations: [
      {
        id: ORG_ID,
        name: "Outer Banks Rehab Group",
        lifecycle_state: "active",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    memberships: [
      {
        org_id: ORG_ID,
        role: "specialist",
        organizations: {
          name: "Outer Banks Rehab Group",
          lifecycle_state: "active",
          created_at: "2026-07-01T00:00:00Z",
        },
      },
    ],
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
    audit_log: [],
    party_role_assignments: [],
    touches: [] as Record<string, unknown>[],
    status_history: [],
    mso_routing_rules: [],
    msos: [],
    provider_groups: [
      {
        id: "g-1",
        org_id: ORG_ID,
        name: "Group 1",
        tin: "123456789",
        states: ["NC"],
        is_active: true,
        created_at: "2026-07-10T00:00:00Z",
      },
    ],
    facilities: [],
    providers: [
      providerRow("pr-jane", "Jane", "Whitaker", "2026-01-01"),
      providerRow("pr-marco", "Marco", "Reyes", daysFromNow(4)),
    ],
    provider_group_assignments: [],
    provider_facility_assignments: [],
    state_licenses: [],
    payers: [
      {
        id: "pay-bcbsnc",
        org_id: null,
        name: "BCBS-NC",
        payer_kind: "commercial",
        states: ["NC"],
        aliases: [],
        status: "active",
        payer_slug: "bcbs-nc",
        is_active: true,
        created_at: "2026-07-10T00:00:00Z",
      },
    ],
    org_payer_assignments: [],
    payer_network_targets: [],
    provider_documents: [],
    group_insurance_policies: [],
    status_configs: [
      {
        id: "st-inprog",
        org_id: ORG_ID,
        track: "credentialing",
        label: "In Progress",
        color: "#888888",
        sort_order: 20,
        required_fields: [],
        action_bucket: "ours",
        created_at: "2026-07-10T00:00:00Z",
      },
      {
        id: "st-approved",
        org_id: ORG_ID,
        track: "credentialing",
        label: "Approved",
        color: "#888888",
        sort_order: 70,
        required_fields: [],
        action_bucket: "complete",
        created_at: "2026-07-10T00:00:00Z",
      },
    ],
    sop_templates: [],
    credential_cases: [] as Record<string, unknown>[],
    tasks: [] as Record<string, unknown>[],
    contracts: [],
    case_generation_exclusions: [],
    case_generation_runs: [],
  } as Record<string, Record<string, unknown>[]>;
}

function makeHandler(fixtures: Record<string, Record<string, unknown>[]>) {
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (req.method() !== "GET") return json(null, 201);

    const matchFilters = (row: Record<string, unknown>): boolean => {
      for (const [key, raw] of url.searchParams.entries()) {
        if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(key)) continue;
        if (!(key in row)) continue;
        if (raw.startsWith("eq.")) {
          if (String(row[key]) !== raw.slice(3)) return false;
        } else if (raw.startsWith("in.(")) {
          const ids = raw
            .slice(4, -1)
            .split(",")
            .map((s) => s.replace(/^"|"$/g, ""));
          if (!ids.includes(String(row[key]))) return false;
        } else if (raw.startsWith("neq.")) {
          if (String(row[key]) === raw.slice(4)) return false;
        }
      }
      return true;
    };

    let rows = (fixtures[table] ?? []).filter((r) => matchFilters(r));
    const order = url.searchParams.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      rows = [...rows].sort((a, b) =>
        dir === "desc"
          ? String(b[col] ?? "").localeCompare(String(a[col] ?? ""))
          : String(a[col] ?? "").localeCompare(String(b[col] ?? "")),
      );
    }
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  };
  return { handler };
}

function seedAuth(context: {
  addInitScript: (fn: (args: unknown[]) => void, args: unknown[]) => Promise<void>;
}) {
  return context.addInitScript(
    ([authKey, session, activeOrg]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: activeOrg }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_ID] as const,
  );
}

// The TS-119 mix: an overdue follow-up, a due task, and an approaching
// provider start date, plus one approved case for the rollups.
function seedCases(fixtures: Record<string, Record<string, unknown>[]>) {
  fixtures.credential_cases.push(
    caseRow("case-follow", "pr-jane", { state: "NC" }),
    caseRow("case-task", "pr-jane", { state: "SC" }),
    caseRow("case-start", "pr-marco", { state: "NC" }),
    caseRow("case-approved", "pr-jane", {
      state: "CO",
      credentialing_status_id: "st-approved",
      case_status: "approved",
    }),
  );
  fixtures.tasks.push(
    taskRow("task-follow", "case-follow", "pr-jane", { title: "Chase the missing roster" }),
    taskRow("task-task", "case-task", "pr-jane", {
      title: "Follow up on Jane's application",
      due_date: daysFromNow(9),
    }),
    taskRow("task-start", "case-start", "pr-marco", { title: "Submit Marco's application" }),
  );
  fixtures.touches.push({
    id: "touch-follow",
    org_id: ORG_ID,
    case_id: "case-follow",
    entry_type: "touchpoint",
    touch_type: "call",
    outcome: "no_response",
    touch_date: daysFromNow(-3),
    next_follow_up_date: daysFromNow(-1),
    notes: "Left a voicemail",
    coordinator_id: USER_ID,
    task_id: null,
    communication_event_id: null,
    source: "manual",
    created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  });
}

test("TS-119: the to-do pivot ranks overdue follow-ups → task dues → provider starts, naming each reason", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  seedCases(fixtures);
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/cases");
  await expect(page.getByRole("heading", { name: "Cases" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("tab", { name: "To-do" })).toHaveAttribute("aria-selected", "true");

  const rows = page.locator("ol > li");
  await expect(rows).toHaveCount(3, { timeout: 30000 });
  // Top card: the overdue follow-up, and it says WHY it is first.
  await expect(rows.nth(0)).toContainText("Touch due — follow up with BCBS-NC");
  await expect(rows.nth(0)).toContainText("Follow-up overdue");
  await expect(rows.nth(0)).toContainText("Overdue");
  // Then the due task, then the approaching provider start.
  await expect(rows.nth(1)).toContainText("Follow up on Jane's application");
  await expect(rows.nth(1)).toContainText("task due date");
  await expect(rows.nth(2)).toContainText("Submit Marco's application");
  await expect(rows.nth(2)).toContainText("provider start date");
});

test("TS-119: pivots are URL states that restore exactly; the by-payer slice lists every open case for the payer", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  seedCases(fixtures);
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/cases");
  await expect(page.getByRole("heading", { name: "Cases" })).toBeVisible({ timeout: 30000 });

  // Switching pivots writes the URL — the slice is shareable.
  await page.getByRole("tab", { name: "By payer" }).click();
  await expect(page).toHaveURL(/\/cases\?pivot=payer$/, { timeout: 15000 });
  await expect(page.getByText("BCBS-NC")).toBeVisible();
  await expect(page.getByText("4 cases")).toBeVisible();
  await expect(page.getByText("1 of 4 approved")).toBeVisible();
  // Every open case for the payer sits in the one group (the payer-call view).
  await expect(page.getByRole("button", { name: "All open cases 3" })).toBeVisible();

  // Deep-linking the by-provider pivot restores that exact slice: groups per
  // provider, rows lead with the payer, and the per-provider rollup shows.
  await page.goto("/cases?pivot=provider");
  await expect(page.getByRole("tab", { name: "By provider" })).toHaveAttribute(
    "aria-selected",
    "true",
    { timeout: 30000 },
  );
  await expect(page.getByText("Jane Whitaker")).toBeVisible();
  await expect(page.getByText("Marco Reyes")).toBeVisible();
  await expect(page.getByText("1 of 3 approved")).toBeVisible();
});

test("legacy list params land on the list, never the queue (?chip= back-compat)", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  seedCases(fixtures);
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/cases?chip=needs");
  await expect(page.getByRole("tab", { name: "By payer" })).toHaveAttribute(
    "aria-selected",
    "true",
    { timeout: 30000 },
  );
  // The chip filter is applied exactly as before the merge.
  await expect(page.getByRole("button", { name: /Needs your action/ })).toBeVisible();
  // Case-detail deep links resolve unchanged (F6.1.3 AC).
  await page.goto("/cases/case-task");
  await expect(page).toHaveURL(/\/cases\/case-task/);
});
