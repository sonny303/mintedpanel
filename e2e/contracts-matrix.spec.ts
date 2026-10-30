// Group Contracts Matrix — organization view (spec "Group Contracts Matrix:
// Organization View", Oct 29, 2026). The fixture is the spec's PT/Nutrition
// example: Group Name 1 (PT in CO, NM), Group Name 2 (PT and Nutrition in KS,
// MO), Group Name 3 (PT in LA, NE; Nutrition in NE). The mock honors PostgREST
// filters and writes through, so the upsert lookup by its 4-part key and the
// refetch after a save both behave as they do against the real database.
import { expect, test, type Page, type Route } from "./fixtures/legacy-access-context";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_1 = "33333333-3333-4333-8333-333333333331";
const GROUP_2 = "33333333-3333-4333-8333-333333333332";
const GROUP_3 = "33333333-3333-4333-8333-333333333333";
const GROUP_4 = "33333333-3333-4333-8333-333333333334";
const PAYER_1 = "44444444-4444-4444-8444-444444444441";
const PAYER_2 = "44444444-4444-4444-8444-444444444442";
const BLUE_KC = "44444444-4444-4444-8444-444444444443";
const BLUE_KC_NAME = "Blue Cross and Blue Shield of Kansas City (Blue KC)";

const PT_CODE = "225100000X";
const DIETITIAN_CODE = "133V00000X";
const ALL_STATES = ["CO", "KS", "LA", "MO", "NE", "NM"];

const STATUS = {
  notStarted: "55555555-5555-4555-8555-555555555501",
  submitted: "55555555-5555-4555-8555-555555555502",
  signed: "55555555-5555-4555-8555-555555555503",
  inNetwork: "55555555-5555-4555-8555-555555555504",
  denied: "55555555-5555-4555-8555-555555555505",
  appealed: "55555555-5555-4555-8555-555555555506",
  reapplied: "55555555-5555-4555-8555-555555555507",
  outOfNetwork: "55555555-5555-4555-8555-555555555508",
};

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
    email: "operator@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Test Operator" },
    created_at: "2026-07-09T00:00:00Z",
  },
};

type Row = Record<string, unknown>;

function contractRow(
  id: string,
  groupId: string,
  payerId: string,
  state: string,
  specialtyKey: string,
  statusId: string,
  extra: Row = {},
): Row {
  return {
    id,
    org_id: ORG_ID,
    group_id: groupId,
    payer_id: payerId,
    state,
    specialty_key: specialtyKey,
    contracting_status_id: statusId,
    effective_date: null,
    tentative_effective_date: null,
    expiration_date: null,
    specialty: null,
    notes: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...extra,
  };
}

/** One provider of a specialty, a member of `groupId`, at an active clinic of
 * that group in each state. */
function staff(
  rows: Record<string, Row[]>,
  providerId: string,
  groupId: string,
  taxonomyCode: string,
  states: string[],
) {
  rows.providers.push({
    id: providerId,
    org_id: ORG_ID,
    first_name: providerId,
    last_name: "Provider",
    status: "active",
    verification_state: "verified",
    is_test_provider: false,
    taxonomy_code: taxonomyCode,
    npi: null,
    caqh_id: null,
    caqh_last_attested_date: null,
    date_of_birth: null,
    ssn_last4: null,
  });
  rows.provider_group_assignments.push({
    id: `pga-${providerId}`,
    org_id: ORG_ID,
    provider_id: providerId,
    group_id: groupId,
    is_primary: true,
    start_date: null,
    end_date: null,
  });
  for (const state of states) {
    const facilityId = `fac-${groupId}-${state}`;
    if (!rows.facilities.some((facility) => facility.id === facilityId)) {
      rows.facilities.push({
        id: facilityId,
        org_id: ORG_ID,
        group_id: groupId,
        name: `${state} Clinic`,
        state,
        is_active: true,
        reference_only: false,
      });
    }
    rows.provider_facility_assignments.push({
      id: `pfa-${providerId}-${state}`,
      org_id: ORG_ID,
      provider_id: providerId,
      facility_id: facilityId,
      is_primary: false,
    });
  }
}

