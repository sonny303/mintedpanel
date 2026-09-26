import { expect, test, type Route } from "./fixtures/legacy-access-context";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const TEMPLATE_ID = "44444444-4444-4444-8444-444444444444";
const MAPPING_ID = "55555555-5555-4555-8555-555555555555";
const PROVIDER_ID = "66666666-6666-4666-8666-666666666666";
const FACILITY_ID = "77777777-7777-4777-8777-777777777777";
const GROUP_ID = "88888888-8888-4888-8888-888888888888";
const SNAPSHOT_ID = "99999999-9999-4999-8999-999999999999";

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
    email: "roster@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Roster Tester" },
    created_at: "2026-09-01T00:00:00Z",
  },
};

const TEMPLATE = {
  id: TEMPLATE_ID,
  slug: "roster-flow-test",
  payerName: "Example Payer",
  name: "Example provider roster",
  schemaVersion: 1,
  verified: false,
  verificationStatus: "draft_pending_payer_spec" as const,
  grains: ["provider", "provider_location_tin"] as Array<"provider" | "provider_location_tin">,
  columns: [
    { key: "individual_npi", header: "Individual NPI", required: true, targetType: "npi" as const },
    {
      key: "practice_zip",
      header: "Practice ZIP+4",
      required: true,
      targetType: "zip_plus_4" as const,
    },
  ],
};

const SOURCE_OPTIONS = {
  providers: [{ id: PROVIDER_ID, label: "Tester, Ada", npi: "1234567893" }],
  facilities: [
    {
      id: FACILITY_ID,
      label: "West Clinic",
      state: "NC",
      groupId: GROUP_ID,
      groupLabel: "Example Group",
    },
  ],
  groups: [{ id: GROUP_ID, label: "Example Group", tin: "001234567", npi: "1234567893" }],
};

const INITIAL_ASSIGNMENTS = TEMPLATE.columns.map((column) => ({
  columnKey: column.key,
  sourceField: null,
  transform: null,
}));

function makeMapping() {
  return {
    id: MAPPING_ID,
    orgId: ORG_ID,
    templateId: TEMPLATE_ID,
    name: "Example provider roster mapping",
    grain: "provider" as const,
    selectedProviderIds: [] as string[],
    selectedFacilityIds: [] as string[],
    selectedGroupIds: [] as string[],
    columnAssignments: INITIAL_ASSIGNMENTS,
    revision: 1,
    updatedAt: "2026-09-24T12:00:00Z",
  };
}

