// E2.1 TE-9 — case-creation coverage over the mock harness (L1/L3 per
// seed-universe; no new baseline fixtures). The TS-50 generation-confirm UI
// flows are PARKED with the /generation surface E6.1 F6.1.6 retired — E6.3
// (decoupled generation) re-homes the door and re-covers them; the 4-part-key
// write-through machinery stays exercised by TS-51/TS-52 and the
// unified-case-status suite:
//   TS-51  Denial → reapply on the SAME case: reapply flips Denied → In
//          Progress (recorded in the unified history) and appends tasks
//          restamped from the current SOP — no second case is ever created.
//   TS-52  Manual one-off case against a non-attached payer: same key and
//          dedupe, generation_run_id stays NULL, and a repeat attempt at the
//          key blocks with a link to the existing case.
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

const groupRow = (id: string, name: string) => ({
  id,
  org_id: ORG_SHELBY,
  name,
  tin: "123456789",
  states: ["NC"],
  is_active: true,
  created_at: "2026-07-10T00:00:00Z",
});

const facilityRow = (id: string, groupId: string, name: string) => ({
  id,
  org_id: ORG_SHELBY,
  group_id: groupId,
  name,
  street: "1 Main St",
  city: "Charlotte",
  state: "NC",
  zip: "28280",
  is_active: true,
  status_id: null,
  effective_date: null,
  reference_only: false,
  created_at: "2026-07-10T00:00:00Z",
});

const providerRow = (id: string, first: string, last: string) => ({
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
  caqh_id: "16224897",
  caqh_last_attested_date: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10),
  date_of_birth: "1990-01-01",
  ssn_last4: "1234",
  home_street: "4104 S Croatan Hwy",
  home_city: "Nags Head",
  home_zip: "27959",
  malpractice_coverage_end: "2027-12-31",
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
});

const groupAssignment = (providerId: string, groupId: string, isPrimary: boolean) => ({
  id: `ga-${providerId}-${groupId}`,
  org_id: ORG_SHELBY,
  provider_id: providerId,
  group_id: groupId,
  is_primary: isPrimary,
  start_date: "2026-01-01",
  end_date: null,
  created_at: "2026-07-10T00:00:00Z",
});

const facilityAssignment = (providerId: string, facilityId: string) => ({
  id: `fa-${providerId}-${facilityId}`,
  org_id: ORG_SHELBY,
  provider_id: providerId,
  facility_id: facilityId,
  is_primary: true,
  start_date: "2026-01-01",
  created_at: "2026-07-10T00:00:00Z",
});

const payerRow = (id: string, name: string, orgId: string | null = null) => ({
  id,
  org_id: orgId,
  name,
  payer_kind: "commercial",
  states: ["NC"],
  aliases: [],
  status: "active",
  payer_slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  is_active: true,
  created_at: "2026-07-10T00:00:00Z",
});

const payerAssignment = (payerId: string) => ({
  id: `opa-${payerId}`,
  org_id: ORG_SHELBY,
  payer_id: payerId,
  starter: false,
  status: "active",
  archived_at: null,
  created_at: "2026-07-10T00:00:00Z",
});

const STATUS_CONFIGS = [
  {
    id: "st-notstarted",
    org_id: ORG_SHELBY,
    track: "credentialing",
    label: "Not Started",
    color: "#888888",
    sort_order: 10,
    required_fields: [],
    action_bucket: "ours",
    created_at: "2026-07-10T00:00:00Z",
  },
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
    id: "st-denied",
    org_id: ORG_SHELBY,
    track: "credentialing",
    label: "Denied",
    color: "#888888",
    sort_order: 80,
    required_fields: [],
    action_bucket: "ours",
    created_at: "2026-07-10T00:00:00Z",
  },
];

