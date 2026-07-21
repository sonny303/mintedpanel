import { test, expect, type Page, type Route } from "@playwright/test";

// E3.1 TE-11 — import preview / dedupe / conflict review / staged commit over
// the mock harness:
//   TS-61 Preview summary + five-part dedupe: a ready-for-review run with a
//         new provider, an exact five-part duplicate (skipped "already
//         exists"), and Jane under a second group/facility (an UPDATE
//         proposing the assignment, never a second Jane). Counts reconcile
//         with the staged rows; nothing hits live tables before Commit.
//   TS-62 Per-field conflict review + staged commit: Jane's specialty
//         conflicts; existing is the default; the conflict blocks only its
//         own row; resolve + Commit runs the transactional RPC, providers
//         land Pending Verification, run-level + per-entity audit rows exist,
//         staged rows purge.
//   TS-63 Staging fence + batch assignment: a pending-verification provider
//         is a generation/readiness candidate ONLY after it is verified (the
//         TE-2 single-fence read); batch assignment fills gaps and re-running
//         adds nothing (idempotent).
//
// The harness write-throughs import_runs, the commit_import_run RPC (creating
// providers pending_verification + assignments + licenses + audit rows,
// purging import_rows, flipping the run), and provider verification PATCH, so
// the invalidate-and-refetch loop runs for real. matchFilters honors eq./in./
// neq. — the neq. on verification_state is the fence.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-07-13T12:00:00Z";

const JANE_ID = "aaaaaaa1-0000-4000-8000-000000000001";
const BROOKE_ID = "aaaaaaa1-0000-4000-8000-000000000002";
const G1 = "bbbbbbb1-0000-4000-8000-000000000001";
const G2 = "bbbbbbb1-0000-4000-8000-000000000002";
const F1 = "ccccccc1-0000-4000-8000-000000000001";
const F2 = "ccccccc1-0000-4000-8000-000000000002";
const JANE_LIC = "ddddddd1-0000-4000-8000-000000000001";
const BROOKE_LIC = "ddddddd1-0000-4000-8000-000000000002";
const PAYER = "eeeeeee1-0000-4000-8000-000000000001";
const TARGET = "fffffff1-0000-4000-8000-000000000001";
const RUN_ID = "99999991-0000-4000-8000-000000000001";

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

const LIVE_TABLES = [
  "providers",
  "provider_groups",
  "facilities",
  "provider_facility_assignments",
  "provider_group_assignments",
  "state_licenses",
];

function provider(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "prov",
    org_id: ORG_ID,
    group_id: null,
    launch_id: null,
    first_name: "First",
    last_name: "Last",
    credentials: "PT",
    date_of_birth: null,
    ssn_last4: null,
    email: null,
    phone: null,
    home_street: null,
    home_city: null,
    home_state: "NC",
    home_zip: null,
    npi: null,
    caqh_id: null,
    caqh_last_attested_date: null,
    dea_number: null,
    taxonomy_code: null,
    specialty: "Physical Therapy",
    start_date: null,
    status: "active",
    is_new_grad: null,
    terminated_date: null,
    malpractice_coverage_end: null,
    middle_initial: null,
    reference_only: false,
    verification_state: "verified",
    license_number: null,
    license_state: null,
    license_issue_date: null,
    license_expiration_date: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}

function group(id: string, name: string, tin: string): Record<string, unknown> {
  return { id, org_id: ORG_ID, name, tin, is_active: true, created_at: NOW };
}

function facility(id: string, name: string, groupId: string): Record<string, unknown> {
  return {
    id,
    org_id: ORG_ID,
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
    created_at: NOW,
  };
}

function license(
  id: string,
  providerId: string,
  state: string,
  number: string,
): Record<string, unknown> {
  return {
    id,
    org_id: ORG_ID,
    provider_id: providerId,
    state,
    license_number: number,
    license_type: null,
    issue_date: null,
    expiration_date: "2027-01-01",
    status: "active",
    verified_status: "unverified",
    verified_at: null,
    verified_by: null,
    verification_source_url: null,
    created_at: NOW,
  };
}