function makeFixtures(role: "admin" | "billing"): Record<string, Row[]> {
  const rows: Record<string, Row[]> = {
    organizations: [{ id: ORG_ID, name: "Acme Health", lifecycle_state: "active" }],
    memberships: [
      {
        org_id: ORG_ID,
        role,
        organizations: { id: ORG_ID, name: "Acme Health", lifecycle_state: "active" },
      },
    ],
    provider_groups: [
      { id: GROUP_1, org_id: ORG_ID, name: "Group Name 1", tin: "00-0000001", is_active: true },
      { id: GROUP_2, org_id: ORG_ID, name: "Group Name 2", tin: "00-0000002", is_active: true },
      { id: GROUP_3, org_id: ORG_ID, name: "Group Name 3", tin: "00-0000003", is_active: true },
      // Deactivated: hidden by default (D4), shown when a case links to it.
      { id: GROUP_4, org_id: ORG_ID, name: "Group Name 4", tin: "00-0000004", is_active: false },
    ],
    providers: [],
    provider_group_assignments: [],
    provider_facility_assignments: [],
    facilities: [],
    state_licenses: [],
    payers: [
      { id: PAYER_1, org_id: null, name: "Payer 1", is_active: true, states: ALL_STATES },
      { id: PAYER_2, org_id: null, name: "Payer 2", is_active: true, states: ALL_STATES },
      { id: BLUE_KC, org_id: null, name: BLUE_KC_NAME, is_active: true, states: ["KS", "MO"] },
    ],
    payer_network_targets: [PAYER_1, PAYER_2, BLUE_KC].map((payerId, index) => ({
      id: `target-${index}`,
      org_id: ORG_ID,
      group_id: GROUP_2,
      payer_id: payerId,
      state: "KS",
      status: "active",
      created_at: "2026-09-01T00:00:00Z",
    })),
    status_configs: [
      ["Not Started", STATUS.notStarted],
      ["Application Submitted", STATUS.submitted],
      ["In Progress (Contract Signed)", STATUS.signed],
      ["In-Network", STATUS.inNetwork],
      ["Denied", STATUS.denied],
      ["Denied - Appealed", STATUS.appealed],
      ["Denied - Reapplied", STATUS.reapplied],
      ["Out of Network", STATUS.outOfNetwork],
    ].map(([label, id], index) => ({
      id,
      org_id: ORG_ID,
      track: "contracting",
      label,
      color: "#9CA3AF",
      sort_order: index * 10,
    })),
    contracts: [
      // One agreement for every specialty: shows, tagged All, in both tables.
      contractRow("c-shared", GROUP_2, PAYER_1, "KS", "all", STATUS.inNetwork, {
        effective_date: "2026-03-01",
      }),
      // A different status per specialty in the same group and state (D11).
      contractRow("c-p2-pt", GROUP_2, PAYER_2, "KS", "pt", STATUS.inNetwork, {
        effective_date: "2026-02-01",
      }),
      contractRow("c-p2-nutrition", GROUP_2, PAYER_2, "KS", "nutrition", STATUS.denied, {
        notes: "Does not contract dietitians in KS.",
      }),
      contractRow("c-p1-co", GROUP_1, PAYER_1, "CO", "pt", STATUS.submitted),
      contractRow("c-p1-mo", GROUP_2, PAYER_1, "MO", "pt", STATUS.submitted),
      contractRow("c-g4-ks", GROUP_4, PAYER_2, "KS", "pt", STATUS.submitted),
      contractRow("c-bkc-mo", GROUP_2, BLUE_KC, "MO", "pt", STATUS.signed, {
        tentative_effective_date: "2026-12-01",
      }),
    ],
    sop_templates: [],
    contract_sop_assignments: [],
    credential_cases: [],
    touches: [],
    notes: [],
    inbound_leads: [],
    user_table_prefs: [],
    status_history: [],
    audit_log: [],
  };
  staff(rows, "pt-1", GROUP_1, PT_CODE, ["CO", "NM"]);
  staff(rows, "pt-2", GROUP_2, PT_CODE, ["KS", "MO"]);
  staff(rows, "rd-2", GROUP_2, DIETITIAN_CODE, ["KS", "MO"]);
  staff(rows, "pt-3", GROUP_3, PT_CODE, ["LA", "NE"]);
  staff(rows, "rd-3", GROUP_3, DIETITIAN_CODE, ["NE"]);
  return rows;
}

interface RecordedWrite {
  table: string;
  method: string;
  body: Row;
}

