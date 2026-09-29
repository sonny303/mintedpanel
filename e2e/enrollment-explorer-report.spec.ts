import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test, expect as baseExpect, type BrowserContext, type Route } from "@playwright/test";
import { deriveEnrollmentReportProviders } from "../src/lib/enrollmentReportView";
import type {
  EnrollmentReportPage,
  EnrollmentReportLocation,
  EnrollmentScopeDetail,
} from "@/types";

const expect = baseExpect.configure({ timeout: 30_000 });
const AUTH_KEY = "sb-example-auth-token";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";
const PROVIDER = "44444444-4444-4444-8444-444444444444";
const PRODUCT = "55555555-5555-4555-8555-555555555555";
const SECTION = `${GROUP}:CO`;
const SCOPE_NORTH = "66666666-6666-4666-8666-666666666666";
const SCOPE_EAST = "77777777-7777-4777-8777-777777777777";
const CONTEXT_REVISION = "e614-client-context-1";
const ARTIFACT_DIR = "test-results/e614-enrollment-explorer";
const PERFORMANCE_PROVIDER_COUNT = 3_000;
const PERFORMANCE_PAGE_SIZE = 50;
const PERFORMANCE_PRODUCT_COUNT = 20;
const PERFORMANCE_LOCATIONS_PER_PRODUCT = 2;

declare global {
  interface Window {
    __e614LongTasks?: number[];
  }
}

type ProbeState = {
  reportRequests: string[];
  detailRequests: string[];
  historyRequests: string[];
  proofRequests: Array<{
    publicationId: string;
    orgId: string | undefined;
    audience: string | undefined;
    contextRevision: string | undefined;
  }>;
  proofResponseBody?: Buffer;
};

const session = {
  access_token: `synthetic-${ACTOR}`,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 9999999999,
  refresh_token: "synthetic-refresh",
  user: {
    id: ACTOR,
    aud: "authenticated",
    role: "authenticated",
    email: "client@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Synthetic Report User" },
    created_at: "2026-09-01T00:00:00Z",
  },
};

const accessContext = {
  actorUserId: ACTOR,
  email: "client@example.test",
  audience: "client",
  selectedOrgId: ORG,
  staffOrgs: [],
  clientOrgs: [
    {
      orgId: ORG,
      orgName: "North Clinic",
      groups: [{ groupId: GROUP, groupName: "North Clinic" }],
    },
  ],
  globalTraining: false,
  restrictedExternal: true,
  contextRevision: CONTEXT_REVISION,
};

function json(route: Route, body: unknown, status = 200, headers?: Record<string, string>) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(body),
  });
}

async function seedAuth(context: BrowserContext) {
  await context.addInitScript(
    ([key, initialSession, orgId]) => {
      localStorage.setItem(key as string, JSON.stringify(initialSession));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
    },
    [AUTH_KEY, session, ORG] as const,
  );
}

function location(
  scopeId: string,
  facilityLabel: string,
  overrides: Partial<EnrollmentReportLocation> = {},
): EnrollmentReportLocation {
  return {
    sectionKey: SECTION,
    scopeId,
    facilityId:
      scopeId === SCOPE_EAST
        ? "88888888-8888-4888-8888-888888888888"
        : "99999999-9999-4999-8999-999999999999",
    facilityLabel,
    publicationState: "published",
    historical: false,
    status: "submitted",
    ...overrides,
  };
}

