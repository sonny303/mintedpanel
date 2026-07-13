import { readFileSync } from "fs";
import { test, expect, type Page, type Route } from "@playwright/test";

// E3.0 TE-11 — roster-import coverage over the mock harness:
//   TS-58 Internal upload through the front gate: template download, non-CSV
//         + renamed-header rejects naming the problem, drop-zone active
//         state, valid-file columns + sample-rows preview, and the
//         Uploading → Scanning → Ready-for-review states.
//   TS-59 Org-rep guarded upload from the onboarding wizard's roster
//         section: streamlined uploader (template + drop zone, no run
//         history), stages identically through the same pipeline.
//   TS-60 Async scan of a large file: survives in-app navigation away/back,
//         good rows stage / bad rows collect, the run lands
//         ready_for_review, and the error report lists row + column +
//         reason. Nothing ever writes to live provider/group/facility
//         tables.
//
// The harness write-throughs import_runs (POST/PATCH), the
// stage_import_rows RPC (honoring the UNIQUE (run_id, line) resume key and
// recomputing run counts like the SQL does), and audit_log, so the
// invalidate-and-poll loop runs for real. Configurable delays make the
// Uploading/Scanning states deterministic.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-07-13T12:00:00Z";

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

/* ------------------------------ CSV builders ----------------------------- */

const TEMPLATE_HEADERS = [
  "group_name",
  "group_tin",
  "provider_first_name",
  "provider_middle_initial",
  "provider_last_name",
  "npi",
  "caqh_id",
  "specialty",
  "taxonomy_code",
  "license_number",
  "license_state",
  "license_issue_date",
  "license_expiration_date",
  "ssn_last4",
  "date_of_birth",
  "facility_name",
  "facility_street",
  "facility_city",
  "facility_state",
  "facility_zip",
];
const HEADER_LINE = TEMPLATE_HEADERS.join(",");

const VALID_CELLS: Record<string, string> = {
  group_name: "Tree Hill Sports Therapy LLC",
  group_tin: "12-3456789",
  provider_first_name: "Nathan",
  provider_middle_initial: "R",
  provider_last_name: "Scott",
  npi: "1234567893",
  caqh_id: "16224897",
  specialty: "Physical Therapy",
  taxonomy_code: "225100000X",
  license_number: "PT-48213",
  license_state: "NC",
  license_issue_date: "2023-02-01",
  license_expiration_date: "2027-01-31",
  ssn_last4: "6789",
  date_of_birth: "1990-04-12",
  facility_name: "Main Clinic",
  facility_street: "1 Main St",
  facility_city: "Charlotte",
  facility_state: "NC",
  facility_zip: "28280",
};

function rowLine(over: Record<string, string> = {}): string {
  return TEMPLATE_HEADERS.map((h) => over[h] ?? VALID_CELLS[h]).join(",");
}

function csvFile(name: string, content: string) {
  return { name, mimeType: "text/csv", buffer: Buffer.from(content, "utf8") };
}

/* -------------------------------- Fixtures ------------------------------- */

interface WireLog {
  writes: Array<{ table: string; method: string }>;
  stageCalls: Array<{ p_run_id: string; p_rows: Array<Record<string, unknown>> }>;
}

function makeFixtures() {
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
    provider_groups: [],
    facilities: [],
    providers: [],
    state_licenses: [],
    provider_group_assignments: [],
    payers: [],
    org_payer_assignments: [],
    payer_network_targets: [],
    provider_documents: [],
    group_insurance_policies: [],
    contracts: [],
    tasks: [],
    import_runs: [],
    import_rows: [],
  } as Record<string, Record<string, unknown>[]>;
}

