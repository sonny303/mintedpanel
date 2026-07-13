// E2.2 TE-9 — version stamping over the mock harness (L1/L3 per
// seed-universe; the TS-45/47-style SOP fixtures + generation through the
// service path):
//   TS-53  Two batches straddling a publish: April's batch stamps (tpl, v1);
//          the SOP publishes to v2; July's batch stamps (tpl, v2) while
//          April's tasks keep v1 and their content unchanged. The case
//          surface reads each stamp's IMMUTABLE version-row name (a head
//          rename never rewrites history) and links into the read-only
//          version view (E1.7b F1.7b.2).
//   TS-54  A payer with no authored SOP resolves the global generic fallback
//          (never zero tasks), the case is filterable via the URL-driven
//          "Using generic SOP" chip and marked with the neutral pill;
//          authoring a payer SOP later changes nothing on the existing case,
//          and reapply restamps the NEW cycle at the current payer SOP while
//          the original cycle's fallback stamp survives untouched.
import { test, expect, type Route } from "@playwright/test";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_SHELBY = "33333333-3333-4333-8333-333333333333";
// The seeded fallback row's fixed UUID (mirrors FALLBACK_SOP_TEMPLATE_ID).
const FALLBACK_ID = "00000000-0000-4000-a000-00000000e17b";

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

const licenseRow = (id: string, providerId: string) => ({
  id,
  org_id: ORG_SHELBY,
  provider_id: providerId,
  state: "NC",
  license_number: "PT-1",
  expiration_date: "2027-12-31",
  verified_status: "verified",
  status: "active",
});

const payerRow = (id: string, name: string) => ({
  id,
  org_id: null,
  name,
  payer_kind: "commercial",
  states: ["NC"],
  aliases: [],
  status: "active",
  payer_slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  is_active: true,
  created_at: "2026-07-10T00:00:00Z",
});

const versionRow = (
  templateId: string,
  version: number,
  name: string,
  taskDefinitions: unknown[],
) => ({
  id: `ver-${templateId}-${version}`,
  template_id: templateId,
  version,
  name,
  task_definitions: taskDefinitions,
  change_note: null,
  published_at: "2026-07-10T00:00:00Z",
  published_by: null,
});

const taskDefsV1 = [
  {
    title: "Submit {{provider.firstName}} application",
    sortOrder: 0,
    dueOffsetDays: 3,
    steps: [{ label: "Submit the online form", stepType: "online_form" }],
  },
];

const taskDefsV2 = [
  {
    title: "Submit {{provider.firstName}} application (revised)",
    sortOrder: 0,
    dueOffsetDays: 3,
    steps: [{ label: "Submit the revised online form", stepType: "online_form" }],
  },
];

const FALLBACK_DEFS = [
  {
    title: "Standard enrollment checklist for {{provider.firstName}}",
    sortOrder: 0,
    steps: [{ label: "Collect the standard enrollment packet" }],
  },
];

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

