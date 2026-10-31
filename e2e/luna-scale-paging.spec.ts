// MINT-82 Part 2 — MINT-14 completeness checks and client-side timings at
// Luna scale, LOCAL ONLY. Opt-in: LUNA_SCALE=1 (skipped otherwise, so normal
// CI time does not grow).
//
// The browser talks to e2e/fixtures/luna-scale-postgrest.ts, which serves the
// generated Luna-scale dataset (scripts/luna-scale/luna-dataset.mjs) with the
// hosted 1,000-row cap. The Enrollment Explorer reads a nitro /api route
// backed by a SQL RPC, so it is mocked one layer up, at /api/enrollment-
// explorer/report/page, from the same dataset.
//
// Every number this writes is CLIENT-SIDE WITH A MOCKED NETWORK: no database
// time, no network latency, no server work. Results land in
// test-results/luna-scale/results.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test, expect, type BrowserContext, type Page, type Route } from "@playwright/test";
import { PostgrestStandIn, type Row, type Tables } from "./fixtures/luna-scale-postgrest";
import { buildLunaDataset, DEFAULT_LUNA_PARAMS } from "../scripts/luna-scale/luna-dataset.mjs";
import { LUNA_ORG_ID, LUNA_ORG_NAME } from "../scripts/luna-scale/luna-fixture.mjs";
import { buildCasesMatrix, type CasesMatrixInput } from "../src/lib/casesMatrix";
import { camelizeRow } from "../src/lib/case";

const ENABLED = process.env.LUNA_SCALE === "1";
const RUNS = Number(process.env.LUNA_SCALE_RUNS ?? 3);
const QUIET_MS = 750;
const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const EMAIL = "luna.reviewer@example.test";
const TODAY = new Date().toISOString().slice(0, 10);
const RESULTS_DIR = "test-results/luna-scale";
const CONTEXT_REVISION = "luna-scale-context-1";

test.skip(!ENABLED, "Opt-in Luna-scale paging harness: set LUNA_SCALE=1");

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
    email: EMAIL,
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Luna Reviewer" },
    created_at: "2026-10-01T00:00:00Z",
  },
};

type Dataset = { tables: Record<string, Row[]>; params: Record<string, unknown> };

let cached: { dataset: Dataset; tables: Tables } | null = null;

/** The seed's rows plus what the database would add (defaults, sequences)
 * and the fixture user's own rows. */
function served(): { dataset: Dataset; tables: Tables } {
  if (cached) return cached;
  const dataset = buildLunaDataset(DEFAULT_LUNA_PARAMS, { anchorDate: TODAY }) as Dataset;
  const stamp = `${TODAY}T00:00:00Z`;
  const tables: Tables = {};
  for (const [table, rows] of Object.entries(dataset.tables)) {
    tables[table] = rows.map((row) => ({ created_at: stamp, ...row }));
  }
  tables.organizations = tables.organizations.map((row) => ({
    ...row,
    created_at: "2026-01-01T00:00:00Z",
  }));
  tables.providers = tables.providers.map((row) => ({
    updated_at: stamp,
    middle_initial: null,
    suffix: null,
    ...row,
  }));
  tables.credential_cases = tables.credential_cases.map((row, index) => ({
    case_number: 10_001 + index,
    case_type: "enrollment",
    context_version: 1,
    case_email_token: `tok${String(index).padStart(9, "0")}`,
    mso_id: null,
    assigned_to: null,
    generation_run_id: null,
    contract_executed_date: null,
    payer_group_provider_id: null,
    created_by: null,
    ...row,
  }));
  tables.tasks = tables.tasks.map((row) => ({
    updated_at: stamp,
    sop_template_id: null,
    sop_version: null,
    execution_type: null,
    ...row,
  }));
  tables.touches = tables.touches.map((row) => ({
    coordinator_id: null,
    task_id: null,
    communication_event_id: null,
    corrects_touch_id: null,
    fill_session_id: null,
    ...row,
  }));
  tables.facilities = tables.facilities.map((row) => ({
    hours: {},
    reference_only: false,
    ...row,
  }));
  tables.profiles = [{ id: USER_ID, full_name: "Luna Reviewer", email: EMAIL, created_at: stamp }];
  tables.memberships = [
    {
      id: "22222222-2222-4222-8222-222222222222",
      org_id: LUNA_ORG_ID,
      user_id: USER_ID,
      role: "admin",
      created_at: stamp,
    },
  ];
  cached = { dataset, tables };
  return cached;
}