function stagedRow(line: number, mapped: Record<string, string | null>): Record<string, unknown> {
  return {
    id: `import-row-${line}`,
    org_id: ORG_ID,
    run_id: RUN_ID,
    line,
    raw: mapped,
    mapped,
    row_state: "staged",
    error_column: null,
    error_reason: null,
    created_at: NOW,
  };
}

function readyRun(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RUN_ID,
    org_id: ORG_ID,
    created_by: USER_ID,
    source: "internal",
    file_name: "roster.csv",
    state: "ready_for_review",
    total_rows: 3,
    staged_rows: 3,
    error_rows: 0,
    error_report: null,
    committed_at: null,
    created_provider_ids: null,
    updated_provider_ids: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}

function baseFixtures(): Record<string, Record<string, unknown>[]> {
  return {
    organizations: [
      {
        id: ORG_ID,
        name: "Tree Hill Sports Therapy",
        lifecycle_state: "prospect",
        created_at: NOW,
      },
    ],
    memberships: [
      {
        org_id: ORG_ID,
        role: "admin",
        organizations: {
          name: "Tree Hill Sports Therapy",
          lifecycle_state: "prospect",
          created_at: NOW,
        },
      },
    ],
    profiles: [
      { id: USER_ID, full_name: "Sowmya Seed", email: "sowmya.seed@example.test", created_at: NOW },
    ],
    notes: [],
    user_table_prefs: [],
    credential_cases: [],
    status_configs: [],
    audit_log: [],
    party_role_assignments: [],
    parties: [],
    provider_groups: [],
    facilities: [],
    providers: [],
    state_licenses: [],
    provider_group_assignments: [],
    provider_facility_assignments: [],
    payers: [],
    org_payer_assignments: [],
    payer_network_targets: [],
    provider_documents: [],
    group_insurance_policies: [],
    contracts: [],
    tasks: [],
    sop_templates: [],
    case_generation_exclusions: [],
    import_runs: [],
    import_rows: [],
  };
}

interface WireLog {
  writes: Array<{ table: string; method: string }>;
  commitCalls: Array<{ p_run_id: string; p_plan: Record<string, unknown> }>;
}

