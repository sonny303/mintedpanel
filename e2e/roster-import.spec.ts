import { readFileSync } from "fs";
import { test, expect, type Page, type Route } from "@playwright/test";

// E3.0 TE-11 + E3.3 (per-section retarget) — roster-import coverage over the
// mock harness. The combined 20-column template is retired (E3.3 TE-7); these
// tests now exercise the PROVIDER per-section upload (the closest analog of the
// old combined roster), which still validates the whole pipeline:
//   TS-58 Internal front gate on /admin/import's Providers section: per-section
//         template download, non-CSV + renamed-header rejects, drop-zone active
//         state, columns + sample-rows preview, Uploading → Scanning →
//         Ready-for-review.
//   TS-59 Org-rep guarded upload from the wizard's Providers section:
//         streamlined uploader beside the manual form (needs a group — the
//         TE-5 ladder), stages identically through the same pipeline.
//   TS-60 Async scan of a large file: survives in-app navigation, good rows
//         stage / bad rows collect, run lands ready_for_review, error report
//         lists row + column + reason. Nothing writes to live tables.
//
// The harness write-throughs import_runs (POST/PATCH), stage_import_rows
// (honoring the UNIQUE (run_id, line) resume key + recomputing counts), and
// audit_log. Configurable delays make the states deterministic.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
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

// The provider per-section template (E3.3 TE-2) — the E3.0 provider subset,
// NO facility-creation columns; the parent group is keyed by group_tin/name.
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

function activeGroup() {
  return {
    id: GROUP_ID,
    org_id: ORG_ID,
    name: "Tree Hill Sports Therapy LLC",
    tin: "123456789",
    is_active: true,
    states: ["NC"],
    created_at: NOW,
  };
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

// The Providers upload section on /admin/import (one of three per-section
// uploaders); scope every interaction so the assertions don't collide with the
// group/facility uploaders.
function providersSection(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Providers", exact: true }) });
}

async function uploadRoster(scope: ReturnType<Page["locator"]>, name: string, content: string) {
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
    makeHandler(fixtures, wire, { scanDelayMs: 900, stageDelayMs: 900 }),
  );
  await seedAuth(context);

  await page.goto("/admin/import");
  await expect(page.getByRole("heading", { name: "Roster Import" })).toBeVisible({
    timeout: 30000,
  });
  const section = providersSection(page);

  // The per-section provider template downloads from the Providers uploader.
  const downloadPromise = page.waitForEvent("download");
  await section.getByRole("button", { name: "Download Provider template" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("provider-import-template.csv");
  expect(readFileSync((await download.path()) as string, "utf8")).toBe(HEADER_LINE);

  // Drop-zone active state on drag hover.
  const zone = section.getByRole("button", { name: /Upload roster CSV/ });
  await zone.dispatchEvent("dragover", {
    dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
  });
  await expect(zone).toContainText("Drop the file to upload");
  await zone.dispatchEvent("dragleave");

  // Non-CSV rejects client-side.
  await section
    .locator('input[type="file"]')
    .setInputFiles({ name: "roster.txt", mimeType: "text/plain", buffer: Buffer.from("nope") });
  await expect(section.getByRole("alert")).toContainText("Only .csv files are accepted");

  // Renamed header rejects at the gate BEFORE any row work, naming the offender.
  await uploadRoster(
    section,
    "renamed.csv",
    [HEADER_LINE.replace("npi,", "npi_number,"), rowLine()].join("\n"),
  );
  await expect(section.getByRole("alert")).toContainText("missing: npi");
  await expect(section.getByRole("alert")).toContainText("npi_number");
  expect(wire.stageCalls).toHaveLength(0);
  expect(fixtures.import_runs).toHaveLength(0);

  // Valid file → columns + sample-rows preview before processing.
  await uploadRoster(
    section,
    "roster.csv",
    [HEADER_LINE, rowLine(), rowLine({ provider_first_name: "Quinn", npi: "1093817465" })].join(
      "\n",
    ),
  );
  await expect(section.getByText("2 data rows")).toBeVisible();
  await expect(section.locator("th", { hasText: "provider_first_name" })).toBeVisible();
  await expect(section.locator("td", { hasText: "Nathan" }).first()).toBeVisible();

  // Start → the explicit state sequence renders from the durable run row.
  await section.getByRole("button", { name: "Start import" }).click();
  await expect(section.getByText("Uploading", { exact: true }).first()).toBeVisible({
    timeout: 10000,
  });
  await expect(section.getByText("Scanning", { exact: true }).first()).toBeVisible({
    timeout: 10000,
  });
  await expect(section.getByRole("progressbar")).toBeVisible();
  await expect(section.getByText("Ready for review", { exact: true }).first()).toBeVisible({
    timeout: 15000,
  });

  // Both rows staged through the RPC; the run is stamped entity_kind='provider'.
  expect(wire.stageCalls).toHaveLength(1);
  expect(fixtures.import_rows).toHaveLength(2);
  const run = fixtures.import_runs[0];
  expect(run.source).toBe("internal");
  expect(run.entity_kind).toBe("provider");
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

test("TS-59: org-rep streamlined wizard upload stages identically beside the manual form", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  // A group exists, so the TE-5 ladder lets the Providers upload proceed.
  fixtures.provider_groups = [activeGroup()];
  const wire: WireLog = { writes: [], stageCalls: [] };
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures, wire));
  await seedAuth(context);

  await page.goto("/onboarding/wizard");
  const card = page.locator("#wizard-providers");
  await expect(card).toBeVisible({ timeout: 30000 });

  // The streamlined per-section uploader renders BESIDE the manual "Add
  // provider" form: template + drop zone, no internal power-user run history.
  await expect(card.getByText("Bulk provider import")).toBeVisible();
  await expect(card.getByRole("button", { name: "Add provider" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Download Provider template" })).toBeVisible();
  await expect(card.getByRole("button", { name: /Upload roster CSV/ })).toBeVisible();
  await expect(page.getByText("Run history")).toHaveCount(0);

  // Small valid roster through the SAME pipeline.
  await uploadRoster(
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

  // Identical staging: source 'onboarding', entity_kind 'provider', rows in
  // import_rows via the same RPC, zero live-table writes.
  const run = fixtures.import_runs[0];
  expect(run.source).toBe("onboarding");
  expect(run.entity_kind).toBe("provider");
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
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures, wire, { stageDelayMs: 4000 }));
  await seedAuth(context);

  await page.goto("/admin/import");
  await expect(page.getByRole("heading", { name: "Roster Import" })).toBeVisible({
    timeout: 30000,
  });
  const section = providersSection(page);

  // 60 rows, 3 with malformed NPIs.
  const badIndexes = [10, 25, 40];
  const rows = Array.from({ length: 60 }, (_, i) =>
    rowLine({
      npi: badIndexes.includes(i) ? "999" : String(1000000000 + i),
      provider_last_name: `Scott${i}`,
    }),
  );
  await uploadRoster(section, "big-roster.csv", [HEADER_LINE, ...rows].join("\n"));
  await expect(section.getByText("60 data rows")).toBeVisible();
  await section.getByRole("button", { name: "Start import" }).click();
  await expect(section.getByText("Scanning", { exact: true }).first()).toBeVisible({
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
  // Once ready_for_review, the internal uploader's inline resume panel (which
  // tracks uploading/scanning only) drops it — the state shows in Run history.
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

  // The run history panel carries the raw detail + downloadable report.
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