// ---------- the Enrollment Explorer's /api page, derived from the dataset ----------

type ExplorerVariant = "as-seeded" | "products";

const DISCIPLINE: Record<string, string> = {
  "225100000X": "PT",
  "225200000X": "PTA",
  "225X00000X": "OT",
  "235Z00000X": "SLP",
};

function explorerModel(tables: Tables, variant: ExplorerVariant) {
  const groups = new Map(tables.provider_groups.map((g) => [g.id as string, g]));
  const payers = new Map(tables.payers.map((p) => [p.id as string, p]));
  const facilities = new Map(tables.facilities.map((f) => [f.id as string, f]));
  const products = tables.payers.map((p) => ({
    id: p.id as string,
    payerLabel: p.name as string,
    label: "Standard",
  }));
  const sections =
    variant === "as-seeded"
      ? []
      : [...new Set(tables.payer_network_targets.map((t) => `${t.group_id}:${t.state}`))]
          .sort()
          .map((key) => {
            const [groupId, state] = key.split(":");
            const columns = tables.payer_network_targets
              .filter((t) => t.group_id === groupId && t.state === state)
              .map((t) => ({
                key: `${key}:${t.payer_id}`,
                productId: t.payer_id as string,
                payerLabel: payers.get(t.payer_id as string)?.name as string,
                productLabel: "Standard",
              }))
              .sort((a, b) => a.payerLabel.localeCompare(b.payerLabel));
            return {
              key,
              groupId,
              groupLabel: groups.get(groupId)?.name as string,
              state,
              columns,
            };
          });
  const sectionKeys = new Set(sections.map((s) => s.key));
  const linksByCase = new Map<string, Row[]>();
  for (const link of tables.case_facilities) {
    linksByCase.set(link.case_id as string, [
      ...(linksByCase.get(link.case_id as string) ?? []),
      link,
    ]);
  }
  const casesByProvider = new Map<string, Row[]>();
  for (const row of tables.credential_cases) {
    casesByProvider.set(row.provider_id as string, [
      ...(casesByProvider.get(row.provider_id as string) ?? []),
      row,
    ]);
  }
  const workStates = new Map<string, Set<string>>();
  for (const a of tables.provider_facility_assignments) {
    const f = facilities.get(a.facility_id as string);
    if (!f) continue;
    const set = workStates.get(a.provider_id as string) ?? new Set<string>();
    set.add(`${f.group_id}:${f.state}`);
    workStates.set(a.provider_id as string, set);
  }
  // The RPC's active cohort: active, verified, not reference/test, with a
  // current group assignment.
  const assigned = new Set(
    tables.provider_group_assignments
      .filter((a) => (a.start_date as string) <= TODAY && !a.end_date)
      .map((a) => a.provider_id as string),
  );
  const cohort = tables.providers
    .filter(
      (p) =>
        p.status === "active" &&
        p.verification_state === "verified" &&
        !p.reference_only &&
        !p.is_test_provider &&
        assigned.has(p.id as string),
    )
    .sort(
      (a, b) =>
        String(a.last_name).localeCompare(String(b.last_name)) ||
        String(a.first_name).localeCompare(String(b.first_name)) ||
        String(a.id).localeCompare(String(b.id)),
    )
    .map((p) => {
      const keys = [...(workStates.get(p.id as string) ?? [])]
        .filter((key) => sectionKeys.has(key))
        .sort();
      const cells = (casesByProvider.get(p.id as string) ?? [])
        .filter((c) => sectionKeys.has(`${c.group_id}:${c.state}`))
        .map((c) => {
          const sectionKey = `${c.group_id}:${c.state}`;
          const locations = (linksByCase.get(c.id as string) ?? []).map((link) => ({
            sectionKey,
            scopeId: link.id as string,
            facilityId: link.facility_id as string,
            facilityLabel: facilities.get(link.facility_id as string)?.name as string,
            publicationState: "published",
            historical: false,
            status: c.case_status as string,
          }));
          return {
            key: `${sectionKey}:${c.payer_id}`,
            sectionKey,
            productId: c.payer_id as string,
            state: "published",
            locationCount: locations.length,
            locations,
          };
        });
      return {
        providerId: p.id as string,
        name: `${p.first_name} ${p.last_name}`,
        npi: (p.npi as string | null) ?? null,
        discipline: DISCIPLINE[p.taxonomy_code as string] ?? "Unknown",
        status: p.status as string,
        referenceOnly: false,
        verificationState: "verified",
        sectionKeys: keys,
        cells,
      };
    });
  const filterChoices = {
    groups: tables.provider_groups.map((g) => ({ id: g.id, label: g.name })),
    states: [...new Set(tables.facilities.map((f) => f.state as string))].sort(),
    facilities: tables.facilities.map((f) => ({
      id: f.id,
      label: f.name,
      groupId: f.group_id,
      state: f.state,
    })),
    products: variant === "as-seeded" ? [] : products,
    disciplines: ["PT", "PTA", "OT", "SLP"],
    statuses: [
      "not_started",
      "in_progress",
      "submitted",
      "in_review",
      "action_required",
      "approved",
      "denied",
    ],
  };
  return { cohort, sections, filterChoices, products };
}

