import { expect, test, type Route } from "./fixtures/legacy-access-context";

// MINT-62 synthetic prerequisite. The inert .test URL exercises two typed
// configurations and SOP references without opening or submitting a payer
// form. All records below are synthetic; the historical mixed configuration
// is retained as a fixture and must remain byte-for-byte unchanged.
const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "00000000-0000-4000-a000-000000000005";
const PAYER_ID = "00000000-0000-4000-a000-000000000062";
const CONTRACT_SOP_ID = "62000000-0000-4000-8000-000000000001";
const ENROLLMENT_SOP_ID = "62000000-0000-4000-8000-000000000002";
const LEGACY_SOP_ID = "62000000-0000-4000-8000-000000000003";
const LEGACY_PORTAL_ID = "62000000-0000-4000-8000-000000000010";
const LEGACY_PORTAL_KEY = "synthetic-medical-mixed-legacy";
const SYNTHETIC_URL = "https://synthetic.example.test/aetna-medical-application";

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
    email: "synthetic.operator@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Synthetic Operator" },
    created_at: "2026-10-01T00:00:00Z",
  },
};

type Row = Record<string, unknown>;

interface CapturedPublish {
  templateId: string;
  body: Row;
}

interface Scenario {
  db: Record<string, Row[]>;
  createdPortals: Row[];
  createPayloads: Row[];
  publishes: CapturedPublish[];
  requests: Array<{ method: string; table: string; url: string }>;
  payerSiteRequests: Array<{ method: string; url: string }>;
}

function onlineFormStep(label: string) {
  return {
    label,
    detail: "Synthetic-only preflight step.",
    stepType: "online_form",
    portalKey: "",
  };
}

function templateRow(id: string, name: string, caseType: "contract" | "enrollment"): Row {
  const definitions = [
    {
      title: `Synthetic ${caseType} form`,
      description: "",
      sortOrder: 0,
      dueOffsetDays: 0,
      steps: [onlineFormStep(`Select the ${caseType} configuration`)],
    },
  ];
  return {
    id,
    org_id: ORG_ID,
    name,
    payer_id: PAYER_ID,
    state: "AZ",
    states: ["AZ"],
    group_id: null,
    specialty: null,
    archived: false,
    current_version: 1,
    required_profile_attributes: [],
    case_type: caseType,
    task_definitions: definitions,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };
}