const IGNORED_PARAMS = new Set([
  "select",
  "order",
  "limit",
  "offset",
  "on_conflict",
  "or",
  "columns",
]);

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [key, raw] of params.entries()) {
    if (IGNORED_PARAMS.has(key) || !(key in row)) continue;
    const value = row[key];
    if (raw.startsWith("eq.")) {
      if (String(value) !== raw.slice(3)) return false;
    } else if (raw.startsWith("neq.")) {
      if (String(value) === raw.slice(4)) return false;
    } else if (raw.startsWith("in.(")) {
      const ids = raw
        .slice(4, -1)
        .split(",")
        .map((s) => s.replace(/^"|"$/g, ""));
      if (!ids.includes(String(value))) return false;
    } else if (raw === "is.null") {
      if (value !== null && value !== undefined) return false;
    }
  }
  return true;
}

async function installMatrix(page: Page, role: "admin" | "billing" = "admin") {
  await page.context().addInitScript(
    ({ authKey, session, orgId }) => {
      localStorage.setItem(authKey, JSON.stringify(session));
      localStorage.setItem("active_org_id", orgId);
    },
    { authKey: AUTH_KEY, session: SESSION, orgId: ORG_ID },
  );
  const fixtures = makeFixtures(role);
  const writes: RecordedWrite[] = [];
  let created = 0;

  await page.route("**/rest/v1/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.split("/rest/v1/")[1] ?? "";
    const method = request.method();
    const wantsObject = (request.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path.startsWith("rpc/")) return json(path === "rpc/claim_invites" ? 0 : []);
    const table = path;
    if (method === "HEAD") {
      return route.fulfill({ status: 200, headers: { "content-range": "*/0" } });
    }
    const rows = fixtures[table] ?? [];

    if (method === "GET") {
      const found = rows.filter((row) => matches(row, url.searchParams));
      if (wantsObject) {
        return found.length === 0
          ? json({ code: "PGRST116", message: "no rows" }, 406)
          : json(found[0]);
      }
      return json(found);
    }

    const parsed: unknown = request.postDataJSON();
    const bodies = (Array.isArray(parsed) ? parsed : [parsed]) as Row[];
    if (method === "POST") {
      const inserted = bodies.map((body) => {
        writes.push({ table, method, body });
        created += 1;
        const row: Row = {
          id: `created-${created}`,
          created_at: "2026-10-29T00:00:00Z",
          updated_at: "2026-10-29T00:00:00Z",
          ...(table === "contracts"
            ? { effective_date: null, tentative_effective_date: null, expiration_date: null }
            : {}),
          ...(table === "contracts" ? { specialty: null, notes: null } : {}),
          ...body,
        };
        rows.push(row);
        fixtures[table] = rows;
        return row;
      });
      return json(wantsObject ? inserted[0] : inserted, 201);
    }
    if (method === "PATCH") {
      writes.push({ table, method, body: bodies[0] });
      const updated = rows.filter((row) => matches(row, url.searchParams));
      for (const row of updated) Object.assign(row, bodies[0]);
      if (wantsObject) {
        return updated.length === 0
          ? json({ code: "PGRST116", message: "no rows" }, 406)
          : json(updated[0]);
      }
      return json(updated);
    }
    return json([]);
  });

  return { fixtures, writes };
}