async function mockSupabase(route: Route) {
  const url = new URL(route.request().url());
  const send = (data: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
  if (url.pathname.includes("/auth/v1/")) return send(SESSION);
  if (url.pathname.endsWith("/rpc/claim_invites")) return send(0);
  const table = url.pathname.split("/rest/v1/")[1] ?? "";
  if (table === "profiles") {
    return send([{ id: USER_ID, full_name: "Roster Tester", email: "roster@example.test" }]);
  }
  if (table === "memberships") {
    return send([
      {
        org_id: ORG_ID,
        role: "admin",
        organizations: {
          name: "Example Health Group",
          lifecycle_state: "active",
          created_at: "2026-09-01T00:00:00Z",
        },
      },
    ]);
  }
  return send([]);
}

test("roster mapping saves scope, records an override, and downloads an immutable export", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000);
  let mapping = makeMapping();
  let overrideReason: string | null = null;
  let snapshot: Record<string, unknown> | null = null;
  const exportAttemptKeys: string[] = [];

  await context.route(/\/(rest|auth)\/v1\//, mockSupabase);
  await context.route("**/api/rosters/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ data, error: null, meta: null }),
      });

    if (url.pathname === "/api/rosters/templates" && method === "GET") return json([TEMPLATE]);
    if (url.pathname === "/api/rosters/mappings" && method === "GET") return json([]);
    if (url.pathname === "/api/rosters/mappings" && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      mapping = {
        ...makeMapping(),
        name: String(body.name),
        grain: body.grain as typeof mapping.grain,
        selectedProviderIds: body.selectedProviderIds as string[],
        selectedFacilityIds: (body.selectedFacilityIds as string[] | undefined) ?? [],
        selectedGroupIds: (body.selectedGroupIds as string[] | undefined) ?? [],
      };
      return json({ mapping, template: TEMPLATE, sourceOptions: SOURCE_OPTIONS }, 201);
    }
    if (url.pathname === `/api/rosters/mappings/${MAPPING_ID}` && method === "GET") {
      return json({ mapping, template: TEMPLATE, sourceOptions: SOURCE_OPTIONS });
    }
    if (url.pathname === `/api/rosters/mappings/${MAPPING_ID}` && method === "PATCH") {
      const body = request.postDataJSON() as Record<string, unknown>;
      mapping = {
        ...mapping,
        name: String(body.name ?? mapping.name),
        grain: (body.grain as typeof mapping.grain | undefined) ?? mapping.grain,
        selectedProviderIds:
          (body.selectedProviderIds as string[] | undefined) ?? mapping.selectedProviderIds,
        selectedFacilityIds:
          (body.selectedFacilityIds as string[] | undefined) ?? mapping.selectedFacilityIds,
        selectedGroupIds:
          (body.selectedGroupIds as string[] | undefined) ?? mapping.selectedGroupIds,
        columnAssignments:
          (body.columnAssignments as typeof mapping.columnAssignments | undefined) ??
          mapping.columnAssignments,
        revision: mapping.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      return json({ mapping, template: TEMPLATE, sourceOptions: SOURCE_OPTIONS });
    }
    if (url.pathname === `/api/rosters/mappings/${MAPPING_ID}/preview` && method === "GET") {
      return json({
        mappingId: MAPPING_ID,
        revision: mapping.revision,
        inputFingerprint: `fingerprint-${mapping.revision}`,
        rowCount: mapping.selectedProviderIds.length,
        rows: mapping.selectedProviderIds.length
          ? [
              {
                rowKey: `${PROVIDER_ID}:${FACILITY_ID}`,
                providerLabel: "Tester, Ada",
                facilityLabel: "West Clinic",
                groupLabel: "Example Group",
                values: { individual_npi: "1234567893", practice_zip: "66048" },
              },
            ]
          : [],
      });
    }
    if (url.pathname === `/api/rosters/mappings/${MAPPING_ID}/validate` && method === "POST") {
      return json({
        mappingId: MAPPING_ID,
        revision: mapping.revision,
        inputFingerprint: `fingerprint-${mapping.revision}`,
        rowCount: mapping.selectedProviderIds.length,
        hardErrorCount: overrideReason ? 0 : 1,
        overriddenErrorCount: overrideReason ? 1 : 0,
        exportable: Boolean(overrideReason && mapping.selectedProviderIds.length),
        issues: mapping.selectedProviderIds.length
          ? [
              {
                rowKey: `${PROVIDER_ID}:${FACILITY_ID}`,
                ruleCode: "ZIP_PLUS_4_REQUIRED",
                fieldKey: "practice_zip",
                severity: "hard_error",
                message: "Practice ZIP must include ZIP+4 for this roster column.",
                overrideable: true,
                overrideId: overrideReason ? "override-1" : null,
                overrideReason,
              },
            ]
          : [],
      });
    }
    if (url.pathname === `/api/rosters/mappings/${MAPPING_ID}/overrides` && method === "POST") {
      const body = request.postDataJSON() as { reason: string };
      overrideReason = body.reason;
      return json(
        {
          id: "override-1",
          mappingId: MAPPING_ID,
          revision: mapping.revision,
          inputFingerprint: `fingerprint-${mapping.revision}`,
          rowKey: `${PROVIDER_ID}:${FACILITY_ID}`,
          ruleCode: "ZIP_PLUS_4_REQUIRED",
          fieldKey: "practice_zip",
          reason: overrideReason,
          createdAt: "2026-09-24T12:30:00Z",
        },
        201,
      );
    }
    if (url.pathname === `/api/rosters/mappings/${MAPPING_ID}/export` && method === "POST") {
      const body = request.postDataJSON() as { format: "csv" | "xlsx"; idempotencyKey: string };
      exportAttemptKeys.push(body.idempotencyKey);
      if (exportAttemptKeys.length === 1) {
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ data: null, error: "Temporary export service failure" }),
        });
      }
      snapshot = {
        id: SNAPSHOT_ID,
        mappingId: MAPPING_ID,
        templateId: TEMPLATE_ID,
        templateName: TEMPLATE.name,
        mappingName: mapping.name,
        templateVerified: false,
        templateVerificationStatus: "draft_pending_payer_spec",
        format: body.format,
        exportedAt: "2026-09-24T12:31:00Z",
        totalRows: mapping.selectedProviderIds.length,
        checksum: "a".repeat(64),
        appliedOverrides: 1,
        exportedBy: USER_ID,
        fileName: `example-roster.${body.format}`,
        downloadPath: `/api/rosters/exports/${SNAPSHOT_ID}/download`,
      };
      return json(snapshot, 201);
    }
    if (url.pathname === "/api/rosters/history" && method === "GET")
      return json(snapshot ? [snapshot] : []);
    if (url.pathname === `/api/rosters/exports/${SNAPSHOT_ID}/download` && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "text/csv; charset=utf-8",
        body: "Individual NPI,Practice ZIP+4\r\n1234567893,66048\r\n",
      });
    }
    return json({ message: `Unhandled roster API request: ${method} ${url.pathname}` }, 404);
  });

  await page.addInitScript(
    ([authKey, session, orgId]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_ID] as const,
  );

  page.setDefaultTimeout(30_000);
  await page.goto("/reporting/rosters/templates");
  await expect(page.getByRole("heading", { name: "Provider Roster Engine" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Draft · payer spec pending")).toBeVisible();
  await page.getByRole("button", { name: /Map fields/ }).click();

  await expect(page.getByRole("heading", { name: "Source scope" })).toBeVisible();
  await page.getByRole("checkbox", { name: /Tester, Ada/ }).check();
  await page.getByRole("checkbox", { name: /West Clinic/ }).check();
  await page.getByRole("combobox", { name: "Source for Individual NPI" }).click();
  await page.getByRole("option", { name: /Individual NPI/ }).click();
  await page.getByRole("combobox", { name: "Source for Practice ZIP+4" }).click();
  await page.getByRole("option", { name: /Practice ZIP/ }).click();
  await page.getByRole("button", { name: "Save mapping", exact: true }).first().click();
  await expect(
    page.getByText("1 selected providers produce 1 output rows", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Review validation/ }).click();

  await expect(page.getByText("Hard errors")).toBeVisible();
  await page
    .getByLabel("Audited override reason")
    .fill(
      "Confirmed the payer accepts this ZIP+5 for the selected location in this one-time roster export.",
    );
  await page.getByRole("button", { name: "Record override" }).click();
  await expect(page.getByText("Export ready")).toBeVisible();
  await page.getByRole("link", { name: /Continue to export/ }).click();

  await expect(page.getByText("Draft payer schema")).toBeVisible();
  await page.getByRole("button", { name: /Export and save snapshot/ }).click();
  await expect(page.getByText("Temporary export service failure")).toBeVisible();
  expect(exportAttemptKeys).toHaveLength(1);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export and save snapshot/ }).click();
  const fileDownload = await downloadPromise;
  expect(exportAttemptKeys).toHaveLength(2);
  expect(exportAttemptKeys[0]).toBe(exportAttemptKeys[1]);
  expect(fileDownload.suggestedFilename()).toBe("example-roster.csv");
  await expect(page.getByText("Snapshot saved")).toBeVisible();
  await expect(page.getByText("a".repeat(64))).toBeVisible();
  await page.getByRole("link", { name: /View export history/ }).click();
  await expect(page.getByRole("heading", { name: "Roster export history" })).toBeVisible();
  const exportedRow = page.getByRole("row").filter({ hasText: "example-roster.csv" });
  await expect(exportedRow).toContainText("Example provider roster");
  await expect(page.getByText("Draft payer schema")).toBeVisible();
  await expect(page.getByText(USER_ID)).toBeVisible();
});