function makeScenario(): Scenario {
  const legacyPortal: Row = {
    id: LEGACY_PORTAL_ID,
    org_id: ORG_ID,
    portal_key: LEGACY_PORTAL_KEY,
    name: "[hidden] Synthetic legacy mixed configuration",
    payer_id: PAYER_ID,
    form_url: SYNTHETIC_URL,
    case_type: null,
    requires_explicit_selection: false,
    mapping_generation: 7,
    is_verified: true,
    last_verified_at: "2026-08-14T00:00:00Z",
    proven_at: "2026-08-14T00:00:00Z",
    url_changed_at: null,
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-08-14T00:00:00Z",
  };
  const legacyMaps: Row[] = [
    {
      id: "synthetic-legacy-map-provider",
      org_id: ORG_ID,
      portal_key: LEGACY_PORTAL_KEY,
      url_pattern: null,
      page_step: "provider-details",
      map_type: "web",
      selector: "#synthetic-provider-name",
      selector_fallbacks: null,
      source: "token",
      token: "provider.firstName",
      hardcoded_value: null,
      transform: null,
      field_type: "text",
      notes: null,
      status: "approved",
      control_options: null,
      field_label: "Synthetic provider name",
      mapping_generation: 7,
      shared_base_generation: null,
      created_at: "2026-07-12T00:00:00Z",
      updated_at: "2026-08-14T00:00:00Z",
    },
    {
      id: "synthetic-legacy-map-contact",
      org_id: ORG_ID,
      portal_key: LEGACY_PORTAL_KEY,
      url_pattern: null,
      page_step: "group-contracting-contact",
      map_type: "web",
      selector: "#synthetic-contract-contact",
      selector_fallbacks: null,
      source: "token",
      token: "group.contractingContactName",
      hardcoded_value: null,
      transform: null,
      field_type: "text",
      notes: null,
      status: "approved",
      control_options: null,
      field_label: "Synthetic contracting contact",
      mapping_generation: 7,
      shared_base_generation: null,
      created_at: "2026-07-12T00:00:00Z",
      updated_at: "2026-08-14T00:00:00Z",
    },
  ];
  const contract = templateRow(CONTRACT_SOP_ID, "Synthetic Medical Contract SOP", "contract");
  const enrollment = templateRow(
    ENROLLMENT_SOP_ID,
    "Synthetic Medical Enrollment SOP",
    "enrollment",
  );
  const legacyTemplate = {
    id: LEGACY_SOP_ID,
    org_id: ORG_ID,
    name: "Synthetic legacy mixed SOP",
    payer_id: PAYER_ID,
    state: "AZ",
    states: ["AZ"],
    group_id: null,
    specialty: null,
    archived: false,
    current_version: 1,
    required_profile_attributes: [],
    case_type: null,
    task_definitions: [
      {
        title: "Legacy mixed form",
        steps: [
          {
            label: "Historical combined form",
            detail: "Retained as a synthetic historical reference.",
            stepType: "online_form",
            portalKey: LEGACY_PORTAL_KEY,
          },
        ],
      },
    ],
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-07-12T00:00:00Z",
  };

  return {
    createdPortals: [],
    createPayloads: [],
    publishes: [],
    requests: [],
    payerSiteRequests: [],
    db: {
      memberships: [
        {
          org_id: ORG_ID,
          user_id: USER_ID,
          role: "admin",
          organizations: {
            id: ORG_ID,
            name: "Synthetic Test Organization",
            lifecycle_state: "active",
          },
        },
      ],
      profiles: [{ id: USER_ID, full_name: "Synthetic Operator", email: SESSION.user.email }],
      payers: [
        {
          id: PAYER_ID,
          org_id: null,
          name: "Synthetic Test Payer",
          is_active: true,
          avg_decision_days: null,
          payer_kind: "commercial",
          payer_slug: "synthetic-test-payer",
          aliases: [],
          states: ["AZ"],
          status: "active",
          merged_into_id: null,
          delegation_note: null,
          archived_at: null,
          created_at: "2026-07-12T00:00:00Z",
          updated_at: "2026-07-12T00:00:00Z",
        },
      ],
      org_payer_assignments: [{ id: "synthetic-assignment", org_id: ORG_ID, payer_id: PAYER_ID }],
      portals: [legacyPortal],
      portal_field_maps: legacyMaps,
      fill_sessions: [],
      touches: [],
      audit_log: [],
      sop_templates: [contract, enrollment, legacyTemplate],
      sop_template_versions: [contract, enrollment, legacyTemplate].map((template) => ({
        id: `version-${String(template.id)}`,
        template_id: template.id,
        version: 1,
        name: template.name,
        case_type: template.case_type,
        required_profile_attributes: [],
        task_definitions: template.task_definitions,
        published_at: "2026-07-12T00:00:00Z",
      })),
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
    if (value === "not.is.null" && row[key] === null) return false;
  }
  return true;
}

async function fulfillSupabase(route: Route, scenario: Scenario) {
  const request = route.request();
  const url = new URL(request.url());
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  if (url.pathname.includes("/auth/v1/")) return json(SESSION);
  if (url.pathname.includes("/rest/v1/rpc/")) {
    const functionName = url.pathname.split("/rpc/")[1] ?? "";
    const body = (request.postDataJSON() ?? {}) as Row;
    if (functionName === "get_sop_field_tokens") {
      return json([
        { token: "provider.firstName", table: "providers", column: "first_name" },
        {
          token: "group.contractingContactName",
          table: "provider_groups",
          column: "contracting_contact_name",
        },
      ]);
    }
    if (functionName === "publish_sop_template_version") {
      const templateId = String(body.p_template_id);
      scenario.publishes.push({ templateId, body: structuredClone(body) });
      return json({ template_id: templateId, version: Number(body.p_expected_version) + 1 });
    }
    if (functionName === "list_global_payers") {
      return json(scenario.db.payers.filter((payer) => payer.org_id === null));
    }
    return json([]);
  }

  const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
  scenario.requests.push({ method: request.method(), table, url: request.url() });
  const rows = (scenario.db[table] ??= []);
  const wantsObject = (request.headers()["accept"] ?? "").includes("vnd.pgrst.object");

  if (request.method() === "POST") {
    const body = (request.postDataJSON() ?? {}) as Row;
    if (table === "portals") scenario.createPayloads.push(structuredClone(body));
    const nextRow: Row = {
      id: `62000000-0000-4000-8000-${String(rows.length + 1).padStart(12, "0")}`,
      created_at: "2026-10-02T00:00:00Z",
      updated_at: "2026-10-02T00:00:00Z",
      ...(table === "portals" ? { mapping_generation: 1 } : {}),
      ...body,
    };
    rows.push(nextRow);
    if (table === "portals") scenario.createdPortals.push(nextRow);
    return json(wantsObject ? nextRow : [nextRow], 201);
  }

  if (request.method() === "PATCH") {
    const body = (request.postDataJSON() ?? {}) as Row;
    const matched = rows.filter((row) => rowMatches(row, url));
    for (const row of matched) Object.assign(row, body, { updated_at: "2026-10-02T00:00:00Z" });
    return json(wantsObject ? (matched[0] ?? {}) : matched);
  }

  if (request.method() === "DELETE") {
    const matched = rows.filter((row) => rowMatches(row, url));
    scenario.db[table] = rows.filter((row) => !matched.includes(row));
    return json(wantsObject ? (matched[0] ?? {}) : matched);
  }

  const matched = rows.filter((row) => rowMatches(row, url));
  if (wantsObject) {
    if (matched.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
    return json(matched[0]);
  }
  return json(matched);
}

async function seed(context: import("@playwright/test").BrowserContext, scenario: Scenario) {
  await context.route("https://synthetic.example.test/**", async (route) => {
    scenario.payerSiteRequests.push({
      method: route.request().method(),
      url: route.request().url(),
    });
    await route.abort();
  });
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
  await expect(page.getByRole("heading", { name: "Synthetic Test Payer" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("tab", { name: "Portals", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Portals — Synthetic Test Payer" })).toBeVisible();
}

async function createTypedConfiguration(
  page: import("@playwright/test").Page,
  type: "Contract" | "Enrollment",
) {
  await page
    .getByRole("button", { name: /Add portal/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  const name = `Synthetic Medical ${type} Configuration`;
  await dialog.getByPlaceholder("e.g. Aetna Provider Portal").fill(name);
  await dialog.getByPlaceholder("https://...").fill(SYNTHETIC_URL);
  await dialog.getByRole("combobox", { name: "Case type" }).click();
  await page.getByRole("option", { name: type, exact: true }).click();
  await dialog.getByRole("button", { name: "Add portal", exact: true }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Never proven")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).first().click();
}

async function bindTypedSop(
  page: import("@playwright/test").Page,
  scenario: Scenario,
  templateId: string,
  type: "contract" | "enrollment",
  selectedKey: string,
  otherKey: string,
) {
  await page.goto(`/admin/templates/${templateId}`);
  const templateName =
    type === "contract" ? "Synthetic Medical Contract SOP" : "Synthetic Medical Enrollment SOP";
  await expect(page.getByRole("heading", { name: templateName })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Actions" }).click();

  const picker = page.getByRole("combobox").filter({ hasText: "No portal (not linked)" });
  await expect(picker).toBeVisible();
  await picker.click();
  const exactOption = page.getByRole("option").filter({ hasText: selectedKey });
  await expect(exactOption).toBeVisible();
  await expect(page.getByRole("option").filter({ hasText: otherKey })).toHaveCount(0);
  await exactOption.click();
  await expect(picker).toContainText(selectedKey);

  await page.getByRole("button", { name: "Review" }).click();
  await page.getByRole("button", { name: "Publish" }).click();
  const publishDialog = page.getByRole("dialog");
  await expect(publishDialog).toContainText("Publish version 2");
  await publishDialog
    .getByPlaceholder("What changed and why")
    .fill("Synthetic MINT-62 prerequisite");
  await publishDialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published version 2")).toBeVisible({ timeout: 15000 });

  const captured = scenario.publishes.find((publish) => publish.templateId === templateId);
  expect(captured).toBeDefined();
  expect(captured?.body).toMatchObject({ p_template_id: templateId, p_case_type: type });
  const taskDefinitions = captured?.body.p_task_definitions as Array<{
    steps: Array<{ portalKey?: string }>;
  }>;
  expect(taskDefinitions[0]?.steps[0]?.portalKey).toBe(selectedKey);
}

test("MINT-62 synthetic two-path prerequisite keeps empty configs and typed SOP keys independent", async ({
  context,
  page,
}) => {
  const scenario = makeScenario();
  const historicalPortal = structuredClone(scenario.db.portals[0]);
  const historicalMaps = structuredClone(scenario.db.portal_field_maps);
  const historicalTemplate = structuredClone(
    scenario.db.sop_templates.find((row) => row.id === LEGACY_SOP_ID),
  );
  const historicalVersion = structuredClone(
    scenario.db.sop_template_versions.find((row) => row.template_id === LEGACY_SOP_ID),
  );
  await seed(context, scenario);

  await openPortalsTab(page);
  const historicalRow = page.getByRole("row").filter({ hasText: LEGACY_PORTAL_KEY });
  await expect(historicalRow.getByText("Hidden from pickers")).toBeVisible();

  await createTypedConfiguration(page, "Contract");
  await createTypedConfiguration(page, "Enrollment");

  expect(scenario.createdPortals).toHaveLength(2);
  const contract = scenario.createdPortals.find((portal) => portal.case_type === "contract");
  const enrollment = scenario.createdPortals.find((portal) => portal.case_type === "enrollment");
  expect(contract).toBeDefined();
  expect(enrollment).toBeDefined();
  const contractKey = String(contract?.portal_key);
  const enrollmentKey = String(enrollment?.portal_key);
  expect(contractKey).not.toBe(enrollmentKey);
  expect(contractKey).not.toBe(LEGACY_PORTAL_KEY);
  expect(enrollmentKey).not.toBe(LEGACY_PORTAL_KEY);

  for (const config of [contract, enrollment]) {
    expect(config).toMatchObject({
      payer_id: PAYER_ID,
      form_url: SYNTHETIC_URL,
      requires_explicit_selection: true,
      mapping_generation: 1,
      is_verified: false,
      last_verified_at: null,
      proven_at: null,
      url_changed_at: null,
    });
    expect(
      scenario.db.portal_field_maps.filter((map) => map.portal_key === config?.portal_key),
    ).toEqual([]);
  }
  expect(contract).toMatchObject({
    case_type: "contract",
    name: "Synthetic Medical Contract Configuration",
  });
  expect(enrollment).toMatchObject({
    case_type: "enrollment",
    name: "Synthetic Medical Enrollment Configuration",
  });
  expect(scenario.createPayloads).toHaveLength(2);
  for (const payload of scenario.createPayloads) {
    expect(payload).toMatchObject({
      form_url: SYNTHETIC_URL,
      requires_explicit_selection: true,
      is_verified: false,
      proven_at: null,
    });
    expect(payload).not.toHaveProperty("mapping");
    expect(payload).not.toHaveProperty("field_maps");
  }

  // Same URL, different exact keys: each typed SOP picker must expose only its
  // compatible configuration. Publishing captures the exact selected key.
  await bindTypedSop(page, scenario, CONTRACT_SOP_ID, "contract", contractKey, enrollmentKey);
  await bindTypedSop(page, scenario, ENROLLMENT_SOP_ID, "enrollment", enrollmentKey, contractKey);
  expect(scenario.publishes).toHaveLength(2);
  expect(scenario.publishes.map((publish) => publish.templateId).sort()).toEqual(
    [CONTRACT_SOP_ID, ENROLLMENT_SOP_ID].sort(),
  );

  // The old mixed mapping, proof, and SOP link remain intact after both new
  // paths are configured. No operation created a fill receipt or touch.
  expect(scenario.db.portals.find((portal) => portal.id === LEGACY_PORTAL_ID)).toEqual(
    historicalPortal,
  );
  expect(
    scenario.db.portal_field_maps.filter((map) => map.portal_key === LEGACY_PORTAL_KEY),
  ).toEqual(historicalMaps);
  expect(scenario.db.sop_templates.find((row) => row.id === LEGACY_SOP_ID)).toEqual(
    historicalTemplate,
  );
  expect(
    scenario.db.sop_template_versions.find((row) => row.template_id === LEGACY_SOP_ID),
  ).toEqual(historicalVersion);
  expect(scenario.db.fill_sessions).toEqual([]);
  expect(scenario.db.touches).toEqual([]);
  expect(
    scenario.requests.filter((request) => ["fill_sessions", "touches"].includes(request.table)),
  ).toEqual([]);
  expect(scenario.payerSiteRequests).toEqual([]);
});
