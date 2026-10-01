import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from "./fixtures/legacy-access-context";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ORG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
const PAYER_ID = "44444444-4444-4444-8444-444444444444";
const CONTRACT_ID = "55555555-5555-4555-8555-555555555555";
const TEMPLATE_ID = "66666666-6666-4666-8666-666666666666";
const ASSIGNMENT_ID = "77777777-7777-4777-8777-777777777777";
const PROVIDER_ID = "88888888-8888-4888-8888-888888888888";
const FACILITY_ID = "99999999-9999-4999-8999-999999999999";
const PORTAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const PORTAL_KEY = "aetna_contract_form";

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

function portalRow(orgId = ORG_ID): Row {
  return {
    id: PORTAL_ID,
    org_id: orgId,
    portal_key: PORTAL_KEY,
    name: "Aetna Contract Portal",
    payer_id: PAYER_ID,
    form_url: "https://portal.example.test/apply",
    case_type: "contract",
    requires_explicit_selection: true,
    mapping_generation: 4,
    is_verified: true,
    proven_at: "2026-09-01T00:00:00Z",
  };
}

function mapRow(orgId = ORG_ID): Row {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    org_id: orgId,
    portal_key: PORTAL_KEY,
    url_pattern: "https://portal.example.test/apply",
    page_step: null,
    map_type: "web",
    selector: "input[name='provider_npi']",
    selector_fallbacks: [],
    source: "manual",
    token: "provider.npi",
    hardcoded_value: null,
    transform: null,
    field_type: "text",
    notes: null,
    status: "approved",
    control_options: null,
    mapping_generation: 4,
    shared_base_generation: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    learned_via: "manual",
    field_label: "Provider NPI",
  };
}

function baseRows(portals: Row[], maps: Row[]): Record<string, Row[]> {
  return {
    organizations: [{ id: ORG_ID, name: "Acme Health", lifecycle_state: "active" }],
    memberships: [
      {
        org_id: ORG_ID,
        role: "admin",
        organizations: { id: ORG_ID, name: "Acme Health", lifecycle_state: "active" },
      },
    ],
    provider_groups: [
      { id: GROUP_ID, org_id: ORG_ID, name: "Acme Medical Group", is_active: true },
    ],
    facilities: [
      {
        id: FACILITY_ID,
        org_id: ORG_ID,
        group_id: GROUP_ID,
        name: "Wichita Clinic",
        state: "KS",
        is_active: true,
        reference_only: false,
      },
    ],
    providers: [
      {
        id: PROVIDER_ID,
        org_id: ORG_ID,
        first_name: "Avery",
        last_name: "Provider",
        credentials: "MD",
        npi: "1234567890",
        status: "active",
        reference_only: false,
        verification_state: "verified",
        is_test_provider: false,
      },
    ],
    provider_group_assignments: [
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        org_id: ORG_ID,
        provider_id: PROVIDER_ID,
        group_id: GROUP_ID,
        start_date: null,
        end_date: null,
      },
    ],
    payers: [
      {
        id: PAYER_ID,
        org_id: ORG_ID,
        name: "Aetna",
        is_active: true,
        status: "active",
        payer_kind: "commercial",
        states: ["KS"],
      },
    ],
    payer_network_targets: [
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        org_id: ORG_ID,
        group_id: GROUP_ID,
        payer_id: PAYER_ID,
        state: "KS",
        status: "active",
      },
    ],
    status_configs: [
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        org_id: ORG_ID,
        track: "contracting",
        label: "In Progress (Contract Signed)",
        color: "#EAB308",
        sort_order: 30,
      },
    ],
    contracts: [
      {
        id: CONTRACT_ID,
        org_id: ORG_ID,
        group_id: GROUP_ID,
        payer_id: PAYER_ID,
        state: "KS",
        contracting_status_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        tentative_effective_date: "2026-10-01",
        notes: null,
      },
    ],
    sop_templates: [
      {
        id: TEMPLATE_ID,
        org_id: ORG_ID,
        name: "Aetna Contract SOP",
        case_type: "contract",
        payer_id: PAYER_ID,
        group_id: null,
        state: "KS",
        states: ["KS"],
        archived: false,
        current_version: 3,
        task_definitions: [],
      },
    ],
    contract_sop_assignments: [
      {
        id: ASSIGNMENT_ID,
        org_id: ORG_ID,
        contract_id: CONTRACT_ID,
        sop_template_id: TEMPLATE_ID,
        sop_version: 3,
        context_version: 2,
      },
    ],
    sop_template_versions: [
      {
        template_id: TEMPLATE_ID,
        version: 3,
        name: "Aetna Contract SOP v3",
        case_type: "contract",
        required_profile_attributes: [],
        task_definitions: [
          {
            title: "Complete application",
            steps: [
              {
                label: "Enter provider details",
                detail: "Use the active provider and selected group location.",
                stepType: "online_form",
                portalKey: ` ${PORTAL_KEY.toUpperCase()} `,
              },
            ],
          },
          {
            title: "Review application",
            steps: [
              {
                label: "Review the same form",
                stepType: "online_form",
                portalKey: PORTAL_KEY,
              },
            ],
          },
        ],
      },
    ],
    portals,
    portal_field_maps: maps,
    credential_cases: [],
    fill_sessions: [],
    touches: [],
    inbound_leads: [],
    user_table_prefs: [],
  };
}

