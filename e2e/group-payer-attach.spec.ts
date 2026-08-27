// E6.2 F6.2.4 — TS-110: eligibility-filtered attach to the group via the
// picker AND the CSV path. The picker never offers a zero-overlap payer;
// proposed states = payer states ∩ group operating states, user-reviewed.
// OPA-RETIRE: attach writes payer_network_targets only — no
// org_payer_assignments upsert, and no UI surfaces enablement/subscription.
// The CSV rides the staged-import machine: exact-header gate, per-row
// eligibility errors named at scan time, idempotent skip-on-match commit.
import { test, expect, type Page, type Route } from "@playwright/test";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "99999999-9999-4999-8999-999999999999";

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

// Outer Banks operates NC + CO. Aetna covers NC + SC (overlap NC); BCBS-TX
// covers TX only (zero overlap — never offered, named in the explainer).
const GROUP = {
  id: "g-ob",
  org_id: ORG_ID,
  name: "Outer Banks Rehab Group LLC",
  tin: "123456789",
  npi_type2: null,
  states: ["NC", "CO"],
  is_active: true,
  created_at: "2026-06-01T00:00:00Z",
};

const CATALOG = [
  {
    id: "pay-aetna",
    org_id: null,
    name: "Aetna",
    payer_kind: "commercial",
    states: ["NC", "SC"],
    aliases: ["Aetna Health"],
    status: "active",
    payer_slug: "aetna",
    avg_decision_days: null,
    created_at: "2026-06-01T00:00:00Z",
  },
  {
    id: "pay-tx",
    org_id: null,
    name: "BCBS Texas",
    payer_kind: "commercial",
    states: ["TX"],
    aliases: [],
    status: "active",
    payer_slug: "bcbs-tx",
    avg_decision_days: null,
    created_at: "2026-06-01T00:00:00Z",
  },
];

