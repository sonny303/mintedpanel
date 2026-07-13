// E2.4 TE-10 — generation-traceability coverage over the mock harness
// (TS-48–TS-52-style states, no new baseline fixtures):
//   TS-57 explainable batch trace: a confirmed mixed-disposition run —
//         one created, one skipped (Jane's in-flight legacy case blocks the
//         key), one excluded with a reason recorded through the E2.0 dialog —
//         writes one immutable disposition row per candidate at confirm time
//         (created rows AND blocking rows link their case; the excluded row
//         links its exclusion and snapshots the reason, never the note). Run
//         history lists the run with counts DERIVED from those rows; run
//         detail lists every disposition with its reason; case detail's
//         provenance names the run (deep link) while a run-less case reads
//         as a distinct manual origin. Audit rows exist for confirm, create,
//         and exclude — and the run-rows table sees INSERTs only.
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
  malpractice_coverage_end: "2028-12-31",
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
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

// TS-48/TS-50 states: Group 1 roster of three; one payer target; Jane's
// legacy NULL-group in-flight case blocks her key (the TE-6 3-part cover).
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
    audit_log: [] as Record<string, unknown>[],
    party_role_assignments: [],
    touches: [],
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
    providers: [
      providerRow("pr-jane", "Jane", "Whitaker"),
      providerRow("pr-noel", "Noel", "Baxter"),
      providerRow("pr-priya", "Priya", "Raman"),
    ],
    provider_group_assignments: [
      groupAssignment("pr-jane"),
      groupAssignment("pr-noel"),
      groupAssignment("pr-priya"),
    ],
    provider_facility_assignments: [
      facilityAssignment("pr-jane"),
      facilityAssignment("pr-noel"),
      facilityAssignment("pr-priya"),
    ],
    state_licenses: [
      licenseRow("l1", "pr-jane"),
      licenseRow("l2", "pr-noel"),
      licenseRow("l3", "pr-priya"),
    ],
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
    provider_documents: [],
    group_insurance_policies: [],
    status_configs: [
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
    ],
    sop_templates: [],
    credential_cases: [
      // Jane's legacy in-flight case (NULL group covers her key; NULL run id
      // = the distinct manual origin F2.4.2 requires).
      {
        id: "case-jane",
        org_id: ORG_SHELBY,
        provider_id: "pr-jane",
        payer_id: "pay-bcbsnc",
        state: "NC",
        group_id: null,
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
        case_email_token: "tok-case-jane",
        created_by: USER_ID,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ] as Record<string, unknown>[],
    tasks: [] as Record<string, unknown>[],
    contracts: [],
    case_generation_exclusions: [] as Record<string, unknown>[],
    case_generation_runs: [] as Record<string, unknown>[],
    case_generation_run_rows: [] as Record<string, unknown>[],
  } as Record<string, Record<string, unknown>[]>;
}

interface RecordedWrite {
  table: string;
  method: string;
  body: Record<string, unknown> | null;
}

const caseKey = (c: Record<string, unknown>) =>
  `${c.provider_id}|${c.group_id ?? "null"}|${c.payer_id}|${c.state}`;