function reportPage(locations: EnrollmentReportLocation[]): EnrollmentReportPage {
  return {
    contextRevision: CONTEXT_REVISION,
    viewToken: "synthetic-report-view-1",
    accessState: "ready",
    filters: {},
    filterChoices: {
      groups: [{ id: GROUP, label: "North Clinic" }],
      states: ["CO"],
      facilities: [
        {
          id: "99999999-9999-4999-8999-999999999999",
          label: "Facility North",
          groupId: GROUP,
          state: "CO",
        },
        {
          id: "88888888-8888-4888-8888-888888888888",
          label: "Facility East",
          groupId: GROUP,
          state: "CO",
        },
      ],
      products: [{ id: PRODUCT, payerLabel: "Blue Cedar", label: "Choice PPO" }],
      disciplines: ["PT"],
      statuses: ["submitted", "approved"],
    },
    sections: [
      {
        key: SECTION,
        groupId: GROUP,
        groupLabel: "North Clinic",
        state: "CO",
        columns: [
          {
            key: `${SECTION}:${PRODUCT}`,
            productId: PRODUCT,
            payerLabel: "Blue Cedar",
            productLabel: "Choice PPO",
          },
        ],
      },
    ],
    providers: [
      {
        providerId: PROVIDER,
        name: "Jordan Example",
        npi: "0012345678",
        discipline: "PT",
        status: "active",
        referenceOnly: false,
        verificationState: "verified",
        sectionKeys: [SECTION],
        cells: [
          {
            key: `${SECTION}:${PRODUCT}`,
            sectionKey: SECTION,
            productId: PRODUCT,
            state: "published",
            locationCount: locations.length,
            locations,
          },
        ],
      },
    ],
    nextCursor: null,
  };
}

function syntheticUuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

function performancePage(url: URL): EnrollmentReportPage {
  const offset = Number(url.searchParams.get("cursor") ?? 0);
  const products = Array.from({ length: PERFORMANCE_PRODUCT_COUNT }, (_, index) => ({
    id: syntheticUuid(10_000 + index),
    payerLabel: `Payer ${String(index + 1).padStart(2, "0")}`,
    label: `Product ${String(index + 1).padStart(2, "0")}`,
  }));
  const columns = products.map((product) => ({
    key: `${SECTION}:${product.id}`,
    productId: product.id,
    payerLabel: product.payerLabel,
    productLabel: product.label,
  }));
  const providers = Array.from({ length: PERFORMANCE_PAGE_SIZE }, (_, localIndex) => {
    const index = offset + localIndex;
    const cells = columns.map((column, productIndex) => {
      const locations = Array.from(
        { length: PERFORMANCE_LOCATIONS_PER_PRODUCT },
        (_, locationIndex) => ({
          sectionKey: SECTION,
          scopeId: syntheticUuid(
            100_000 +
              index * PERFORMANCE_PRODUCT_COUNT * PERFORMANCE_LOCATIONS_PER_PRODUCT +
              productIndex * PERFORMANCE_LOCATIONS_PER_PRODUCT +
              locationIndex,
          ),
          facilityId: syntheticUuid(200_000 + locationIndex),
          facilityLabel: `Facility ${locationIndex + 1}`,
          publicationState: "published" as const,
          historical: false,
          status: "submitted" as const,
        }),
      );
      return {
        key: column.key,
        sectionKey: SECTION,
        productId: column.productId,
        state: "published" as const,
        locationCount: locations.length,
        locations,
      };
    });
    return {
      providerId: syntheticUuid(300_000 + index),
      name: `Synthetic Provider ${String(index + 1).padStart(4, "0")}`,
      npi: String(1_000_000_000 + index),
      discipline: "PT" as const,
      status: "active" as const,
      referenceOnly: false,
      verificationState: "verified" as const,
      sectionKeys: [SECTION],
      cells,
    };
  });
  const nextOffset = offset + PERFORMANCE_PAGE_SIZE;
  return {
    contextRevision: CONTEXT_REVISION,
    viewToken: "synthetic-performance-view",
    accessState: "ready",
    filters: {},
    filterChoices: {
      groups: [{ id: GROUP, label: "North Clinic" }],
      states: ["CO"],
      facilities: [],
      products,
      disciplines: ["PT"],
      statuses: ["submitted", "approved"],
    },
    sections: [{ key: SECTION, groupId: GROUP, groupLabel: "North Clinic", state: "CO", columns }],
    providers,
    nextCursor: nextOffset < PERFORMANCE_PROVIDER_COUNT ? String(nextOffset) : null,
  };
}

