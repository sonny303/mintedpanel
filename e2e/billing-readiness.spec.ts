import { expect, test, type Page, type Route } from "./fixtures/legacy-access-context";
import { readFile } from "node:fs/promises";

// WP1.2 browser coverage uses a synthetic PostgREST/GoTrue HTTP layer only.
// It never contacts a hosted Supabase project or uses real provider data.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_A = "22222222-2222-4222-8222-222222222222";
const ORG_B = "33333333-3333-4333-8333-333333333333";
const GROUP_A = "44444444-4444-4444-8444-444444444444";
const GROUP_B = "55555555-5555-4555-8555-555555555555";
const FACILITY_A = "66666666-6666-4666-8666-666666666666";
const FACILITY_NORTH = "77777777-7777-4777-8777-777777777777";
const FACILITY_B = "88888888-8888-4888-8888-888888888888";
const PAYER_BLUE = "99999999-9999-4999-8999-999999999999";
const PAYER_CIGNA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const SESSION = {
  access_token: "synthetic-access-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 9999999999,
  refresh_token: "synthetic-refresh-token",
  user: {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic.billing@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Synthetic Billing User" },
    created_at: "2026-07-09T00:00:00Z",
  },
};

type Row = Record<string, unknown>;
type Fixtures = Record<string, Row[]>;
type MockRequest = { table: string; url: string };

const BILLING_SELECTS: Record<string, string> = {
  providers:
    "id, first_name, last_name, npi, taxonomy_code, status, verification_state, is_test_provider",
  provider_groups: "id, name, tin, npi_type2, is_active",
  facilities: "id, name, group_id, state, is_active",
  payers: "id, name, status, is_active, avg_decision_days, org_id",
  provider_group_assignments: "provider_id, group_id, start_date, end_date",
  provider_facility_assignments: "provider_id, facility_id, start_date",
  state_licenses:
    "provider_id, state, license_number, license_type, status, verified_status, issue_date, expiration_date",
  credential_cases:
    "id, provider_id, group_id, payer_id, state, case_status, submitted_date, approved_date, confirmed_effective_date, expected_effective_date, termination_date, created_at",
  case_facilities: "case_id, facility_id, created_at, created_by",
  case_status_history: "id, case_id, from_status, to_status, actor_kind, changed_at",
  status_history: "id, case_id, track, to_status_id, changed_at",
  status_configs: "id, track, label",
};

// AppShell's sidebar calls useCases(), which uses this existing list projection
// before the report route renders. Keep that shell read separate from the
// billing report's narrower credential-case projection above.
const APP_SELECTS: Record<string, string> = {
  credential_cases:
    "id, case_number, provider_id, payer_id, state, group_id, facility_id, mso_id, credentialing_status_id, case_status, contract_executed_date, assigned_to, submitted_date, approved_date, confirmed_effective_date, expected_effective_date, termination_date, generation_run_id, payer_reference_id, payer_individual_provider_id, payer_group_provider_id, payer_pipeline_state, created_at, updated_at",
};

function syntheticNpi(id: string): string {
  const number = [...id].reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) % 1_000_000_000,
    0,
  );
  return `1${String(number).padStart(9, "0")}`;
}

function normalizeSelect(select: string | null | undefined): string {
  return (select ?? "").replace(/\s+/g, "");
}

function clinicianOption(providerId: string, name: string): string {
  return `${name} · NPI ${syntheticNpi(providerId)}`;
}

function facilityOption(name: string, groupName = "Synthetic North Group"): string {
  return `${name} · NC · ${groupName}`;
}