async function installExplorer(context: BrowserContext, tables: Tables, variant: ExplorerVariant) {
  const model = explorerModel(tables, variant);
  const pageSize = 50;
  await context.route("**/api/enrollment-explorer/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const revision = CONTEXT_REVISION;
    const headers = { "X-Minted-Context-Revision": revision, "Cache-Control": "no-store" };
    const reply = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers,
        body: JSON.stringify({ data, error: null }),
      });
    if (url.pathname.endsWith("/report/page")) {
      const offset = Number(url.searchParams.get("cursor") ?? 0);
      const next = offset + pageSize;
      return reply({
        contextRevision: revision,
        viewToken: "luna-scale-view",
        accessState: model.cohort.length === 0 ? "empty_cohort" : "ready",
        filters: {},
        filterChoices: model.filterChoices,
        sections: model.sections,
        providers: model.cohort.slice(offset, next),
        nextCursor: next < model.cohort.length ? String(next) : null,
      });
    }
    if (url.pathname.endsWith("/catalog")) {
      return reply({
        products:
          variant === "as-seeded"
            ? []
            : model.products.map((p) => ({
                productId: p.id,
                payerId: p.id,
                payerName: p.payerLabel,
                productKey: "standard",
                displayName: "Standard",
                isActive: true,
              })),
        targets: [],
      });
    }
    if (url.pathname.endsWith("/unresolved")) return reply({ items: [], nextCursor: null });
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      headers,
      body: JSON.stringify({ data: null, error: "not mocked" }),
    });
  });
  return model;
}

// ---------- harness plumbing ----------

async function install(context: BrowserContext): Promise<PostgrestStandIn> {
  const { tables } = served();
  const store = new PostgrestStandIn(tables, { claim_invites: () => 0 });
  await context.route(/\/(rest|auth)\/v1\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/auth/v1/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SESSION),
      });
    }
    return store.route(route);
  });
  // A staff access context already pointed at the Luna org (the Explorer
  // needs a selected org; the other screens only need the shell to load).
  const accessContext = {
    actorUserId: USER_ID,
    email: EMAIL,
    audience: "staff",
    selectedOrgId: LUNA_ORG_ID,
    staffOrgs: [
      {
        orgId: LUNA_ORG_ID,
        orgName: LUNA_ORG_NAME,
        role: "admin",
        reportStaff: true,
        clientManage: true,
      },
    ],
    clientOrgs: [],
    globalTraining: true,
    restrictedExternal: false,
    contextRevision: CONTEXT_REVISION,
  };
  await context.route("**/api/me/access-context**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-Minted-Context-Revision": CONTEXT_REVISION },
      body: JSON.stringify({ data: accessContext, error: null }),
    }),
  );
  await context.addInitScript(
    ([authKey, session, orgId]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, LUNA_ORG_ID] as const,
  );
  return store;
}

interface Settled {
  ms: number;
  metric: number;
}

/** Navigate, then wait until the screen is ready, no mocked request is in
 * flight, and the DOM metric has not changed for QUIET_MS. The time reported
 * is navigation start -> the later of the last response and the last metric
 * change (±50 ms polling). */
async function settle(
  page: Page,
  store: PostgrestStandIn,
  start: number,
  metric: () => Promise<number>,
  ready: (value: number) => boolean,
  timeoutMs = 240_000,
): Promise<Settled> {
  let last = Number.NaN;
  let changedAt = Date.now();
  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(50);
    const value = await metric();
    if (value !== last) {
      last = value;
      changedAt = Date.now();
    }
    const settledAt = Math.max(changedAt, store.lastActivityAt);
    if (!store.busy && ready(value) && Date.now() - settledAt >= QUIET_MS) {
      return { ms: settledAt - start, metric: value };
    }
  }
  throw new Error(`Screen did not settle within ${timeoutMs} ms (last metric ${last})`);
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const results: Record<string, unknown> = {
  label:
    "CLIENT-SIDE, MOCKED NETWORK: PostgREST stand-in with db-max-rows 1000; no database time, no network latency",
  date: TODAY,
  params: DEFAULT_LUNA_PARAMS,
};