function makeHandler(fixtures: Record<string, Record<string, unknown>[]>, wire: WireLog) {
  let seq = 500;
  return async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.endsWith("/rpc/claim_invites")) return json(0);

    if (url.pathname.endsWith("/rpc/commit_import_run")) {
      const body = JSON.parse(req.postData() ?? "{}") as WireLog["commitCalls"][number];
      wire.commitCalls.push(body);
      const run = fixtures.import_runs.find((r) => r.id === body.p_run_id);
      if (!run) return json({ message: "Import run not found" }, 400);
      if (run.state === "committed") {
        return json({
          already_committed: true,
          created_provider_ids: run.created_provider_ids ?? [],
          updated_provider_ids: run.updated_provider_ids ?? [],
        });
      }
      const plan = body.p_plan as {
        creates?: Array<Record<string, unknown>>;
        updates?: Array<Record<string, unknown>>;
      };
      const created: string[] = [];
      const updated: string[] = [];
      for (const c of plan.creates ?? []) {
        const pid = `imp-prov-${seq++}`;
        const p = c.provider as Record<string, string | null>;
        const groupIds = (c.group_ids as string[]) ?? [];
        fixtures.providers.push(
          provider({
            id: pid,
            first_name: p.first_name,
            last_name: p.last_name,
            middle_initial: p.middle_initial,
            npi: p.npi,
            caqh_id: p.caqh_id,
            specialty: p.specialty,
            taxonomy_code: p.taxonomy_code,
            ssn_last4: p.ssn_last4,
            date_of_birth: p.date_of_birth,
            group_id: groupIds[0] ?? null,
            status: "onboarding",
            verification_state: "pending_verification",
          }),
        );
        created.push(pid);
        groupIds.forEach((gid, i) =>
          fixtures.provider_group_assignments.push({
            id: `imp-pga-${seq++}`,
            org_id: ORG_ID,
            provider_id: pid,
            group_id: gid,
            is_primary: i === 0,
            start_date: null,
            end_date: null,
            created_at: NOW,
          }),
        );
        ((c.facility_ids as string[]) ?? []).forEach((fid) =>
          fixtures.provider_facility_assignments.push({
            id: `imp-pfa-${seq++}`,
            org_id: ORG_ID,
            provider_id: pid,
            facility_id: fid,
            is_primary: false,
            start_date: NOW.slice(0, 10),
            created_at: NOW,
          }),
        );
        ((c.licenses as Array<Record<string, string | null>>) ?? []).forEach((l) =>
          fixtures.state_licenses.push(
            license(`imp-lic-${seq++}`, pid, (l.state ?? "").toUpperCase(), l.license_number ?? ""),
          ),
        );
        fixtures.audit_log.push({
          org_id: ORG_ID,
          user_id: USER_ID,
          action_type: "CREATE",
          entity_type: "provider",
          entity_id: pid,
          after: { id: pid, importRunId: run.id, verificationState: "pending_verification" },
          description: "Provider created from roster import (pending verification)",
        });
      }
      for (const u of plan.updates ?? []) {
        const pid = u.provider_id as string;
        if (!updated.includes(pid)) updated.push(pid);
        const target = fixtures.providers.find((p) => p.id === pid);
        const set = (u.set as Record<string, string>) ?? {};
        if (target) Object.assign(target, set);
        ((u.add_group_ids as string[]) ?? []).forEach((gid) =>
          fixtures.provider_group_assignments.push({
            id: `imp-pga-${seq++}`,
            org_id: ORG_ID,
            provider_id: pid,
            group_id: gid,
            is_primary: false,
            start_date: null,
            end_date: null,
            created_at: NOW,
          }),
        );
        ((u.add_facility_ids as string[]) ?? []).forEach((fid) =>
          fixtures.provider_facility_assignments.push({
            id: `imp-pfa-${seq++}`,
            org_id: ORG_ID,
            provider_id: pid,
            facility_id: fid,
            is_primary: false,
            start_date: NOW.slice(0, 10),
            created_at: NOW,
          }),
        );
        fixtures.audit_log.push({
          org_id: ORG_ID,
          user_id: USER_ID,
          action_type: "UPDATE",
          entity_type: "provider",
          entity_id: pid,
          after: { id: pid, importRunId: run.id },
          description: "Provider updated from roster import",
        });
      }
      fixtures.audit_log.push({
        org_id: ORG_ID,
        user_id: USER_ID,
        action_type: "UPDATE",
        entity_type: "import_run",
        entity_id: run.id,
        after: { id: run.id, created: created.length, updated: updated.length },
        description: "Roster import run committed",
      });
      run.state = "committed";
      run.committed_at = NOW;
      run.created_provider_ids = created;
      run.updated_provider_ids = updated;
      fixtures.import_rows = fixtures.import_rows.filter((r) => r.run_id !== run.id);
      return json({
        already_committed: false,
        created: created.length,
        updated: updated.length,
        created_provider_ids: created,
        updated_provider_ids: updated,
      });
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

    const matchFilters = (row: Record<string, unknown>): boolean => {
      for (const [key, raw] of url.searchParams.entries()) {
        if (["select", "order", "limit", "offset", "or"].includes(key)) continue;
        if (!(key in row)) continue;
        if (raw.startsWith("eq.")) {
          if (String(row[key]) !== raw.slice(3)) return false;
        } else if (raw.startsWith("neq.")) {
          if (String(row[key]) === raw.slice(4)) return false;
        } else if (raw.startsWith("in.(")) {
          const ids = raw
            .slice(4, -1)
            .split(",")
            .map((s) => s.replace(/^"|"$/g, ""));
          if (!ids.includes(String(row[key]))) return false;
        }
      }
      return true;
    };

    if (req.method() === "POST") {
      wire.writes.push({ table, method: "POST" });
      const body = JSON.parse(req.postData() ?? "[]") as
        Record<string, unknown> | Record<string, unknown>[];
      const rows = Array.isArray(body) ? body : [body];
      if (table === "audit_log") {
        fixtures.audit_log.push(...rows);
        return json(null, 201);
      }
      const created = rows.map((r) => ({ id: `row-${seq++}`, created_at: NOW, ...r }));
      fixtures[table] = [...(fixtures[table] ?? []), ...created];
      return json(wantsObject ? created[0] : created, 201);
    }
    if (req.method() === "PATCH") {
      wire.writes.push({ table, method: "PATCH" });
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      const targets = (fixtures[table] ?? []).filter(matchFilters);
      for (const t of targets) Object.assign(t, body);
      return json(wantsObject ? (targets[0] ?? {}) : targets);
    }
    if (req.method() === "DELETE") {
      wire.writes.push({ table, method: "DELETE" });
      const rows = fixtures[table] ?? [];
      const removed = rows.filter(matchFilters);
      fixtures[table] = rows.filter((r) => !removed.includes(r));
      return json(removed);
    }

    const rows = (fixtures[table] ?? []).filter(matchFilters);
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  };
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

