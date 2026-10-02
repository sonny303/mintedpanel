import { expect, test, type Route } from "./fixtures/legacy-access-context";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "00000000-0000-4000-a000-000000000005";
const PAYER_ID = "00000000-0000-4000-a000-0000000000aa";
const SOURCE_ID = "50000000-0000-4000-8000-000000000001";
const SOURCE_KEY = "aetna-provider-portal-enrollment-source";
const LEGACY_ID = "50000000-0000-4000-8000-000000000002";
const LEGACY_KEY = "aetna-legacy-portal";
const FORM_URL = "https://provider.aetna.test/forms";
const TEMPLATE_ID = "44444444-4444-4444-8444-000000000001";

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
    email: "owner.dillon@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Owner Dillon" },
    created_at: "2026-07-09T00:00:00Z",
  },
};

type Row = Record<string, unknown>;

interface Scenario {
  db: Record<string, Row[]>;
  createPayloads: Row[];
  portalUpdates: Array<{ functionName: string; body: Row }>;
}

function portalRow(input: {
  id: string;
  portal_key: string;
  name: string;
  case_type: string | null;
  requires_explicit_selection: boolean;
  is_verified: boolean;
  proven_at: string | null;
}): Row {
  return {
    ...input,
    org_id: ORG_ID,
    payer_id: PAYER_ID,
    form_url: FORM_URL,
    mapping_generation: 4,
    last_verified_at: input.is_verified ? "2026-07-20T00:00:00Z" : null,
    url_changed_at: null,
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-07-12T00:00:00Z",
  };
}

function fieldMapRow(id: string, portalKey: string, selector: string): Row {
  return {
    id,
    org_id: ORG_ID,
    portal_key: portalKey,
    url_pattern: null,
    page_step: null,
    map_type: "web",
    selector,
    selector_fallbacks: null,
    source: "manual",
    token: null,
    hardcoded_value: null,
    transform: null,
    field_type: "text",
    notes: "Existing mapping for this fixture portal.",
    status: "approved",
    control_options: null,
    field_label: "Provider NPI",
    form_section: "Provider details",
    confidence: null,
    display_label: "Provider NPI",
    section: "Provider details",
    sort_order: 0,
    learned_via: "manual",
    mapping_generation: 4,
    shared_base_generation: null,
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-07-12T00:00:00Z",
  };
}

function makeScenario(): Scenario {
  return {
    createPayloads: [],
    portalUpdates: [],
    db: {
      memberships: [
        {
          org_id: ORG_ID,
          role: "admin",
          organizations: {
            name: "Dillon Sports Medicine",
            lifecycle_state: "active",
            created_at: "2026-07-01T00:00:00Z",
          },
        },
      ],
      profiles: [{ id: USER_ID, full_name: "Owner Dillon", email: SESSION.user.email }],
      payers: [
        {
          id: PAYER_ID,
          org_id: null,
          name: "Aetna Provider Services",
          is_active: true,
          avg_decision_days: null,
          payer_kind: "commercial",
          payer_slug: "aetna-provider-services",
          aliases: ["Aetna"],
          states: ["AZ"],
          status: "active",
          merged_into_id: null,
          delegation_note: null,
          archived_at: null,
          created_at: "2026-07-12T00:00:00Z",
          updated_at: "2026-07-12T00:00:00Z",
        },
      ],
      payer_network_targets: [],
      org_payer_assignments: [],
      portals: [
        portalRow({
          id: SOURCE_ID,
          portal_key: SOURCE_KEY,
          name: "Aetna Provider Portal",
          case_type: "enrollment",
          requires_explicit_selection: true,
          is_verified: true,
          proven_at: "2026-07-20T00:00:00Z",
        }),
        portalRow({
          id: LEGACY_ID,
          portal_key: LEGACY_KEY,
          name: "[hidden] Legacy Aetna portal",
          case_type: null,
          requires_explicit_selection: false,
          is_verified: true,
          proven_at: "2026-06-18T00:00:00Z",
        }),
      ],
      portal_field_maps: [
        fieldMapRow("map-source-1", SOURCE_KEY, "#npi"),
        fieldMapRow("map-legacy-1", LEGACY_KEY, "#legacy-npi"),
      ],
      sop_templates: [
        {
          id: TEMPLATE_ID,
          org_id: ORG_ID,
          name: "Aetna enrollment intake",
          payer_id: PAYER_ID,
          state: "AZ",
          group_id: null,
          specialty: null,
          archived: false,
          current_version: 1,
          required_profile_attributes: [],
          case_type: "enrollment",
          task_definitions: [
            {
              title: "Enrollment application",
              steps: [
                {
                  label: "Submit this form",
                  stepType: "online_form",
                  portalKey: SOURCE_KEY,
                },
              ],
            },
          ],
          created_at: "2026-07-12T00:00:00Z",
          updated_at: "2026-07-12T00:00:00Z",
        },
      ],
      fill_sessions: [],
      audit_log: [],
    },
  };
}