// Jane works at clinics of BOTH groups; both groups target BCBS-NC in NC —
// the TS-50 two-group scenario. Cigna-NC is org-visible but NOT attached
// (no payer_network_targets row) — the TS-52 one-off payer.
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
    touches: [],
    case_status_history: [] as Record<string, unknown>[],
    tasks: [] as Record<string, unknown>[],
    status_history: [] as Record<string, unknown>[],
    mso_routing_rules: [],
    msos: [],
    provider_groups: [groupRow("g-1", "Group 1"), groupRow("g-2", "Group 2")],
    facilities: [
      facilityRow("f-g1-nc", "g-1", "Shelby Central Clinic"),
      facilityRow("f-g2-nc", "g-2", "Shelby Performance NC"),
    ],
    providers: [providerRow("pr-jane", "Jane", "Whitaker")],
    provider_group_assignments: [
      groupAssignment("pr-jane", "g-1", true),
      groupAssignment("pr-jane", "g-2", false),
    ],
    provider_facility_assignments: [
      facilityAssignment("pr-jane", "f-g1-nc"),
      facilityAssignment("pr-jane", "f-g2-nc"),
    ],
    state_licenses: [
      {
        id: "l1",
        org_id: ORG_SHELBY,
        provider_id: "pr-jane",
        state: "NC",
        license_number: "PT-1",
        expiration_date: "2027-12-31",
        verified_status: "verified",
        status: "active",
      },
    ],
    payers: [payerRow("pay-bcbsnc", "BCBS-NC"), payerRow("pay-cigna", "Cigna-NC")],
    org_payer_assignments: [payerAssignment("pay-bcbsnc"), payerAssignment("pay-cigna")],
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
      {
        id: "t-2",
        org_id: ORG_SHELBY,
        payer_id: "pay-bcbsnc",
        group_id: "g-2",
        state: "NC",
        status: "active",
        created_at: "2026-07-12T00:00:00Z",
      },
    ],
    provider_documents: [],
    group_insurance_policies: [],
    status_configs: STATUS_CONFIGS,
    sop_templates: [
      {
        id: "tpl-bcbsnc",
        org_id: ORG_SHELBY,
        name: "BCBS-NC enrollment",
        payer_id: "pay-bcbsnc",
        state: "NC",
        specialty: null,
        group_id: null,
        archived: false,
        current_version: 1,
        task_definitions: [
          {
            title: "Submit {{provider.firstName}} application",
            sortOrder: 0,
            dueOffsetDays: 3,
            steps: [{ label: "Submit the online form", stepType: "online_form" }],
          },
        ],
        created_at: "2026-07-10T00:00:00Z",
        updated_at: "2026-07-10T00:00:00Z",
      },
    ],
    credential_cases: [] as Record<string, unknown>[],
    contracts: [],
    case_generation_exclusions: [],
    case_generation_runs: [] as Record<string, unknown>[],
  } as Record<string, Record<string, unknown>[]>;
}

interface RecordedWrite {
  table: string;
  method: string;
  body: Record<string, unknown> | null;
}

const caseKey = (c: Record<string, unknown>) =>
  `${c.provider_id}|${c.group_id ?? "null"}|${c.payer_id}|${c.state}`;