/* --------------------------------- TS-61 --------------------------------- */

test("TS-61: preview summary + five-part dedupe (create / skip / multi-group update); nothing live before commit", async ({
  context,
  page,
}) => {
  const fixtures = baseFixtures();
  const wire: WireLog = { writes: [], commitCalls: [] };
  fixtures.providers = [
    provider({
      id: JANE_ID,
      first_name: "Jane",
      last_name: "Shelby",
      npi: "1234567890",
      group_id: G1,
    }),
    provider({
      id: BROOKE_ID,
      first_name: "Brooke",
      last_name: "Ostrander",
      npi: "9990001111",
      group_id: G1,
    }),
  ];
  fixtures.provider_groups = [
    group(G1, "Shelby Group 1", "111111111"),
    group(G2, "Shelby Group 2", "222222222"),
  ];
  fixtures.facilities = [facility(F1, "Clinic North", G1), facility(F2, "Clinic South", G2)];
  fixtures.provider_group_assignments = [
    {
      id: "pga-1",
      org_id: ORG_ID,
      provider_id: JANE_ID,
      group_id: G1,
      is_primary: true,
      start_date: null,
      end_date: null,
      created_at: NOW,
    },
    {
      id: "pga-2",
      org_id: ORG_ID,
      provider_id: BROOKE_ID,
      group_id: G1,
      is_primary: true,
      start_date: null,
      end_date: null,
      created_at: NOW,
    },
  ];
  fixtures.provider_facility_assignments = [
    {
      id: "pfa-1",
      org_id: ORG_ID,
      provider_id: JANE_ID,
      facility_id: F1,
      is_primary: true,
      start_date: "2024-01-01",
      created_at: NOW,
    },
    {
      id: "pfa-2",
      org_id: ORG_ID,
      provider_id: BROOKE_ID,
      facility_id: F1,
      is_primary: true,
      start_date: "2024-01-01",
      created_at: NOW,
    },
  ];
  fixtures.state_licenses = [
    license(JANE_LIC, JANE_ID, "NC", "NC-100"),
    license(BROOKE_LIC, BROOKE_ID, "SC", "SC-50"),
  ];
  fixtures.import_runs = [readyRun()];
  fixtures.import_rows = [
    // new provider
    stagedRow(2, {
      group_name: "Shelby Group 1",
      group_tin: "111111111",
      provider_first_name: "Nora",
      provider_last_name: "Newton",
      npi: "1112223334",
      specialty: "Physical Therapy",
      facility_name: "Clinic North",
      license_state: "NC",
      license_number: "NC-200",
      license_expiration_date: "2028-06-01",
    }),
    // exact five-part duplicate → skip
    stagedRow(3, {
      group_name: "Shelby Group 1",
      group_tin: "111111111",
      provider_first_name: "Brooke",
      provider_last_name: "Ostrander",
      npi: "9990001111",
      facility_name: "Clinic North",
      license_state: "SC",
      license_number: "SC-50",
    }),
    // Jane under a second group/facility → update proposing assignments
    stagedRow(4, {
      group_name: "Shelby Group 2",
      group_tin: "222222222",
      provider_first_name: "Jane",
      provider_last_name: "Shelby",
      npi: "1234567890",
      facility_name: "Clinic South",
    }),
  ];

  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures, wire));
  await seedAuth(context);

  await page.goto(`/import/${RUN_ID}`);
  await expect(page.getByRole("heading", { name: "Review import" })).toBeVisible({
    timeout: 30000,
  });

  // Summary reconciles exactly with the staged rows. The drill-down button
  // names encode the exact counts (create 1 / update 1 / skip 1); blocked 0.
  await expect(page.getByText("New providers to create")).toBeVisible();
  await expect(page.getByText("Existing providers to update")).toBeVisible();
  await expect(page.getByText("Rows with blocked errors")).toBeVisible();
  await expect(page.getByText("1 exact duplicate")).toBeVisible();
  await expect(page.getByText("Counts reconcile with the 3 staged rows.")).toBeVisible();

  // Drill down: exactly one NEW provider (Nora) — no second Jane record.
  await page.getByRole("button", { name: /New providers \(1\)/ }).click();
  await expect(page.getByText("Nora Newton")).toBeVisible();
  await expect(page.getByText("Jane Shelby")).toHaveCount(0);

  // The update proposes Jane's new group + facility assignment.
  await page.getByRole("button", { name: /Updates & conflict review \(1\)/ }).click();
  await expect(page.getByText(/Jane Shelby/)).toBeVisible();
  await expect(
    page.getByText(/proposes 1 group assignment\(s\), 1 facility assignment\(s\)/),
  ).toBeVisible();

  // Skip drilldown: Brooke, already exists.
  await page.getByRole("button", { name: /Skipped \(already exists\) \(1\)/ }).click();
  await expect(page.getByText(/Brooke Ostrander — already exists/)).toBeVisible();

  // NOTHING has been written to live tables just by previewing.
  expect(wire.writes.filter((w) => LIVE_TABLES.includes(w.table))).toHaveLength(0);
  expect(wire.commitCalls).toHaveLength(0);
});