async function installMatrixFixtures(
  context: BrowserContext,
  page: Page,
  portalRows: Row[],
  mapRows: Row[],
  failPortalResolution = false,
  portalResolutionDelayMs = 0,
) {
  await context.addInitScript(
    ({ authKey, session, orgId }) => {
      localStorage.setItem(authKey, JSON.stringify(session));
      localStorage.setItem("active_org_id", orgId);
    },
    { authKey: AUTH_KEY, session: SESSION, orgId: ORG_ID },
  );
  const fixtures = baseRows(portalRows, mapRows);
  await page.route("**/rest/v1/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/").pop() ?? "";
    const method = route.request().method();
    if (failPortalResolution && table === "portals" && method === "GET") {
      return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    }
    if (portalResolutionDelayMs > 0 && table === "portals" && method === "GET") {
      await new Promise((resolve) => setTimeout(resolve, portalResolutionDelayMs));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fixtures[table] ?? []),
      });
    }
    if (method === "HEAD") {
      return route.fulfill({ status: 200, headers: { "content-range": "*/0" } });
    }
    if (method === "GET") {
      let rows = fixtures[table] ?? [];
      // Supabase/RLS applies this scope in production. Mirror it in the mock so
      // the wrong-org scenario proves that another tenant's config is absent.
      if (table === "portals" || table === "portal_field_maps") {
        rows = rows.filter((row) => row.org_id === null || row.org_id === ORG_ID);
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rows),
      });
    }
    if (method === "POST" || method === "PATCH") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "mock-id" }),
      });
    }
    return route.continue();
  });
}

async function openAssignedContract(page: Page) {
  await page.goto("/reporting/contracts-matrix");
  await expect(page.getByRole("heading", { name: "Group Contracts Matrix" })).toBeVisible();
  await page.evaluate(
    async ({ orgId, contract }) => {
      const optimizedDepUrl = (name: string) => {
        const prefix = `/node_modules/.vite/deps/${name}.js`;
        const url = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .find((resourceUrl) => resourceUrl.includes(prefix));
        if (!url) throw new Error(`Vite did not load the ${name} browser module`);
        return url;
      };
      const [React, ReactDOM, ReactQuery, authStore, drawerModule] = await Promise.all([
        import(optimizedDepUrl("react")),
        import(optimizedDepUrl("react-dom_client")),
        import(optimizedDepUrl("@tanstack_react-query")),
        import("/src/lib/auth-store.ts"),
        import("/src/components/reports/ContractDetailDrawer.tsx"),
      ]);
      authStore.useAuthStore.setState({ activeOrgId: orgId });
      const queryClient = new ReactQuery.QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 0 } },
      });
      const host = document.createElement("div");
      host.dataset.testid = "mounted-contract-matrix-drawer";
      document.body.appendChild(host);
      const root = ReactDOM.default.createRoot(host);
      (window as unknown as { __m49QueryClient?: unknown }).__m49QueryClient = queryClient;
      const element = React.default.createElement(
        ReactQuery.QueryClientProvider,
        { client: queryClient },
        React.default.createElement(drawerModule.ContractDetailDrawer, {
          open: true,
          onClose: () => undefined,
          contract,
          groupId: "33333333-3333-4333-8333-333333333333",
          payerId: "44444444-4444-4444-8444-444444444444",
          state: "KS",
          groupName: "Acme Medical Group",
          payerName: "Aetna",
        }),
      );
      root.render(element);
      (window as unknown as { __m49DrawerRoot?: unknown }).__m49DrawerRoot = root;
    },
    {
      orgId: ORG_ID,
      contract: {
        id: CONTRACT_ID,
        groupId: GROUP_ID,
        payerId: PAYER_ID,
        state: "KS",
        contractingStatusId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        tentativeEffectiveDate: "2026-10-01",
        effectiveDate: null,
        expirationDate: null,
        specialty: null,
        notes: null,
        // listContracts intentionally omits org_id; the Drawer must use the
        // authenticated active organization when preparing a tuple.
      },
    },
  );
  await expect(page.getByRole("heading", { name: "Aetna — KS" })).toBeVisible();
  await expect(page.getByTestId("contract-launch-tuple").first()).toBeVisible();
}