// The shared mock harness, extended with WRITE-THROUGH for every table the
// creation flows touch, a create_case_with_tasks emulation that enforces the
// swapped UNIQUE NULLS NOT DISTINCT constraint (23505 on a duplicate 4-part
// key), and on-the-fly PostgREST-style embeds for the case-detail read.
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
    touches: [],
    status_history: fixtures.status_history.filter((h) => h.case_id === row.id),
    payer_pipeline_history: [],
    case_status_history: fixtures.case_status_history.filter((h) => h.case_id === row.id),
  });

  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.endsWith("/rpc/claim_invites")) return json(0);

    if (url.pathname.endsWith("/rpc/create_case_with_tasks") && req.method() === "POST") {
      const rpcBody = req.postDataJSON() as {
        p_input: Record<string, unknown>;
        p_tasks: Array<Record<string, unknown>>;
      };
      writes.push({ table: "rpc/create_case_with_tasks", method: "POST", body: rpcBody.p_input });
      const input = rpcBody.p_input;
      if (fixtures.credential_cases.some((c) => caseKey(c) === caseKey(input))) {
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
      const caseId = `case-new-${nextId++}`;
      const row = {
        id: caseId,
        org_id: input.org_id,
        provider_id: input.provider_id,
        payer_id: input.payer_id,
        state: input.state,
        group_id: input.group_id ?? null,
        facility_id: input.facility_id ?? null,
        specialty: input.specialty ?? null,
        mso_id: input.mso_id ?? null,
        assigned_to: input.assigned_to ?? null,
        credentialing_status_id: input.credentialing_status_id ?? "st-notstarted",
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
        case_email_token: `tok-${caseId}`,
        created_by: USER_ID,
        created_at: "2026-07-13T00:00:00Z",
        updated_at: "2026-07-13T00:00:00Z",
      };
      fixtures.credential_cases.push(row);
      fixtures.status_history.push({
        id: `sh-${nextId++}`,
        org_id: ORG_SHELBY,
        case_id: caseId,
        track: "credentialing",
        from_status_id: null,
        to_status_id: row.credentialing_status_id,
        metadata: {},
        changed_by: USER_ID,
        changed_at: "2026-07-13T00:00:00Z",
      });
      for (const t of rpcBody.p_tasks ?? []) {
        fixtures.tasks.push({
          id: `task-${nextId++}`,
          org_id: ORG_SHELBY,
          case_id: caseId,
          provider_id: row.provider_id,
          title: t.title ?? "Task",
          description: t.description ?? null,
          sop_content: t.sop_content ?? [],
          status: "not_started",
          sort_order: t.sort_order ?? 0,
          due_date: t.due_date ?? null,
          is_auto_generated: true,
          sop_template_id: t.sop_template_id ?? null,
          sop_version: t.sop_version ?? null,
          created_at: "2026-07-13T00:00:00Z",
          updated_at: "2026-07-13T00:00:00Z",
        });
      }
      return json(row);
    }
    if (url.pathname.endsWith("/rpc/set_case_status") && req.method() === "POST") {
      // E6.0 write-through: mirrors the RPC — canonical flip + legacy-mirror
      // lockstep + an appended case_status_history row.
      const body = req.postDataJSON() as Record<string, unknown>;
      writes.push({ table: "rpc/set_case_status", method: "POST", body });
      const row = fixtures.credential_cases.find((c) => c.id === body.p_case_id);
      if (!row) return json({ message: "case_status_case_not_found" }, 400);
      const from = (row.case_status as string | undefined) ?? "not_started";
      if (body.p_expected_status && body.p_expected_status !== from) {
        return json({ message: `case_status_conflict:${from}` }, 400);
      }
      const to = body.p_to_status as string;
      const mirrorLabel = (
        {
          not_started: "Not Started",
          in_progress: "In Progress",
          submitted: "Submitted",
          in_review: "Submitted",
          action_required: "Waiting on Provider",
          approved: "Approved",
          denied: "Denied",
          not_pursuing: "Not Required",
        } as Record<string, string>
      )[to];
      const mirror = STATUS_CONFIGS.find(
        (s) => s.track === "credentialing" && s.label === mirrorLabel,
      );
      row.case_status = to;
      if (mirror) row.credentialing_status_id = mirror.id;
      row.payer_pipeline_state = (
        {
          not_started: "not_started",
          in_progress: "drafting",
          submitted: "submitted",
          in_review: "in_review",
          action_required: "action_required",
          approved: "approved",
          denied: "denied",
          not_pursuing: "oon",
        } as Record<string, string>
      )[to];
      fixtures.case_status_history.push({
        id: `csh-${nextId++}`,
        org_id: row.org_id,
        case_id: row.id,
        from_status: from,
        to_status: to,
        actor_kind: "user",
        reason_code_id: body.p_reason_code_id ?? null,
        evidence_touch_id: body.p_evidence_touch_id ?? null,
        is_correction: body.p_is_correction ?? false,
        note: body.p_note ?? null,
        changed_by: USER_ID,
        changed_at: "2026-07-19T00:00:00Z",
      });
      return json(row);
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

    if (req.method() !== "GET") {
      let parsed: unknown = null;
      try {
        parsed = req.postDataJSON();
      } catch {
        parsed = null;
      }
      const bodies: Array<Record<string, unknown>> = Array.isArray(parsed)
        ? (parsed as Array<Record<string, unknown>>)
        : parsed
          ? [parsed as Record<string, unknown>]
          : [];
      for (const body of bodies) writes.push({ table, method: req.method(), body });

      if (table === "case_generation_runs" && req.method() === "POST") {
        const row = {
          id: `run-${nextId++}`,
          created_at: "2026-07-13T00:00:00Z",
          ...(bodies[0] ?? {}),
        };
        fixtures.case_generation_runs.push(row);
        return json(wantsObject ? row : [row], 201);
      }
      if (table === "tasks" && req.method() === "POST") {
        const inserted = bodies.map((body) => {
          const row = { id: `task-${nextId++}`, ...body };
          fixtures.tasks.push(row);
          return row;
        });
        return json(wantsObject ? inserted[0] : inserted, 201);
      }
      if (table === "status_history" && req.method() === "POST") {
        for (const body of bodies) {
          fixtures.status_history.push({
            id: `sh-${nextId++}`,
            changed_at: "2026-07-13T00:00:00Z",
            ...body,
          });
        }
        return json(null, 201);
      }
      if (table === "credential_cases" && req.method() === "PATCH") {
        const idFilter = url.searchParams.get("id") ?? "";
        const id = idFilter.startsWith("eq.") ? idFilter.slice(3) : idFilter;
        const row = fixtures.credential_cases.find((r) => r.id === id);
        if (!row) return json({ code: "PGRST116", message: "no rows" }, 406);
        Object.assign(row, bodies[0] ?? {});
        const enriched = enrichCase(row);
        return json(wantsObject ? enriched : [enriched]);
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

    // NB: this repo's supabase-js maybeSingle()/single() fetch ARRAYS with
    // Accept: */* and enforce row count client-side — so embeds must ride
    // the array path too, not just vnd.pgrst.object.
    const rows = (fixtures[table] ?? []).filter((r) => matchFilters(r));
    const out = table === "credential_cases" ? rows.map(enrichCase) : rows;
    if (wantsObject) {
      if (out.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(out[0]);
    }
    return json(out);
  };
  return { handler, writes };
}

function seedAuth(
  context: {
    addInitScript: (fn: (args: unknown[]) => void, args: unknown[]) => Promise<void>;
  },
  orgId: string,
) {
  return context.addInitScript(
    ([authKey, session, activeOrg]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: activeOrg }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, orgId] as const,
  );
}

// (TS-50's two generation-confirm tests were parked with the retired
// /generation surface — see the header note.)

test("TS-51: a denied case reapplies on the SAME case — Denied → In Progress in status_history, tasks restamped from the current SOP, no second case", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  // The TS-51 L3 seed: Jane × Group 1 × BCBS-NC × NC was DENIED last cycle,
  // with its original task and status trail.
  fixtures.credential_cases.push({
    id: "case-denied",
    org_id: ORG_SHELBY,
    provider_id: "pr-jane",
    payer_id: "pay-bcbsnc",
    state: "NC",
    group_id: "g-1",
    facility_id: null,
    specialty: null,
    mso_id: null,
    assigned_to: null,
    credentialing_status_id: "st-denied",
    case_status: "denied",
    submitted_date: "2026-05-01",
    approved_date: null,
    confirmed_effective_date: null,
    expected_effective_date: null,
    termination_date: null,
    payer_reference_id: null,
    generation_run_id: null,
    case_email_token: "tok-denied",
    created_by: USER_ID,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  });
  fixtures.tasks.push({
    id: "task-orig",
    org_id: ORG_SHELBY,
    case_id: "case-denied",
    provider_id: "pr-jane",
    title: "Original submission",
    description: null,
    sop_content: [],
    status: "completed",
    sort_order: 0,
    due_date: null,
    is_auto_generated: true,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
  });
  fixtures.status_history.push({
    id: "sh-denied",
    org_id: ORG_SHELBY,
    case_id: "case-denied",
    track: "credentialing",
    from_status_id: "st-inprog",
    to_status_id: "st-denied",
    metadata: {},
    changed_by: null,
    changed_at: "2026-06-01T00:00:00Z",
  });
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_SHELBY);

  // The preview's grayed reapply link retired with /generation (E6.1); the
  // case itself remains the reapply door.
  await page.goto("/cases/case-denied");

  // On the case: the reapply affordance, gated to the denied status.
  await expect(page.getByText("This application was denied.", { exact: false })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Reapply" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Denied → In Progress");
  await dialog.getByRole("button", { name: "Reapply" }).click();
  await expect(page.getByText("Case reopened — In Progress, 1 task regenerated.")).toBeVisible({
    timeout: 30000,
  });

  // E6.0: the reapply edge rides the atomic set_case_status RPC (unified
  // history + legacy-mirror lockstep) — never a bare PATCH.
  const statusRpc = writes.find((w) => w.table === "rpc/set_case_status");
  expect(statusRpc?.body).toMatchObject({
    p_case_id: "case-denied",
    p_to_status: "in_progress",
    p_expected_status: "denied",
  });
  expect(
    writes.find((w) => w.table === "credential_cases" && w.method === "PATCH"),
  ).toBeUndefined();

  // Tasks regenerated from the CURRENT SOP (Model A), appended AFTER the
  // existing task — resolved title proves the current template was used.
  const taskPost = writes.find((w) => w.table === "tasks" && w.method === "POST");
  expect(taskPost?.body).toMatchObject({
    org_id: ORG_SHELBY,
    case_id: "case-denied",
    provider_id: "pr-jane",
    title: "Submit Jane application",
    status: "not_started",
    sort_order: 1,
    is_auto_generated: true,
  });

  // Never a second case at the key: no create RPC fired, one case row total.
  expect(writes.filter((w) => w.table === "rpc/create_case_with_tasks")).toHaveLength(0);
  expect(fixtures.credential_cases).toHaveLength(1);

  // The refetched case shows the continuous history: original + new task.
  await expect(page.getByText("Submit Jane application")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Original submission")).toBeVisible();
});

test("TS-52: a manual one-off case against a non-attached payer gets the same key discipline and a NULL run id; the key then blocks with a link", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_SHELBY);

  await page.goto("/cases");
  await page.getByRole("button", { name: "New case" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("New case");

  await dialog.getByRole("combobox", { name: "Provider" }).click();
  await page.getByRole("option", { name: "Jane Whitaker" }).click();
  await dialog.getByRole("combobox", { name: "Group" }).click();
  await page.getByRole("option", { name: "Group 1" }).click();
  // Cigna-NC is assigned to the org but OUTSIDE its attached network targets —
  // the exact Q2a escape hatch. The picker is not filtered to targets.
  await dialog.getByRole("combobox", { name: "Payer" }).click();
  await page.getByRole("option", { name: "Cigna-NC" }).click();
  await dialog.getByRole("combobox", { name: "State" }).click();
  await page.getByRole("option", { name: "NC", exact: true }).click();

  await dialog.getByRole("button", { name: "Create case" }).click();

  // Created through the same RPC path with the run-less NULL generation id.
  await expect(page).toHaveURL(/\/cases\/case-new-/, { timeout: 30000 });
  const rpc = writes.find((w) => w.table === "rpc/create_case_with_tasks");
  expect(rpc?.body).toMatchObject({
    org_id: ORG_SHELBY,
    provider_id: "pr-jane",
    group_id: "g-1",
    payer_id: "pay-cigna",
    state: "NC",
    generation_run_id: null,
  });

  // A repeat attempt at the same 4-part key blocks with a link to the case.
  await page.goto("/cases");
  await page.getByRole("button", { name: "New case" }).click();
  const dialog2 = page.getByRole("dialog");
  await dialog2.getByRole("combobox", { name: "Provider" }).click();
  await page.getByRole("option", { name: "Jane Whitaker" }).click();
  await dialog2.getByRole("combobox", { name: "Group" }).click();
  await page.getByRole("option", { name: "Group 1" }).click();
  await dialog2.getByRole("combobox", { name: "Payer" }).click();
  await page.getByRole("option", { name: "Cigna-NC" }).click();
  await dialog2.getByRole("combobox", { name: "State" }).click();
  await page.getByRole("option", { name: "NC", exact: true }).click();

  await expect(
    dialog2.getByText("A case already exists at this key", { exact: false }),
  ).toBeVisible();
  await expect(dialog2.getByRole("button", { name: "Create case" })).toBeDisabled();
  await dialog2.getByRole("link", { name: "open the existing case" }).click();
  await expect(page).toHaveURL(/\/cases\/case-new-/, { timeout: 30000 });
  // Still exactly one case at the key — the block pre-empted the constraint.
  expect(writes.filter((w) => w.table === "rpc/create_case_with_tasks")).toHaveLength(1);
});

test("manual case replaces empty selectors with provider and payer setup actions", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  fixtures.providers = [];
  fixtures.org_payer_assignments = [];
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_SHELBY);

  await page.goto("/cases");
  await page.getByRole("button", { name: "New case" }).click();
  const dialog = page.getByRole("dialog");

  await expect(dialog.getByText("Add a provider first")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Add provider" })).toHaveAttribute(
    "href",
    "/onboarding/wizard?section=providers",
  );
  await expect(dialog.getByText("Add a payer to this organization")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Open payer catalog" })).toHaveAttribute(
    "href",
    "/payer-directory",
  );
  await expect(dialog.getByRole("combobox", { name: "Provider" })).toHaveCount(0);
  await expect(dialog.getByRole("combobox", { name: "Payer" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Create case" })).toBeDisabled();
});

test("manual case directs providers without group assignments back to the roster", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  fixtures.provider_group_assignments = [];
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_SHELBY);

  await page.goto("/cases");
  await page.getByRole("button", { name: "New case" }).click();
  const dialog = page.getByRole("dialog");

  await expect(dialog.getByText("Assign a provider to a group")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Assign provider group" })).toHaveAttribute(
    "href",
    "/onboarding/wizard?section=providers",
  );
  await expect(dialog.getByRole("combobox", { name: "Provider" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Create case" })).toBeDisabled();
});

test("manual case excludes an org-owned payer without an assignment (subscription-only picker)", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  fixtures.payers = [payerRow("pay-legacy", "Legacy Org Payer", ORG_SHELBY)];
  fixtures.org_payer_assignments = [];
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_SHELBY);

  await page.goto("/cases");
  await page.getByRole("button", { name: "New case" }).click();
  const dialog = page.getByRole("dialog");

  await expect(dialog.getByText("Add a payer to this organization")).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Payer" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Legacy Org Payer" })).toHaveCount(0);
});

test("manual case distinguishes prerequisite query failures from empty data", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await context.route(/\/rest\/v1\/providers(?:\?|$)/, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "provider read failed" }),
    });
  });
  await seedAuth(context, ORG_SHELBY);

  await page.goto("/cases");
  await page.getByRole("button", { name: "New case" }).click();
  const dialog = page.getByRole("dialog");

  await expect(dialog.getByRole("alert")).toContainText("Couldn't load case prerequisites.", {
    timeout: 30000,
  });
  await expect(dialog.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Provider" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Create case" })).toBeDisabled();
});