// The shared mock harness with write-through for every table this flow
// touches. The create_case_with_tasks emulation mirrors the PRODUCTION RPC
// body: it also inserts the CREATE/credential_case and CREATE/task audit
// rows (baseline RPC behavior E2.1 kept), so TS-57's "audit rows exist for
// create" assertion exercises the real contract.
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
        facility_id: null,
        specialty: input.specialty ?? null,
        mso_id: null,
        assigned_to: null,
        credentialing_status_id: "st-notstarted",
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
      // The production RPC writes the case + task audit rows itself.
      fixtures.audit_log.push({
        id: `al-${nextId++}`,
        org_id: ORG_SHELBY,
        action_type: "CREATE",
        entity_type: "credential_case",
        entity_id: caseId,
        created_at: "2026-07-13T00:00:00Z",
      });
      for (const t of rpcBody.p_tasks ?? []) {
        const taskId = `task-${nextId++}`;
        fixtures.tasks.push({
          id: taskId,
          org_id: ORG_SHELBY,
          case_id: caseId,
          provider_id: row.provider_id,
          title: t.title ?? "Task",
          description: null,
          sop_content: t.sop_content ?? [],
          status: "not_started",
          sort_order: t.sort_order ?? 0,
          due_date: null,
          is_auto_generated: true,
          sop_template_id: t.sop_template_id ?? null,
          sop_version: t.sop_version ?? null,
          created_at: "2026-07-13T00:00:00Z",
          updated_at: "2026-07-13T00:00:00Z",
        });
        fixtures.audit_log.push({
          id: `al-${nextId++}`,
          org_id: ORG_SHELBY,
          action_type: "CREATE",
          entity_type: "task",
          entity_id: taskId,
          created_at: "2026-07-13T00:00:00Z",
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

      if (table === "case_generation_exclusions" && req.method() === "POST") {
        const row = {
          id: `x-${nextId++}`,
          status: "active",
          note: null,
          voided_by: null,
          voided_at: null,
          created_at: "2026-07-13T00:00:00Z",
          ...(bodies[0] ?? {}),
        };
        fixtures.case_generation_exclusions.push(row);
        return json(wantsObject ? row : [row], 201);
      }
      if (table === "case_generation_runs" && req.method() === "POST") {
        const row = {
          id: `run-${nextId++}`,
          created_at: "2026-07-13T00:00:00Z",
          ...(bodies[0] ?? {}),
        };
        fixtures.case_generation_runs.push(row);
        return json(wantsObject ? row : [row], 201);
      }
      if (table === "case_generation_run_rows" && req.method() === "POST") {
        const inserted = bodies.map((body) => {
          const row = { id: `rr-${nextId++}`, created_at: "2026-07-13T00:00:00Z", ...body };
          fixtures.case_generation_run_rows.push(row);
          return row;
        });
        return json(wantsObject ? inserted[0] : inserted, 201);
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
    const order = url.searchParams.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      rows = [...rows].sort((a, b) =>
        dir === "desc"
          ? String(b[col] ?? "").localeCompare(String(a[col] ?? ""))
          : String(a[col] ?? "").localeCompare(String(b[col] ?? "")),
      );
    }
    // Embeds ride the array path too (this repo's maybeSingle fetches arrays).
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

test("TS-57: a mixed-disposition run is fully explainable — immutable rows with reasons and links, derived counts, case provenance, audit spine", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  // The preview: Noel + Priya proposed, Jane's key already exists (legacy
  // NULL-group in-flight case).
  await page.goto("/generation");
  await expect(
    page.getByText("3 combinations: 2 proposed · 1 already exists · 0 excluded", { exact: false }),
  ).toBeVisible({ timeout: 30000 });

  // Exclude Priya with a reason through the E2.0 dialog (the audited flow).
  await page
    .getByRole("checkbox", { name: "Uncheck to exclude Priya Raman — BCBS-NC NC (Group 1)" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Exclusion reason" }).click();
  await page.getByRole("option", { name: "Panel closed" }).click();
  await dialog.getByRole("button", { name: "Exclude" }).click();
  await expect(page.getByText("· 1 excluded", { exact: false })).toBeVisible();

  // Confirm the batch: 1 created (Noel), 1 skipped (Jane), 1 excluded (Priya).
  await page.getByRole("button", { name: "Confirm & create 1 case" }).click();
  await expect(page).toHaveURL(/\/work\?run=/, { timeout: 30000 });

  // One immutable disposition row per candidate, written at confirm time.
  const rowWrites = writes.filter(
    (w) => w.table === "case_generation_run_rows" && w.method === "POST",
  );
  expect(rowWrites).toHaveLength(3);
  const runId = fixtures.case_generation_runs[0].id as string;
  const byDisposition = new Map(rowWrites.map((w) => [w.body?.disposition, w.body]));
  expect(byDisposition.get("skipped_existing")).toMatchObject({
    org_id: ORG_SHELBY,
    run_id: runId,
    provider_id: "pr-jane",
    group_id: "g-1",
    payer_id: "pay-bcbsnc",
    state: "NC",
    case_id: "case-jane", // the BLOCKING case is a link, not a hunt
  });
  const exclusionId = fixtures.case_generation_exclusions[0].id as string;
  expect(byDisposition.get("excluded")).toMatchObject({
    provider_id: "pr-priya",
    exclusion_id: exclusionId,
    reason: "Panel closed", // the reason snapshot — never the note
  });
  const createdCaseId = fixtures.credential_cases.find((c) => c.generation_run_id === runId)
    ?.id as string;
  expect(byDisposition.get("created")).toMatchObject({
    provider_id: "pr-noel",
    case_id: createdCaseId,
  });
  // INSERT-only: nothing ever updates or deletes a disposition row.
  expect(
    writes.filter((w) => w.table === "case_generation_run_rows" && w.method !== "POST"),
  ).toHaveLength(0);

  // Run history (reached from the generation surface — no nav item): counts
  // are DERIVED from the disposition rows.
  await page.goto("/generation");
  await page.getByRole("link", { name: /Run history/ }).click();
  await expect(page.getByRole("heading", { name: "Generation run history" })).toBeVisible({
    timeout: 30000,
  });
  const listRow = page.locator("table tbody tr").first();
  await expect(listRow).toContainText("Sowmya Seed");
  await page.getByRole("link", { name: "Open run" }).click();

  // Run detail: every disposition with its confirm-time reason.
  await expect(page.getByRole("heading", { name: "Generation run" })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByText("1 created · 1 skipped (existing) · 1 excluded · 0 failed", { exact: false }),
  ).toBeVisible();
  const detailRows = page.locator("table tbody tr");
  await expect(detailRows).toHaveCount(3);
  const janeRow = detailRows.filter({ hasText: "Jane Whitaker" });
  await expect(janeRow).toContainText("Skipped — already exists");
  await expect(janeRow.getByRole("link", { name: "Open blocking case" })).toBeVisible();
  const priyaRow = detailRows.filter({ hasText: "Priya Raman" });
  await expect(priyaRow).toContainText("Excluded");
  await expect(priyaRow).toContainText("Panel closed");
  await expect(priyaRow).toContainText("still excluded");
  const noelRow = detailRows.filter({ hasText: "Noel Baxter" });
  await expect(noelRow).toContainText("Created");

  // Created case links back to this run (F2.4.1) and its detail names the
  // run + actor (F2.4.2).
  await noelRow.getByRole("link", { name: "Open case" }).click();
  await expect(page).toHaveURL(new RegExp(`/cases/${createdCaseId}`), { timeout: 30000 });
  await expect(page.getByText(/Created by a/, { exact: false })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("confirmed by Sowmya Seed", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "generation run" }).click();
  await expect(page).toHaveURL(new RegExp(`/generation/runs/${runId}`), { timeout: 30000 });

  // A run-less case shows the DISTINCT manual origin.
  await page.goto("/cases/case-jane");
  await expect(page.getByText("Created manually by Sowmya Seed", { exact: false })).toBeVisible({
    timeout: 30000,
  });

  // Audit spine (F2.4.3): confirm + exclude audited via writeAudit; each
  // created case/task audited inside the RPC (synthesized here exactly as
  // the production RPC writes them). No double-writing anywhere.
  const auditWrites = writes.filter((w) => w.table === "audit_log");
  expect(auditWrites.filter((w) => w.body?.entity_type === "case_generation_run")).toHaveLength(1);
  expect(
    auditWrites.filter((w) => w.body?.entity_type === "case_generation_exclusion"),
  ).toHaveLength(1);
  expect(auditWrites.filter((w) => w.body?.entity_type === "credential_case")).toHaveLength(0);
  expect(fixtures.audit_log.filter((a) => a.entity_type === "credential_case")).toHaveLength(1);
});