function dayOffset(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timestampOffset(days: number): string {
  return `${dayOffset(days)}T12:00:00.000Z`;
}

const organization = (id: string, name: string) => ({
  id,
  name,
  lifecycle_state: "active",
  created_at: "2026-07-01T00:00:00Z",
});

const baseFixtures: Fixtures = {
  organizations: [
    organization(ORG_A, "Synthetic North Rehab"),
    organization(ORG_B, "Synthetic South Rehab"),
  ],
  memberships: [
    {
      user_id: USER_ID,
      org_id: ORG_A,
      role: "admin",
      organizations: organization(ORG_A, "Synthetic North Rehab"),
    },
    {
      user_id: USER_ID,
      org_id: ORG_B,
      role: "admin",
      organizations: organization(ORG_B, "Synthetic South Rehab"),
    },
  ],
  profiles: [
    {
      id: USER_ID,
      full_name: "Synthetic Billing User",
      email: "synthetic.billing@example.test",
      created_at: "2026-07-09T00:00:00Z",
    },
  ],
  party_role_assignments: [],
  report_shares: [],
  user_table_prefs: [],
  provider_groups: [],
  facilities: [],
  providers: [],
  provider_group_assignments: [],
  provider_facility_assignments: [],
  state_licenses: [],
  credential_cases: [],
  case_facilities: [],
  case_status_history: [],
  status_history: [],
  status_configs: [],
  payers: [
    {
      id: PAYER_BLUE,
      org_id: null,
      name: "Blue Cross Synthetic",
      is_active: true,
      status: "active",
      avg_decision_days: 30,
      states: ["NC"],
      created_at: "2026-07-01T00:00:00Z",
    },
    {
      id: PAYER_CIGNA,
      org_id: null,
      name: "Cigna Synthetic",
      is_active: true,
      status: "active",
      avg_decision_days: 21,
      states: ["NC"],
      created_at: "2026-07-01T00:00:00Z",
    },
  ],
};

function group(orgId: string, id: string, name: string): Row {
  return {
    id,
    org_id: orgId,
    name,
    tin: "123456789",
    npi_type2: "1222333444",
    states: ["NC"],
    is_active: true,
  };
}

function facility(orgId: string, id: string, groupId: string, name: string): Row {
  return {
    id,
    org_id: orgId,
    group_id: groupId,
    name,
    state: "NC",
    is_active: true,
    reference_only: false,
  };
}

function clinician(
  orgId: string,
  id: string,
  firstName: string,
  lastName: string,
  taxonomyCode: string,
): Row {
  return {
    id,
    org_id: orgId,
    first_name: firstName,
    last_name: lastName,
    npi: syntheticNpi(id),
    status: "active",
    verification_state: "verified",
    is_test_provider: false,
    reference_only: false,
    taxonomy_code: taxonomyCode,
    credentials: taxonomyCode === "225200000X" ? "PTA" : "PT",
    created_at: "2026-07-01T00:00:00Z",
  };
}

function groupAssignment(orgId: string, providerId: string, groupId: string): Row {
  return {
    id: `ga-${providerId}`,
    org_id: orgId,
    provider_id: providerId,
    group_id: groupId,
    is_primary: true,
    start_date: dayOffset(-120),
    end_date: null,
  };
}

function facilityAssignment(orgId: string, providerId: string, facilityId: string): Row {
  return {
    id: `fa-${providerId}-${facilityId}`,
    org_id: orgId,
    provider_id: providerId,
    facility_id: facilityId,
    is_primary: true,
    start_date: dayOffset(-120),
  };
}

function license(orgId: string, providerId: string, licenseType = "PT"): Row {
  return {
    id: `license-${providerId}`,
    org_id: orgId,
    provider_id: providerId,
    state: "NC",
    license_number: `SYN-${providerId}`,
    license_type: licenseType,
    status: "active",
    verified_status: "verified",
    issue_date: null,
    expiration_date: dayOffset(300),
  };
}

function credentialCase(input: {
  orgId: string;
  id: string;
  number: number;
  providerId: string;
  groupId: string;
  payerId: string;
  facilityId: string;
  status?: string;
  approvedDaysAgo: number;
  terminationDaysAgo?: number | null;
}): Row {
  return {
    id: input.id,
    org_id: input.orgId,
    case_number: input.number,
    provider_id: input.providerId,
    group_id: input.groupId,
    payer_id: input.payerId,
    facility_id: input.facilityId,
    mso_id: null,
    credentialing_status_id: null,
    state: "NC",
    case_status: input.status ?? "approved",
    submitted_date: dayOffset(-60),
    approved_date: dayOffset(-input.approvedDaysAgo),
    confirmed_effective_date: dayOffset(-Math.max(0, input.approvedDaysAgo - 5)),
    expected_effective_date: null,
    contract_executed_date: null,
    assigned_to: null,
    termination_date:
      input.terminationDaysAgo === undefined || input.terminationDaysAgo === null
        ? null
        : dayOffset(-input.terminationDaysAgo),
    generation_run_id: null,
    payer_reference_id: null,
    payer_individual_provider_id: null,
    payer_group_provider_id: null,
    payer_pipeline_state: null,
    created_at: timestampOffset(-90),
    updated_at: timestampOffset(-1),
  };
}

function caseFacility(
  orgId: string,
  caseId: string,
  facilityId: string,
  createdDaysAgo: number,
): Row {
  return {
    id: `cf-${caseId}-${facilityId}`,
    org_id: orgId,
    case_id: caseId,
    facility_id: facilityId,
    is_primary: true,
    created_at: timestampOffset(-createdDaysAgo),
    created_by: USER_ID,
  };
}

function statusEvent(
  orgId: string,
  caseId: string,
  id: string,
  toStatus: string,
  changedDaysAgo: number,
  fromStatus: string | null = null,
): Row {
  return {
    id,
    org_id: orgId,
    case_id: caseId,
    from_status: fromStatus,
    to_status: toStatus,
    actor_kind: "user",
    is_correction: false,
    note: null,
    changed_at: timestampOffset(-changedDaysAgo),
  };
}

function enrollmentRows(
  orgId: string,
  groupId: string,
  providerId: string,
  caseId: string,
  caseNumber: number,
  facilityId: string,
  payerId: string,
  approvalDaysAgo: number,
  options: { status?: string; terminationDaysAgo?: number | null; taxonomyCode?: string } = {},
): Fixtures {
  const name = providerId.replace(/[^a-z0-9]/gi, "");
  const isPta = options.taxonomyCode === "225200000X";
  return {
    provider_groups: [
      group(
        orgId,
        groupId,
        groupId === GROUP_B ? "Synthetic South Group" : "Synthetic North Group",
      ),
    ],
    facilities: [
      facility(
        orgId,
        facilityId,
        groupId,
        facilityId === FACILITY_B
          ? "South Clinic"
          : facilityId === FACILITY_NORTH
            ? "North Clinic"
            : "Central Clinic",
      ),
    ],
    providers: [
      clinician(
        orgId,
        providerId,
        `Casey${name}`,
        "Synthetic",
        options.taxonomyCode ?? "225100000X",
      ),
    ],
    provider_group_assignments: [groupAssignment(orgId, providerId, groupId)],
    provider_facility_assignments: [facilityAssignment(orgId, providerId, facilityId)],
    state_licenses: [license(orgId, providerId, isPta ? "PTA" : "PT")],
    credential_cases: [
      credentialCase({
        orgId,
        id: caseId,
        number: caseNumber,
        providerId,
        groupId,
        payerId,
        facilityId,
        status: options.status,
        approvedDaysAgo: approvalDaysAgo,
        terminationDaysAgo: options.terminationDaysAgo,
      }),
    ],
    case_facilities: [caseFacility(orgId, caseId, facilityId, Math.max(approvalDaysAgo, 8))],
    case_status_history: [
      statusEvent(
        orgId,
        caseId,
        `event-approved-${caseId}`,
        "approved",
        approvalDaysAgo,
        "in_review",
      ),
      ...(options.status === "denied"
        ? [statusEvent(orgId, caseId, `event-denied-${caseId}`, "denied", 1, "approved")]
        : []),
    ],
  };
}

function mergeFixtures(...overrides: Fixtures[]): Fixtures {
  const result = Object.fromEntries(
    Object.entries(baseFixtures).map(([table, rows]) => [table, [...rows]]),
  ) as Fixtures;
  for (const override of overrides) {
    for (const [table, rows] of Object.entries(override)) {
      const combined = [...(result[table] ?? []), ...rows];
      if (table === "provider_groups" || table === "facilities") {
        const unique = new Map(combined.map((row) => [`${row.org_id}:${row.id}`, row]));
        result[table] = [...unique.values()];
      } else {
        result[table] = combined;
      }
    }
  }
  return result;
}

function matchesAtom(row: Row, atom: string): boolean {
  const match = atom.match(/^([^.]+)\.(?:(not)\.)?([^.]+)\.(.*)$/);
  if (!match) throw new Error(`Unsupported PostgREST filter expression: ${atom}`);
  const [, column, negated, operation, raw] = match;
  if (!(column in row))
    throw new Error(`Fixture is missing filtered column ${column}: ${JSON.stringify(row)}`);
  const actual = row[column];
  const expected = raw.replace(/^"|"$/g, "");
  let result: boolean;
  switch (operation) {
    case "eq":
      result = String(actual) === expected;
      break;
    case "neq":
      result = String(actual) !== expected;
      break;
    case "is":
      if (expected === "null") result = actual === null || actual === undefined;
      else if (expected === "true") result = actual === true;
      else if (expected === "false") result = actual === false;
      else result = String(actual) === expected;
      break;
    case "gte":
      result = actual !== null && actual !== undefined && String(actual) >= expected;
      break;
    case "lte":
      result = actual !== null && actual !== undefined && String(actual) <= expected;
      break;
    case "in": {
      const choices = expected
        .replace(/^\(|\)$/g, "")
        .split(",")
        .map((value) => value.replace(/^"|"$/g, ""));
      result = choices.includes(String(actual));
      break;
    }
    case "like":
    case "ilike": {
      const escaped = expected
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/%/g, ".*")
        .replace(/_/g, ".");
      const matcher = new RegExp(`^${escaped}$`, operation === "ilike" ? "i" : "");
      result = matcher.test(String(actual));
      break;
    }
    default:
      throw new Error(`Unsupported PostgREST filter operator: ${operation} (${atom})`);
  }
  return negated ? !result : result;
}