const LIVE_TABLES = [
  "providers",
  "provider_groups",
  "facilities",
  "provider_facility_assignments",
  "provider_group_assignments",
  "state_licenses",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Stateful PostgREST + RPC mock. scanDelayMs delays the uploading→scanning
// PATCH; stageDelayMs delays each stage_import_rows batch — together they
// hold each state open long enough to assert on.
function makeHandler(
  fixtures: Record<string, Record<string, unknown>[]>,
  wire: WireLog,
  opts: { scanDelayMs?: number; stageDelayMs?: number } = {},
) {
  let seq = 100;
  return async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.endsWith("/rpc/claim_invites")) return json(0);

    if (url.pathname.endsWith("/rpc/stage_import_rows")) {
      if (opts.stageDelayMs) await sleep(opts.stageDelayMs);
      const body = JSON.parse(req.postData() ?? "{}") as WireLog["stageCalls"][number];
      wire.stageCalls.push(body);
      const rows = fixtures.import_rows;
      const claimed = new Set(
        rows.filter((r) => r.run_id === body.p_run_id).map((r) => r.line as number),
      );
      for (const e of body.p_rows) {
        const line = e.line as number;
        if (claimed.has(line)) continue; // UNIQUE (run_id, line) — resume-idempotent
        claimed.add(line);
        rows.push({
          id: `import-row-${seq++}`,
          org_id: ORG_ID,
          run_id: body.p_run_id,
          line,
          raw: e.raw,
          mapped: e.mapped,
          row_state: e.row_state,
          error_column: e.error_column,
          error_reason: e.error_reason,
          created_at: NOW,
        });
      }
      const run = fixtures.import_runs.find((r) => r.id === body.p_run_id);
      if (run) {
        const mine = rows.filter((r) => r.run_id === run.id);
        run.staged_rows = mine.filter((r) => r.row_state === "staged").length;
        run.error_rows = mine.filter((r) => r.row_state === "error").length;
        run.updated_at = NOW;
      }
      return json(null);
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

    const matchFilters = (row: Record<string, unknown>): boolean => {
      for (const [key, raw] of url.searchParams.entries()) {
        if (["select", "order", "limit", "offset"].includes(key)) continue;
        if (!(key in row)) continue;
        if (raw.startsWith("eq.")) {
          if (String(row[key]) !== raw.slice(3)) return false;
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
      if (table === "import_runs") {
        const created = rows.map((r) => ({
          id: `run-${seq++}`,
          created_at: NOW,
          updated_at: NOW,
          error_report: null,
          ...r,
        }));
        fixtures.import_runs.push(...created);
        return json(wantsObject ? created[0] : created, 201);
      }
      if (table === "audit_log") {
        fixtures.audit_log.push(...rows);
        return json(null, 201);
      }
      fixtures[table] = [...(fixtures[table] ?? []), ...rows];
      return json(rows, 201);
    }
    if (req.method() === "PATCH") {
      wire.writes.push({ table, method: "PATCH" });
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      if (table === "import_runs" && body.state === "scanning" && opts.scanDelayMs) {
        await sleep(opts.scanDelayMs);
      }
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

async function uploadRoster(
  page: Page,
  scope: ReturnType<Page["locator"]>,
  name: string,
  content: string,
) {
  await scope.locator('input[type="file"]').setInputFiles(csvFile(name, content));
}

/* --------------------------------- TS-58 --------------------------------- */

test("TS-58: internal front gate — template, rejects, preview, Uploading→Scanning→Ready", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  const wire: WireLog = { writes: [], stageCalls: [] };
  await context.route(
    /\/(rest|auth)\/v1\//,
    makeHandler(fixtures, wire, {
      scanDelayMs: 900,
      stageDelayMs: 900,
    }),
  );
  await seedAuth(context);

  await page.goto("/admin/import");
  await expect(page.getByRole("heading", { name: "Roster Import" })).toBeVisible({
    timeout: 30000,
  });

  // Template downloads from the upload screen, generated from the canonical list.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV template" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("roster-import-template.csv");
  expect(readFileSync((await download.path()) as string, "utf8")).toBe(HEADER_LINE);

  // Drop-zone active state on drag hover (F3.0.3).
  const zone = page.getByRole("button", { name: /Upload roster CSV/ });
  await zone.dispatchEvent("dragover", {
    dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
  });
  await expect(zone).toContainText("Drop the file to upload");
  await zone.dispatchEvent("dragleave");

  // Non-CSV rejects client-side.
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "roster.txt", mimeType: "text/plain", buffer: Buffer.from("nope") });
  await expect(page.getByRole("alert")).toContainText("Only .csv files are accepted");

  // Renamed header rejects at the gate BEFORE any row work, naming the offender.
  await uploadRoster(
    page,
    page.locator("body"),
    "renamed.csv",
    [HEADER_LINE.replace("npi,", "npi number,"), rowLine()].join("\n"),
  );
  await expect(page.getByRole("alert")).toContainText("missing: npi");
  await expect(page.getByRole("alert")).toContainText("npi_number");
  await expect(page.getByRole("button", { name: "Download CSV template" })).toBeVisible();
  expect(wire.stageCalls).toHaveLength(0);
  expect(fixtures.import_runs).toHaveLength(0);

  // Valid file → columns + sample-rows preview before processing.
  await uploadRoster(
    page,
    page.locator("body"),
    "roster.csv",
    [HEADER_LINE, rowLine(), rowLine({ provider_first_name: "Quinn", npi: "1093817465" })].join(
      "\n",
    ),
  );
  await expect(page.getByText("2 data rows")).toBeVisible();
  await expect(page.locator("th", { hasText: "provider_first_name" })).toBeVisible();
  await expect(page.locator("td", { hasText: "Nathan" }).first()).toBeVisible();

  // Start → the explicit state sequence renders from the durable run row.
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByText("Uploading", { exact: true }).first()).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText("Scanning", { exact: true }).first()).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByText("Ready for review", { exact: true }).first()).toBeVisible({
    timeout: 15000,
  });

  // Both rows staged through the RPC; run counts recomputed server-side.
  expect(wire.stageCalls).toHaveLength(1);
  expect(fixtures.import_rows).toHaveLength(2);
  const run = fixtures.import_runs[0];
  expect(run.source).toBe("internal");
  expect(run.state).toBe("ready_for_review");
  expect(run.staged_rows).toBe(2);
  expect(run.error_rows).toBe(0);

  // Nothing touched live tables; the lifecycle is audited.
  expect(wire.writes.filter((w) => LIVE_TABLES.includes(w.table))).toHaveLength(0);
  const auditRows = fixtures.audit_log.filter((a) => a.entity_type === "import_run");
  expect(auditRows.some((a) => a.action_type === "CREATE")).toBe(true);
  expect(auditRows.some((a) => a.action_type === "UPDATE")).toBe(true);
});

