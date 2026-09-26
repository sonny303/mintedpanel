import { test, expect as baseExpect, type BrowserContext, type Route } from "@playwright/test";

const expect = baseExpect.configure({ timeout: 30_000 });

const AUTH_KEY = "sb-example-auth-token";
const ACTOR_STAFF = "11111111-1111-4111-8111-111111111111";
const ACTOR_CLIENT = "22222222-2222-4222-8222-222222222222";
const STAFF_ORG = "33333333-3333-4333-8333-333333333333";
const CLIENT_ORG = "55555555-5555-4555-8555-555555555555";
const GROUP_ALPHA = "77777777-7777-4777-8777-777777777777";
const GROUP_BETA = "88888888-8888-4888-8888-888888888888";
const PROV_1 = "99999999-9999-4999-8999-999999999991";
const PROV_2 = "99999999-9999-4999-8999-999999999992";
const PAYER_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROD_1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
const PROD_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02";
const SCOPE_1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PUB_1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TEST_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const SESSION = (id: string, email: string) => ({
  access_token: `synthetic-${id}`,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 9999999999,
  refresh_token: `synthetic-refresh-${id}`,
  user: {
    id,
    aud: "authenticated",
    role: "authenticated",
    email,
    app_metadata: { provider: "email" },
    user_metadata: { full_name: id === ACTOR_CLIENT ? "Client User" : "Staff User" },
    created_at: "2026-07-09T00:00:00Z",
  },
});

const staffAccessContext = {
  actorUserId: ACTOR_STAFF,
  audience: "staff",
  selectedOrgId: STAFF_ORG,
  staffOrgs: [
    {
      orgId: STAFF_ORG,
      orgName: "Minted Health Ops",
      role: "admin",
      reportStaff: true,
      clientManage: true,
    },
  ],
  clientOrgs: [],
  globalTraining: false,
  restrictedExternal: false,
  contextRevision: "rev-staff-1",
};

const clientAccessContext = {
  actorUserId: ACTOR_CLIENT,
  audience: "client",
  selectedOrgId: CLIENT_ORG,
  staffOrgs: [],
  clientOrgs: [
    {
      orgId: CLIENT_ORG,
      orgName: "Acme Physical Therapy",
      groups: [{ groupId: GROUP_ALPHA, groupName: "Acme Downtown Clinic" }],
    },
  ],
  globalTraining: false,
  restrictedExternal: true,
  contextRevision: "rev-client-1",
};

const mockCatalog = {
  payers: [{ id: PAYER_1, name: "Blue Cross Blue Shield" }],
  products: [
    {
      productId: PROD_1,
      payerId: PAYER_1,
      payerName: "Blue Cross Blue Shield",
      productKey: "bcbs_ppo",
      displayName: "BCBS PPO",
      isActive: true,
    },
    {
      productId: PROD_2,
      payerId: PAYER_1,
      payerName: "Blue Cross Blue Shield",
      productKey: "bcbs_hmo",
      displayName: "BCBS HMO",
      isActive: true,
    },
  ],
  groups: [
    { id: GROUP_ALPHA, name: "Acme Downtown Clinic" },
    { id: GROUP_BETA, name: "St. Jude Hospital Group" },
  ],
  facilities: [
    { id: "fac-1", name: "Main Campus", groupId: GROUP_ALPHA },
    { id: "fac-2", name: "West Wing", groupId: GROUP_BETA },
  ],
};

const mockScopesMatrix = {
  clinicians: [
    {
      providerId: PROV_1,
      firstName: "Sarah",
      lastName: "Connor",
      npi: "1098765432",
      discipline: "PT",
      disciplines: ["PT"],
      primaryDiscipline: "PT",
      groupIds: [GROUP_ALPHA],
      facilityIds: ["fac-1"],
      facilityNames: ["Main Campus"],
      cells: {},
    },
    {
      providerId: PROV_2,
      firstName: "John",
      lastName: "Doe",
      npi: "1234567890",
      discipline: "OT",
      disciplines: ["OT"],
      primaryDiscipline: "OT",
      groupIds: [GROUP_ALPHA],
      facilityIds: ["fac-1"],
      facilityNames: ["Main Campus"],
      cells: {},
    },
  ],
  products: mockCatalog.products,
  cells: {
    [`${PROV_1}:${PROD_1}`]: {
      scopeId: SCOPE_1,
      providerId: PROV_1,
      productId: PROD_1,
      status: "approved",
      effectiveDate: "2026-01-01",
      actionOwner: null,
      blockingReason: null,
      facilityCount: 1,
      hasProof: true,
    },
    [`${PROV_1}:${PROD_2}`]: {
      scopeId: "scope-2",
      providerId: PROV_1,
      productId: PROD_2,
      status: "action_required",
      effectiveDate: null,
      actionOwner: "Client",
      blockingReason: "Attestation expired",
      facilityCount: 1,
      hasProof: false,
    },
  },
  stats: {
    totalClinicians: 2,
    activeEnrollments: 1,
    pendingPayerAction: 0,
    actionableClientBlockers: 1,
  },
  totalClinicians: 2,
  page: 1,
  limit: 50,
};