async function installNetwork(
  context: BrowserContext,
  state: ProbeState,
  locations: EnrollmentReportLocation[],
  options: {
    pageFactory?: (url: URL) => EnrollmentReportPage;
    conflictAfterFirstPage?: boolean;
    deniedAfterFirstPageStatus?: number;
    csvStatus?: number;
  } = {},
) {
  await context.route(/\/(rest|auth)\/v1\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/token")) return json(route, session);
    if (url.pathname.includes("/auth/v1/")) return json(route, session);
    const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
    if (table === "profiles") {
      const profile = { id: ACTOR, full_name: "Synthetic Report User" };
      return (route.request().headers().accept ?? "").includes("vnd.pgrst.object")
        ? json(route, profile)
        : json(route, [profile]);
    }
    if (table === "memberships") return json(route, []);
    if (table === "organizations") return json(route, []);
    if ((route.request().headers().accept ?? "").includes("vnd.pgrst.object")) {
      return json(route, { code: "PGRST116", message: "No rows found" }, 406);
    }
    return json(route, []);
  });

  await context.route("**/api/me/access-context**", async (route) =>
    json(route, { data: accessContext, error: null }, 200, {
      "X-Minted-Context-Revision": CONTEXT_REVISION,
    }),
  );

  await context.route("**/api/enrollment-explorer/**", async (route) => {
    const url = new URL(route.request().url());
    const headers = { "X-Minted-Context-Revision": CONTEXT_REVISION };
    if (url.pathname.endsWith("/report/page")) {
      state.reportRequests.push(url.search);
      if (options.conflictAfterFirstPage && url.searchParams.has("cursor")) {
        return json(route, { data: null, error: "report snapshot expired" }, 409, headers);
      }
      if (options.deniedAfterFirstPageStatus && url.searchParams.has("cursor")) {
        return json(
          route,
          { data: null, error: "report access denied" },
          options.deniedAfterFirstPageStatus,
          headers,
        );
      }
      return json(
        route,
        { data: options.pageFactory?.(url) ?? reportPage(locations), error: null },
        200,
        headers,
      );
    }
    if (url.pathname.endsWith("/report.csv") && options.csvStatus) {
      return json(
        route,
        { data: null, error: "report snapshot expired" },
        options.csvStatus,
        headers,
      );
    }
    const detail = /\/scopes\/([^/]+)$/.exec(url.pathname);
    if (detail) {
      state.detailRequests.push(detail[1]);
      const scopeId = detail[1];
      const facilityId =
        scopeId === SCOPE_EAST
          ? "88888888-8888-4888-8888-888888888888"
          : "99999999-9999-4999-8999-999999999999";
      const value: EnrollmentScopeDetail = {
        scopeId,
        providerId: PROVIDER,
        groupId: GROUP,
        payerProductId: PRODUCT,
        facilityId,
        state: "CO",
        status: scopeId === SCOPE_EAST ? "approved" : "submitted",
        cycleNo: 1,
        revisionNo: 2,
        payerReference: "0000789",
        approvedDate: scopeId === SCOPE_EAST ? "2026-08-01" : null,
        effectiveDate: scopeId === SCOPE_EAST ? "2026-08-15" : null,
        proofs:
          scopeId === SCOPE_EAST
            ? [
                {
                  publicationId: "abababab-abab-4bab-8bab-abababababab",
                  evidenceKind: "payer_approval_letter",
                  supportedFields: [
                    "enrollment_status",
                    "approved_date",
                    "effective_date",
                    "product_id",
                    "facility_id",
                  ],
                  publishedAt: "2026-08-02T00:00:00Z",
                },
              ]
            : [],
      };
      return json(route, { data: value, error: null }, 200, headers);
    }
    const proof = /\/proofs\/([^/]+)\/download$/.exec(url.pathname);
    if (proof) {
      const requestHeaders = route.request().headers();
      state.proofRequests.push({
        publicationId: proof[1],
        orgId: requestHeaders["x-org-id"],
        audience: requestHeaders["x-enrollment-audience"],
        contextRevision: requestHeaders["x-minted-context-revision"],
      });
      return route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: { ...headers, "Cache-Control": "no-store" },
        body: (state.proofResponseBody = Buffer.from(
          "%PDF-1.4\nSynthetic enrollment proof\n%%EOF",
        )),
      });
    }
    const history = /\/scopes\/([^/]+)\/history$/.exec(url.pathname);
    if (history) {
      state.historyRequests.push(history[1]);
      return json(
        route,
        {
          data: { audience: "client", scopeId: history[1], items: [], nextCursor: null },
          error: null,
        },
        200,
        headers,
      );
    }
    return json(route, { data: null, error: "Unexpected synthetic report request" }, 404, headers);
  });
}