// One group, one clinic; Jane is the day-one candidate. The payer under test
// differs per scenario: TS-53 attaches BCBS-NC (authored SOP), TS-54 attaches
// Cigna-NC (NO authored SOP — the fallback path).
function makeFixtures(targetPayerId: string) {
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
    portals: [],
    tasks: [] as Record<string, unknown>[],
    status_history: [] as Record<string, unknown>[],
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
    providers: [providerRow("pr-jane", "Jane", "Whitaker")],
    provider_group_assignments: [groupAssignment("pr-jane", "g-1", true)],
    provider_facility_assignments: [facilityAssignment("pr-jane", "f-g1-nc")],
    state_licenses: [licenseRow("l1", "pr-jane")],
    payers: [payerRow("pay-bcbsnc", "BCBS-NC"), payerRow("pay-cigna", "Cigna-NC")],
    org_payer_assignments: [],
    payer_network_targets: [
      {
        id: "t-1",
        org_id: ORG_SHELBY,
        payer_id: targetPayerId,
        group_id: "g-1",
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
        task_definitions: taskDefsV1,
        created_at: "2026-07-10T00:00:00Z",
        updated_at: "2026-07-10T00:00:00Z",
      },
      {
        // The seeded global generic fallback (E1.7b F1.7b.4): global AND
        // payerless — the TE-3 structural identity.
        id: FALLBACK_ID,
        org_id: null,
        name: "General enrollment SOP",
        payer_id: null,
        state: null,
        specialty: null,
        group_id: null,
        archived: false,
        current_version: 1,
        task_definitions: FALLBACK_DEFS,
        created_at: "2026-07-10T00:00:00Z",
        updated_at: "2026-07-10T00:00:00Z",
      },
    ],
    sop_template_versions: [
      versionRow("tpl-bcbsnc", 1, "BCBS-NC enrollment", taskDefsV1),
      versionRow(FALLBACK_ID, 1, "General enrollment SOP", FALLBACK_DEFS),
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

// The shared write-through harness (see case-creation.spec.ts): the RPC
// emulation persists p_tasks INCLUDING the E2.2 stamp columns, and records
// the FULL rpc body so the specs can assert on the stamp transport.
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
      writes.push({
        table: "rpc/create_case_with_tasks",
        method: "POST",
        body: rpcBody as unknown as Record<string, unknown>,
      });
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

const rpcTasks = (w: RecordedWrite) =>
  ((w.body as { p_tasks?: Array<Record<string, unknown>> })?.p_tasks ?? []) as Array<
    Record<string, unknown>
  >;

test("TS-53: batches straddling a publish stamp v1 then v2; the earlier batch keeps its version and the case surface links each read-only version view", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures("pay-bcbsnc");
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_SHELBY);

  // April's batch: Jane resolves the BCBS-NC SOP at v1.
  await page.goto("/generation");
  await expect(page.getByText("1 proposed", { exact: false })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Confirm & create 1 case" }).click();
  await expect(page).toHaveURL(/\/cases\?runId=/, { timeout: 30000 });

  const aprilRpc = writes.filter((w) => w.table === "rpc/create_case_with_tasks");
  expect(aprilRpc).toHaveLength(1);
  expect(rpcTasks(aprilRpc[0])[0]).toMatchObject({
    title: "Submit Jane application",
    sop_template_id: "tpl-bcbsnc",
    sop_version: 1,
  });
  const aprilCaseId = fixtures.credential_cases[0].id as string;

  // June: the SOP publishes to v2 (head renamed + content revised; the v1
  // version row is immutable and keeps the original name).
  Object.assign(fixtures.sop_templates[0], {
    name: "BCBS-NC enrollment (revised)",
    current_version: 2,
    task_definitions: taskDefsV2,
  });
  fixtures.sop_template_versions.push(
    versionRow("tpl-bcbsnc", 2, "BCBS-NC enrollment (revised)", taskDefsV2),
  );

  // July's batch: Mark joins the group — the new candidate resolves v2.
  fixtures.providers.push(providerRow("pr-mark", "Mark", "Ostrander"));
  fixtures.provider_group_assignments.push(groupAssignment("pr-mark", "g-1", true));
  fixtures.provider_facility_assignments.push(facilityAssignment("pr-mark", "f-g1-nc"));
  fixtures.state_licenses.push(licenseRow("l2", "pr-mark"));

  await page.goto("/generation");
  await expect(page.getByText("1 proposed", { exact: false })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Confirm & create 1 case" }).click();
  await expect(page).toHaveURL(/\/cases\?runId=/, { timeout: 30000 });

  const allRpc = writes.filter((w) => w.table === "rpc/create_case_with_tasks");
  expect(allRpc).toHaveLength(2);
  expect(rpcTasks(allRpc[1])[0]).toMatchObject({
    title: "Submit Mark application (revised)",
    sop_template_id: "tpl-bcbsnc",
    sop_version: 2,
  });

  // April's tasks still reference v1 and their content is unchanged.
  const aprilTask = fixtures.tasks.find((t) => t.case_id === aprilCaseId);
  expect(aprilTask).toMatchObject({
    title: "Submit Jane application",
    sop_template_id: "tpl-bcbsnc",
    sop_version: 1,
  });

  // April's case surface: provenance reads the IMMUTABLE v1 row's name (not
  // the renamed head) and opens the read-only version view on v1.
  await page.goto(`/cases/${aprilCaseId}`);
  await expect(page.getByText("Generated from")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "BCBS-NC enrollment v1" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Version 1");
  await expect(dialog).toContainText("Read-only snapshot — current version is 2");
  await expect(dialog).toContainText("Submit {{provider.firstName}} application");
  await dialog.press("Escape");

  // July's case links v2 under the published name.
  const julyCaseId = fixtures.credential_cases[1].id as string;
  await page.goto(`/cases/${julyCaseId}`);
  await expect(page.getByRole("button", { name: "BCBS-NC enrollment (revised) v2" })).toBeVisible({
    timeout: 30000,
  });
});

test("TS-54: a no-SOP payer resolves the generic fallback (never zero tasks), is chip-filterable and marked; reapply restamps at the later-authored payer SOP without touching the original stamp", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures("pay-cigna");
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_SHELBY);

  // Generation: no Cigna SOP exists — the fallback resolves and stamps.
  await page.goto("/generation");
  await expect(page.getByText("1 proposed", { exact: false })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Confirm & create 1 case" }).click();
  await expect(page).toHaveURL(/\/cases\?runId=/, { timeout: 30000 });

  const genRpc = writes.filter((w) => w.table === "rpc/create_case_with_tasks");
  expect(genRpc).toHaveLength(1);
  expect(rpcTasks(genRpc[0])).toHaveLength(1);
  expect(rpcTasks(genRpc[0])[0]).toMatchObject({
    title: "Standard enrollment checklist for Jane",
    sop_template_id: FALLBACK_ID,
    sop_version: 1,
  });
  const caseId = fixtures.credential_cases[0].id as string;

  // The URL-driven chip filters to fallback-stamped cases (the coverage-gap
  // working list).
  await page.goto("/cases");
  const genericChip = page.getByRole("button", { name: /Using generic SOP/ });
  await expect(genericChip).toContainText("1");
  await genericChip.click();
  await expect(page).toHaveURL(/\/cases\?chip=generic/);
  await expect(page.getByText("Jane Whitaker").first()).toBeVisible({ timeout: 30000 });

  // The case is visibly marked: fallback provenance + the neutral pill.
  await page.goto(`/cases/${caseId}`);
  await expect(page.getByRole("button", { name: "General enrollment SOP v1" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText("Generic SOP", { exact: true })).toBeVisible();

  // A Cigna SOP is authored afterward — existing case keeps its stamp (no
  // retro-swap); the case is then denied and reapplied: the NEW cycle stamps
  // the current payer SOP.
  fixtures.sop_templates.push({
    id: "tpl-cigna",
    org_id: ORG_SHELBY,
    name: "Cigna-NC enrollment",
    payer_id: "pay-cigna",
    state: "NC",
    specialty: null,
    group_id: null,
    archived: false,
    current_version: 1,
    task_definitions: taskDefsV1,
    created_at: "2026-07-13T00:00:00Z",
    updated_at: "2026-07-13T00:00:00Z",
  });
  fixtures.sop_template_versions.push(
    versionRow("tpl-cigna", 1, "Cigna-NC enrollment", taskDefsV1),
  );
  fixtures.credential_cases[0].credentialing_status_id = "st-denied";

  await page.goto(`/cases/${caseId}`);
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

  // The appended cycle stamps the CURRENT best match (payer SOP beats the
  // fallback now), while the original fallback-stamped task is untouched.
  const appended = writes.find((w) => w.table === "tasks" && w.method === "POST");
  expect(appended?.body).toMatchObject({
    case_id: caseId,
    title: "Submit Jane application",
    sop_template_id: "tpl-cigna",
    sop_version: 1,
    sort_order: 1,
  });
  const originalTask = fixtures.tasks.find((t) => t.case_id === caseId);
  expect(originalTask).toMatchObject({ sop_template_id: FALLBACK_ID, sop_version: 1 });

  // Both cycles' provenance lines render; only the fallback line is marked.
  await expect(page.getByRole("button", { name: "General enrollment SOP v1" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole("button", { name: "Cigna-NC enrollment v1" })).toBeVisible();
  await expect(page.getByText("Generic SOP", { exact: true })).toHaveCount(1);
});