test("mounted Contract Matrix prepares exact ready tuples and selected launch inputs", async ({
  context,
  page,
}) => {
  await installMatrixFixtures(context, page, [portalRow()], [mapRow()], false, 750);
  await openAssignedContract(page);
  await expect(page.getByText("Resolving the exact form configuration…").first()).toBeVisible();

  await page.getByRole("combobox", { name: "First provider for form work" }).click();
  await page.getByRole("option", { name: "Avery Provider" }).click();
  await page.getByRole("combobox", { name: "Location for form work" }).click();
  await page.getByRole("option", { name: "Wichita Clinic" }).click();

  const tuples = page.getByTestId("contract-launch-tuple");
  await expect(tuples).toHaveCount(2);
  await expect(tuples.first()).toHaveAttribute("data-readiness-outcome", "ready_handoff_deferred");
  for (const tuple of await tuples.all()) {
    await expect(tuple).toHaveAttribute("data-org-id", ORG_ID);
    await expect(tuple).toHaveAttribute("data-portal-id", PORTAL_ID);
    await expect(tuple).toHaveAttribute("data-portal-scope", "organization");
    await expect(tuple).toHaveAttribute("data-mapping-generation", "4");
    await expect(tuple).toHaveAttribute(
      "data-effective-mapping-fingerprint",
      /^sha256:[a-f0-9]{64}$/,
    );
    await expect(tuple).toHaveAttribute("data-provider-id", PROVIDER_ID);
    await expect(tuple).toHaveAttribute("data-facility-id", FACILITY_ID);
    await expect(tuple).toHaveAttribute("data-readiness-outcome", "ready_handoff_deferred");
  }
  const identities = await tuples.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-step-identity")),
  );
  expect(identities[0]).not.toBe(identities[1]);
  const queryKeys = await page.evaluate(() => {
    const queryClient = (
      window as unknown as {
        __m49QueryClient?: {
          getQueryCache: () => { getAll: () => Array<{ queryKey: unknown[] }> };
        };
      }
    ).__m49QueryClient;
    return (
      queryClient
        ?.getQueryCache()
        .getAll()
        .map((query) => query.queryKey) ?? []
    );
  });
  expect(queryKeys).toContainEqual(["contract-sop-portal-resolutions", ORG_ID, "web"]);
  await expect(page.getByRole("button", { name: "Work in portal" }).first()).toBeDisabled();
});

test("mounted Matrix gates a configuration owned by another org as missing", async ({
  context,
  page,
}) => {
  await installMatrixFixtures(context, page, [portalRow(OTHER_ORG_ID)], [mapRow(OTHER_ORG_ID)]);
  await openAssignedContract(page);

  await expect(page.getByTestId("contract-launch-tuple").first()).toHaveAttribute(
    "data-readiness-outcome",
    "configuration_missing",
  );
  await expect(page.getByText(/No visible portal configuration matches/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Work in portal" }).first()).toBeDisabled();
});

test("mounted Matrix gates a genuinely absent configuration", async ({ context, page }) => {
  await installMatrixFixtures(context, page, [], []);
  await openAssignedContract(page);

  await expect(page.getByTestId("contract-launch-tuple").first()).toHaveAttribute(
    "data-readiness-outcome",
    "configuration_missing",
  );
  await expect(page.getByRole("button", { name: "Work in portal" }).first()).toBeDisabled();
});

test("mounted Matrix keeps form work gated when map resolution fails", async ({
  context,
  page,
}) => {
  await installMatrixFixtures(context, page, [portalRow()], [mapRow()], true);
  await openAssignedContract(page);

  await expect(page.getByTestId("contract-launch-tuple").first()).toHaveAttribute(
    "data-readiness-outcome",
    "resolver_unavailable",
  );
  await expect(
    page.getByText("Form configuration lookup failed; launch remains gated.").first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Work in portal" }).first()).toBeDisabled();
});