function initState(): ProbeState {
  return { reportRequests: [], detailRequests: [], historyRequests: [], proofRequests: [] };
}

test("matrix filters stay URL/API aligned and location detail restores focus", async ({
  context,
  page,
}) => {
  const state = initState();
  const locations = [
    location(SCOPE_NORTH, "Facility North"),
    location(SCOPE_EAST, "Facility East", { status: "approved" }),
  ];
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  await installNetwork(context, state, locations);
  await seedAuth(context);
  await page.goto("/reporting/enrollment-explorer");

  await expect(page.getByRole("grid", { name: "Provider enrollment matrix" })).toBeVisible();
  const search = page.getByRole("textbox", { name: "Search providers" });
  await search.fill("Jordan");
  await expect.poll(() => new URL(page.url()).searchParams.get("search")).toBe("Jordan");
  await expect
    .poll(() =>
      state.reportRequests.some((query) => new URLSearchParams(query).get("search") === "Jordan"),
    )
    .toBe(true);
  await page.screenshot({ path: `${ARTIFACT_DIR}/desktop-matrix.png`, fullPage: true });

  const group = page.getByRole("combobox", { name: "Group" });
  const groupPageResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/report/page") &&
      url.searchParams.get("groupId") === GROUP &&
      response.status() === 200
    );
  });
  await group.click();
  await page.getByRole("option", { name: "North Clinic" }).click();
  await groupPageResponse;
  await expect.poll(() => new URL(page.url()).searchParams.get("group")).toBe(GROUP);
  await expect
    .poll(() =>
      state.reportRequests.some((query) => new URLSearchParams(query).get("groupId") === GROUP),
    )
    .toBe(true);

  const trigger = page.getByTestId(`enrollment-cell-${PROVIDER}-${PRODUCT}`);
  await trigger.click();
  const locationPicker = page.getByTestId("enrollment-location-picker");
  await expect(locationPicker).toBeVisible();
  await locationPicker.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  await locationPicker.getByRole("button", { name: /Facility East/ }).click();
  await expect(page.getByTestId("enrollment-scope-drawer")).toBeVisible();
  await expect(page.getByText(/Facility East/).last()).toBeVisible();
  expect(state.detailRequests).toEqual([SCOPE_EAST]);
  await page.screenshot({ path: `${ARTIFACT_DIR}/desktop-drawer.png`, fullPage: true });
  const proofResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/proofs/abababab-abab-4bab-8bab-abababababab/download"),
  );
  const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
  await page.getByRole("button", { name: "Download proof" }).click();
  const [proofResponse, download] = await Promise.all([proofResponsePromise, downloadPromise]);
  expect(proofResponse.status()).toBe(200);
  expect(proofResponse.headers()["cache-control"]).toBe("no-store");
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  expect(await readFile(downloadedPath!)).toEqual(
    Buffer.from("%PDF-1.4\nSynthetic enrollment proof\n%%EOF"),
  );
  expect(state.proofResponseBody?.subarray(0, 8).toString()).toBe("%PDF-1.4");
  expect(state.proofRequests).toEqual([
    {
      publicationId: "abababab-abab-4bab-8bab-abababababab",
      orgId: ORG,
      audience: "client",
      contextRevision: CONTEXT_REVISION,
    },
  ]);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("enrollment-scope-drawer")).toHaveCount(0);
  await expect(trigger).toBeFocused({ timeout: 5_000 });
});

test("historical matrix selection opens paged history without current detail", async ({
  context,
  page,
}) => {
  const state = initState();
  const locations = [
    location(SCOPE_NORTH, "Facility North", {
      historical: true,
      publicationState: "retracted",
      status: "submitted",
    }),
  ];
  await installNetwork(context, state, locations);
  await seedAuth(context);
  await page.goto("/reporting/enrollment-explorer?historical=true");

  await page.getByTestId(`enrollment-cell-${PROVIDER}-${PRODUCT}`).click();
  await expect(page.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(/Selected historical row: submitted/)).toBeVisible();
  await expect.poll(() => state.historyRequests).toEqual([SCOPE_NORTH]);
  expect(state.detailRequests).toEqual([]);
});