/* --------------------------------- TS-59 --------------------------------- */

test("TS-59: org-rep streamlined wizard upload stages identically, no power tooling", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  const wire: WireLog = { writes: [], stageCalls: [] };
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures, wire));
  await seedAuth(context);

  await page.goto("/onboarding/wizard");
  const card = page.locator("#wizard-providers");
  await expect(card).toBeVisible({ timeout: 30000 });

  // The streamlined uploader renders inside the roster section: template +
  // drop zone, no internal power-user tooling (no run history).
  await expect(card.getByText("Bulk roster import")).toBeVisible();
  await expect(card.getByRole("button", { name: "Download CSV template" })).toBeVisible();
  await expect(card.getByRole("button", { name: /Upload roster CSV/ })).toBeVisible();
  await expect(page.getByText("Run history")).toHaveCount(0);

  // Small valid roster through the SAME pipeline.
  await uploadRoster(
    page,
    card,
    "org-roster.csv",
    [HEADER_LINE, rowLine(), rowLine({ provider_first_name: "Quinn", npi: "1093817465" })].join(
      "\n",
    ),
  );
  await expect(card.getByText("2 data rows")).toBeVisible();
  await card.getByRole("button", { name: "Start import" }).click();
  await expect(card.getByText("Ready for review", { exact: true })).toBeVisible({
    timeout: 15000,
  });

  // Identical staging: source stamped 'onboarding', rows in import_rows via
  // the same RPC, zero live-table writes.
  const run = fixtures.import_runs[0];
  expect(run.source).toBe("onboarding");
  expect(run.state).toBe("ready_for_review");
  expect(fixtures.import_rows).toHaveLength(2);
  expect(fixtures.import_rows.every((r) => r.row_state === "staged" && r.run_id === run.id)).toBe(
    true,
  );
  expect(wire.writes.filter((w) => LIVE_TABLES.includes(w.table))).toHaveLength(0);
});

