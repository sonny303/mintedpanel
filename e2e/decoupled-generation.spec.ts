// E6.3 — the decoupled generation grid (the ONE door cases come through):
//   TS-111  Grid buckets + the sum invariant across pivots, skip-for-now vs
//           Exclude…, restore-to-candidate, confirm reconciliation, the run +
//           run-row ledger accounting for EVERY candidate (created/skipped/
//           excluded/enrolled), and the /cases?run= landing.
//   TS-125  New-payer-attached entry: the payer-scoped grid over an existing
//           4-provider roster groups 4 candidates under one payer header.
//   TS-126  Concurrent-duplicate race → safe skipped_existing (never an
//           error); a hard failure is reported honestly and the grid stays.
//   TS-127  Provider-record scoped entry renders only that provider's slice;
//           the manual escape hatch stays pinned by case-creation TS-52 and
//           the code-level oneDoor.test.ts — not re-covered here.
// The harness write-throughs the create_case_with_tasks RPC (enforcing the
// UNIQUE NULLS NOT DISTINCT 4-part key → 23505 on a duplicate) and records
// every write so the read-only posture of the grid render is pinned.
import { test, expect, type Route } from "@playwright/test";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "88888888-8888-4888-8888-888888888888";
const FALLBACK_SOP_ID = "00000000-0000-4000-a000-00000000e17b";

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

const PAYER_NAMES: Record<string, string> = {
  p1: "Aetna",
  p2: "BCBS-NC",
  p3: "Cigna",
  p4: "Humana",
  p5: "Medcost",
  p6: "Optum",
  p7: "UnitedHealthcare",
};

const payerRow = (id: string) => ({
  id,
  org_id: null,
  name: PAYER_NAMES[id] ?? id,
  payer_kind: "commercial",
  states: ["NC", "SC"],
  aliases: [],
  status: "active",
  payer_slug: (PAYER_NAMES[id] ?? id).toLowerCase(),
  avg_decision_days: null,
  created_at: "2026-06-01T00:00:00Z",
});

const providerRow = (id: string, first: string, last: string) => ({
  id,
  org_id: ORG_ID,
  first_name: first,
  last_name: last,
  credentials: "PT",
  npi: "1093817465",
  status: "onboarding",
  verification_state: "verified",
  reference_only: false,
  home_state: "NC",
  specialty: "Physical Therapy",
  taxonomy_code: null,
  email: null,
  group_id: null,
  start_date: "2026-06-01",
  caqh_id: "16224897",
  caqh_last_attested_date: "2026-07-01",
  date_of_birth: "1990-01-01",
  ssn_last4: "1234",
  home_street: "4104 S Croatan Hwy",
  home_city: "Nags Head",
  home_zip: "27959",
  malpractice_coverage_end: "2028-12-31",
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
});

const groupRow = (id: string, name: string) => ({
  id,
  org_id: ORG_ID,
  name,
  tin: "123456789",
  npi_type2: null,
  states: ["NC"],
  is_active: true,
  created_at: "2026-06-01T00:00:00Z",
});

const target = (payerId: string, groupId: string) => ({
  id: `t-${groupId}-${payerId}`,
  org_id: ORG_ID,
  payer_id: payerId,
  group_id: groupId,
  state: "NC",
  status: "active",
  created_at: "2026-06-15T00:00:00Z",
});

const groupAssignment = (providerId: string, groupId: string) => ({
  id: `ga-${providerId}`,
  org_id: ORG_ID,
  provider_id: providerId,
  group_id: groupId,
  is_primary: true,
  start_date: "2026-06-01",
  end_date: null,
  created_at: "2026-06-01T00:00:00Z",
});

const facilityAssignment = (providerId: string, facilityId: string) => ({
  id: `fa-${providerId}`,
  org_id: ORG_ID,
  provider_id: providerId,
  facility_id: facilityId,
  is_primary: true,
  start_date: "2026-06-01",
  created_at: "2026-06-01T00:00:00Z",
});