test("authorized provider cohort with no configured products stays visible without invented cells", async ({
  context,
  page,
}) => {
  const state = initState();
  const noTargets = reportPage([]);
  noTargets.sections = [];
  noTargets.providers[0].sectionKeys = [];
  noTargets.providers[0].cells = [];
  await installNetwork(context, state, [], { pageFactory: () => noTargets });
  await seedAuth(context);
  await page.goto("/reporting/enrollment-explorer");

  await expect(page.getByText(/No payer products are configured/)).toBeVisible();
  await expect(page.getByText("Jordan Example")).toBeVisible();
  await expect(page.getByRole("gridcell")).toHaveCount(0);
});

test("expired report view token hides retained rows and offers a visible refresh", async ({
  context,
  page,
}) => {
  const state = initState();
  const first = reportPage([location(SCOPE_NORTH, "Facility North")]);
  first.nextCursor = "next-page-cursor";
  await installNetwork(context, state, [location(SCOPE_NORTH, "Facility North")], {
    pageFactory: (url) => (url.searchParams.has("cursor") ? reportPage([]) : first),
    conflictAfterFirstPage: true,
  });
  await seedAuth(context);
  await page.goto("/reporting/enrollment-explorer");
  await expect(page.getByRole("grid", { name: "Provider enrollment matrix" })).toBeVisible();
  await page.getByTestId(`enrollment-cell-${PROVIDER}-${PRODUCT}`).click();
  await expect(page.getByTestId("enrollment-scope-drawer")).toBeVisible();
  await page
    .locator("button")
    .filter({ hasText: "Load next 50 providers" })
    .evaluate((button) => (button as HTMLButtonElement).click());

  await expect(
    page.getByRole("alert").filter({ hasText: "Refresh before reviewing or downloading" }),
  ).toBeVisible();
  await expect(page.getByRole("grid", { name: "Provider enrollment matrix" })).toHaveCount(0);
  await expect(page.getByTestId("enrollment-scope-drawer")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download CSV" })).toHaveCount(0);
});

test("report authorization denial hides retained rows and disables export", async ({
  context,
  page,
}) => {
  const state = initState();
  const first = reportPage([location(SCOPE_NORTH, "Facility North")]);
  first.nextCursor = "next-page-cursor";
  await installNetwork(context, state, [location(SCOPE_NORTH, "Facility North")], {
    pageFactory: (url) => (url.searchParams.has("cursor") ? reportPage([]) : first),
    deniedAfterFirstPageStatus: 403,
  });
  await seedAuth(context);
  await page.goto("/reporting/enrollment-explorer");
  await expect(page.getByRole("grid", { name: "Provider enrollment matrix" })).toBeVisible();
  await page.getByTestId(`enrollment-cell-${PROVIDER}-${PRODUCT}`).click();
  await expect(page.getByTestId("enrollment-scope-drawer")).toBeVisible();
  await page
    .locator("button")
    .filter({ hasText: "Load next 50 providers" })
    .evaluate((button) => (button as HTMLButtonElement).click());

  await expect(
    page.getByRole("alert").filter({ hasText: "Access to this report is no longer valid" }),
  ).toBeVisible();
  await expect(page.getByRole("grid", { name: "Provider enrollment matrix" })).toHaveCount(0);
  await expect(page.getByTestId("enrollment-scope-drawer")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download CSV" })).toHaveCount(0);
});

test("CSV snapshot conflicts are visible and invalidate the matrix", async ({ context, page }) => {
  const state = initState();
  const item = location(SCOPE_NORTH, "Facility North");
  await installNetwork(context, state, [item], { csvStatus: 409 });
  await seedAuth(context);
  await page.goto("/reporting/enrollment-explorer");
  await expect(page.getByRole("button", { name: "Download CSV" })).toBeVisible();
  await page.getByRole("button", { name: "Download CSV" }).click();

  await expect(
    page.getByRole("alert").filter({ hasText: "Refresh before reviewing or downloading" }),
  ).toBeVisible();
  await expect(page.getByRole("grid", { name: "Provider enrollment matrix" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh snapshot" })).toBeVisible();
});

test("matrix remains bounded and scrolls for a synthetic 3,000-provider, 20-product cohort", async ({
  context,
  page,
}) => {
  test.setTimeout(180_000);
  const state = initState();
  await page.addInitScript(() => {
    window.__e614LongTasks = [];
    if ("PerformanceObserver" in window) {
      const observer = new PerformanceObserver((list) => {
        window.__e614LongTasks?.push(...list.getEntries().map((entry) => entry.duration));
      });
      observer.observe({ type: "longtask", buffered: true });
    }
  });
  const syntheticPages = Array.from(
    { length: PERFORMANCE_PROVIDER_COUNT / PERFORMANCE_PAGE_SIZE },
    (_, pageIndex) =>
      performancePage(
        new URL(`http://localhost/report/page?cursor=${pageIndex * PERFORMANCE_PAGE_SIZE}`),
      ),
  );
  const deriveStartedAt = performance.now();
  const derivedProviders = deriveEnrollmentReportProviders(syntheticPages);
  const derivationMs = performance.now() - deriveStartedAt;
  expect(derivedProviders).toHaveLength(PERFORMANCE_PROVIDER_COUNT);
  const actualScopeLocations = derivedProviders.reduce(
    (count, provider) =>
      count + provider.cells.reduce((sum, cell) => sum + cell.locations.length, 0),
    0,
  );
  expect(actualScopeLocations).toBe(
    PERFORMANCE_PROVIDER_COUNT * PERFORMANCE_PRODUCT_COUNT * PERFORMANCE_LOCATIONS_PER_PRODUCT,
  );
  await installNetwork(context, state, [], {
    pageFactory: (url) =>
      syntheticPages[
        Math.floor(Number(url.searchParams.get("cursor") ?? 0) / PERFORMANCE_PAGE_SIZE)
      ],
  });
  await seedAuth(context);
  await page.goto("/reporting/enrollment-explorer");
  await expect(page.getByRole("grid", { name: "Provider enrollment matrix" })).toBeVisible();

  for (
    let pageNumber = 2;
    pageNumber <= PERFORMANCE_PROVIDER_COUNT / PERFORMANCE_PAGE_SIZE;
    pageNumber += 1
  ) {
    await page.getByRole("button", { name: "Load next 50 providers" }).click();
    await expect(
      page.getByText(`${pageNumber * PERFORMANCE_PAGE_SIZE} providers loaded`, { exact: true }),
    ).toBeVisible();
  }

  const responseToFrameMs = await page.evaluate(async () => {
    const entries = performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes("/api/enrollment-explorer/report/page"));
    const responseEnd = entries.at(-1)?.responseEnd ?? performance.now();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return performance.now() - responseEnd;
  });
  const measurements = await page.evaluate(async () => {
    const matrix = document.querySelector<HTMLElement>('[data-testid="enrollment-matrix"]');
    if (!matrix) throw new Error("Matrix did not mount");
    const longTaskStart = window.__e614LongTasks?.length ?? 0;
    for (let step = 0; step < 24; step += 1) {
      matrix.scrollTo({ top: step * 400, left: (step % 10) * 260 });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    return {
      mountedRows: matrix.querySelectorAll('[role="row"]').length,
      mountedCells: matrix.querySelectorAll('[role="gridcell"]').length,
      scrollLongTasksMs: (window.__e614LongTasks ?? []).slice(longTaskStart),
    };
  });
  console.log(
    "E614 synthetic browser measurement",
    JSON.stringify({
      cohortProviders: PERFORMANCE_PROVIDER_COUNT,
      responsePageSize: PERFORMANCE_PAGE_SIZE,
      products: PERFORMANCE_PRODUCT_COUNT,
      compactCells: PERFORMANCE_PROVIDER_COUNT * PERFORMANCE_PRODUCT_COUNT,
      scopeLocations: actualScopeLocations,
      pagesLoaded: PERFORMANCE_PROVIDER_COUNT / PERFORMANCE_PAGE_SIZE,
      productionProviderPageMergeMs: derivationMs,
      lastPageResponseToNextFrameMs: responseToFrameMs,
      method:
        "60 synthetic 50-provider page DTOs reused by the mock API and production provider-page merge helper; Chromium frame lag measured from final responseEnd; 24 RAF scroll steps with PerformanceObserver longtask entries",
      ...measurements,
      scrollTargetMet: measurements.scrollLongTasksMs.every((duration) => duration <= 50),
    }),
  );
  expect(measurements.mountedRows).toBeLessThan(40);
  expect(measurements.mountedCells).toBeLessThan(500);
  // TD-54 records the accepted CI variance; retain the measurement without
  // treating the unproven 50 ms scroll target as a release gate.
  await page.screenshot({ path: `${ARTIFACT_DIR}/desktop-matrix-3000-loaded.png`, fullPage: true });
});

test("mobile matrix drills into the exact scoped location and renders the drawer", async ({
  context,
  page,
}) => {
  const state = initState();
  const locations = [
    location(SCOPE_NORTH, "Facility North"),
    location(SCOPE_EAST, "Facility East", { status: "approved" }),
  ];
  await installNetwork(context, state, locations);
  await seedAuth(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/reporting/enrollment-explorer");

  await expect(page.getByTestId("enrollment-mobile-list")).toBeVisible();
  await page.screenshot({ path: `${ARTIFACT_DIR}/mobile-list.png`, fullPage: true });
  await page.getByRole("button", { name: "View 2 scoped locations" }).click();
  await page
    .getByRole("button", { name: /North Clinic, CO, Blue Cedar, Choice PPO, Facility East/ })
    .click();
  await expect(page.getByTestId("enrollment-scope-drawer")).toBeVisible();
  expect(state.detailRequests).toEqual([SCOPE_EAST]);
  await page.screenshot({ path: `${ARTIFACT_DIR}/mobile-drawer.png`, fullPage: true });
});

test("staff capture saves the selected secondary facility id", async ({ context, page }) => {
  const state = initState();
  const facilityNorth = "99999999-9999-4999-8999-999999999999";
  const facilityEast = "88888888-8888-4888-8888-888888888888";
  const savedRequests: Array<Record<string, unknown>> = [];
  const staffContext = {
    ...accessContext,
    audience: "staff",
    restrictedExternal: false,
    staffOrgs: [
      { orgId: ORG, orgName: "North Clinic", role: "admin", reportStaff: true, clientManage: true },
    ],
  };
  await context.addInitScript(
    ([key, initialSession, orgId]) => {
      localStorage.setItem(key as string, JSON.stringify(initialSession));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
    },
    [AUTH_KEY, session, ORG] as const,
  );
  await context.route(/\/(rest|auth)\/v1\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/token")) return json(route, session);
    if (url.pathname.includes("/auth/v1/")) return json(route, session);
    const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
    if (table === "profiles")
      return json(route, [{ id: ACTOR, full_name: "Synthetic Report User" }]);
    if (table === "memberships")
      return json(route, [
        {
          org_id: ORG,
          role: "admin",
          organizations: {
            id: ORG,
            name: "North Clinic",
            lifecycle_state: "active",
            created_at: "2026-09-01T00:00:00Z",
          },
        },
      ]);
    if (table === "organizations") return json(route, []);
    if (table === "providers")
      return json(route, [
        {
          id: PROVIDER,
          org_id: ORG,
          group_id: GROUP,
          first_name: "Jordan",
          last_name: "Example",
          npi: "0012345678",
          status: "active",
          is_test_provider: false,
          reference_only: false,
          verification_state: "verified",
        },
      ]);
    if (table === "provider_groups")
      return json(route, [
        { id: GROUP, org_id: ORG, name: "North Clinic", states: ["CO"], is_active: true },
      ]);
    if (table === "provider_group_assignments")
      return json(route, [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          org_id: ORG,
          provider_id: PROVIDER,
          group_id: GROUP,
          is_primary: true,
          start_date: "2025-01-01",
          end_date: null,
        },
      ]);
    if (table === "provider_facility_assignments")
      return json(route, [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          org_id: ORG,
          provider_id: PROVIDER,
          facility_id: facilityNorth,
          is_primary: true,
          start_date: "2025-01-01",
          created_at: "2025-01-01T00:00:00Z",
        },
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          org_id: ORG,
          provider_id: PROVIDER,
          facility_id: facilityEast,
          is_primary: false,
          start_date: "2025-01-01",
          created_at: "2025-01-01T00:00:00Z",
        },
      ]);
    if (table === "facilities")
      return json(route, [
        {
          id: facilityNorth,
          org_id: ORG,
          group_id: GROUP,
          name: "Facility North",
          state: "CO",
          is_active: true,
          reference_only: false,
        },
        {
          id: facilityEast,
          org_id: ORG,
          group_id: GROUP,
          name: "Facility East",
          state: "CO",
          is_active: true,
          reference_only: false,
        },
      ]);
    if (table === "payers")
      return json(route, [
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          org_id: null,
          name: "Blue Cedar",
          is_active: true,
          status: "active",
        },
      ]);
    return json(route, []);
  });
  await context.route("**/api/me/access-context**", async (route) =>
    json(route, { data: staffContext, error: null }, 200, {
      "X-Minted-Context-Revision": CONTEXT_REVISION,
    }),
  );
  await context.route("**/api/enrollment-explorer/**", async (route) => {
    const url = new URL(route.request().url());
    const headers = { "X-Minted-Context-Revision": CONTEXT_REVISION };
    if (url.pathname.endsWith("/report/page"))
      return json(route, { data: reportPage([]), error: null }, 200, headers);
    if (url.pathname.endsWith("/catalog"))
      return json(
        route,
        {
          data: {
            products: [
              {
                productId: PRODUCT,
                payerId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                payerName: "Blue Cedar",
                productKey: "choice-ppo",
                displayName: "Choice PPO",
                isActive: true,
              },
            ],
            targets: [
              {
                targetId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                groupId: GROUP,
                payerProductId: PRODUCT,
                payerId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                state: "CO",
                isActive: true,
              },
            ],
          },
          error: null,
        },
        200,
        headers,
      );
    if (url.pathname.endsWith("/unresolved"))
      return json(
        route,
        { data: { groupId: GROUP, items: [], nextCursor: null }, error: null },
        200,
        headers,
      );
    if (url.pathname === "/api/enrollment-explorer/scopes" && route.request().method() === "POST") {
      savedRequests.push(route.request().postDataJSON() as Record<string, unknown>);
      return json(
        route,
        {
          data: {
            scopeId: SCOPE_EAST,
            revisionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            revisionNo: 1,
            cycleNo: 1,
            created: true,
          },
          error: null,
        },
        200,
        headers,
      );
    }
    if (url.pathname === `/api/enrollment-explorer/scopes/${SCOPE_EAST}`) {
      return json(
        route,
        {
          data: {
            scope: {
              id: SCOPE_EAST,
              orgId: ORG,
              providerId: PROVIDER,
              groupId: GROUP,
              payerProductId: PRODUCT,
              facilityId: facilityEast,
              state: "CO",
              currentRevisionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            },
            revision: {
              status: "not_started",
              action_owner: "Minted",
              retro_status: "unknown",
              cycle_no: 1,
              revision_no: 1,
            },
            stale: false,
            sources: [],
            summary: null,
            proofs: [],
          },
          error: null,
        },
        200,
        headers,
      );
    }
    return json(route, { data: null, error: "Unexpected synthetic staff request" }, 404, headers);
  });

  await page.goto("/reporting/enrollment-explorer");
  await expect(page.getByRole("heading", { name: "Staff enrollment workspace" })).toBeVisible();
  await page.getByRole("combobox", { name: "Scope provider" }).selectOption(PROVIDER);
  await page.getByRole("combobox", { name: "Scope group" }).selectOption(GROUP);
  await page.getByRole("combobox", { name: "Scope facility" }).selectOption(facilityEast);
  await page.getByRole("combobox", { name: "Scope state" }).selectOption("CO");
  await page.getByRole("combobox", { name: "Scope payer product" }).selectOption(PRODUCT);
  await page.getByRole("button", { name: "Save draft revision" }).click();

  await expect.poll(() => savedRequests.length).toBe(1);
  expect(savedRequests[0]).toMatchObject({
    facilityId: facilityEast,
    providerId: PROVIDER,
    groupId: GROUP,
    payerProductId: PRODUCT,
    state: "CO",
  });
  await expect(page.getByText(/Facility East/).last()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Save draft revision" })).toBeFocused();
});