function matchesRow(row: Row, url: URL): boolean {
  for (const [key, value] of url.searchParams.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(key)) continue;
    if (key === "or") {
      const clauses = value.replace(/^\(|\)$/g, "").split(",");
      if (!clauses.some((clause) => matchesAtom(row, clause))) return false;
      continue;
    }
    if (key === "and") {
      const clauses = value.replace(/^\(|\)$/g, "").split(",");
      if (!clauses.every((clause) => matchesAtom(row, clause))) return false;
      continue;
    }
    if (!matchesAtom(row, `${key}.${value}`)) return false;
  }
  return true;
}

function projectRows(rows: Row[], url: URL): Row[] {
  const select = url.searchParams.get("select");
  if (!select || select === "*" || select.includes("(")) return rows;
  const columns = select.split(",").map((column) => column.trim());
  return rows.map((row) => {
    const projected: Row = {};
    for (const column of columns) {
      if (!(column in row))
        throw new Error(`Fixture is missing selected column ${column}: ${JSON.stringify(row)}`);
      projected[column] = row[column];
    }
    return projected;
  });
}

function makeHandler(fixtures: Fixtures, failTables: ReadonlySet<string> = new Set()) {
  const requests: MockRequest[] = [];
  const handler = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
        headers: {
          "access-control-expose-headers": "Content-Range",
          ...headers,
        },
      });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    requests.push({ table, url: url.toString() });
    if (failTables.has(table)) {
      return json({ code: "PGRST500", message: "Synthetic read failure" }, 500);
    }

    const matchingRows = (fixtures[table] ?? []).filter((row) => matchesRow(row, url));
    const select = url.searchParams.get("select");
    const normalizedSelect = normalizeSelect(select);
    const expectedBillingSelect = BILLING_SELECTS[table];
    const expectedAppSelect = APP_SELECTS[table];
    const allRows =
      (expectedBillingSelect !== undefined &&
        normalizedSelect === normalizeSelect(expectedBillingSelect)) ||
      (expectedAppSelect !== undefined && normalizedSelect === normalizeSelect(expectedAppSelect))
        ? projectRows(matchingRows, url)
        : matchingRows;
    const accept = request.headers()["accept"] ?? "";
    if (accept.includes("vnd.pgrst.object")) {
      if (allRows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(allRows[0]);
    }

    const rangeHeader = request.headers().range;
    const range = rangeHeader?.match(/^(\d+)-(\d+)$/);
    const offset = Number(url.searchParams.get("offset") ?? range?.[1] ?? 0);
    const limit = Number(
      url.searchParams.get("limit") ?? (range ? Number(range[2]) - offset + 1 : allRows.length),
    );
    const rows = allRows.slice(offset, offset + limit);
    const contentRange =
      rows.length > 0
        ? `${offset}-${offset + rows.length - 1}/${matchingRows.length}`
        : `*/${matchingRows.length}`;
    return json(rows, 200, { "content-range": contentRange });
  };
  return { handler, requests };
}