const liveFact = (id: string, providerId: string, groupId: string, payerId: string) => ({
  id,
  org_id: ORG_ID,
  provider_id: providerId,
  group_id: groupId,
  payer_id: payerId,
  state: "NC",
  effective_date: "2025-03-01",
  source: "migration",
  expired_at: null,
  expired_by: null,
  created_by: USER_ID,
  created_at: "2026-06-20T00:00:00Z",
});

// The generic fallback SOP (global, payerless) — every candidate resolves it
// here, so the grid's fallback flag + the version stamp are both exercised.
const FALLBACK_TEMPLATE = {
  id: FALLBACK_SOP_ID,
  org_id: null,
  payer_id: null,
  state: null,
  specialty: null,
  group_id: null,
  name: "Generic credentialing checklist",
  archived: false,
  current_version: 1,
  required_profile_attributes: [],
  task_definitions: [
    {
      title: "Prepare application packet",
      dueOffsetDays: 7,
      steps: [{ label: "Complete the generic checklist", stepType: "online_form", dataFields: [] }],
    },
  ],
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

function baseFixtures(groupId: string, groupName: string) {
  return {
    organizations: [
      {
        id: ORG_ID,
        name: "Outer Banks Rehab Group",
        lifecycle_state: "active",
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    memberships: [
      {
        id: "m-1",
        org_id: ORG_ID,
        user_id: USER_ID,
        role: "admin",
        created_at: "2026-06-01T00:00:00Z",
        organizations: {
          name: "Outer Banks Rehab Group",
          lifecycle_state: "active",
          created_at: "2026-06-01T00:00:00Z",
        },
        profiles: { full_name: "Sowmya Seed", email: "sowmya.seed@example.test" },
      },
    ],
    profiles: [
      {
        id: USER_ID,
        full_name: "Sowmya Seed",
        email: "sowmya.seed@example.test",
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    provider_groups: [groupRow(groupId, groupName)],
    facilities: [
      {
        id: "f-1",
        org_id: ORG_ID,
        group_id: groupId,
        name: "Kill Devil Hills Clinic",
        street: "12 Figure Eight Rd",
        city: "Kill Devil Hills",
        state: "NC",
        zip: "27948",
        is_active: true,
        status_id: null,
        effective_date: null,
        reference_only: false,
        hours: {},
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    providers: [] as Record<string, unknown>[],
    provider_group_assignments: [] as Record<string, unknown>[],
    provider_facility_assignments: [] as Record<string, unknown>[],
    state_licenses: [],
    payers: Object.keys(PAYER_NAMES).map(payerRow),
    org_payer_assignments: Object.keys(PAYER_NAMES).map((id) => ({
      id: `a-${id}`,
      org_id: ORG_ID,
      payer_id: id,
      starter: false,
      status: "active",
      archived_at: null,
      created_at: "2026-06-15T00:00:00Z",
    })),
    payer_network_targets: [] as Record<string, unknown>[],
    case_generation_exclusions: [] as Record<string, unknown>[],
    enrollment_facts: [] as Record<string, unknown>[],
    credential_cases: [] as Record<string, unknown>[],
    case_generation_runs: [] as Record<string, unknown>[],
    case_generation_run_rows: [] as Record<string, unknown>[],
    case_status_history: [],
    status_history: [],
    denial_reason_codes: [],
    contracts: [],
    tasks: [] as Record<string, unknown>[],
    status_configs: [],
    sop_templates: [FALLBACK_TEMPLATE] as Record<string, unknown>[],
    sop_template_drafts: [],
    next_best_action_configs: [],
    provider_documents: [],
    group_insurance_policies: [],
    import_runs: [],
    import_rows: [],
    notes: [],
    user_table_prefs: [],
    audit_log: [],
    touches: [],
  } as Record<string, Record<string, unknown>[]>;
}

// TS-111 — the epic gherkin state on Outer Banks: 7 targets, Brooke on the
// group's clinic, 2 LIVE enrollment facts (Aetna, BCBS-NC), 1 standing
// exclusion (UnitedHealthcare), NO existing cases. Buckets: 4 candidates /
// 2 enrolled / 1 excluded — 7 of 7.
function outerBanksFixtures() {
  const f = baseFixtures("g-ob", "Outer Banks Rehab Group LLC");
  f.providers = [providerRow("pr-1", "Brooke", "Ostrander")];
  f.provider_group_assignments = [groupAssignment("pr-1", "g-ob")];
  f.provider_facility_assignments = [facilityAssignment("pr-1", "f-1")];
  f.payer_network_targets = Object.keys(PAYER_NAMES).map((id) => target(id, "g-ob"));
  f.enrollment_facts = [
    liveFact("ef-1", "pr-1", "g-ob", "p1"),
    liveFact("ef-2", "pr-1", "g-ob", "p2"),
  ];
  f.case_generation_exclusions = [
    {
      id: "x-1",
      org_id: ORG_ID,
      provider_id: "pr-1",
      group_id: "g-ob",
      payer_id: "p7",
      state: "NC",
      reason: "panel_closed",
      note: null,
      status: "active",
      created_by: USER_ID,
      created_at: "2026-07-01T00:00:00Z",
      voided_by: null,
      voided_at: null,
    },
  ];
  return f;
}

interface RecordedWrite {
  method: string;
  path: string;
  body: unknown;
}

interface HandlerOptions {
  /** RPC payer_ids that 23505 (a concurrent duplicate) on the first attempt. */
  duplicatePayerIds?: string[];
  /** RPC payer_ids that hard-fail (non-unique error) — the honest-failure path. */
  failPayerIds?: string[];
}

const caseKey = (c: Record<string, unknown>) =>
  `${c.provider_id}|${c.group_id ?? "null"}|${c.payer_id}|${c.state}`;

function makeHandler(
  fixtures: Record<string, Record<string, unknown>[]>,
  opts: HandlerOptions = {},
) {
  const writes: RecordedWrite[] = [];
  let seq = 0;
  const duplicates = new Set(opts.duplicatePayerIds ?? []);
  const hardFails = new Set(opts.failPayerIds ?? []);

  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);

    // The E2.1 RPC write-through: enforce the swapped UNIQUE NULLS NOT
    // DISTINCT 4-part key (23505 on a duplicate), synthesize the case +
    // status_history + tasks rows — plus the TS-126 fault injection.
    if (url.pathname.endsWith("/rpc/create_case_with_tasks") && req.method() === "POST") {
      const rpcBody = req.postDataJSON() as {
        p_input: Record<string, unknown>;
        p_tasks: Array<Record<string, unknown>>;
      };
      writes.push({ method: "RPC", path: "create_case_with_tasks", body: rpcBody });
      const input = rpcBody.p_input;
      const payerId = String(input.payer_id);
      if (hardFails.has(payerId)) {
        return json({ code: "XX000", message: "insert failed" }, 500);
      }
      if (
        duplicates.has(payerId) ||
        fixtures.credential_cases.some((c) => caseKey(c) === caseKey(input))
      ) {
        return json(
          {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "credential_cases_provider_group_payer_state_key"',
            details: "Key already exists.",
          },
          409,
        );
      }
      const caseId = `case-new-${(seq += 1)}`;
      const row = {
        id: caseId,
        org_id: input.org_id,
        provider_id: input.provider_id,
        payer_id: input.payer_id,
        state: input.state,
        group_id: input.group_id ?? null,
        facility_id: input.facility_id ?? null,
        mso_id: input.mso_id ?? null,
        assigned_to: null,
        credentialing_status_id: null,
        case_status: "not_started",
        payer_pipeline_state: "not_started",
        contract_executed_date: null,
        submitted_date: null,
        approved_date: null,
        confirmed_effective_date: null,
        expected_effective_date: null,
        termination_date: null,
        payer_reference_id: null,
        generation_run_id: input.generation_run_id ?? null,
        created_by: USER_ID,
        created_at: "2026-07-19T00:00:00Z",
        updated_at: "2026-07-19T00:00:00Z",
      };
      fixtures.credential_cases.push(row);
      for (const t of rpcBody.p_tasks ?? []) {
        fixtures.tasks.push({
          id: `task-${(seq += 1)}`,
          org_id: ORG_ID,
          case_id: caseId,
          provider_id: row.provider_id,
          title: t.title ?? "Task",
          sop_content: t.sop_content ?? [],
          status: "not_started",
          sort_order: t.sort_order ?? 0,
          due_date: t.due_date ?? null,
          is_auto_generated: true,
          sop_template_id: t.sop_template_id ?? null,
          sop_version: t.sop_version ?? null,
          sop_resolution_tier: t.sop_resolution_tier ?? null,
          execution_type: t.execution_type ?? null,
          created_at: "2026-07-19T00:00:00Z",
          updated_at: "2026-07-19T00:00:00Z",
        });
      }
      return json(row);
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

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
        } else if (raw.startsWith("is.")) {
          if (raw.slice(3) === "null" && row[key] !== null) return false;
        }
      }
      return true;
    };

    if (req.method() === "HEAD") {
      const n = (fixtures[table] ?? []).filter((r) => matchFilters(r)).length;
      return route.fulfill({ status: 200, headers: { "content-range": `*/${n}` }, body: "" });
    }

    if (req.method() === "POST") {
      let parsed: unknown = null;
      try {
        parsed = req.postDataJSON();
      } catch {
        parsed = null;
      }
      writes.push({ method: "POST", path: table, body: parsed });
      const bodies = Array.isArray(parsed)
        ? (parsed as Record<string, unknown>[])
        : [(parsed ?? {}) as Record<string, unknown>];
      const inserted = bodies.map((b) => ({
        id: `new-${(seq += 1)}`,
        created_at: "2026-07-19T00:00:00Z",
        // Exclusion inserts rely on the DB default status='active'.
        ...(table === "case_generation_exclusions"
          ? { status: "active", voided_by: null, voided_at: null }
          : {}),
        ...b,
      }));
      if (fixtures[table]) fixtures[table].push(...inserted);
      return json(wantsObject ? inserted[0] : inserted, 201);
    }
    if (req.method() === "PATCH") {
      let body: Record<string, unknown> | null = null;
      try {
        body = req.postDataJSON() as Record<string, unknown>;
      } catch {
        body = null;
      }
      writes.push({ method: "PATCH", path: table, body });
      const rows = (fixtures[table] ?? []).filter((r) => matchFilters(r));
      for (const r of rows) Object.assign(r, body ?? {});
      if (wantsObject && rows.length === 0)
        return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(wantsObject ? rows[0] : rows);
    }
    if (req.method() !== "GET") {
      writes.push({ method: req.method(), path: table, body: null });
      return json([]);
    }

    const rows = (fixtures[table] ?? []).filter((r) => matchFilters(r));
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

/** All disposition rows POSTed to the run-row ledger, flattened. */
function ledgerRows(writes: RecordedWrite[]): Record<string, unknown>[] {
  return writes
    .filter((w) => w.method === "POST" && w.path === "case_generation_run_rows")
    .flatMap((w) => (Array.isArray(w.body) ? (w.body as Record<string, unknown>[]) : []));
}

test("TS-111: four buckets sum across both pivots; skip-for-now is free, Exclude… persists, Undo restores; confirm ledgers EVERY candidate and lands on /cases?run=", async ({
  context,
  page,
}) => {
  const { handler, writes } = makeHandler(outerBanksFixtures());
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/generation?group=g-ob");
  await expect(page.getByRole("heading", { name: "Review & generate" })).toBeVisible({
    timeout: 30000,
  });

  // The epic gherkin's reconciliation line, verbatim — the sum invariant.
  const bar = page.getByTestId("grid-reconciliation");
  await expect(bar).toHaveText("Create 4 · 1 excluded · 2 enrolled — 7 of 7 accounted for", {
    timeout: 30000,
  });

  // Enrolled rows are grayed evidence, never casework; the excluded row wears
  // its reason with a one-click Undo; candidates carry the fallback-SOP flag.
  await expect(page.getByText("Already enrolled under Outer Banks Rehab Group LLC")).toHaveCount(2);
  await expect(page.getByText("Excluded — Panel closed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(page.getByText("Generic fallback SOP", { exact: true })).toHaveCount(4);
  await expect(
    page.getByText(/4 of the 4 cases you're about to create will use the generic fallback SOP/),
  ).toBeVisible();

  // By-provider header: one provider, all four candidates under it.
  await expect(page.getByText("Brooke Ostrander").first()).toBeVisible();
  await expect(page.getByText("4 of 4 selected")).toBeVisible();

  // Pivot flip: SAME rows regrouped under payer headers; the reconciliation
  // (and selection) is pivot-stable.
  await page.getByRole("tab", { name: "By payer" }).click();
  await expect(page.getByText("Cigna", { exact: true })).toBeVisible();
  await expect(page.getByText("1 of 1 selected")).toHaveCount(4);
  await expect(bar).toHaveText("Create 4 · 1 excluded · 2 enrolled — 7 of 7 accounted for");

  // Rendering + pivoting the grid wrote NOTHING.
  expect(writes.filter((w) => w.method === "POST" || w.method === "PATCH")).toHaveLength(0);

  // Skip-for-now: uncheck Cigna — no dialog, no reason, no write; the line
  // renames the bucket and the sum still reconciles.
  await page.getByLabel("Include Brooke Ostrander — Cigna NC").uncheck();
  await expect(bar).toHaveText(
    "Create 3 · 1 skipped · 1 excluded · 2 enrolled — 7 of 7 accounted for",
  );
  expect(writes.filter((w) => w.method === "POST" || w.method === "PATCH")).toHaveLength(0);

  // Exclude… is the deliberate opt-out: reasoned, persisted, restorable. Pivot
  // back by provider first (row layout is identical either way).
  await page.getByRole("tab", { name: "By provider" }).click();
  const humanaRow = page.getByRole("row", { name: /Humana/ });
  await humanaRow.getByRole("button", { name: "Exclude…" }).click();
  await page.getByLabel("Exclusion reason").click();
  await page.getByRole("option", { name: "Panel closed" }).click();
  await page.getByRole("button", { name: "Exclude", exact: true }).click();
  await expect(bar).toHaveText(
    "Create 2 · 1 skipped · 2 excluded · 2 enrolled — 7 of 7 accounted for",
    { timeout: 15000 },
  );
  const exclusionPost = writes.find(
    (w) => w.method === "POST" && w.path === "case_generation_exclusions",
  );
  expect(exclusionPost).toBeTruthy();

  // Undo the STANDING exclusion (UnitedHealthcare): a void-flip PATCH, never a
  // DELETE — the combination returns as a checked candidate. (Humana's fresh
  // exclusion also wears an Undo now — target United's row.)
  await page
    .getByRole("row", { name: /UnitedHealthcare/ })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(bar).toHaveText(
    "Create 3 · 1 skipped · 1 excluded · 2 enrolled — 7 of 7 accounted for",
    { timeout: 15000 },
  );
  const voidPatch = writes.find(
    (w) => w.method === "PATCH" && w.path === "case_generation_exclusions",
  );
  expect((voidPatch?.body as Record<string, unknown>)?.status).toBe("voided");
  expect(writes.filter((w) => w.method === "DELETE")).toHaveLength(0);

  // Confirm: 3 creations (Medcost, Optum, UnitedHealthcare), the Cigna skip
  // and the Humana exclusion and both facts all land in the run-row ledger —
  // 7 of 7 candidates accounted for in the immutable record too.
  await page.getByRole("button", { name: "Confirm & create 3 cases" }).click();
  await page.waitForURL(/\/cases\?.*run=/, { timeout: 30000 });
  await expect(page.getByText(/3 created/)).toBeVisible({ timeout: 30000 });

  const rpcCalls = writes.filter((w) => w.method === "RPC" && w.path === "create_case_with_tasks");
  expect(rpcCalls).toHaveLength(3);
  for (const call of rpcCalls) {
    const body = call.body as {
      p_input: Record<string, unknown>;
      p_tasks: Record<string, unknown>[];
    };
    expect(body.p_input.generation_run_id).toBeTruthy();
    // E2.2/E4.2 stamps ride unchanged through the new door.
    expect(body.p_tasks[0].sop_template_id).toBe(FALLBACK_SOP_ID);
    expect(body.p_tasks[0].sop_version).toBe(1);
    expect(body.p_tasks[0].sop_resolution_tier).toBe("generic_fallback");
  }

  const ledger = ledgerRows(writes);
  const byDisposition = (d: string) => ledger.filter((r) => r.disposition === d);
  expect(byDisposition("created")).toHaveLength(3);
  expect(byDisposition("skipped")).toHaveLength(1);
  expect(byDisposition("excluded")).toHaveLength(1);
  expect(byDisposition("enrolled")).toHaveLength(2);
  expect(ledger).toHaveLength(7);
  expect(byDisposition("skipped")[0].payer_id).toBe("p3");
  expect(byDisposition("skipped")[0].reason).toBe("Skipped for now — remains a candidate");
  expect(byDisposition("excluded")[0].payer_id).toBe("p4");
  expect(new Set(byDisposition("enrolled").map((r) => r.payer_id))).toEqual(new Set(["p1", "p2"]));

  // One immutable run row, planned created_count = the released 3.
  const runPosts = writes.filter((w) => w.method === "POST" && w.path === "case_generation_runs");
  expect(runPosts).toHaveLength(1);
  expect((runPosts[0].body as Record<string, unknown>).created_count).toBe(3);
});

test("TS-125: a payer-scoped entry over a 4-provider roster groups all candidates under one payer header, by-payer default", async ({
  context,
  page,
}) => {
  const f = baseFixtures("g-sh", "Shelby Sports Rehab LLC");
  f.providers = [
    providerRow("pr-1", "Alex", "Chen"),
    providerRow("pr-2", "Brooke", "Ostrander"),
    providerRow("pr-3", "Casey", "Rivera"),
    providerRow("pr-4", "Dana", "Whitfield"),
  ];
  f.provider_group_assignments = f.providers.map((p) => groupAssignment(String(p.id), "g-sh"));
  f.provider_facility_assignments = f.providers.map((p) => facilityAssignment(String(p.id), "f-1"));
  // Two attached payers; the entry is scoped to Aetna only.
  f.payer_network_targets = [target("p1", "g-sh"), target("p2", "g-sh")];
  const { handler } = makeHandler(f);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  // The board's payer-row link shape: group + payer scope, payer pivot.
  await page.goto("/generation?group=g-sh&payer=p1");
  await expect(page.getByRole("heading", { name: "Review & generate" })).toBeVisible({
    timeout: 30000,
  });

  // ONE payer header carrying the whole roster; the other payer is scoped out.
  await expect(page.getByText("Aetna", { exact: true })).toBeVisible();
  await expect(page.getByText("4 of 4 selected")).toBeVisible();
  await expect(page.getByText("BCBS-NC", { exact: true })).toHaveCount(0);
  for (const name of ["Alex Chen", "Brooke Ostrander", "Casey Rivera", "Dana Whitfield"]) {
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByTestId("grid-reconciliation")).toHaveText(
    "Create 4 — 4 of 4 accounted for",
  );

  // The same rows re-pivot by provider: four headers of one candidate each.
  await page.getByRole("tab", { name: "By provider" }).click();
  await expect(page.getByText("1 of 1 selected")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Confirm & create 4 cases" })).toBeVisible();
});

test("TS-126: a concurrent duplicate degrades to a safe skip; a hard failure is reported honestly and the grid stays put", async ({
  context,
  page,
}) => {
  const f = baseFixtures("g-ob", "Outer Banks Rehab Group LLC");
  f.providers = [providerRow("pr-1", "Brooke", "Ostrander")];
  f.provider_group_assignments = [groupAssignment("pr-1", "g-ob")];
  f.provider_facility_assignments = [facilityAssignment("pr-1", "f-1")];
  f.payer_network_targets = [target("p1", "g-ob"), target("p2", "g-ob"), target("p3", "g-ob")];
  // The preview sees three clean candidates; at confirm time BCBS-NC hits the
  // unique constraint (someone else confirmed concurrently) and Cigna's insert
  // hard-fails.
  const { handler, writes } = makeHandler(f, {
    duplicatePayerIds: ["p2"],
    failPayerIds: ["p3"],
  });
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/generation?group=g-ob");
  await expect(page.getByTestId("grid-reconciliation")).toHaveText(
    "Create 3 — 3 of 3 accounted for",
    { timeout: 30000 },
  );

  await page.getByRole("button", { name: "Confirm & create 3 cases" }).click();

  // Partial failure: the failed row is NAMED, and the page stays on the grid
  // (no landing) — the duplicate skip is NOT a failure.
  await expect(page.getByText(/1 row failed: Brooke Ostrander — Cigna NC/)).toBeVisible({
    timeout: 30000,
  });
  await expect(page).toHaveURL(/\/generation/);

  const ledger = ledgerRows(writes);
  expect(ledger.filter((r) => r.disposition === "created")).toHaveLength(1);
  const skippedExisting = ledger.filter((r) => r.disposition === "skipped_existing");
  expect(skippedExisting).toHaveLength(1);
  expect(skippedExisting[0].payer_id).toBe("p2");
  expect(skippedExisting[0].reason).toBe(
    "already exists — created concurrently by another confirm",
  );
  const failed = ledger.filter((r) => r.disposition === "failed");
  expect(failed).toHaveLength(1);
  expect(failed[0].payer_id).toBe("p3");
  // Exactly one case row exists — the duplicate never double-created and the
  // failure never half-created.
  expect(f.credential_cases).toHaveLength(1);
  expect(f.credential_cases[0].payer_id).toBe("p1");
});

test("TS-127: a provider-record entry scopes the grid to that provider's slice; the record links the ONE door", async ({
  context,
  page,
}) => {
  const f = baseFixtures("g-ob", "Outer Banks Rehab Group LLC");
  f.providers = [providerRow("pr-1", "Brooke", "Ostrander"), providerRow("pr-2", "Alex", "Chen")];
  f.provider_group_assignments = [groupAssignment("pr-1", "g-ob"), groupAssignment("pr-2", "g-ob")];
  f.provider_facility_assignments = [
    facilityAssignment("pr-1", "f-1"),
    facilityAssignment("pr-2", "f-1"),
  ];
  f.payer_network_targets = [target("p1", "g-ob"), target("p2", "g-ob")];
  const { handler } = makeHandler(f);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  // The provider record carries the scoped entry link (F6.3.1's record slice).
  await page.goto("/providers/pr-2");
  const entry = page.getByRole("link", { name: /Review & generate/ });
  await expect(entry).toBeVisible({ timeout: 30000 });
  await expect(entry).toHaveAttribute("href", /\/generation\?provider=pr-2/);

  await entry.click();
  await expect(page.getByRole("heading", { name: "Review & generate" })).toBeVisible({
    timeout: 30000,
  });

  // Only Alex's slice renders — 2 of the org's 4 provider×target rows.
  await expect(page.getByText("Alex Chen", { exact: true })).toBeVisible();
  await expect(page.getByText("2 of 2 selected")).toBeVisible();
  await expect(page.getByText("Brooke Ostrander")).toHaveCount(0);
  await expect(page.getByTestId("grid-reconciliation")).toHaveText(
    "Create 2 — 2 of 2 accounted for",
  );
});
