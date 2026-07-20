// E2.3 TE-12 — next-best-action queue coverage over the mock harness. Since
// E6.1 F6.1.3 the queue is the DEFAULT (to-do) pivot of the merged /cases
// surface and the shipped default ranking is grouped: overdue follow-ups →
// task due dates → provider start dates → the rest.
//   TS-55 deadline-ordered queue: Jane's task due date now outranks Marco's
//         sooner provider start date (grouped tiers, not date-merged), and
//         Marco's entry still names the start date as its reason; the queue
//         itself writes NOTHING (TE-10, derived not stored). The
//         post-generation landing (?run=, URL-state and shareable) filters
//         to the batch with the created/skipped banner from the immutable
//         run row; the All work toggle clears the param.
//   TS-56 cadence follow-up: a case 14+ days since its last touchpoint whose
//         stamped SOP step carries followUpEveryDays: 14 surfaces an overdue
//         "touch due" entry — a same-day NOTE never resets the clock — and
//         recording a touch through the existing case-detail flow re-derives
//         it away. The touches spine stays read-only to the queue: the only
//         touches write in the whole flow is the user's own logged touch.
import { test, expect, type Route } from "@playwright/test";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_SHELBY = "33333333-3333-4333-8333-333333333333";

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

// A provider whose readiness checklist fully passes (the TS-48 fixture shape),
// with the TS-55 start-date signal parameterized.
const providerRow = (id: string, first: string, last: string, startDate: string | null) => ({
  id,
  org_id: ORG_SHELBY,
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

const licenseRow = (id: string, providerId: string) => ({
  id,
  org_id: ORG_SHELBY,
  provider_id: providerId,
  state: "NC",
  license_number: `PT-${id}`,
  expiration_date: "2028-12-31",
  verified_status: "verified",
  status: "active",
});

const groupAssignment = (providerId: string) => ({
  id: `ga-${providerId}`,
  org_id: ORG_SHELBY,
  provider_id: providerId,
  group_id: "g-1",
  is_primary: true,
  start_date: "2026-01-01",
  end_date: null,
  created_at: "2026-07-10T00:00:00Z",
});

const facilityAssignment = (providerId: string) => ({
  id: `fa-${providerId}`,
  org_id: ORG_SHELBY,
  provider_id: providerId,
  facility_id: "f-g1-nc",
  is_primary: true,
  start_date: "2026-01-01",
  created_at: "2026-07-10T00:00:00Z",
});

const caseRow = (id: string, providerId: string, over: Partial<Record<string, unknown>> = {}) => ({
  id,
  org_id: ORG_SHELBY,
  provider_id: providerId,
  payer_id: "pay-bcbsnc",
  state: "NC",
  group_id: "g-1",
  facility_id: null,
  specialty: null,
  mso_id: null,
  assigned_to: null,
  credentialing_status_id: "st-inprog",
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
  org_id: ORG_SHELBY,
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

// Everything the queue's composition reads, fully green on readiness so the
// entries carry their TASK/touch actions (readiness-gap surfacing is pinned
// by the unit suite; this spec exercises the deadline ordering).
function makeFixtures() {
  return {
    organizations: [
      {
        id: ORG_SHELBY,
        name: "Shelby Sports Rehab",
        lifecycle_state: "active",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    memberships: [
      {
        org_id: ORG_SHELBY,
        role: "admin",
        organizations: {
          name: "Shelby Sports Rehab",
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
        org_id: ORG_SHELBY,
        name: "Group 1",
        tin: "123456789",
        states: ["NC"],
        is_active: true,
        created_at: "2026-07-10T00:00:00Z",
      },
    ],
    facilities: [
      {
        id: "f-g1-nc",
        org_id: ORG_SHELBY,
        group_id: "g-1",
        name: "Shelby Central Clinic",
        street: "1 Main St",
        city: "Charlotte",
        state: "NC",
        zip: "28280",
        is_active: true,
        status_id: null,
        effective_date: null,
        reference_only: false,
        created_at: "2026-07-10T00:00:00Z",
      },
    ],
    // Jane started long ago (a past start date is history, never a deadline);
    // Marco starts seeing patients in 4 days (TS-55).
    providers: [
      providerRow("pr-jane", "Jane", "Whitaker", "2026-01-01"),
      providerRow("pr-marco", "Marco", "Reyes", daysFromNow(4)),
    ],
    provider_group_assignments: [groupAssignment("pr-jane"), groupAssignment("pr-marco")],
    provider_facility_assignments: [facilityAssignment("pr-jane"), facilityAssignment("pr-marco")],
    state_licenses: [licenseRow("l1", "pr-jane"), licenseRow("l2", "pr-marco")],
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
    payer_network_targets: [
      {
        id: "t-1",
        org_id: ORG_SHELBY,
        payer_id: "pay-bcbsnc",
        group_id: "g-1",
        state: "NC",
        status: "active",
        created_at: "2026-07-12T00:00:00Z",
      },
    ],
    provider_documents: ["w9", "coi", "voided_check"].map((docType) => ({
      id: `g-1-${docType}`,
      org_id: ORG_SHELBY,
      group_id: "g-1",
      doc_type: docType,
      expiration_date: null,
    })),
    group_insurance_policies: [],
    status_configs: [
      {
        id: "st-inprog",
        org_id: ORG_SHELBY,
        track: "credentialing",
        label: "In Progress",
        color: "#888888",
        sort_order: 20,
        required_fields: [],
        action_bucket: "ours",
        created_at: "2026-07-10T00:00:00Z",
      },
      {
        id: "st-contracted",
        org_id: ORG_SHELBY,
        track: "contracting",
        label: "Contracted",
        color: "#888888",
        sort_order: 60,
        required_fields: [],
        action_bucket: "complete",
        created_at: "2026-07-10T00:00:00Z",
      },
    ],
    sop_templates: [],
    credential_cases: [] as Record<string, unknown>[],
    tasks: [] as Record<string, unknown>[],
    contracts: [
      {
        id: "ct-1",
        org_id: ORG_SHELBY,
        group_id: "g-1",
        payer_id: "pay-bcbsnc",
        state: "NC",
        contracting_status_id: "st-contracted",
        effective_date: null,
        expiration_date: null,
        notes: null,
        created_at: "2026-07-10T00:00:00Z",
        updated_at: "2026-07-10T00:00:00Z",
      },
    ],
    case_generation_exclusions: [],
    case_generation_runs: [] as Record<string, unknown>[],
  } as Record<string, Record<string, unknown>[]>;
}

interface RecordedWrite {
  table: string;
  method: string;
  body: Record<string, unknown> | null;
}

// The shared mock harness: generic eq./in./neq. filters + order handling
// (getLatestTouchFollowUps relies on touch_date.desc to pick the LATEST
// touchpoint), write-through for touches so the TS-56 log-a-touch flow runs
// the real invalidate-and-refetch loop, and PostgREST-style embeds for the
// case-detail read (arrays too — this repo's maybeSingle fetches arrays).
function makeHandler(fixtures: Record<string, Record<string, unknown>[]>) {
  const writes: RecordedWrite[] = [];
  let nextId = 1;

  const enrichCase = (row: Record<string, unknown>) => ({
    ...row,
    provider: fixtures.providers.find((p) => p.id === row.provider_id) ?? null,
    payer: fixtures.payers.find((p) => p.id === row.payer_id) ?? null,
    mso: null,
    group: fixtures.provider_groups.find((g) => g.id === row.group_id) ?? null,
    facility: null,
    credentialing_status:
      fixtures.status_configs.find((s) => s.id === row.credentialing_status_id) ?? null,
    tasks: fixtures.tasks.filter((t) => t.case_id === row.id),
    touches: fixtures.touches.filter((t) => t.case_id === row.id),
    status_history: [],
  });

  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.endsWith("/rpc/claim_invites")) return json(0);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

    if (req.method() !== "GET") {
      let body: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = req.postDataJSON();
        body = Array.isArray(parsed)
          ? ((parsed[0] ?? null) as Record<string, unknown> | null)
          : (parsed as Record<string, unknown> | null);
      } catch {
        body = null;
      }
      writes.push({ table, method: req.method(), body });

      if (table === "touches" && req.method() === "POST") {
        const row = {
          id: `touch-${nextId++}`,
          next_follow_up_date: null,
          notes: null,
          task_id: null,
          communication_event_id: null,
          created_at: new Date().toISOString(),
          ...(body ?? {}),
        };
        fixtures.touches.push(row);
        return json(wantsObject ? row : [row], 201);
      }
      const prefer = req.headers()["prefer"] ?? "";
      if (prefer.includes("return=representation")) return json(wantsObject ? {} : [{}]);
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
    // Honor `order=col.desc` — the latest-touchpoint read depends on it.
    const order = url.searchParams.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      rows = [...rows].sort((a, b) =>
        dir === "desc"
          ? String(b[col] ?? "").localeCompare(String(a[col] ?? ""))
          : String(a[col] ?? "").localeCompare(String(b[col] ?? "")),
      );
    }
    const out = table === "credential_cases" ? rows.map(enrichCase) : rows;
    if (wantsObject) {
      if (out.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(out[0]);
    }
    return json(out);
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
    [AUTH_KEY, SESSION, ORG_SHELBY] as const,
  );
}

test("TS-55 (E6.1 default tiers): a due task outranks a sooner provider start, whose entry still states its reason; the batch filter is URL-state with the run banner", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  // Jane's open case has a task due in 10 days; Marco starts in 4 days with
  // an unsubmitted application (his task carries no due date of its own).
  // Marco's case came from generation run-9 (the fresh batch).
  fixtures.credential_cases.push(
    caseRow("case-jane", "pr-jane"),
    caseRow("case-marco", "pr-marco", {
      generation_run_id: "run-9",
      created_at: "2026-07-12T00:00:00Z",
    }),
  );
  fixtures.tasks.push(
    taskRow("task-jane", "case-jane", "pr-jane", {
      title: "Follow up on Jane's application",
      due_date: daysFromNow(10),
    }),
    taskRow("task-marco", "case-marco", "pr-marco", { title: "Submit Marco's application" }),
  );
  fixtures.case_generation_runs.push({
    id: "run-9",
    org_id: ORG_SHELBY,
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

  await page.goto("/cases");
  await expect(page.getByRole("heading", { name: "Cases" })).toBeVisible({ timeout: 30000 });

  // E6.1 F6.1.3 default order: the task_due group ranks above provider_start
  // even though Marco starts sooner; Marco's entry says WHY it ranks (the
  // provider start date).
  const rows = page.locator("ol > li");
  await expect(rows).toHaveCount(2, { timeout: 30000 });
  await expect(rows.nth(0)).toContainText("Follow up on Jane's application");
  await expect(rows.nth(0)).toContainText("task due date");
  await expect(rows.nth(1)).toContainText("Submit Marco's application");
  await expect(rows.nth(1)).toContainText("Marco Reyes");
  await expect(rows.nth(1)).toContainText("provider start date");

  // Derived, never stored (TE-10): rendering the queue wrote NOTHING.
  expect(writes).toHaveLength(0);

  // The batch landing is shareable URL-state: opening ?run= directly filters
  // to the batch and shows the created/skipped banner from the run row.
  await page.goto("/cases?run=run-9");
  await expect(page.getByText("1 created · 0 skipped (existing) · 0 excluded")).toBeVisible({
    timeout: 30000,
  });
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText("Marco Reyes");

  // One-click "all work": clearing is a param removal, not component state.
  await page.getByRole("tab", { name: "All work" }).click();
  await expect(page).toHaveURL(/\/cases\/?$/, { timeout: 15000 });
  await expect(rows).toHaveCount(2);
});

test("TS-56: a 14-day cadence surfaces an overdue touch-due entry (notes never reset the clock); logging a touch re-derives it away", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  // Jane's case: the submission task is DONE and its stamped step carries
  // followUpEveryDays: 14; the last touchpoint is 15 days old. A newer NOTE
  // exists — it must not reset the cadence clock.
  fixtures.credential_cases.push(caseRow("case-jane", "pr-jane"));
  fixtures.tasks.push(
    taskRow("task-jane", "case-jane", "pr-jane", {
      title: "Submit application",
      status: "completed",
      completed_date: daysFromNow(-15),
      sop_content: [
        {
          id: "s1",
          order: 1,
          label: "Submit the online form",
          stepType: "online_form",
          isCompleted: true,
          followUpEveryDays: 14,
        },
      ],
    }),
  );
  fixtures.touches.push(
    {
      id: "touch-old",
      org_id: ORG_SHELBY,
      case_id: "case-jane",
      entry_type: "touchpoint",
      touch_type: "call",
      outcome: "spoke_to_rep",
      touch_date: daysFromNow(-15),
      next_follow_up_date: null,
      notes: "Called the payer",
      coordinator_id: USER_ID,
      task_id: null,
      communication_event_id: null,
      source: "manual",
      created_at: new Date(Date.now() - 15 * 86_400_000).toISOString(),
    },
    {
      id: "touch-note",
      org_id: ORG_SHELBY,
      case_id: "case-jane",
      entry_type: "note",
      touch_type: null,
      outcome: null,
      touch_date: daysFromNow(0),
      next_follow_up_date: null,
      notes: "Internal note — must not reset the cadence clock",
      coordinator_id: USER_ID,
      task_id: null,
      communication_event_id: null,
      source: "manual",
      created_at: new Date().toISOString(),
    },
  );

  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/cases");
  const row = page.locator("ol > li").first();
  await expect(row).toContainText("Touch due — follow up with BCBS-NC", { timeout: 30000 });
  await expect(row).toContainText("Overdue");
  await expect(row).toContainText("SOP follow-up cadence");
  await expect(row).toContainText("touch every 14 days");

  // Record a touch through the EXISTING case-detail flow (never the queue —
  // the queue has no write affordance).
  await row.getByRole("link").click();
  await expect(page).toHaveURL(/\/cases\/case-jane/, { timeout: 15000 });
  // E6.6: the /cases toolbar now ALSO carries an "Add touch" button, so wait
  // for the destination page to COMMIT before clicking (the documented
  // TanStack-transition harness rule — the source route can linger briefly
  // after the URL flips, and its toolbar button would swallow the click).
  await expect(page.getByText("Touchlog")).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Add touch" }).click();
  await page.getByRole("button", { name: "Save touch" }).click();
  await expect(page.getByText("Touch logged")).toBeVisible({ timeout: 15000 });

  // Back on the queue (the Cases nav entry's default to-do pivot), the
  // touch-due entry has re-derived away: the cadence clock restarted today,
  // so the case is no longer touch-due (its honest action is the review
  // fallback — its only task is completed).
  await page
    .locator("aside")
    .getByRole("link", { name: /^Cases/ })
    .click();
  await expect(page).toHaveURL(/\/cases\/?$/, { timeout: 15000 });
  await expect(row).toContainText("Review case — no open tasks", { timeout: 30000 });
  await expect(row).not.toContainText("Touch due — follow up");
  await expect(row).not.toContainText("Overdue");

  // The spine is read-only to the queue: the ONLY touches write in the whole
  // flow is the touch the user logged through the case detail.
  expect(writes.filter((w) => w.table === "touches")).toHaveLength(1);
  expect(writes.filter((w) => w.table === "touches")[0].body).toMatchObject({
    org_id: ORG_SHELBY,
    case_id: "case-jane",
    entry_type: "touchpoint",
  });
});
