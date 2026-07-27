// E6.2 F6.2.3/F6.2.5 — TS-109 (board derivations: Targeted / In Progress /
// Active, drill-down with denial history, the candidates buffer + cause,
// excluded rows with Restore), TS-113's E6.2 slice (facts count Active with
// zero cases, suppress candidates; an EXPIRED fact re-opens the candidate),
// TS-122 (multi-group honesty: the same payer on two groups derives two
// honest boards) and TS-124 (remove = archive, re-attach restores without
// duplicates). Everything on the board is DERIVED — the harness records every
// write so the derive-only posture is pinned at the wire.
import { test, expect, type Route } from "@playwright/test";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "88888888-8888-4888-8888-888888888888";

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

const GROUP = {
  id: "g-ob",
  org_id: ORG_ID,
  name: "Outer Banks Rehab Group LLC",
  tin: "123456789",
  npi_type2: null,
  states: ["NC"],
  is_active: true,
  created_at: "2026-06-01T00:00:00Z",
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

const target = (payerId: string, over: Record<string, unknown> = {}) => ({
  id: `t-${payerId}`,
  org_id: ORG_ID,
  payer_id: payerId,
  group_id: "g-ob",
  state: "NC",
  status: "active",
  created_at: "2026-06-15T00:00:00Z",
  ...over,
});

const caseRow = (id: string, payerId: string, over: Record<string, unknown> = {}) => ({
  id,
  org_id: ORG_ID,
  provider_id: "pr-1",
  payer_id: payerId,
  state: "NC",
  group_id: "g-ob",
  facility_id: null,
  mso_id: null,
  credentialing_status_id: null,
  case_status: "in_progress",
  contract_executed_date: null,
  assigned_to: null,
  submitted_date: null,
  approved_date: null,
  confirmed_effective_date: null,
  expected_effective_date: null,
  termination_date: null,
  generation_run_id: null,
  payer_reference_id: null,
  payer_pipeline_state: "not_started",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  ...over,
});

function baseFixtures(): Record<string, Record<string, unknown>[]> {
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
    provider_groups: [GROUP],
    facilities: [
      {
        id: "f-ob",
        org_id: ORG_ID,
        group_id: "g-ob",
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
    providers: [],
    provider_group_assignments: [],
    provider_facility_assignments: [],
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
    payer_network_targets: Object.keys(PAYER_NAMES).map((id) => target(id)),
    case_generation_exclusions: [],
    enrollment_facts: [],
    credential_cases: [],
    case_status_history: [],
    denial_reason_codes: [],
    contracts: [],
    tasks: [],
    status_configs: [],
    sop_templates: [],
    provider_documents: [],
    group_insurance_policies: [],
    import_runs: [],
    import_rows: [],
    notes: [],
    user_table_prefs: [],
    audit_log: [],
    touches: [],
  };
}

// The TS-109/TS-113 working state: Brooke on the group's clinic; live facts
// for Aetna + BCBS-NC; an EXPIRED Cigna fact (re-opened candidate); Humana
// approved; Medcost denied with a reasoned history entry; UnitedHealthcare
// excluded. Candidates = 7 targets − 2 live facts − 2 cases − 1 exclusion = 2.
function workingFixtures(): Record<string, Record<string, unknown>[]> {
  const f = baseFixtures();
  f.providers = [
    {
      id: "pr-1",
      org_id: ORG_ID,
      first_name: "Brooke",
      last_name: "Ostrander",
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
    },
  ];
  f.provider_group_assignments = [
    {
      id: "ga-1",
      org_id: ORG_ID,
      provider_id: "pr-1",
      group_id: "g-ob",
      is_primary: true,
      start_date: "2026-06-01",
      end_date: null,
      created_at: "2026-06-01T00:00:00Z",
    },
  ];
  f.provider_facility_assignments = [
    {
      id: "fa-1",
      org_id: ORG_ID,
      provider_id: "pr-1",
      facility_id: "f-ob",
      is_primary: true,
      start_date: "2026-06-01",
      created_at: "2026-06-01T00:00:00Z",
    },
  ];
  f.enrollment_facts = [
    {
      id: "ef-1",
      org_id: ORG_ID,
      provider_id: "pr-1",
      group_id: "g-ob",
      payer_id: "p1",
      state: "NC",
      effective_date: "2025-03-01",
      source: "migration",
      expired_at: null,
      expired_by: null,
      created_by: USER_ID,
      created_at: "2026-06-20T00:00:00Z",
    },
    {
      id: "ef-2",
      org_id: ORG_ID,
      provider_id: "pr-1",
      group_id: "g-ob",
      payer_id: "p2",
      state: "NC",
      effective_date: null,
      source: "migration",
      expired_at: null,
      expired_by: null,
      created_by: USER_ID,
      created_at: "2026-06-20T00:00:00Z",
    },
    {
      // Expired — suppresses nothing; its expiry is the buffer's newest cause.
      id: "ef-3",
      org_id: ORG_ID,
      provider_id: "pr-1",
      group_id: "g-ob",
      payer_id: "p3",
      state: "NC",
      effective_date: "2024-01-01",
      source: "migration",
      expired_at: "2026-07-18T09:00:00Z",
      expired_by: USER_ID,
      created_by: USER_ID,
      created_at: "2026-06-20T00:00:00Z",
    },
  ];
  f.credential_cases = [
    caseRow("c-appr", "p4", { case_status: "approved", approved_date: "2026-07-10" }),
    caseRow("c-den", "p5", { case_status: "denied" }),
  ];
  f.case_status_history = [
    {
      id: "h-1",
      org_id: ORG_ID,
      case_id: "c-den",
      from_status: "submitted",
      to_status: "denied",
      actor_kind: "user",
      reason_code_id: "rc-1",
      evidence_touch_id: null,
      is_correction: false,
      note: null,
      changed_by: USER_ID,
      changed_at: "2026-07-10T00:00:00Z",
    },
  ];
  f.denial_reason_codes = [
    {
      id: "rc-1",
      org_id: null,
      code: "panel_closed",
      label: "Panel closed",
      active: true,
      created_at: "2026-06-01T00:00:00Z",
    },
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
  body: Record<string, unknown> | null;
}

function makeHandler(fixtures: Record<string, Record<string, unknown>[]>) {
  const writes: RecordedWrite[] = [];
  let seq = 0;
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.endsWith("/rpc/list_global_payers")) {
      return json(fixtures.payers.filter((p) => p.org_id === null));
    }
    if (url.pathname.endsWith("/rpc/archive_org_payer_assignment")) {
      // The E4.2 atomic archive: flip the assignment + the payer's active
      // targets in one transaction (write-through mirror).
      const body = (req.postDataJSON() ?? {}) as { p_payer_id?: string };
      writes.push({ method: "RPC", path: "archive_org_payer_assignment", body });
      const assignment = fixtures.org_payer_assignments.find((a) => a.payer_id === body.p_payer_id);
      if (assignment) {
        assignment.status = "archived";
        assignment.archived_at = "2026-07-19T00:00:00Z";
      }
      let archived = 0;
      for (const t of fixtures.payer_network_targets) {
        if (t.payer_id === body.p_payer_id && t.status === "active") {
          t.status = "archived";
          archived += 1;
        }
      }
      return json({ assignment: assignment ?? null, archived_target_count: archived });
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

    // supabase-js `count: "exact", head: true` issues a HEAD request — the
    // remove-payer flow counts remaining active targets through it.
    if (req.method() === "HEAD") {
      const n = (fixtures[table] ?? []).filter((r) => matchFilters(r)).length;
      return route.fulfill({
        status: 200,
        headers: { "content-range": `*/${n}` },
        body: "",
      });
    }

    if (req.method() === "POST") {
      let body: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = req.postDataJSON();
        body = Array.isArray(parsed)
          ? ((parsed[0] ?? null) as Record<string, unknown> | null)
          : (parsed as Record<string, unknown> | null);
      } catch {
        body = null;
      }
      writes.push({ method: "POST", path: table, body });
      const row = { id: `new-${(seq += 1)}`, created_at: "2026-07-19T00:00:00Z", ...(body ?? {}) };
      if (fixtures[table]) fixtures[table].push(row);
      return json(wantsObject ? row : [row], 201);
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
      if (wantsObject) {
        if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
        return json(rows[0]);
      }
      return json(rows);
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

function seedAuth(
  context: {
    addInitScript: (fn: (args: unknown[]) => void, args: unknown[]) => Promise<void>;
  },
  orgId = ORG_ID,
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

test("TS-109 day 1: 7 targets, zero providers → 7 Targeted rows, 7-of-7 accounting, honest zero buffer", async ({
  context,
  page,
}) => {
  const { handler, writes } = makeHandler(baseFixtures());
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/groups/g-ob/payer-network");
  await expect(page.getByRole("heading", { name: "Payer Network" })).toBeVisible({
    timeout: 30000,
  });

  await expect(page.getByText("7 of 7 targeted payers accounted for.")).toBeVisible();
  await expect(page.getByText("Targeted", { exact: true })).toHaveCount(7);
  await expect(page.getByText(/No providers yet — add providers to create casework/)).toBeVisible();
  await expect(page.getByText(/\d+ candidates? awaiting generation/)).toHaveCount(0);

  // The board records the target state with ZERO writes — fully derived.
  expect(writes.filter((w) => w.method !== "HEAD")).toHaveLength(0);
});

test("TS-109/TS-113: facts flip rows Active with zero cases, the expired fact re-opens its candidate, denial history shows beneath the case, the buffer names its cause", async ({
  context,
  page,
}) => {
  const { handler, writes } = makeHandler(workingFixtures());
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/groups/g-ob/payer-network");
  await expect(page.getByText("7 of 7 targeted payers accounted for.")).toBeVisible({
    timeout: 30000,
  });

  // Facts → Active with zero cases (TS-113); the dated fact carries "since".
  const aetna = page.locator("li", { hasText: "Aetna" }).first();
  await expect(aetna.getByText("Active", { exact: true })).toBeVisible();
  await expect(aetna.getByText("1 enrolled by fact")).toBeVisible();
  await expect(aetna.getByText("since Mar 1, 2025")).toBeVisible();

  // Approved case → Active since its approval date; open-case count absent.
  const humana = page.locator("li", { hasText: "Humana" }).first();
  await expect(humana.getByText("Active", { exact: true })).toBeVisible();
  await expect(humana.getByText("since Jul 10, 2026")).toBeVisible();

  // Denied-only pair: Targeted + the denial marker; drill-down keeps the
  // reasoned denial beneath the case (the reapply story stays visible).
  const medcost = page.locator("li", { hasText: "Medcost" }).first();
  await expect(medcost.getByText("Denial on file")).toBeVisible();
  await medcost.getByRole("button", { name: /Show providers for Medcost/ }).click();
  await expect(medcost.getByText("Brooke Ostrander")).toBeVisible();
  await expect(medcost.getByText(/Denied — Panel closed, Jul 10, 2026/)).toBeVisible();

  // The Cigna fact is EXPIRED: the row is NOT Active and its combination is
  // back in the buffer — the banner counts 2 (Cigna + Optum) and names the
  // expiry as the most recent cause (F6.2.5: expiry reverses, immediately).
  const cigna = page.locator("li", { hasText: "Cigna" }).first();
  await expect(cigna.getByText("Targeted", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/2 candidates awaiting generation — Cigna enrollment fact expired/),
  ).toBeVisible();

  // E6.3 — Generate cases is LIVE: the banner enters the ONE shared grid
  // scoped to this group.
  await expect(page.getByRole("link", { name: "Generate cases" }).first()).toHaveAttribute(
    "href",
    /\/generation\?group=g-ob/,
  );

  // Drill-down cells: enrolled-by-fact and awaiting-generation are explicit.
  await aetna.getByRole("button", { name: /Show providers for Aetna/ }).click();
  await expect(aetna.getByText(/Enrolled \(fact\) — effective Mar 1, 2025/)).toBeVisible();
  const optum = page.locator("li", { hasText: "Optum" }).first();
  await optum.getByRole("button", { name: /Show providers for Optum/ }).click();
  await expect(optum.getByText("Awaiting generation")).toBeVisible();

  // Reading the board wrote NOTHING (no board-side writes, ever).
  expect(writes.filter((w) => w.method === "POST" || w.method === "PATCH")).toHaveLength(0);
});

test("TS-109: excluded combinations stay visible with reason and restore in one click, re-opening the candidate", async ({
  context,
  page,
}) => {
  const { handler, writes } = makeHandler(workingFixtures());
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/groups/g-ob/payer-network");
  const united = page.locator("li", { hasText: "UnitedHealthcare" }).first();
  await expect(united.getByText(/Excluded: Brooke Ostrander · NC — Panel closed/)).toBeVisible({
    timeout: 30000,
  });

  await united.getByRole("button", { name: "Restore" }).click();
  await expect
    .poll(
      () =>
        writes.filter((w) => w.method === "PATCH" && w.path === "case_generation_exclusions")
          .length,
      { timeout: 15000 },
    )
    .toBeGreaterThan(0);
  const patch = writes.find((w) => w.method === "PATCH" && w.path === "case_generation_exclusions");
  expect(patch?.body?.status).toBe("voided");

  // The restored combination re-enters the buffer on re-derivation: 3 now.
  await expect(page.getByText(/3 candidates awaiting generation/)).toBeVisible({
    timeout: 15000,
  });
});

test("TS-124: removing a payer ARCHIVES its targets (never deletes); re-attach restores them without duplicates", async ({
  context,
  page,
}) => {
  const fixtures = baseFixtures();
  // One payer is enough for the removal cycle.
  fixtures.payer_network_targets = [target("p1")];
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/groups/g-ob/payer-network");
  await expect(page.getByText("1 of 1 targeted payer accounted for.")).toBeVisible({
    timeout: 30000,
  });

  // Remove: archive this group's targets, then the implicit org enablement
  // (no other group works the payer) — never a DELETE anywhere.
  await page.getByRole("button", { name: "Remove payer" }).click();
  await page.getByRole("button", { name: "Remove payer" }).last().click();
  await expect(page.getByText("No payers targeted yet.")).toBeVisible({ timeout: 15000 });
  const targetPatch = writes.find(
    (w) => w.method === "PATCH" && w.path === "payer_network_targets",
  );
  expect(targetPatch?.body?.status).toBe("archived");
  expect(
    writes.find((w) => w.method === "RPC" && w.path === "archive_org_payer_assignment"),
  ).toBeTruthy();
  expect(writes.filter((w) => w.method === "DELETE")).toHaveLength(0);
  expect(fixtures.payer_network_targets).toHaveLength(1); // the row survives, archived

  // Re-attach: the archived state row arrives pre-unchecked; checking it
  // RESTORES the same row — no duplicate insert under the unique key.
  await page.getByRole("button", { name: "Attach payer", exact: true }).click();
  await page.getByRole("button", { name: /Aetna/ }).click();
  await expect(page.getByRole("cell", { name: "Archived" })).toBeVisible();
  await page.getByLabel("Target NC").check();
  await page.getByRole("button", { name: "Save targets" }).click();
  await expect(page.getByText("Aetna attached")).toBeVisible({ timeout: 15000 });

  expect(
    writes.filter((w) => w.method === "POST" && w.path === "payer_network_targets"),
  ).toHaveLength(0);
  const restore = writes.filter(
    (w) =>
      w.method === "PATCH" && w.path === "payer_network_targets" && w.body?.status === "active",
  );
  expect(restore.length).toBeGreaterThan(0);
  await expect(page.getByText("1 of 1 targeted payer accounted for.")).toBeVisible({
    timeout: 15000,
  });
});

test("TS-122: the same payer on two groups derives two honest boards — no org-level conflation", async ({
  context,
  page,
}) => {
  const fixtures = baseFixtures();
  fixtures.provider_groups = [
    { ...GROUP, id: "g-1", name: "Shelby Group One LLC" },
    { ...GROUP, id: "g-2", name: "Shelby Group Two LLC", tin: "987654321" },
  ];
  fixtures.payer_network_targets = [
    target("p1", { id: "t-g1", group_id: "g-1" }),
    target("p1", { id: "t-g2", group_id: "g-2" }),
  ];
  fixtures.credential_cases = [
    caseRow("c-g1", "p1", {
      group_id: "g-1",
      case_status: "approved",
      approved_date: "2026-07-01",
    }),
    caseRow("c-g2", "p1", { group_id: "g-2", case_status: "in_progress" }),
  ];
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/groups/g-1/payer-network");
  const rowG1 = page.locator("li", { hasText: "Aetna" }).first();
  await expect(rowG1.getByText("Active", { exact: true })).toBeVisible({ timeout: 30000 });

  await page.goto("/groups/g-2/payer-network");
  const rowG2 = page.locator("li", { hasText: "Aetna" }).first();
  await expect(rowG2.getByText("In Progress", { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(rowG2.getByText("1 open case")).toBeVisible();
  await expect(rowG2.getByText("Active", { exact: true })).toHaveCount(0);
});

test("2026-07-20 re-scope: the payer-issued GROUP ID is captured on the payer entry per state — a PATCH on the target row, coexisting with provider-level IDs", async ({
  context,
  page,
}) => {
  const fixtures = baseFixtures();
  // Two states so the dialog shows the per-state grain; one pre-set ID so the
  // display chip and the edit prefill are both covered.
  fixtures.payer_network_targets = [
    target("p1"),
    target("p1", { id: "t-p1-sc", state: "SC", payer_issued_id: "GRP-SC-777" }),
  ];
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/groups/g-ob/payer-network");
  const aetna = page.locator("li", { hasText: "Aetna" }).first();
  await expect(aetna).toBeVisible({ timeout: 30000 });

  // The pre-set group ID renders on the payer entry.
  await expect(aetna.getByText(/Group ID: SC GRP-SC-777/)).toBeVisible();

  // Admin sets the NC group ID through the per-state dialog.
  await aetna.getByRole("button", { name: "Edit group IDs" }).click();
  const dialog = page.getByRole("dialog", { name: /Group identifiers — Aetna/ });
  await expect(dialog.getByLabel("SC")).toHaveValue("GRP-SC-777");
  await dialog.getByLabel("NC").fill("GRP-NC-123");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();

  await expect(aetna.getByText(/Group ID: NC GRP-NC-123 · SC GRP-SC-777/)).toBeVisible({
    timeout: 15000,
  });

  // Exactly one PATCH (the unchanged SC row is never rewritten), on the
  // target row itself — the group grain, not any org-wide settings table.
  const idPatches = writes.filter(
    (w) => w.method === "PATCH" && w.path === "payer_network_targets",
  );
  expect(idPatches).toHaveLength(1);
  expect(idPatches[0].body?.payer_issued_id).toBe("GRP-NC-123");
  expect(writes.filter((w) => w.path === "org_payer_settings")).toHaveLength(0);
});

test("Slice D (screen 5): the board derives Awaiting ID from an acked approval — expected + approved + NULL group ID — links the capturing case, and the stored PIN resolves it; a no-group-ID payer reads honestly", async ({
  context,
  page,
}) => {
  const fixtures = baseFixtures();
  // Aetna EXPECTS a group ID under its own wording; Humana issues none (the
  // unconfigured group side defaults to not-expected, mirroring the RPC).
  const aetnaPayer = fixtures.payers.find((p) => p.id === "p1");
  Object.assign(aetnaPayer ?? {}, { group_id_expected: true, group_id_label: "Group PIN" });
  fixtures.payer_network_targets = [target("p1"), target("p4")];
  fixtures.credential_cases = [
    // The E6.8 "Didn't receive" outcome: approved with the group ID NULL.
    caseRow("c-appr", "p1", {
      case_status: "approved",
      approved_date: "2026-07-01",
      payer_group_provider_id: null,
      case_number: 1042,
    }),
    caseRow("c-hum", "p4", {
      case_status: "approved",
      approved_date: "2026-07-02",
      payer_group_provider_id: null,
      case_number: 1043,
    }),
  ];
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/groups/g-ob/payer-network");
  const aetna = page.locator("li", { hasText: "Aetna" }).first();
  await expect(aetna).toBeVisible({ timeout: 30000 });

  // DERIVED, never stored: the amber wait + a link to the capturing case.
  await expect(aetna.getByText("Awaiting ID", { exact: true })).toBeVisible();
  await expect(aetna.getByRole("link", { name: "C-1042" })).toHaveAttribute(
    "href",
    "/cases/c-appr",
  );

  // Humana issues no group ID — honest state, no wait, no case chase.
  const humana = page.locator("li", { hasText: "Humana" }).first();
  await expect(humana.getByText("No group ID issued")).toBeVisible();
  await expect(humana.getByText("Awaiting ID")).toHaveCount(0);

  // Back-fill rides the EXISTING set-later path (the Group-IDs dialog): the
  // stored target PIN resolves the wait by re-derivation — zero case writes.
  await aetna.getByRole("button", { name: "Add group ID" }).click();
  const dialog = page.getByRole("dialog", { name: /Group identifiers — Aetna/ });
  await dialog.getByLabel("NC").fill("GP-448210");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();

  // The chip is worded the payer's way (Group PIN), and the wait is gone.
  await expect(aetna.getByText(/Group PIN: NC GP-448210/)).toBeVisible({ timeout: 15000 });
  await expect(aetna.getByText("Awaiting ID")).toHaveCount(0);
  expect(writes.filter((w) => w.path === "credential_cases")).toHaveLength(0);
});