function rowMatches(row: Row, url: URL): boolean {
  for (const [key, value] of url.searchParams.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict", "or", "and"].includes(key)) {
      continue;
    }
    if (!(key in row)) continue;
    if (value.startsWith("eq.") && String(row[key]) !== value.slice(3)) return false;
    if (value.startsWith("neq.") && String(row[key]) === value.slice(4)) return false;
    if (value === "is.null" && row[key] !== null) return false;
  }
  return true;
}

function projectRows(table: string, rows: Row[], url: URL, scenario: Scenario): Row[] {
  if (table !== "portals") return rows;
  const includesPayer = (url.searchParams.get("select") ?? "").includes("payers(");
  return rows.map((row) => {
    const { payers: _embeddedPayer, ...portal } = row;
    if (!includesPayer) return portal;
    const payer = scenario.db.payers.find((candidate) => candidate.id === portal.payer_id);
    return {
      ...portal,
      payers: payer
        ? {
            name: payer.name,
            status: payer.status,
            archived_at: payer.archived_at,
            merged_into_id: payer.merged_into_id,
          }
        : null,
    };
  });
}

async function fulfillSupabase(route: Route, scenario: Scenario) {
  const request = route.request();
  const url = new URL(request.url());
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  if (url.pathname.includes("/auth/v1/")) return json(SESSION);
  if (url.pathname.includes("/rest/v1/rpc/")) {
    const functionName = url.pathname.split("/rpc/")[1] ?? "";
    if (functionName === "list_global_payers") {
      return json(scenario.db.payers.filter((payer) => payer.org_id === null));
    }
    if (functionName === "update_org_portal_configuration") {
      const body = (request.postDataJSON() ?? {}) as Row;
      scenario.portalUpdates.push({ functionName, body: { ...body } });
      const portal = scenario.db.portals.find(
        (row) => row.id === body.p_id && row.org_id === body.p_org_id,
      );
      if (!portal) return json({ code: "P0002", message: "portal_not_found" }, 404);
      Object.assign(portal, body.p_patch as Row, { updated_at: "2026-09-30T00:00:00Z" });
      return json(portal);
    }
    return json([]);
  }

  const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
  const rows = (scenario.db[table] ??= []);
  const wantsObject = (request.headers()["accept"] ?? "").includes("vnd.pgrst.object");

  if (request.method() === "POST") {
    const body = (request.postDataJSON() ?? {}) as Row;
    if (table === "portals") scenario.createPayloads.push({ ...body });
    const nextRow: Row = {
      id: `50000000-0000-4000-8000-${String(rows.length + 1).padStart(12, "0")}`,
      created_at: "2026-09-30T00:00:00Z",
      updated_at: "2026-09-30T00:00:00Z",
      ...(table === "portals" ? { mapping_generation: 1 } : {}),
      ...body,
    };
    rows.push(nextRow);
    const [projected] = projectRows(table, [nextRow], url, scenario);
    return json(wantsObject ? projected : [projected], 201);
  }

  if (request.method() === "PATCH") {
    const body = (request.postDataJSON() ?? {}) as Row;
    if (table === "portals")
      scenario.portalUpdates.push({ functionName: "PATCH", body: { ...body } });
    const matched = rows.filter((row) => rowMatches(row, url));
    for (const row of matched) Object.assign(row, body, { updated_at: "2026-09-30T00:00:00Z" });
    const projected = projectRows(table, matched, url, scenario);
    return json(wantsObject ? (projected[0] ?? {}) : projected);
  }

  if (request.method() === "DELETE") {
    const matched = rows.filter((row) => rowMatches(row, url));
    scenario.db[table] = rows.filter((row) => !matched.includes(row));
    return json(wantsObject ? (matched[0] ?? {}) : matched);
  }

  const matched = rows.filter((row) => rowMatches(row, url));
  if (wantsObject) {
    if (matched.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
    return json(projectRows(table, matched, url, scenario)[0]);
  }
  return json(projectRows(table, matched, url, scenario));
}

async function seed(context: import("@playwright/test").BrowserContext, scenario: Scenario) {
  await context.route(/\/(rest|auth)\/v1\//, (route) => fulfillSupabase(route, scenario));
  await context.addInitScript(
    ([authKey, session, orgId]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_ID] as const,
  );
}

async function openPortalsTab(page: import("@playwright/test").Page) {
  await page.goto(`/admin/payer-admin/setup/${PAYER_ID}`);
  await expect(page.getByRole("heading", { name: "Aetna Provider Services" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("tab", { name: "Portals", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Portals — Aetna Provider Services" }),
  ).toBeVisible();
}

async function openAddDialog(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: /Add portal/ })
    .first()
    .click();
  return page.getByRole("dialog");
}

async function fillAndSubmitNewPortal(
  page: import("@playwright/test").Page,
  checkRequiredCaseType: boolean,
) {
  const dialog = await openAddDialog(page);
  await dialog.getByPlaceholder("e.g. Aetna Provider Portal").fill("Aetna Provider Portal");
  await dialog.getByPlaceholder("https://...").fill(FORM_URL);

  if (checkRequiredCaseType) {
    await dialog.getByRole("button", { name: "Add portal", exact: true }).click();
    await expect(dialog.getByText("Case type is required.")).toBeVisible();
  }

  await dialog.getByRole("combobox", { name: "Case type" }).click();
  await page.getByRole("option", { name: "Enrollment", exact: true }).click();
  await dialog.getByRole("button", { name: "Add portal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Aetna Provider Portal" })).toBeVisible();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test("Add portal creates separate empty typed configurations and leaves hidden legacy rows intact", async ({
  context,
  page,
}) => {
  const scenario = makeScenario();
  const sourceBefore = clone(scenario.db.portals[0]);
  const legacyBefore = clone(scenario.db.portals[1]);
  const sourceMapCount = scenario.db.portal_field_maps.length;
  await seed(context, scenario);
  await openPortalsTab(page);

  const legacyRow = page.getByRole("row").filter({ hasText: LEGACY_KEY });
  await expect(legacyRow.getByText("Hidden from pickers")).toBeVisible();

  await fillAndSubmitNewPortal(page, true);
  const firstDrawer = page.getByRole("dialog");
  await expect(firstDrawer.getByText("Never proven")).toBeVisible();
  await expect(firstDrawer.getByText("No template steps reference this portal.")).toBeVisible();
  await firstDrawer.getByRole("button", { name: "Close" }).first().click();

  await fillAndSubmitNewPortal(page, false);
  const secondDrawer = page.getByRole("dialog");
  await expect(secondDrawer.getByText("Never proven")).toBeVisible();
  await expect(secondDrawer.getByText("No template steps reference this portal.")).toBeVisible();
  await secondDrawer.getByRole("button", { name: "Close" }).first().click();

  const created = scenario.db.portals.filter(
    (portal) => ![SOURCE_ID, LEGACY_ID].includes(String(portal.id)),
  );
  expect(created).toHaveLength(2);
  const keys = created.map((portal) => String(portal.portal_key));
  expect(new Set(keys).size).toBe(2);

  for (const portal of created) {
    expect(portal).toMatchObject({
      name: "Aetna Provider Portal",
      payer_id: PAYER_ID,
      form_url: FORM_URL,
      case_type: "enrollment",
      requires_explicit_selection: true,
      is_verified: false,
      last_verified_at: null,
      proven_at: null,
      url_changed_at: null,
    });
    const key = String(portal.portal_key);
    expect(key).toMatch(/^aetna-provider-portal-enrollment-[a-f0-9]{12}$/);
    expect(scenario.db.portal_field_maps.filter((map) => map.portal_key === key)).toHaveLength(0);
    expect(scenario.db.sop_templates[0].task_definitions).toEqual([
      {
        title: "Enrollment application",
        steps: [{ label: "Submit this form", stepType: "online_form", portalKey: SOURCE_KEY }],
      },
    ]);

    const row = page.getByRole("row").filter({ hasText: key });
    await expect(row.getByText("Registered · no fields")).toBeVisible();
    await expect(row.getByText("0 steps (Ad hoc)")).toBeVisible();
    await expect(row.getByText("never", { exact: true })).toBeVisible();
  }

  expect(scenario.createPayloads).toHaveLength(2);
  for (const payload of scenario.createPayloads) {
    expect(payload).toMatchObject({
      name: "Aetna Provider Portal",
      payer_id: PAYER_ID,
      form_url: FORM_URL,
      case_type: "enrollment",
      requires_explicit_selection: true,
      is_verified: false,
      last_verified_at: null,
      proven_at: null,
      url_changed_at: null,
    });
    expect(payload).not.toHaveProperty("field_maps");
    expect(payload).not.toHaveProperty("mapping");
  }
  expect(scenario.db.portal_field_maps).toHaveLength(sourceMapCount);
  expect(scenario.db.portals.find((portal) => portal.id === SOURCE_ID)).toEqual(sourceBefore);
  expect(scenario.db.portals.find((portal) => portal.id === LEGACY_ID)).toEqual(legacyBefore);
  await expect(legacyRow.getByText("Hidden from pickers")).toBeVisible();
});

test("renaming a typed configuration keeps its permanent key and SOP reference", async ({
  context,
  page,
}) => {
  const scenario = makeScenario();
  const sourceBefore = clone(scenario.db.portals[0]);
  const templateBefore = clone(scenario.db.sop_templates[0]);
  const legacyBefore = clone(scenario.db.portals[1]);
  await seed(context, scenario);
  await openPortalsTab(page);

  await page.getByRole("row").filter({ hasText: SOURCE_KEY }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Enrollment application → Submit this form")).toBeVisible();
  await expect(
    drawer.getByText("Renaming keeps this configuration key and its SOP references unchanged."),
  ).toBeVisible();

  const newName = "Aetna AZ enrollment configuration";
  await drawer.getByLabel("Configuration name").fill(newName);
  await drawer.getByRole("button", { name: "Save", exact: true }).click();

  await expect(drawer.getByRole("heading", { name: newName })).toBeVisible();
  await expect(drawer.getByText("Enrollment application → Submit this form")).toBeVisible();
  await expect(drawer.locator("input[readonly]")).toHaveValue(SOURCE_KEY);

  expect(scenario.portalUpdates).toHaveLength(1);
  const update = scenario.portalUpdates[0];
  expect(update.functionName).toBe("update_org_portal_configuration");
  expect(update.body).toEqual({
    p_org_id: ORG_ID,
    p_id: SOURCE_ID,
    p_expected_mapping_generation: 4,
    p_patch: { name: newName },
  });
  expect(scenario.db.portals.find((portal) => portal.id === SOURCE_ID)).toMatchObject({
    ...sourceBefore,
    name: newName,
    portal_key: SOURCE_KEY,
    updated_at: "2026-09-30T00:00:00Z",
  });
  expect(scenario.db.sop_templates[0]).toEqual(templateBefore);
  expect(scenario.db.portals.find((portal) => portal.id === LEGACY_ID)).toEqual(legacyBefore);
});