/* --------------------------------- TS-62 --------------------------------- */

test("TS-62: per-field conflict review blocks only its row; resolve + commit → Pending Verification + audit", async ({
  context,
  page,
}) => {
  const fixtures = baseFixtures();
  const wire: WireLog = { writes: [], commitCalls: [] };
  fixtures.providers = [
    provider({
      id: JANE_ID,
      first_name: "Jane",
      last_name: "Shelby",
      npi: "1234567890",
      specialty: "Physical Therapy",
      group_id: G1,
    }),
  ];
  fixtures.provider_groups = [group(G1, "Shelby Group 1", "111111111")];
  fixtures.facilities = [facility(F1, "Clinic North", G1)];
  fixtures.provider_group_assignments = [
    {
      id: "pga-1",
      org_id: ORG_ID,
      provider_id: JANE_ID,
      group_id: G1,
      is_primary: true,
      start_date: null,
      end_date: null,
      created_at: NOW,
    },
  ];
  fixtures.provider_facility_assignments = [
    {
      id: "pfa-1",
      org_id: ORG_ID,
      provider_id: JANE_ID,
      facility_id: F1,
      is_primary: true,
      start_date: "2024-01-01",
      created_at: NOW,
    },
  ];
  fixtures.state_licenses = [license(JANE_LIC, JANE_ID, "NC", "NC-100")];
  fixtures.import_runs = [readyRun({ total_rows: 2, staged_rows: 2 })];
  fixtures.import_rows = [
    // clean new provider — must stay committable while Jane's row is blocked
    stagedRow(2, {
      group_name: "Shelby Group 1",
      group_tin: "111111111",
      provider_first_name: "Nora",
      provider_last_name: "Newton",
      npi: "1112223334",
      specialty: "Physical Therapy",
      facility_name: "Clinic North",
    }),
    // Jane with a conflicting specialty (name+NPI match, same group/facility)
    stagedRow(3, {
      group_name: "Shelby Group 1",
      group_tin: "111111111",
      provider_first_name: "Jane",
      provider_last_name: "Shelby",
      npi: "1234567890",
      specialty: "Occupational Therapy",
      facility_name: "Clinic North",
    }),
  ];

  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures, wire));
  await seedAuth(context);

  await page.goto(`/import/${RUN_ID}`);
  await expect(page.getByRole("heading", { name: "Review import" })).toBeVisible({
    timeout: 30000,
  });

  // The conflicted row starts blocked (unresolved); the clean create is still committable.
  await page.getByRole("button", { name: /Updates & conflict review \(1\)/ }).click();
  await expect(page.getByText("1 unresolved conflict")).toBeVisible();
  // Both values shown side-by-side, existing default; specialty conflict.
  await expect(page.getByText("Physical Therapy")).toBeVisible();
  await expect(page.getByText("Occupational Therapy")).toBeVisible();

  // Resolve the conflict by keeping the existing value (explicit pick).
  await page
    .getByRole("button", { name: /Keep existing/ })
    .first()
    .click();
  await expect(page.getByText("conflicts resolved")).toBeVisible();

  // Commit (with the finality confirm step).
  await page.getByRole("button", { name: "Commit Changes" }).click();
  await page.getByRole("button", { name: "Yes, commit changes" }).click();

  // The committed view renders (the batch panel is committed-only); the RPC
  // ran once with the reviewed plan.
  await expect(page.getByText("Batch assignment")).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("1 provider created · 1 updated", { exact: true })).toBeVisible();
  expect(wire.commitCalls).toHaveLength(1);
  const plan = wire.commitCalls[0].p_plan as {
    creates: unknown[];
    updates: Array<{ provider_id: string; set: Record<string, string> }>;
  };
  expect(plan.creates).toHaveLength(1);
  expect(plan.updates).toHaveLength(1);
  // "Keep existing" → the resolved update carries NO overwrite in `set`.
  expect(plan.updates[0].set).toEqual({});

  // Nora landed Pending Verification; Jane's specialty was NOT overwritten.
  const nora = fixtures.providers.find((p) => p.npi === "1112223334");
  expect(nora?.verification_state).toBe("pending_verification");
  expect(fixtures.providers.find((p) => p.id === JANE_ID)?.specialty).toBe("Physical Therapy");

  // Run-level + per-entity audit rows exist; staged rows purged.
  const audit = fixtures.audit_log;
  expect(
    audit.some(
      (a) => a.entity_type === "import_run" && a.description === "Roster import run committed",
    ),
  ).toBe(true);
  expect(audit.some((a) => a.entity_type === "provider" && a.action_type === "CREATE")).toBe(true);
  expect(fixtures.import_rows.filter((r) => r.run_id === RUN_ID)).toHaveLength(0);

  // The Pending Verification pill shows on the wizard roster.
  await page.goto("/onboarding/wizard");
  const rosterCard = page.locator("#wizard-providers");
  await expect(rosterCard).toBeVisible({ timeout: 30000 });
  await expect(rosterCard.getByText("Nora Newton")).toBeVisible();
  await expect(rosterCard.getByText("Pending verification").first()).toBeVisible();
});

