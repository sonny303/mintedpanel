// 2026-07-22 Cases page redesign — the rebuilt /cases surface over the mock
// harness. Three VIEWS (Flat default · By provider · By payer), four derived
// KPI cards (Total · In progress · Awaiting effective · Denied/appeal), a
// globally-sequential Case# that is the row click-through, and URL back-compat
// (?pivot / ?chip / ?ids / ?runId; /work redirect). The former "to-do" pivot is
// retired as a tab, but its E2.3 deadline ranking IS Flat's default sort.
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

const caseRow = (
  id: string,
  caseNumber: number,
  providerId: string,
  over: Partial<Record<string, unknown>> = {},
) => ({
  id,
  case_number: caseNumber,
  org_id: ORG_ID,
  provider_id: providerId,
  payer_id: "pay-bcbsnc",
  state: "NC",
  group_id: "g-1",
  facility_id: null,
  specialty: null,
  mso_id: null,
  assigned_to: null,
  credentialing_status_id: null,
  case_status: "in_progress",
  submitted_date: null,
  approved_date: null,
  confirmed_effective_date: null,
  expected_effective_date: null,
  termination_date: null,
  payer_reference_id: null,
  payer_individual_provider_id: null,
  payer_pipeline_state: "not_started",
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

const payer = (id: string, name: string, kind: string, states: string[]) => ({
  id,
  org_id: null,
  name,
  payer_kind: kind,
  states,
  aliases: [],
  status: "active",
  payer_slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  is_active: true,
  created_at: "2026-07-10T00:00:00Z",
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
      payer("pay-bcbsnc", "BCBS-NC", "commercial", ["NC"]),
      payer("pay-aetna", "Aetna", "commercial", ["NC"]),
    ],
    org_payer_assignments: [],
    payer_network_targets: [],
    provider_documents: [],
    group_insurance_policies: [],
    status_configs: [],
    sop_templates: [],
    credential_cases: [] as Record<string, unknown>[],
    tasks: [] as Record<string, unknown>[],
    contracts: [],
    case_generation_exclusions: [],
    case_generation_runs: [],
  } as Record<string, Record<string, unknown>[]>;
}

function makeHandler(fixtures: Record<string, Record<string, unknown>[]>) {
  const writes: { table: string; method: string }[] = [];
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (req.method() !== "GET") {
      writes.push({ table, method: req.method() });
      return json(null, 201);
    }

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
  return { handler, writes };
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

// A ranking-bearing mix (overdue follow-up → task due → provider start) plus
// one approved (Awaiting effective) and one denied case for the KPI cards.
function seedCases(fixtures: Record<string, Record<string, unknown>[]>) {
  fixtures.credential_cases.push(
    caseRow("case-follow", 1001, "pr-jane", { state: "NC" }),
    caseRow("case-task", 1002, "pr-jane", { state: "SC" }),
    caseRow("case-start", 1003, "pr-marco", { state: "NC", case_status: "not_started" }),
    caseRow("case-approved", 1004, "pr-jane", {
      state: "CO",
      case_status: "approved",
      payer_id: "pay-aetna",
      confirmed_effective_date: null,
      approved_date: "2026-06-15",
    }),
    caseRow("case-denied", 1005, "pr-marco", {
      state: "NC",
      case_status: "denied",
      payer_id: "pay-aetna",
    }),
  );
  fixtures.tasks.push(
    taskRow("task-follow", "case-follow", "pr-jane", { title: "Chase the missing roster" }),
    taskRow("task-task", "case-task", "pr-jane", { title: "Follow up", due_date: daysFromNow(9) }),
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

test("Flat view (default): KPI cards, Case# columns, and the E2.3 deadline ranking as default sort", async ({
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
  // Flat is the default view.
  await expect(page.getByRole("tab", { name: "Flat" })).toHaveAttribute("aria-selected", "true");

  // KPI cards are derived filters: Total 5 / In progress 2 (follow + task) /
  // Awaiting effective 1 (approved, no confirmed date) / Denied 1.
  const total = page.getByRole("button", { name: /Total cases/ });
  await expect(total).toContainText("5", { timeout: 30000 });
  await expect(page.getByRole("button", { name: /In progress/ })).toContainText("2");
  await expect(page.getByRole("button", { name: /Awaiting effective date/ })).toContainText("1");
  await expect(page.getByRole("button", { name: /Denied \/ appeal/ })).toContainText("1");

  // The Flat table carries the redesign columns and the mono Case# link.
  await expect(page.getByRole("columnheader", { name: "Case#" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Days open" })).toBeVisible();

  // Default sort = the E2.3 ranking: the overdue follow-up (C-1001) is first.
  const firstCaseLink = page.locator("tbody tr").first().getByRole("link");
  await expect(firstCaseLink).toHaveText("C-1001");

  // Case# IS the click-through — no separate Open-case affordance.
  await firstCaseLink.click();
  await expect(page).toHaveURL(/\/cases\/case-follow/);
});

test("KPI + Case Status filters narrow the Flat table; the KPI selection rides ?chip", async ({
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
  await expect(page.locator("tbody tr")).toHaveCount(5, { timeout: 30000 });

  // Clicking the In progress KPI filters to the two in_progress cases and
  // writes ?chip=inprog (shareable).
  await page.getByRole("button", { name: /In progress/ }).click();
  await expect(page).toHaveURL(/chip=inprog/, { timeout: 15000 });
  await expect(page.locator("tbody tr")).toHaveCount(2);

  // The Case Status dropdown composes with it: Denied while the In progress
  // KPI is active leaves nothing.
  await page.getByLabel("Filter by case status").click();
  await page.getByRole("option", { name: "Denied" }).click();
  await expect(page.getByText("Nothing matches these filters")).toBeVisible();
});

test("By provider / By payer grouped views with subtitles, approved rollup, and needs-action", async ({
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

  // By payer: grouped, subtitle carries the kind, and the rollups render.
  await page.getByRole("tab", { name: "By payer" }).click();
  await expect(page).toHaveURL(/pivot=payer$/, { timeout: 15000 });
  const bcbs = page.getByRole("button", { name: /BCBS-NC/ });
  await expect(bcbs).toBeVisible();
  await expect(bcbs).toContainText("Commercial");
  await expect(bcbs).toContainText("3 cases"); // follow + task + start
  await expect(bcbs).toContainText("needs action");

  // Deep-linking By provider restores that exact slice.
  await page.goto("/cases?pivot=provider");
  await expect(page.getByRole("tab", { name: "By provider" })).toHaveAttribute(
    "aria-selected",
    "true",
    { timeout: 30000 },
  );
  await expect(page.getByRole("button", { name: /Jane Whitaker/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Marco Reyes/ })).toBeVisible();
  // Jane has one approved case (of her three) — the x-of-y rollup.
  await expect(page.getByRole("button", { name: /Jane Whitaker/ })).toContainText(
    "1 of 3 approved",
  );
});

test("legacy back-compat: ?chip= maps to the KPI quick-filter; case-detail deep links resolve", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  seedCases(fixtures);
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  // Legacy ?chip=needs has no new KPI equivalent — it lands on Total (Flat),
  // never a dead end.
  await page.goto("/cases?chip=needs");
  await expect(page.getByRole("tab", { name: "Flat" })).toHaveAttribute("aria-selected", "true", {
    timeout: 30000,
  });
  await expect(page.getByRole("button", { name: /Total cases/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // A direct new value selects that KPI.
  await page.goto("/cases?chip=inprog");
  await expect(page.getByRole("button", { name: /In progress/ })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 30000 },
  );

  // Case-detail deep links resolve unchanged.
  await page.goto("/cases/case-task");
  await expect(page).toHaveURL(/\/cases\/case-task/);
});

test("post-generation ?run= filters to that batch with a banner; Show all cases clears it; rendering writes nothing", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  seedCases(fixtures);
  // One case belongs to generation run-9 — the post-generation landing target
  // (?run=/?runId=, shareable URL-state; the /work redirect preserves it).
  fixtures.credential_cases.push(
    caseRow("case-run", 1006, "pr-marco", { generation_run_id: "run-9", state: "SC" }),
  );
  fixtures.case_generation_runs.push({
    id: "run-9",
    org_id: ORG_ID,
    created_by: USER_ID,
    created_at: "2026-07-12T00:00:00Z",
    proposed_count: 1,
    created_count: 1,
    skipped_existing_count: 0,
    excluded_count: 0,
    failed_count: 0,
  });
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/cases?run=run-9");
  await expect(page.getByRole("heading", { name: "Cases" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("created by this generation run")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr").first().getByRole("link")).toHaveText("C-1006");

  // The queue ranking that feeds the default sort is DERIVED, never stored
  // (E2.3 TE-10): rendering the list wrote nothing.
  expect(writes).toHaveLength(0);

  // "Show all cases" is a param removal, not component state — back to all six.
  await page.getByRole("button", { name: "Show all cases" }).click();
  await expect(page).toHaveURL(/\/cases\/?$/, { timeout: 15000 });
  await expect(page.locator("tbody tr")).toHaveCount(6);

  // The E2.1 ?runId= spelling is honored too (old links stay live).
  await page.goto("/cases?runId=run-9");
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

// 2026-08-25 Cases Matrix — the fourth pivot (?pivot=matrix). A read-only
// provider x payer board sectioned by group + state. These cover the three
// things unit tests cannot reach: the semantic table markup, the gap cell's
// "Generate case" link actually being reachable, and Group by re-nesting.

/** Give (g-1, NC) an active Aetna target so Jane's empty Aetna cell is a GAP
 *  rather than an absent column: she has no NC/Aetna case, Marco does. */
function seedMatrixTargets(fixtures: Record<string, Record<string, unknown>[]>) {
  fixtures.payer_network_targets.push(
    {
      id: "pnt-nc-aetna",
      org_id: ORG_ID,
      payer_id: "pay-aetna",
      group_id: "g-1",
      state: "NC",
      status: "active",
      payer_issued_id: null,
      created_at: "2026-07-10T00:00:00Z",
    },
    {
      id: "pnt-nc-bcbs",
      org_id: ORG_ID,
      payer_id: "pay-bcbsnc",
      group_id: "g-1",
      state: "NC",
      status: "active",
      payer_issued_id: null,
      created_at: "2026-07-10T00:00:00Z",
    },
  );
}

test("Matrix pivot: ?pivot=matrix renders a semantic provider x payer table with case, gap and excluded cells", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  seedCases(fixtures);
  seedMatrixTargets(fixtures);
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/cases");
  await expect(page.getByRole("heading", { name: "Cases" })).toBeVisible({ timeout: 30000 });

  // The Matrix is a fourth tab, not a replacement — Flat is still the default.
  await expect(page.getByRole("tab", { name: "Flat" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Matrix" }).click();
  await expect(page).toHaveURL(/pivot=matrix/, { timeout: 15000 });

  // §10 hard requirement: a real <table> with a 2D header relationship —
  // payers are column headers, providers are row headers.
  const ncTable = page.getByRole("table", { name: /Group 1 in North Carolina/ });
  await expect(ncTable).toBeVisible({ timeout: 30000 });
  await expect(ncTable.getByRole("columnheader", { name: "Provider" })).toBeVisible();
  await expect(ncTable.getByRole("columnheader", { name: "Aetna" })).toBeVisible();
  await expect(ncTable.getByRole("columnheader", { name: "BCBS-NC" })).toBeVisible();
  await expect(ncTable.getByRole("rowheader", { name: "Jane Whitaker" })).toBeVisible();
  await expect(ncTable.getByRole("rowheader", { name: "Marco Reyes" })).toBeVisible();

  // Jane holds an NC/BCBS case but no NC/Aetna case, and Aetna is an active
  // target there — so that cell is a gap, labelled Not started.
  await expect(
    ncTable.getByRole("button", { name: /Jane Whitaker, Aetna, NC, not started/ }),
  ).toBeVisible();
  // Marco's NC/Aetna case is denied — a terminal cell still renders because a
  // sibling open case keeps him in the Matrix.
  await expect(
    ncTable.getByRole("link", { name: /Marco Reyes, Aetna, NC, open case/ }),
  ).toBeVisible();

  // The board is derived, never stored: rendering it wrote nothing.
  expect(writes).toHaveLength(0);
});

test("Matrix gap cell: the Generate case link is reachable and deep-links into /generation pre-scoped", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  seedCases(fixtures);
  seedMatrixTargets(fixtures);
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/cases?pivot=matrix");
  await expect(page.getByRole("heading", { name: "Cases" })).toBeVisible({ timeout: 30000 });

  const gap = page.getByRole("button", { name: /Jane Whitaker, Aetna, NC, not started/ });
  await expect(gap).toBeVisible({ timeout: 30000 });

  // A gap opens its detail on hover. The link inside must be genuinely
  // clickable — this is why gaps use a Popover and not a Tooltip.
  await gap.hover();
  const generate = page.getByRole("link", { name: /Generate case/ });
  await expect(generate).toBeVisible({ timeout: 15000 });

  // The Matrix never creates a case: the link hands off to /generation, the
  // one door, with this candidate pre-scoped.
  await generate.click();
  await expect(page).toHaveURL(/\/generation/, { timeout: 15000 });
  await expect(page).toHaveURL(/provider=pr-jane/);
  await expect(page).toHaveURL(/payer=pay-aetna/);
  await expect(page).toHaveURL(/group=g-1/);
});

test("Matrix Group by re-nests the same sections instead of changing which sections exist", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  seedCases(fixtures);
  seedMatrixTargets(fixtures);
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/cases?pivot=matrix");
  await expect(page.getByRole("heading", { name: "Cases" })).toBeVisible({ timeout: 30000 });

  // Jane has open cases in NC and SC and an approved one in CO; Marco is in
  // NC. That is three (group, state) sections under either nesting.
  const tables = page.getByRole("table");
  await expect(tables).toHaveCount(3, { timeout: 30000 });

  // Default nesting is by state: the outer headings are the states.
  await expect(page.getByRole("heading", { name: /North Carolina/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /South Carolina/ })).toBeVisible();

  // Switching to Group re-nests: the outer heading becomes the group, and the
  // section count is unchanged (D3 — nesting only).
  await page.getByLabel("Group Matrix by").click();
  await page.getByRole("option", { name: "Group by Group" }).click();
  await expect(page.getByRole("heading", { name: "Group 1" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("heading", { name: /North Carolina/ })).toHaveCount(0);
  await expect(tables).toHaveCount(3);

  // The payer filter narrows COLUMNS, so the CO/SC sections (BCBS + Aetna
  // only respectively) drop out when a non-matching payer is selected.
  await page.getByLabel("Filter Matrix by payer").click();
  await page.getByRole("option", { name: "BCBS-NC" }).click();
  await expect(page.getByRole("columnheader", { name: "Aetna" })).toHaveCount(0, {
    timeout: 15000,
  });
  await expect(page.getByRole("columnheader", { name: "BCBS-NC" }).first()).toBeVisible();
});

test("Matrix cell popover: one popover per hover, no focus theft, and it stays dismissed", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  seedCases(fixtures);
  seedMatrixTargets(fixtures);
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/cases?pivot=matrix");
  await expect(page.getByRole("heading", { name: "Cases" })).toBeVisible({ timeout: 30000 });

  const caseCell = page.getByRole("link", { name: /Marco Reyes, Aetna, NC, open case/ });
  await expect(caseCell).toBeVisible({ timeout: 30000 });
  await caseCell.hover();

  const popper = page.locator("[data-radix-popper-content-wrapper]");
  await expect(popper).toHaveCount(1, { timeout: 15000 });

  // Exactly one popover, and it is this cell's case — not a neighbour's.
  await expect(popper.getByText("Marco Reyes", { exact: true })).toBeVisible();

  // The root cause of the blink: hover must not move focus. Radix's non-modal
  // Content focuses itself on mount, and these triggers open on focus and close
  // on blur, so a hover that steals focus arms a loop.
  const focusInsidePopover = await page.evaluate(
    () =>
      document.activeElement !== null &&
      document.activeElement.closest("[data-radix-popper-content-wrapper]") !== null,
  );
  expect(focusInsidePopover).toBe(false);

  // Moving off dismisses it (handoff §7) — and it must STAY dismissed. This is
  // the reported symptom: Radix hands focus back to the trigger on close, the
  // trigger's onFocus re-opened, the content stole focus again, the trigger
  // blurred, and the cell blinked at the close-delay interval from then on,
  // with the pointer parked somewhere else entirely.
  await page.getByRole("heading", { name: "Cases" }).hover();
  await expect(popper).toHaveCount(0, { timeout: 15000 });

  // Count state churn rather than sampling visibility, which can land on any
  // frame of a blink; count `data-state` flips as well as mounts, because a
  // reopen landing mid-exit-animation replays the fade on the SAME element.
  const churn = await page.evaluate(async () => {
    let events = 0;
    const isPopper = (node: Node) =>
      node instanceof HTMLElement && node.matches("[data-radix-popper-content-wrapper]");
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          const target = record.target as HTMLElement;
          if (target.closest("[data-radix-popper-content-wrapper]")) events += 1;
          continue;
        }
        for (const node of record.addedNodes) if (isPopper(node)) events += 1;
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    observer.disconnect();
    return events;
  });
  expect(churn).toBe(0);
  await expect(popper).toHaveCount(0);
});

test("Matrix gap cell: keyboard focus opens the popover and Enter reaches the Generate case link", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  seedCases(fixtures);
  seedMatrixTargets(fixtures);
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/cases?pivot=matrix");
  await expect(page.getByRole("heading", { name: "Cases" })).toBeVisible({ timeout: 30000 });

  const gap = page.getByRole("button", { name: /Jane Whitaker, Aetna, NC, not started/ });
  await expect(gap).toBeVisible({ timeout: 30000 });

  // §10 keyboard parity: focus alone opens the popover, and the focus ring
  // stays on the cell rather than jumping into the portalled panel.
  await gap.focus();
  const generate = page.getByRole("link", { name: /Generate case/ });
  await expect(generate).toBeVisible({ timeout: 15000 });
  await expect(gap).toBeFocused();

  // The content is portalled, so Tab does not lead into it — Enter is the
  // documented way in.
  await page.keyboard.press("Enter");
  await expect(generate).toBeFocused();

  // Escape dismisses and returns focus to the cell WITHOUT re-opening.
  await page.keyboard.press("Escape");
  await expect(generate).toHaveCount(0, { timeout: 15000 });
  await expect(gap).toBeFocused();
  await page.waitForTimeout(500);
  await expect(page.locator("[data-radix-popper-content-wrapper]")).toHaveCount(0);
});