async function seed(
  context: import("@playwright/test").BrowserContext,
  fixtures: Fixtures,
  activeOrgId = ORG_A,
  failTables: ReadonlySet<string> = new Set(),
) {
  const mock = makeHandler(fixtures, failTables);
  await context.route(/\/(rest|auth)\/v1\//, mock.handler);
  await context.addInitScript(
    ([authKey, session, orgId]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, activeOrgId] as const,
  );
  return mock.requests;
}

function expectOrganizationScoped(requests: MockRequest[], orgId: string) {
  const reads = requests.filter((request) => {
    const expectedSelect = BILLING_SELECTS[request.table];
    return (
      expectedSelect !== undefined &&
      normalizeSelect(new URL(request.url).searchParams.get("select")) ===
        normalizeSelect(expectedSelect)
    );
  });
  const requestSummary = requests
    .map(({ table, url: requestUrl }) => {
      const url = new URL(requestUrl);
      return `${table}: select=${url.searchParams.get("select") ?? "<none>"}, org_id=${url.searchParams.get("org_id") ?? "<none>"}, or=${url.searchParams.get("or") ?? "<none>"}`;
    })
    .join("; ");
  expect(
    reads.map((request) => request.table).sort(),
    `Expected all billing source projections for ${orgId}; captured: ${requestSummary}`,
  ).toEqual(Object.keys(BILLING_SELECTS).sort());
  for (const request of reads) {
    const url = new URL(request.url);
    if (request.table === "payers") {
      expect(url.searchParams.get("or")).toContain(`org_id.eq.${orgId}`);
    } else {
      expect(url.searchParams.get("org_id")).toBe(`eq.${orgId}`);
    }
  }
}

async function choose(page: import("@playwright/test").Page, label: string, optionName: string) {
  const control = page.getByRole("combobox", { name: label });
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  if ((await control.evaluate((element) => element.tagName)) === "SELECT") {
    await control.selectOption({ label: optionName });
  } else {
    await control.click();
    await page.getByRole("option", { name: optionName, exact: true }).click();
  }
}

function feedRowsWithProvider(page: Page, providerName: string) {
  return page.getByRole("tabpanel").getByRole("row").filter({ hasText: providerName });
}

test("Reporting Center links to billing readiness; exact approved scope is green and PTA stays held", async ({
  context,
  page,
}) => {
  const world = mergeFixtures(
    enrollmentRows(ORG_A, GROUP_A, "provider-pt", "case-pt", 101, FACILITY_A, PAYER_BLUE, 3),
    enrollmentRows(ORG_A, GROUP_A, "provider-pta", "case-pta", 102, FACILITY_A, PAYER_BLUE, 3, {
      taxonomyCode: "225200000X",
    }),
  );
  // Both clinicians work at the same facility; the PT is only a candidate and
  // cannot establish a supervisor relationship for the PTA.
  world.provider_facility_assignments = world.provider_facility_assignments.map((row) =>
    row.provider_id === "provider-pta" ? { ...row, facility_id: FACILITY_A } : row,
  );
  await seed(context, world);

  await page.goto("/reporting");
  await expect(page.getByRole("heading", { name: "Reporting Center" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("link", { name: /Billing Readiness/ }).click();
  await expect(page).toHaveURL(/\/reporting\/billing-readiness$/);
  await expect(page.getByRole("heading", { name: "Billing Readiness" })).toBeVisible();

  await page.getByRole("tab", { name: "Clearance Lookup" }).click();
  await choose(page, "Clinician", clinicianOption("provider-pt", "Caseyproviderpt Synthetic"));
  await choose(page, "Facility", facilityOption("Central Clinic"));
  await choose(page, "Payer", "Blue Cross Synthetic");
  await expect(page.getByRole("combobox", { name: "Clinician" })).toContainText(
    `NPI ${syntheticNpi("provider-pt")}`,
  );
  await expect(page.getByRole("combobox", { name: "Facility" })).toContainText(
    facilityOption("Central Clinic"),
  );
  await expect(
    page.getByTestId("billing-assessment-status").getByText("Billable Ready", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tabpanel").getByText("Caseyproviderpta Synthetic")).toHaveCount(0);

  await choose(page, "Clinician", clinicianOption("provider-pta", "Caseyproviderpta Synthetic"));
  await choose(page, "Facility", facilityOption("Central Clinic"));
  await choose(page, "Payer", "Blue Cross Synthetic");
  await expect(
    page.getByTestId("billing-assessment-status").getByText("Hold", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tabpanel").getByText("CQ modifier guidance: PTA supervision is unverified.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("feed ranges and filters apply; digest includes only combinations that pass current readiness", async ({
  context,
  page,
}) => {
  const migratedBackfill = enrollmentRows(
    ORG_A,
    GROUP_A,
    "provider-migrated",
    "case-migrated",
    206,
    FACILITY_A,
    PAYER_BLUE,
    3,
  );
  migratedBackfill.case_status_history = [
    statusEvent(ORG_A, "case-migrated", "event-approved-case-migrated", "approved", 3, null),
  ].map((row) => ({
    ...row,
    actor_kind: "system",
    note: "Unified case status migration (E6.0)",
  }));
  migratedBackfill.case_facilities = migratedBackfill.case_facilities.map((row) => ({
    ...row,
    created_by: null,
  }));

  const world = mergeFixtures(
    enrollmentRows(
      ORG_A,
      GROUP_A,
      "provider-recent",
      "case-recent",
      201,
      FACILITY_A,
      PAYER_BLUE,
      3,
    ),
    enrollmentRows(ORG_A, GROUP_A, "provider-mid", "case-mid", 202, FACILITY_A, PAYER_BLUE, 20),
    enrollmentRows(
      ORG_A,
      GROUP_A,
      "provider-old",
      "case-old",
      203,
      FACILITY_NORTH,
      PAYER_CIGNA,
      45,
    ),
    enrollmentRows(
      ORG_A,
      GROUP_A,
      "provider-denied",
      "case-denied",
      204,
      FACILITY_A,
      PAYER_BLUE,
      3,
      {
        status: "denied",
      },
    ),
    enrollmentRows(
      ORG_A,
      GROUP_A,
      "provider-terminated",
      "case-terminated",
      205,
      FACILITY_NORTH,
      PAYER_CIGNA,
      20,
      {
        terminationDaysAgo: 2,
      },
    ),
    migratedBackfill,
  );
  world.status_configs = [
    { id: "legacy-approved", org_id: ORG_A, track: "credentialing", label: "Approved" },
  ];
  world.status_history = [
    {
      id: "legacy-recent-approved",
      org_id: ORG_A,
      case_id: "case-recent",
      track: "credentialing",
      to_status_id: "legacy-approved",
      changed_at: timestampOffset(-3),
    },
  ];
  await seed(context, world);
  await page.goto("/reporting/billing-readiness");
  await expect(page.getByRole("heading", { name: "Billing Readiness" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("tab", { name: "Change Feed" }).click();

  await choose(page, "Date range", "Last 7 days");
  await expect(feedRowsWithProvider(page, "Caseyproviderrecent Synthetic")).toHaveCount(1);
  await expect(feedRowsWithProvider(page, "Caseyprovidermid Synthetic")).toHaveCount(0);
  await expect(feedRowsWithProvider(page, "Caseyproviderold Synthetic")).toHaveCount(0);

  await choose(page, "Date range", "Last 30 days");
  await expect(feedRowsWithProvider(page, "Caseyprovidermid Synthetic")).not.toHaveCount(0);
  await expect(feedRowsWithProvider(page, "Caseyproviderold Synthetic")).toHaveCount(0);
  await choose(page, "Date range", "Last 90 days");
  await expect(feedRowsWithProvider(page, "Caseyproviderold Synthetic")).not.toHaveCount(0);
  await expect(feedRowsWithProvider(page, "Caseyprovidermigrated Synthetic")).toHaveCount(0);

  await choose(page, "Facility", facilityOption("North Clinic"));
  await expect(feedRowsWithProvider(page, "Caseyproviderold Synthetic")).not.toHaveCount(0);
  await expect(feedRowsWithProvider(page, "Caseyproviderrecent Synthetic")).toHaveCount(0);
  await choose(page, "Payer", "Blue Cross Synthetic");
  await expect(feedRowsWithProvider(page, "Caseyproviderold Synthetic")).toHaveCount(0);
  await choose(page, "Payer", "Cigna Synthetic");
  await expect(feedRowsWithProvider(page, "Caseyproviderold Synthetic")).not.toHaveCount(0);

  await choose(page, "Facility", "All facilities");
  await choose(page, "Payer", "All payers");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Newly Billable Digest" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("newly-billable-digest.csv");
  const csvText = await readFile(await download.path(), "utf8");
  expect(csvText).toContain(syntheticNpi("provider-recent"));
  expect(csvText).toContain(syntheticNpi("provider-mid"));
  expect(csvText).toContain(syntheticNpi("provider-old"));
  expect(csvText).not.toContain(syntheticNpi("provider-denied"));
  expect(csvText).not.toContain(syntheticNpi("provider-terminated"));
  expect(csvText).not.toContain(syntheticNpi("provider-migrated"));
});

test("switching organizations clears lookup selections and replaces feed rows", async ({
  context,
  page,
}) => {
  const world = mergeFixtures(
    enrollmentRows(ORG_A, GROUP_A, "provider-north", "case-north", 301, FACILITY_A, PAYER_BLUE, 2),
    enrollmentRows(ORG_B, GROUP_B, "provider-south", "case-south", 401, FACILITY_B, PAYER_BLUE, 2),
  );
  const requests = await seed(context, world, ORG_A);
  await page.goto("/reporting/billing-readiness");
  await expect(page.getByRole("heading", { name: "Billing Readiness" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("tab", { name: "Clearance Lookup" }).click();
  await choose(
    page,
    "Clinician",
    clinicianOption("provider-north", "Caseyprovidernorth Synthetic"),
  );
  await choose(page, "Facility", facilityOption("Central Clinic"));
  await choose(page, "Payer", "Blue Cross Synthetic");
  await expect(page.getByRole("combobox", { name: "Clinician" })).toContainText(
    `NPI ${syntheticNpi("provider-north")}`,
  );
  expectOrganizationScoped(requests, ORG_A);
  const switchRequestStart = requests.length;

  await page.getByRole("button", { name: /Active organization: Synthetic North Rehab/ }).click();
  await page.getByRole("menuitem", { name: "Synthetic South Rehab" }).click();
  await expect(
    page.getByRole("button", { name: /Active organization: Synthetic South Rehab/ }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Clinician" })).toHaveText("Select clinician");
  await expect(page.getByRole("combobox", { name: "Facility" })).toHaveText("Select facility");
  await page.getByRole("tab", { name: "Change Feed" }).click();
  await expect(feedRowsWithProvider(page, "Caseyprovidersouth Synthetic")).not.toHaveCount(0);
  await expect(feedRowsWithProvider(page, "Caseyprovidernorth Synthetic")).toHaveCount(0);
  expectOrganizationScoped(requests.slice(switchRequestStart), ORG_B);
});

test("a failed fresh read clears a prior green result and cancels the digest", async ({
  context,
  page,
}) => {
  const world = mergeFixtures(
    enrollmentRows(ORG_A, GROUP_A, "provider-error", "case-error", 501, FACILITY_A, PAYER_BLUE, 3),
  );
  const failedTables = new Set<string>();
  await seed(context, world, ORG_A, failedTables);
  await page.goto("/reporting/billing-readiness");
  await expect(page.getByRole("heading", { name: "Billing Readiness" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("tab", { name: "Clearance Lookup" }).click();
  await choose(
    page,
    "Clinician",
    clinicianOption("provider-error", "Caseyprovidererror Synthetic"),
  );
  await choose(page, "Facility", facilityOption("Central Clinic"));
  await choose(page, "Payer", "Blue Cross Synthetic");
  await expect(
    page.getByTestId("billing-assessment-status").getByText("Billable Ready", { exact: true }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Change Feed" }).click();
  const digest = page.getByRole("button", { name: "Newly Billable Digest" });
  await expect(digest).toBeEnabled();

  failedTables.add("credential_cases");
  const noDownload = page
    .waitForEvent("download", { timeout: 3000 })
    .then(() => false)
    .catch(() => true);
  await digest.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Current organization reads did not complete." }),
  ).toBeVisible();
  await expect(digest).toBeDisabled();
  expect(await noDownload).toBe(true);

  await page.getByRole("tab", { name: "Clearance Lookup" }).click();
  await expect(page.getByTestId("billing-assessment-status")).toHaveCount(0);
});