/* --------------------------------- TS-63 --------------------------------- */

test("TS-63: pending-verification providers are fenced out of generation until verified", async ({
  context,
  page,
}) => {
  const fixtures = baseFixtures();
  const wire: WireLog = { writes: [], commitCalls: [] };
  // One provider that WOULD be a generation candidate (active target × group
  // membership × facility assignment) — but it is pending_verification.
  const PROV = "aaaaaaa1-0000-4000-8000-0000000000ff";
  fixtures.providers = [
    provider({
      id: PROV,
      first_name: "Pending",
      last_name: "Provider",
      npi: "1230000009",
      group_id: G1,
      status: "onboarding",
      verification_state: "pending_verification",
    }),
  ];
  fixtures.provider_groups = [group(G1, "Shelby Group 1", "111111111")];
  fixtures.facilities = [facility(F1, "Clinic North", G1)];
  fixtures.provider_group_assignments = [
    {
      id: "pga-1",
      org_id: ORG_ID,
      provider_id: PROV,
      group_id: G1,
      is_primary: true,
      start_date: null,
      end_date: null,
      created_at: NOW,
    },
  ];
  fixtures.provider_facility_assignments = [
    {
      id: "pfa-1",
      org_id: ORG_ID,
      provider_id: PROV,
      facility_id: F1,
      is_primary: true,
      start_date: "2024-01-01",
      created_at: NOW,
    },
  ];
  fixtures.payers = [
    { id: PAYER, org_id: ORG_ID, name: "Aetna", status: "active", created_at: NOW },
  ];
  fixtures.org_payer_assignments = [
    { id: "opa-1", org_id: ORG_ID, payer_id: PAYER, starter: false, created_at: NOW },
  ];
  fixtures.payer_network_targets = [
    {
      id: TARGET,
      org_id: ORG_ID,
      group_id: G1,
      payer_id: PAYER,
      state: "NC",
      status: "active",
      created_at: NOW,
    },
  ];

  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures, wire));
  await seedAuth(context);

  // The fence's visible surface: the shared readiness-facts read is observed
  // on the PROVIDER RECORD's Readiness section (2026-07-21 relocation of the
  // wizard Scope Review; same fenced provider universe — TE-2's single
  // fence). The pending provider yields NO readiness row — its own record
  // renders the empty derive explainer, never the Aetna target.
  await page.goto(`/providers/${PROV}`);
  // 2026-07-21 tabbed record: Readiness lives on the Cases tab.
  await page.getByRole("tab", { name: "Cases" }).click();
  const readinessCard = page.locator("#readiness");
  await expect(readinessCard).toBeVisible({ timeout: 30000 });
  await expect(readinessCard.getByText("Aetna")).toHaveCount(0);

  // Verify the provider on the wizard roster.
  await page.goto("/onboarding/wizard");
  const rosterCard = page.locator("#wizard-providers");
  await expect(rosterCard).toBeVisible({ timeout: 30000 });
  await expect(rosterCard.getByText("Pending verification").first()).toBeVisible();
  await rosterCard.getByRole("button", { name: "Verify", exact: true }).first().click();
  await expect(rosterCard.getByText("Pending verification")).toHaveCount(0, { timeout: 15000 });

  // Now the same provider IS in the fenced universe — the readiness matrix
  // gains the row on a fresh derivation, proving the single fence lifted on
  // verify (generation candidacy consumes the SAME read — E6.3's grid).
  await page.goto(`/providers/${PROV}`);
  await page.getByRole("tab", { name: "Cases" }).click();
  await expect(readinessCard.getByText("Aetna").first()).toBeVisible({ timeout: 30000 });
});