/** Merge into the file: a failed check restarts the worker, which resets
 * this module's state, and every check should still land in one report. */
function save() {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const path = `${RESULTS_DIR}/results.json`;
  const previous: Record<string, unknown> = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : {};
  writeFileSync(path, `${JSON.stringify({ ...previous, ...results }, null, 2)}\n`);
}

const showingTotal = (text: string | null) =>
  Number(/of ([\d,]+)/.exec(text ?? "")?.[1]?.replaceAll(",", "") ?? NaN);

// ---------- checks ----------

test("provider roster: every provider and its groups, past 1,000", async ({ context, page }) => {
  test.setTimeout(10 * 60_000);
  const { tables } = served();
  const store = await install(context);
  const start = Date.now();
  await page.goto("/providers");
  await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible({ timeout: 60_000 });
  const settled = await settle(
    page,
    store,
    start,
    () => page.evaluate(() => document.querySelectorAll("main tbody tr").length),
    (rows) => rows > 0,
  );
  const noGroup = await page.evaluate(
    () =>
      [...document.querySelectorAll("main tbody tr")].filter(
        (row) => row.querySelectorAll("td")[2]?.textContent?.trim() === "—",
      ).length,
  );
  const noLicense = await page.evaluate(
    () =>
      [...document.querySelectorAll("main tbody tr")].filter(
        (row) => row.querySelectorAll("td")[4]?.textContent?.trim() === "—",
      ).length,
  );
  // The roster hides terminated providers (providers.index.tsx).
  const shown = tables.providers.filter((p) => p.status !== "terminated");
  const licensed = new Set(tables.state_licenses.map((l) => l.provider_id));
  const expectedNoLicense = shown.filter((p) => !licensed.has(p.id)).length;
  results.roster = {
    expectedRows: shown.length,
    renderedRows: settled.metric,
    rowsShowingNoGroup: noGroup,
    expectedRowsShowingNoGroup: 0,
    rowsShowingNoLicense: noLicense,
    expectedRowsShowingNoLicense: expectedNoLicense,
    cappedReads: store.cappedReads(),
    completedPagedReads: store.completedPagedReads(),
    complete: settled.metric === shown.length && noGroup === 0 && noLicense === expectedNoLicense,
    settleMs: settled.ms,
  };
  save();
  expect.soft(settled.metric, "roster rows").toBe(shown.length);
});

test("cases list: correct total and every case names its provider, past 1,000", async ({
  context,
  page,
}) => {
  test.setTimeout(10 * 60_000);
  const { tables } = served();
  const store = await install(context);
  const timings: number[] = [];
  let total = Number.NaN;
  for (let run = 0; run < RUNS; run += 1) {
    store.reset();
    const start = Date.now();
    await page.goto("/cases?pivot=flat");
    const settled = await settle(
      page,
      store,
      start,
      async () =>
        showingTotal(
          await page
            .locator("text=/Showing \\d/")
            .first()
            .textContent({ timeout: 1000 })
            .catch(() => null),
        ),
      (value) => Number.isFinite(value) && value > 0,
    );
    timings.push(settled.ms);
    total = settled.metric;
  }
  const capped = store.cappedReads();
  const completed = store.completedPagedReads();
  const kpi = await page.getByRole("button", { name: /Total cases/ }).textContent();
  await page.getByLabel("Search cases").fill("Unknown provider");
  await expect(
    page.locator("text=/Showing \\d|Nothing matches these filters/").first(),
  ).toBeVisible();
  await page.waitForTimeout(500);
  const unknownText = await page.locator("main").innerText();
  const unknown = /Nothing matches these filters/.test(unknownText)
    ? 0
    : showingTotal(await page.locator("text=/Showing \\d/").first().textContent());
  results.casesList = {
    expectedTotal: tables.credential_cases.length,
    shownTotal: total,
    kpiTotalText: kpi?.replace(/\s+/g, " ").trim(),
    casesShowingUnknownProvider: unknown,
    expectedCasesShowingUnknownProvider: 0,
    cappedReads: capped,
    completedPagedReads: completed,
    complete: total === tables.credential_cases.length && unknown === 0,
    timingsMs: timings,
    medianMs: median(timings),
  };
  save();
  expect.soft(total, "Cases list total").toBe(tables.credential_cases.length);
});