const mockScopeDetailStaff = {
  scopeId: SCOPE_1,
  stale: false,
  status: "approved",
  owner: "Internal",
  revision: {
    status: "approved",
    action_owner: "Internal",
    effective_date: "2026-01-01",
    submitted_date: "2025-11-15",
    payer_acknowledged_date: "2025-11-20",
    payer_reference: "BCBS-APPROVED-100",
    client_safe_blocker: null,
    staff_note: "CONFIDENTIAL STAFF NOTE: Handled by VIP senior credentialer",
    retro_status: "eligible",
    retro_days: 90,
    retro_date: "2025-10-01",
  },
  proofs: [
    {
      publicationId: PUB_1,
      documentVersionId: "ver-100",
      evidenceKind: "payer_approval_letter",
      sha256: TEST_SHA256,
      publishedAt: "2026-01-01T12:00:00Z",
      revokedAt: null,
      supportedFields: ["enrollment_status", "effective_date"],
      downloadUrl: `/api/enrollment-explorer/proofs/${PUB_1}/download`,
    },
  ],
};

const mockScopeDetailClient = {
  scopeId: SCOPE_1,
  status: "approved",
  owner: "Internal",
  effectiveDate: "2026-01-01",
  submittedDate: "2025-11-15",
  payerAcknowledgedDate: "2025-11-20",
  payerReference: "BCBS-APPROVED-100",
  clientSafeBlocker: null,
  retroStatus: "eligible",
  retroDays: 90,
  retroDate: "2025-10-01",
  proofs: [
    {
      publicationId: PUB_1,
      documentVersionId: "ver-100",
      evidenceKind: "payer_approval_letter",
      sha256: TEST_SHA256,
      publishedAt: "2026-01-01T12:00:00Z",
      revokedAt: null,
      supportedFields: ["enrollment_status", "effective_date"],
      downloadUrl: `/api/enrollment-explorer/proofs/${PUB_1}/download`,
    },
  ],
};

function json(route: Route, body: unknown, status = 200, headers?: Record<string, string>) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(body),
  });
}

async function setupMockNetwork(
  browserContext: BrowserContext,
  options: { isClient: boolean },
) {
  const actorId = options.isClient ? ACTOR_CLIENT : ACTOR_STAFF;
  const email = options.isClient ? "client@example.test" : "staff@minted.test";
  const context = options.isClient ? clientAccessContext : staffAccessContext;
  const activeOrg = options.isClient ? CLIENT_ORG : STAFF_ORG;

  await browserContext.addInitScript(
    ([authKey, initialSession, persistedOrg]) => {
      localStorage.setItem(authKey as string, JSON.stringify(initialSession));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: persistedOrg }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION(actorId, email), activeOrg] as const,
  );

  await browserContext.route(/\/(rest|auth)\/v1\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.includes("/auth/v1/")) return json(route, SESSION(actorId, email));
    if (url.pathname.endsWith("/rpc/claim_invites")) return json(route, 0);

    const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
    if (table === "profiles") {
      const profile = { id: actorId, full_name: options.isClient ? "Client User" : "Staff User" };
      return (request.headers().accept ?? "").includes("vnd.pgrst.object")
        ? json(route, profile)
        : json(route, [profile]);
    }
    if (table === "memberships") {
      if (options.isClient) return json(route, []);
      return json(route, [
        {
          org_id: STAFF_ORG,
          role: "admin",
          organizations: { id: STAFF_ORG, name: "Minted Health Ops", lifecycle_state: "active" },
        },
      ]);
    }
    return json(route, []);
  });

  await browserContext.route("**/api/me/access-context**", async (route) => {
    return json(route, { data: context, error: null });
  });

  await browserContext.route("**/api/enrollment-explorer/catalog**", async (route) => {
    return json(route, { data: mockCatalog, error: null });
  });

  await browserContext.route("**/api/enrollment-explorer/scopes/query**", async (route) => {
    return json(route, { data: mockScopesMatrix, error: null });
  });

  await browserContext.route(`**/api/enrollment-explorer/scopes/${SCOPE_1}**`, async (route) => {
    return json(route, {
      data: options.isClient ? mockScopeDetailClient : mockScopeDetailStaff,
      error: null,
    });
  });

  await browserContext.route(`**/api/enrollment-explorer/proofs/${PUB_1}/download**`, async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: {
        "content-disposition": 'attachment; filename="proof-approval.pdf"',
        "x-content-type-options": "nosniff",
      },
      body: Buffer.from("%PDF-1.4 synthetic proof content"),
    });
  });
}