test("TS-63: one-step batch assignment fills gaps and is idempotent on re-run", async ({
  context,
  page,
}) => {
  const fixtures = baseFixtures();
  const wire: WireLog = { writes: [], commitCalls: [] };
  // A committed run that created two providers, one of which already carried
  // its own group assignment (explicit row data wins).
  const P1 = "aaaaaaa1-0000-4000-8000-0000000000a1";
  const P2 = "aaaaaaa1-0000-4000-8000-0000000000a2";
  fixtures.providers = [
    provider({
      id: P1,
      first_name: "Alpha",
      last_name: "One",
      npi: "1000000001",
      status: "onboarding",
      verification_state: "pending_verification",
      group_id: G1,
    }),
    provider({
      id: P2,
      first_name: "Beta",
      last_name: "Two",
      npi: "1000000002",
      status: "onboarding",
      verification_state: "pending_verification",
    }),
  ];
  fixtures.provider_groups = [
    group(G1, "Shelby Group 1", "111111111"),
    group(G2, "Shelby Group 2", "222222222"),
  ];
  fixtures.facilities = [facility(F1, "Clinic North", G2)];
  // P1 already assigned to G1 (its own CSV columns); P2 has nothing.
  fixtures.provider_group_assignments = [
    {
      id: "pga-1",
      org_id: ORG_ID,
      provider_id: P1,
      group_id: G1,
      is_primary: true,
      start_date: null,
      end_date: null,
      created_at: NOW,
    },
  ];
  fixtures.provider_facility_assignments = [];
  fixtures.import_runs = [
    readyRun({
      state: "committed",
      committed_at: NOW,
      created_provider_ids: [P1, P2],
      updated_provider_ids: [],
      total_rows: 2,
      staged_rows: 0,
      error_rows: 0,
    }),
  ];
  fixtures.import_rows = [];

  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures, wire));
  await seedAuth(context);

  await page.goto(`/import/${RUN_ID}`);
  await expect(page.getByRole("heading", { name: "Review import" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText("Batch assignment")).toBeVisible();

  // Pick the batch group (G2) + facility (F1) and apply.
  await page.getByLabel("Group").click();
  await page.getByRole("option", { name: "Shelby Group 2" }).click();
  await page.getByLabel(/Clinic North/).check();
  await page.getByRole("button", { name: "Assign batch" }).click();
  await expect(page.getByText(/group \+ .*facility link/)).toBeVisible({ timeout: 15000 });

  // P1 kept its own G1 (explicit wins) — only P2 got the batch G2; both got
  // the batch facility.
  const g2Rows = fixtures.provider_group_assignments.filter((a) => a.group_id === G2);
  expect(g2Rows).toHaveLength(1);
  expect(g2Rows[0].provider_id).toBe(P2);
  expect(fixtures.provider_facility_assignments.filter((a) => a.facility_id === F1)).toHaveLength(
    2,
  );

  const groupCountAfterFirst = fixtures.provider_group_assignments.length;
  const facilityCountAfterFirst = fixtures.provider_facility_assignments.length;

  // The recomputed plan (after cache invalidation) now finds no gaps.
  await expect(page.getByText("0 new assignments will be created.")).toBeVisible({
    timeout: 15000,
  });

  // Re-run the identical batch — idempotent: no new assignments (the DB
  // uniques + the gap-only plan). Assert the re-run toast's unique 0-group/
  // 0-facility text rather than the shared "already assigned" phrase: the
  // first-run toast also carries that phrase and can still be on screen,
  // tripping strict mode. The 0 + 0 counts prove nothing new was assigned.
  await page.getByRole("button", { name: "Assign batch" }).click();
  await expect(page.getByText(/Assigned 0 group \+ 0 facility link\(s\)/)).toBeVisible({
    timeout: 15000,
  });
  expect(fixtures.provider_group_assignments.length).toBe(groupCountAfterFirst);
  expect(fixtures.provider_facility_assignments.length).toBe(facilityCountAfterFirst);
});