function makeFixtures(): Record<string, Record<string, unknown>[]> {
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
    facilities: [],
    providers: [],
    provider_group_assignments: [],
    provider_facility_assignments: [],
    state_licenses: [],
    payers: [...CATALOG],
    org_payer_assignments: [],
    payer_network_targets: [],
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
    if (url.pathname.endsWith("/rpc/stage_import_rows")) {
      // The E3.0 staging RPC write-through: UNIQUE (run_id, line) resume key
      // + recomputed run counts (the roster-import.spec.ts mirror).
      const body = (req.postDataJSON() ?? {}) as {
        p_run_id: string;
        p_rows: Array<Record<string, unknown>>;
      };
      writes.push({ method: "RPC", path: "stage_import_rows", body });
      const rows = fixtures.import_rows;
      const claimed = new Set(
        rows.filter((r) => r.run_id === body.p_run_id).map((r) => r.line as number),
      );
      for (const e of body.p_rows) {
        const line = e.line as number;
        if (claimed.has(line)) continue;
        claimed.add(line);
        rows.push({
          id: `import-row-${(seq += 1)}`,
          org_id: ORG_ID,
          run_id: body.p_run_id,
          line,
          raw: e.raw,
          mapped: e.mapped,
          row_state: e.row_state,
          error_column: e.error_column,
          error_reason: e.error_reason,
          created_at: "2026-07-19T00:00:00Z",
        });
      }
      const run = fixtures.import_runs.find((r) => r.id === body.p_run_id);
      if (run) {
        const mine = rows.filter((r) => r.run_id === run.id);
        run.staged_rows = mine.filter((r) => r.row_state === "staged").length;
        run.error_rows = mine.filter((r) => r.row_state === "error").length;
      }
      return json(null);
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
      // PostgREST takes a single object OR an array — the multi-select attach
      // sends every payer's new rows as ONE insert, so each row is recorded
      // and stored separately here.
      let bodies: (Record<string, unknown> | null)[] = [null];
      try {
        const parsed: unknown = req.postDataJSON();
        bodies = Array.isArray(parsed)
          ? (parsed as Record<string, unknown>[])
          : [parsed as Record<string, unknown> | null];
      } catch {
        bodies = [null];
      }
      const created = bodies.map((body) => {
        writes.push({ method: "POST", path: table, body });
        const row = {
          id: `new-${(seq += 1)}`,
          created_at: "2026-07-19T00:00:00Z",
          ...(body ?? {}),
        };
        if (fixtures[table]) fixtures[table].push(row);
        return row;
      });
      return json(wantsObject ? created[0] : created, 201);
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
    if (req.method() === "DELETE") {
      writes.push({ method: "DELETE", path: table, body: null });
      if (fixtures[table]) {
        const keep = fixtures[table].filter((r) => !matchFilters(r));
        fixtures[table].length = 0;
        fixtures[table].push(...keep);
      }
      return json([]);
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

const csvFile = (name: string, content: string) => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(content, "utf8"),
});

async function uploadCsv(page: Page, name: string, content: string) {
  await page.locator('input[type="file"]').setInputFiles(csvFile(name, content));
}

test("TS-110: the picker never offers a zero-overlap payer; proposed states = payer ∩ group; enablement is never surfaced", async ({
  context,
  page,
}) => {
  const { handler, writes } = makeHandler(makeFixtures());
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/groups/g-ob/payer-network");
  await page.getByRole("button", { name: "Attach payers", exact: true }).click({ timeout: 30000 });

  // Aetna (overlap NC) is offered; zero-overlap BCBS Texas is NOT — it is
  // named in the ineligible explainer instead.
  await expect(page.getByLabel("Select Aetna")).toBeVisible();
  await expect(page.getByLabel("Select BCBS Texas")).toHaveCount(0);
  await page.getByText(/1 catalog payer doesn't overlap/).click();
  await expect(page.getByText(/BCBS Texas.*none cover NC, CO/)).toBeVisible();

  // Review: proposed states = Aetna (NC, SC) ∩ group (NC, CO) = NC only.
  // Fixture has zero facilities — E6.2 still lists NC, but #277 defaults leave
  // zero-facility states unchecked (Save stays disabled until the human checks).
  await page.getByLabel("Select Aetna").check();
  await page.getByRole("button", { name: "Review states" }).click();
  await expect(page.getByLabel("Target NC for Aetna")).toBeVisible();
  await expect(page.getByText(/No facilities in this state yet/)).toBeVisible();
  await expect(page.getByLabel("Target SC for Aetna")).toHaveCount(0);
  await expect(page.getByLabel("Target CO for Aetna")).toHaveCount(0);
  // Org-level enablement/subscription is never surfaced (OPA-RETIRE).
  await expect(page.getByText(/enablement|subscription|assignment/i)).toHaveCount(0);

  await expect(page.getByRole("button", { name: "Save targets" })).toBeDisabled();
  await page.getByLabel("Target NC for Aetna").click();
  await page.getByRole("button", { name: "Save targets" }).click();
  await expect(page.getByText("Aetna attached")).toBeVisible({ timeout: 15000 });

  // Targets only — no dormant org_payer_assignments write.
  expect(
    writes.filter((w) => w.method === "POST" && w.path === "org_payer_assignments"),
  ).toHaveLength(0);
  const targetPosts = writes.filter(
    (w) => w.method === "POST" && w.path === "payer_network_targets",
  );
  expect(targetPosts.length).toBeGreaterThanOrEqual(1);
  const target = targetPosts[0]?.body;
  expect(target?.group_id).toBe("g-ob");
  expect(target?.payer_id).toBe("pay-aetna");
  expect(target?.state).toBe("NC");
  expect(target?.status).toBe("active");
});

test("the picker is a MULTI-select: several payers reviewed together and saved in one batch", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  // Facilities in both operating states so the defaults pre-check the rows.
  fixtures.facilities = [
    {
      id: "f-nc",
      org_id: ORG_ID,
      group_id: "g-ob",
      name: "Kill Devil Hills Clinic",
      state: "NC",
      is_active: true,
      reference_only: false,
      created_at: "2026-06-01T00:00:00Z",
    },
    {
      id: "f-co",
      org_id: ORG_ID,
      group_id: "g-ob",
      name: "Denver Clinic",
      state: "CO",
      is_active: true,
      reference_only: false,
      created_at: "2026-06-01T00:00:00Z",
    },
  ];
  // Aetna is already on the board for NC — the dialog must open with Aetna
  // pre-selected so the coordinator sees what is already attached.
  fixtures.payer_network_targets = [
    {
      id: "t-aetna-nc",
      org_id: ORG_ID,
      payer_id: "pay-aetna",
      group_id: "g-ob",
      state: "NC",
      status: "active",
      payer_issued_id: null,
      created_at: "2026-06-15T00:00:00Z",
    },
  ];
  // A second eligible payer covering BOTH operating states.
  fixtures.payers = [
    ...CATALOG,
    {
      id: "pay-cigna",
      org_id: null,
      name: "Cigna Healthcare",
      payer_kind: "commercial",
      states: ["NC", "CO"],
      aliases: [],
      status: "active",
      payer_slug: "cigna",
      avg_decision_days: null,
      created_at: "2026-06-01T00:00:00Z",
    },
  ];
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/groups/g-ob/payer-network");
  await page.getByRole("button", { name: "Attach payers", exact: true }).click({ timeout: 30000 });

  // Already-attached Aetna is pre-checked; Cigna is not.
  await expect(page.getByLabel("Select Aetna")).toBeChecked();
  await expect(page.getByLabel("Select Cigna Healthcare")).not.toBeChecked();
  await page.getByLabel("Select Cigna Healthcare").check();
  await page.getByRole("button", { name: "Review 2 payers" }).click();

  // One block per payer, each proposing only ITS OWN payer ∩ group states:
  // Aetna (NC, SC) → NC (already active); Cigna (NC, CO) → NC + CO.
  await expect(page.getByLabel("Target NC for Aetna")).toBeDisabled();
  await expect(page.getByLabel("Target CO for Aetna")).toHaveCount(0);
  await expect(page.getByLabel("Target NC for Cigna Healthcare")).toBeChecked();
  await expect(page.getByLabel("Target CO for Cigna Healthcare")).toBeChecked();

  // Unchecking one payer's state leaves the other payer's identical state on.
  await page.getByLabel("Target CO for Cigna Healthcare").uncheck();
  // Aetna is fully attached → dropped from the plan; only Cigna NC saves.
  await page.getByRole("button", { name: "Save targets" }).click();
  await expect(page.getByText("Cigna Healthcare attached")).toBeVisible({ timeout: 15000 });

  const targetPosts = writes.filter(
    (w) => w.method === "POST" && w.path === "payer_network_targets",
  );
  expect(targetPosts.map((w) => [w.body?.payer_id, w.body?.state])).toEqual([["pay-cigna", "NC"]]);
  expect(targetPosts.every((w) => w.body?.group_id === "g-ob")).toBe(true);
  expect(targetPosts.every((w) => w.body?.status === "active")).toBe(true);
});

test("TS-110: the CSV path — exact-header gate, per-row eligibility errors at scan time, idempotent skip-on-match commit", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  // Pre-seed one ACTIVE target so the matching CSV row SKIPS on commit
  // (idempotency) while the fresh state attaches.
  fixtures.org_payer_assignments = [
    {
      id: "a-1",
      org_id: ORG_ID,
      payer_id: "pay-aetna",
      starter: false,
      status: "active",
      archived_at: null,
      created_at: "2026-06-15T00:00:00Z",
    },
  ];
  fixtures.payer_network_targets = [
    {
      id: "t-1",
      org_id: ORG_ID,
      payer_id: "pay-aetna",
      group_id: "g-ob",
      state: "NC",
      status: "active",
      created_at: "2026-06-15T00:00:00Z",
    },
  ];
  // Widen the group so a second eligible state exists for the CSV to add.
  (fixtures.provider_groups[0] as { states: string[] }).states = ["NC", "SC"];
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/groups/g-ob/payer-network");
  await page.getByText("Attach payers from a CSV").click({ timeout: 30000 });

  // Exact-header gate: a renamed column is rejected before any row work.
  await uploadCsv(page, "bad-headers.csv", "group_name,group_tin,payer_name,states\nx,,Aetna,NC");
  await expect(page.getByText(/was rejected/)).toBeVisible();

  // Good headers: one eligible row (NC;SC under Aetna) and one ineligible
  // row (BCBS Texas has zero overlap) — the error is named per row at scan.
  await uploadCsv(
    page,
    "payer-attach.csv",
    [
      "group_name,group_tin,payer,states",
      ",12-3456789,aetna,NC;SC",
      ",12-3456789,BCBS Texas,NC",
    ].join("\n"),
  );
  await page.getByRole("button", { name: /Start import|Import/ }).click();
  await expect(page.getByText("Ready for review")).toBeVisible({ timeout: 30000 });
  const run = fixtures.import_runs[0] as {
    staged_rows: number;
    error_rows: number;
    error_report: Array<{ reason: string }> | null;
  };
  expect(run.staged_rows).toBe(1);
  expect(run.error_rows).toBe(1);
  expect(JSON.stringify(run.error_report)).toContain("BCBS Texas does not cover NC");

  // Review & commit: NC (already active) skips; SC attaches. Idempotent —
  // no duplicate insert for the existing combination.
  await page.getByRole("link", { name: /Review & commit/ }).click();
  await expect(page.getByText("Already attached — skipped")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Will attach")).toBeVisible();
  await page.getByRole("button", { name: "Commit attachments" }).click();
  await page.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(page.getByText("Payer attach committed")).toBeVisible({ timeout: 15000 });

  const targetPosts = writes.filter(
    (w) => w.method === "POST" && w.path === "payer_network_targets",
  );
  expect(targetPosts).toHaveLength(1);
  expect(targetPosts[0].body?.state).toBe("SC");
  // The staged rows are purged after commit; the run row records the flip.
  expect(writes.some((w) => w.method === "DELETE" && w.path === "import_rows")).toBe(true);
  const committedPatch = writes.find(
    (w) => w.method === "PATCH" && w.path === "import_runs" && w.body?.state === "committed",
  );
  expect(committedPatch).toBeTruthy();
});