test.describe("Transparent Enrollment Explorer (E6.14)", () => {
  test("Staff navigates /reporting/enrollment-explorer, filters, opens drawer, verifies proof link & notes", async ({
    context,
    page,
  }) => {
    await setupMockNetwork(context, { isClient: false });

    await page.goto("/reporting/enrollment-explorer");

    // 1. Verify PageHeader & Reporting Center back link
    await expect(page.getByRole("heading", { name: "Enrollment Explorer" })).toBeVisible();
    await expect(page.getByText("Self-service matrix of clinician enrollments")).toBeVisible();

    // 2. Verify KPI strip
    await expect(page.getByTestId("kpi-total-clinicians")).toHaveText("2");
    await expect(page.getByTestId("kpi-active-enrollments")).toHaveText("1");
    await expect(page.getByTestId("kpi-actionable-blockers")).toHaveText("1");

    // 3. Verify matrix double header & clinicians
    await expect(page.getByTestId("enrollment-matrix-grid")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Blue Cross Blue Shield" })).toBeVisible();
    await expect(page.getByTestId(`column-header-${PROD_1}`)).toBeVisible();
    await expect(page.getByText("Connor, Sarah")).toBeVisible();
    await expect(page.getByText("Doe, John")).toBeVisible();

    // 4. Click cell to open detail drawer
    const cell = page.getByTestId(`cell-${PROV_1}-${PROD_1}`);
    await expect(cell).toBeVisible();
    await cell.click();

    // 5. Verify detail drawer contents
    await expect(page.getByTestId("enrollment-detail-drawer")).toBeVisible();
    await expect(page.getByTestId("drawer-clinician-name")).toHaveText("Connor, Sarah");
    await expect(page.getByText("BCBS-APPROVED-100")).toBeVisible();
    await expect(page.getByText("CONFIDENTIAL STAFF NOTE: Handled by VIP senior credentialer")).toBeVisible();

    // 6. Verify proof document & SHA-256 fingerprint
    await expect(page.getByTestId(`proof-document-${PUB_1}`)).toBeVisible();
    await expect(page.getByText(/SHA-256: e3b0c442/)).toBeVisible();
    await expect(page.getByTestId(`download-proof-${PUB_1}`)).toBeVisible();
  });

  test("Client audience views restricted matrix and granted provider groups with staff notes strictly stripped", async ({
    context,
    page,
  }) => {
    await setupMockNetwork(context, { isClient: true });

    await page.goto("/reporting/enrollment-explorer");

    // 1. Verify restricted sidebar: Cases, Payer Setup, and Search are SUPPRESSED
    await expect(page.getByRole("link", { name: "Cases" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Payer Setup" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Find a provider" })).toHaveCount(0);
    await expect(page.locator("aside").first().getByText("Client Organization")).toBeVisible();
    await expect(page.locator("aside").first().getByText("Acme Physical Therapy")).toBeVisible();

    // 2. Verify filter bar displays single client group as disabled
    const groupSelect = page.getByTestId("filter-group-select");
    await expect(groupSelect).toBeDisabled();

    // 3. Open detail drawer
    const cell = page.getByTestId(`cell-${PROV_1}-${PROD_1}`);
    await cell.click();

    await expect(page.getByTestId("enrollment-detail-drawer")).toBeVisible();
    await expect(page.getByTestId("drawer-clinician-name")).toHaveText("Connor, Sarah");

    // 4. STRICT MULTI-TENANT ISOLATION: internal staff note MUST NOT be in the DOM
    await expect(page.getByText("CONFIDENTIAL STAFF NOTE")).toHaveCount(0);
    await expect(page.getByText("Internal Staff Note")).toHaveCount(0);

    // 5. Client can still inspect verified proof document
    await expect(page.getByTestId(`proof-document-${PUB_1}`)).toBeVisible();
    await expect(page.getByText(/SHA-256: e3b0c442/)).toBeVisible();
  });

  test("CSV Export triggers file download", async ({ context, page }) => {
    await setupMockNetwork(context, { isClient: false });

    await page.goto("/reporting/enrollment-explorer");

    const exportBtn = page.getByTestId("export-csv-button");
    await expect(exportBtn).toBeVisible();

    // Wait for the download event when button is clicked
    const downloadPromise = page.waitForEvent("download");
    await exportBtn.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain("enrollment-explorer-");
    expect(download.suggestedFilename()).toContain(".csv");
  });
});