test("matrix: every open-case provider row and open count, past 1,000", async ({
  context,
  page,
}) => {
  test.setTimeout(20 * 60_000);
  const { tables } = served();
  const input: CasesMatrixInput = {
    today: TODAY,
    providers: camelizeRow(tables.providers),
    cases: camelizeRow(tables.credential_cases),
    payers: camelizeRow(tables.payers),
    groups: camelizeRow(tables.provider_groups),
    targets: camelizeRow(tables.payer_network_targets),
    tasks: camelizeRow(tables.tasks),
    exclusions: [],
  };
  const expected = buildCasesMatrix(input);
  const expectedRows = expected.sections.reduce((sum, section) => sum + section.rows.length, 0);
  const expectedOpen = expected.sections.reduce((sum, section) => sum + section.openCaseCount, 0);
  const store = await install(context);
  const timings: number[] = [];
  let rows = 0;
  for (let run = 0; run < RUNS; run += 1) {
    store.reset();
    const start = Date.now();
    await page.goto("/cases");
    const settled = await settle(
      page,
      store,
      start,
      () => page.evaluate(() => document.querySelectorAll("main table tbody th[scope=row]").length),
      (value) => value > 0,
      600_000,
    );
    timings.push(settled.ms);
    rows = settled.metric;
  }
  const open = await page.evaluate(() =>
    [...document.querySelectorAll("main span")]
      .map((span) => /· (\d+) open$/.exec(span.textContent?.trim() ?? "")?.[1])
      .filter(Boolean)
      .reduce((sum, value) => sum + Number(value), 0),
  );
  results.matrix = {
    expectedProviderRows: expectedRows,
    renderedProviderRows: rows,
    expectedSections: expected.sections.length,
    expectedOpenCases: expectedOpen,
    shownOpenCases: open,
    cappedReads: store.cappedReads(),
    completedPagedReads: store.completedPagedReads(),
    complete: rows === expectedRows && open === expectedOpen,
    timingsMs: timings,
    medianMs: median(timings),
  };
  save();
  expect.soft(rows, "Matrix provider rows").toBe(expectedRows);
});

for (const variant of ["products", "as-seeded"] as const) {
  test(`enrollment explorer (${variant}): every cohort provider across 50-provider pages`, async ({
    context,
    page,
  }) => {
    test.setTimeout(20 * 60_000);
    const { tables } = served();
    const store = await install(context);
    const model = await installExplorer(context, tables, variant);
    const grid = page.getByRole("grid", { name: "Provider enrollment matrix" });
    const rowCount = async () =>
      Number((await grid.getAttribute("aria-rowcount", { timeout: 1000 }).catch(() => null)) ?? 0) -
      1;
    const firstPage: number[] = [];
    const allPages: number[] = [];
    let loaded = 0;
    let clicks = 0;
    for (let run = 0; run < RUNS; run += 1) {
      store.reset();
      const start = Date.now();
      await page.goto("/reporting/enrollment-explorer");
      const first = await settle(page, store, start, rowCount, (value) => value > 0);
      firstPage.push(first.ms);
      const next = page.getByRole("button", { name: "Load next 50 providers" });
      clicks = 0;
      while (await next.isVisible()) {
        const before = await rowCount();
        await next.click();
        clicks += 1;
        await expect.poll(rowCount, { timeout: 60_000 }).toBeGreaterThan(before);
      }
      await expect(page.getByText("End of provider list.")).toBeVisible();
      const all = await settle(page, store, start, rowCount, () => true);
      allPages.push(all.ms);
      loaded = all.metric;
    }
    results[`enrollmentExplorer_${variant}`] = {
      layer:
        "the /api/enrollment-explorer/report/page route is mocked (it is a nitro route over a SQL RPC); the PostgREST stand-in serves only the page's other reads",
      expectedCohort: model.cohort.length,
      loadedProviders: loaded,
      pagesClicked: clicks,
      cappedReads: store.cappedReads(),
      complete: loaded === model.cohort.length,
      firstPageMs: firstPage,
      firstPageMedianMs: median(firstPage),
      allPagesMs: allPages,
      allPagesMedianMs: median(allPages),
    };
    save();
    expect.soft(loaded, "Explorer cohort").toBe(model.cohort.length);
  });
}