function region(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

function columnHeaders(page: Page, name: string) {
  return region(page, name).locator('thead th[scope="col"]');
}

test("renders one table per specialty under the organization's name", async ({ page }) => {
  await installMatrix(page);
  await page.goto("/reporting/contracts-matrix");

  await expect(page.getByRole("heading", { name: "Group Contracts Matrix" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Acme Health", level: 2 })).toBeVisible();
  await expect(page.getByTestId("matrix-scope")).toHaveText(
    "3 groups · 2 specialties · 6 states · 3 payers",
  );
  // GCM-36: the shared record counts once although it shows in two tables.
  await expect(page.getByTestId("matrix-totals")).toHaveText("6 contract records · 2 in network");

  // GCM-30: each table's columns come from its own specialty's footprint.
  await expect(columnHeaders(page, "Physical therapy")).toHaveText([
    "Payer",
    "CO",
    "NM",
    "KS",
    "MO",
    "LA",
    "NE",
  ]);
  await expect(columnHeaders(page, "Nutrition")).toHaveText(["Payer", "KS", "MO", "NE"]);
  const ptGroups = region(page, "Physical therapy").locator('thead th[scope="colgroup"]');
  await expect(ptGroups).toHaveText([
    "Group Name 1TIN 00-0000001",
    "Group Name 2TIN 00-0000002",
    "Group Name 3TIN 00-0000003",
  ]);
  await expect(ptGroups.nth(1)).toHaveAttribute("colspan", "2");

  // GCM-31: the all-specialties record shows, tagged All, in both tables.
  for (const specialty of ["Physical therapy", "Nutrition"]) {
    const shared = region(page, specialty).getByRole("button", {
      name: `Payer 1, ${specialty}, Group Name 2, KS: In-Network (All specialties)`,
    });
    await expect(shared).toContainText("In network");
    await expect(shared).toContainText("All");
    await expect(shared).toContainText("Eff Mar 1, 2026");
  }
  // D11: the same group, payer and state with a different status per specialty.
  await expect(
    region(page, "Physical therapy").getByRole("button", {
      name: "Payer 2, Physical therapy, Group Name 2, KS: In-Network",
    }),
  ).toBeVisible();
  await expect(
    region(page, "Nutrition").getByRole("button", {
      name: "Payer 2, Nutrition, Group Name 2, KS: Denied",
    }),
  ).toContainText("Denied");
  await expect(page.getByText("Payer 2 · Nutrition · Group Name 2 · KS")).toBeVisible();
  await expect(page.getByText("Does not contract dietitians in KS.")).toBeVisible();

  // GCM-26: a state the plan does not serve is shaded and not clickable.
  const outsideLabel = `${BLUE_KC_NAME}, Physical therapy, Group Name 1, CO: Not in the plan's area`;
  const outside = region(page, "Physical therapy").locator('td[data-cell-kind="outside"]', {
    hasText: outsideLabel,
  });
  await expect(outside).toHaveCount(1);
  await expect(outside.getByRole("button")).toHaveCount(0);
  await outside.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(/Shaded cells are states the plan does not serve/)).toBeVisible();

  // GCM-15: By state puts the state on top and the group names under it.
  await page.getByRole("tab", { name: "By state" }).click();
  await expect(region(page, "Nutrition").locator('thead th[scope="colgroup"]').first()).toHaveText(
    "KS1 group",
  );
  await expect(columnHeaders(page, "Nutrition")).toHaveText([
    "Payer",
    "Group Name 2",
    "Group Name 2",
    "Group Name 3",
  ]);

  // GCM-29: the Nutrition chip hides that table; the PT table stays.
  await page.getByRole("button", { name: "Nutrition", pressed: true }).click();
  await expect(region(page, "Nutrition")).toHaveCount(0);
  await expect(region(page, "Physical therapy")).toBeVisible();
});

test("opens a cell's dialog with the group's TIN and the specialty table", async ({ page }) => {
  await installMatrix(page);
  await page.goto("/reporting/contracts-matrix");

  await region(page, "Physical therapy")
    .getByRole("button", { name: "Payer 2, Physical therapy, Group Name 2, KS: In-Network" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Payer 2 — KS" })).toBeVisible();
  await expect(dialog.getByText("Group Name 2 · TIN 00-0000002")).toBeVisible();
  await expect(dialog.getByText("Group contract · Physical therapy table")).toBeVisible();
  await expect(dialog.getByTestId("contract-covers-value")).toHaveText("Physical therapy only");
  await expect(dialog.getByPlaceholder("e.g. Physical Therapy, Multi-Specialty")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Nutrition only on a shared record saves a new Nutrition record", async ({ page }) => {
  const { fixtures, writes } = await installMatrix(page);
  await page.goto("/reporting/contracts-matrix");

  await region(page, "Nutrition")
    .getByRole("button", {
      name: "Payer 1, Nutrition, Group Name 2, KS: In-Network (All specialties)",
    })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("radio", { name: "All specialties" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    dialog.getByText(
      /so it also shows in the Physical therapy table\. Saving changes it there too/,
    ),
  ).toBeVisible();

  // The Covers radio group: one tab stop, arrow keys move and select.
  await dialog.getByRole("radio", { name: "All specialties" }).focus();
  await page.keyboard.press("ArrowRight");
  const nutritionOnly = dialog.getByRole("radio", { name: "Nutrition only" });
  await expect(nutritionOnly).toHaveAttribute("aria-checked", "true");
  await expect(nutritionOnly).toBeFocused();
  await expect(nutritionOnly).toHaveAttribute("tabindex", "0");
  await expect(dialog.getByText(/Saving creates a separate Nutrition record/)).toBeVisible();
  // The new record does not exist yet, so no SOP can be attached to it.
  await expect(dialog.getByText("Save first to assign this record's SOP.")).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Contract SOP" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Save contract" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const contractWrites = writes.filter((write) => write.table === "contracts");
  expect(contractWrites).toHaveLength(1);
  expect(contractWrites[0].method).toBe("POST");
  expect(contractWrites[0].body).toMatchObject({
    org_id: ORG_ID,
    group_id: GROUP_2,
    payer_id: PAYER_1,
    state: "KS",
    specialty_key: "nutrition",
    contracting_status_id: STATUS.inNetwork,
    effective_date: "2026-03-01",
  });
  expect(contractWrites[0].body).not.toHaveProperty("specialty");
  // The shared record is untouched.
  expect(fixtures.contracts.find((row) => row.id === "c-shared")).toMatchObject({
    specialty_key: "all",
    contracting_status_id: STATUS.inNetwork,
  });

  // After the refetch, Nutrition shows its own record; PT keeps the shared one.
  await expect(
    region(page, "Nutrition").getByRole("button", {
      name: "Payer 1, Nutrition, Group Name 2, KS: In-Network",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    region(page, "Physical therapy").getByRole("button", {
      name: "Payer 1, Physical therapy, Group Name 2, KS: In-Network (All specialties)",
    }),
  ).toBeVisible();
});

test("Also apply saves the same status and dates to the plan's other state", async ({ page }) => {
  const { writes } = await installMatrix(page);
  await page.goto("/reporting/contracts-matrix");

  await region(page, "Physical therapy")
    .getByRole("button", {
      name: `${BLUE_KC_NAME}, Physical therapy, Group Name 2, MO: In Progress (Contract Signed)`,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("checkbox", {
      name: "Also apply this status and these dates to KS for Group Name 2",
    })
    .click();
  await dialog.getByRole("button", { name: "Save contract" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const contractWrites = writes.filter((write) => write.table === "contracts");
  expect(contractWrites.map((write) => write.method)).toEqual(["PATCH", "POST"]);
  expect(contractWrites[0].body).toMatchObject({
    contracting_status_id: STATUS.signed,
    tentative_effective_date: "2026-12-01",
  });
  expect(contractWrites[0].body).not.toHaveProperty("specialty_key");
  expect(contractWrites[1].body).toMatchObject({
    group_id: GROUP_2,
    payer_id: BLUE_KC,
    state: "KS",
    specialty_key: "pt",
    contracting_status_id: STATUS.signed,
    tentative_effective_date: "2026-12-01",
  });
  await expect(
    region(page, "Physical therapy").getByRole("button", {
      name: `${BLUE_KC_NAME}, Physical therapy, Group Name 2, KS: In Progress (Contract Signed)`,
    }),
  ).toBeVisible();
});

test("Also apply from a shared cell updates the other state's own record", async ({ page }) => {
  const { fixtures, writes } = await installMatrix(page);
  await page.goto("/reporting/contracts-matrix");

  // KS shows the shared record (Covers: All specialties); MO shows PT's own.
  await region(page, "Physical therapy")
    .getByRole("button", {
      name: "Payer 1, Physical therapy, Group Name 2, KS: In-Network (All specialties)",
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("checkbox", {
      name: "Also apply this status and these dates to MO for Group Name 2",
      exact: true,
    })
    .click();
  await dialog.getByRole("button", { name: "Save contract" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const contractWrites = writes.filter((write) => write.table === "contracts");
  // Both are updates: the shared KS record and PT's own MO record. No shared
  // MO record is created, so Nutrition's MO cell is untouched.
  expect(contractWrites.map((write) => write.method)).toEqual(["PATCH", "PATCH"]);
  expect(fixtures.contracts.find((row) => row.id === "c-p1-mo")).toMatchObject({
    specialty_key: "pt",
    contracting_status_id: STATUS.inNetwork,
    effective_date: "2026-03-01",
  });
  expect(
    fixtures.contracts.filter(
      (row) => row.payer_id === PAYER_1 && row.state === "MO" && row.specialty_key === "all",
    ),
  ).toHaveLength(0);
  await expect(
    region(page, "Physical therapy").getByRole("button", {
      name: "Payer 1, Physical therapy, Group Name 2, MO: In-Network",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    region(page, "Nutrition").getByRole("button", {
      name: "Payer 1, Nutrition, Group Name 2, MO: No contract record",
    }),
  ).toBeVisible();
});

test("Also apply into a shared state records the specialty separately", async ({ page }) => {
  const { fixtures, writes } = await installMatrix(page);
  await page.goto("/reporting/contracts-matrix");

  // MO is PT's own record; KS shows the shared record. Saving PT's status
  // into KS splits PT off there and leaves the shared record alone.
  await region(page, "Physical therapy")
    .getByRole("button", {
      name: "Payer 1, Physical therapy, Group Name 2, MO: Application Submitted",
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("checkbox", {
      name: "Also apply this status and these dates to KS for Group Name 2 (records Physical therapy separately)",
    })
    .click();
  await dialog.getByRole("button", { name: "Save contract" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const contractWrites = writes.filter((write) => write.table === "contracts");
  expect(contractWrites.map((write) => write.method)).toEqual(["PATCH", "POST"]);
  expect(contractWrites[1].body).toMatchObject({
    group_id: GROUP_2,
    payer_id: PAYER_1,
    state: "KS",
    specialty_key: "pt",
    contracting_status_id: STATUS.submitted,
  });
  expect(fixtures.contracts.find((row) => row.id === "c-shared")).toMatchObject({
    specialty_key: "all",
    contracting_status_id: STATUS.inNetwork,
  });
  await expect(
    region(page, "Physical therapy").getByRole("button", {
      name: "Payer 1, Physical therapy, Group Name 2, KS: Application Submitted",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    region(page, "Nutrition").getByRole("button", {
      name: "Payer 1, Nutrition, Group Name 2, KS: In-Network (All specialties)",
    }),
  ).toBeVisible();
});

test("a billing user gets a read-only dialog and no add affordances", async ({ page }) => {
  await installMatrix(page, "billing");
  await page.goto("/reporting/contracts-matrix");

  const pt = region(page, "Physical therapy");
  await expect(
    pt.getByRole("button", { name: "Payer 2, Physical therapy, Group Name 2, KS: In-Network" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Add payer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ Add state" })).toHaveCount(0);
  // GCM-10: an empty cell is not clickable for billing.
  await expect(
    pt.getByRole("button", {
      name: "Payer 1, Physical therapy, Group Name 1, NM: No contract record",
    }),
  ).toHaveCount(0);

  await pt
    .getByRole("button", { name: "Payer 2, Physical therapy, Group Name 2, KS: In-Network" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("View only. Billing users can see contract details but not change them."),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save contract" })).toHaveCount(0);
  await expect(dialog.getByLabel("Effective date")).toBeDisabled();
  await expect(dialog.getByLabel("Notes & cross-payer dependencies")).toBeDisabled();
  await dialog.getByRole("button", { name: "Close" }).last().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a link from a case opens the full view and outlines its cell", async ({ page }) => {
  await installMatrix(page);
  await page.goto(`/reporting/contracts-matrix?groupId=${GROUP_2}&payerId=${PAYER_2}&state=KS`);

  await expect(
    page.getByText(
      "Opened from a case: Payer 2 · Physical therapy · Group Name 2 · KS. The cell is highlighted below.",
    ),
  ).toBeVisible();
  // The link never narrows the view: every group's columns still show.
  await expect(columnHeaders(page, "Physical therapy")).toHaveCount(7);
  const highlighted = page.locator('[aria-current="location"]');
  await expect(highlighted).toHaveCount(1);
  await expect(highlighted).toHaveAttribute(
    "aria-label",
    "Payer 2, Physical therapy, Group Name 2, KS: In-Network",
  );
  await expect(highlighted).toBeInViewport();
});

test("a link naming the case's specialty highlights that specialty's table", async ({ page }) => {
  await installMatrix(page);
  await page.goto(
    `/reporting/contracts-matrix?groupId=${GROUP_2}&payerId=${PAYER_2}&state=KS&specialty=nutrition`,
  );

  await expect(
    page.getByText(
      "Opened from a case: Payer 2 · Nutrition · Group Name 2 · KS. The cell is highlighted below.",
    ),
  ).toBeVisible();
  const highlighted = page.locator('[aria-current="location"]');
  await expect(highlighted).toHaveCount(1);
  await expect(highlighted).toHaveAttribute(
    "aria-label",
    "Payer 2, Nutrition, Group Name 2, KS: Denied",
  );
});

test("a link to an inactive group shows that group without narrowing the view", async ({
  page,
}) => {
  await installMatrix(page);
  await page.goto(`/reporting/contracts-matrix?groupId=${GROUP_4}&payerId=${PAYER_2}&state=KS`);

  await expect(
    page.getByText(
      "Opened from a case: Payer 2 · Physical therapy · Group Name 4 · KS. The cell is highlighted below.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Group Name 4 (inactive)" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(region(page, "Physical therapy").locator('thead th[scope="colgroup"]')).toHaveCount(
    4,
  );
  await expect(page.locator('[aria-current="location"]')).toHaveAttribute(
    "aria-label",
    "Payer 2, Physical therapy, Group Name 4, KS: Application Submitted",
  );
});