/* --------------------------------- TS-60 --------------------------------- */

test("TS-60: async scan survives navigation; good rows stage, error report lists row/column/reason", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  const wire: WireLog = { writes: [], stageCalls: [] };
  // A wide staging delay keeps the run mid-scan through the navigation
  // round-trip even under full-suite parallel load.
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures, wire, { stageDelayMs: 4000 }));
  await seedAuth(context);

  await page.goto("/admin/import");
  await expect(page.getByRole("heading", { name: "Roster Import" })).toBeVisible({
    timeout: 30000,
  });

  // 60 rows, 3 with malformed NPIs (the F3.0.4 gherkin).
  const badIndexes = [10, 25, 40];
  const rows = Array.from({ length: 60 }, (_, i) =>
    rowLine({
      npi: badIndexes.includes(i) ? "999" : String(1000000000 + i),
      provider_last_name: `Scott${i}`,
    }),
  );
  await uploadRoster(
    page,
    page.locator("body"),
    "big-roster.csv",
    [HEADER_LINE, ...rows].join("\n"),
  );
  await expect(page.getByText("60 data rows")).toBeVisible();
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByText("Scanning", { exact: true }).first()).toBeVisible({
    timeout: 10000,
  });

  // Leave mid-scan via in-app navigation (the SPA keeps the scan driving) —
  // wait for the destination to COMMIT so the import page really unmounts …
  await page.getByRole("link", { name: "My Cases" }).click();
  await expect(page).toHaveURL(/\/work/, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: "My Cases" })).toBeVisible({ timeout: 15000 });
  // … and return: progress lives on the run row, not React state.
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Roster Import" })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("Ready for review", { exact: true }).first()).toBeVisible({
    timeout: 25000,
  });

  // 57 staged, 3 errors — enumerated, not failing the run.
  const run = fixtures.import_runs[0];
  expect(run.state).toBe("ready_for_review");
  expect(run.staged_rows).toBe(57);
  expect(run.error_rows).toBe(3);
  expect(fixtures.import_rows).toHaveLength(60);
  expect((run.error_report as Array<{ line: number }>).map((e) => e.line)).toEqual([12, 27, 42]);

  // The uploader's transient in-flight resume panel unmounts once the runs
  // list refetch lands (internal resumes in-flight scans only) …
  await expect(page.getByText("rows could not be staged.")).toHaveCount(0, { timeout: 10000 });
  // … and the run history panel carries the raw detail + downloadable report.
  await page.getByRole("button", { name: "View" }).click();
  await expect(page.getByText("3 rows could not be staged.")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download error report" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("roster-import-errors.csv");
  const report = readFileSync((await download.path()) as string, "utf8");
  const lines = report.split("\n");
  expect(lines[0]).toBe("row,column,reason");
  expect(lines).toHaveLength(4);
  for (const [i, line] of [12, 27, 42].entries()) {
    expect(lines[i + 1]).toContain(`${line},npi,`);
    expect(lines[i + 1]).toContain("10 digits");
  }

  // Staging only — live tables untouched.
  expect(wire.writes.filter((w) => LIVE_TABLES.includes(w.table))).toHaveLength(0);
});
