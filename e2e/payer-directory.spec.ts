import { test, expect, type Route } from "@playwright/test";

// E1.6 TE-6 + E4.2 payer governance, retargeted by the payer-and-cases
// Slice A (the catalog browse is retired — /payer-directory now lands on the
// single-view Payer Setup page, which lists the ORG'S OWN payers):
//   TS-36 (retargeted) — search/State/Kind filter the org's payer list; the
//         catalog's alias search and commercial-default narrowing went with
//         the browse (both pinned absent).
//   Drill-in — the payer name is the only link; identity facts (catalog key,
//         full coverage) live on the read-only detail; the interactive
//         +N-more states disclosure is design-removed (plain text overflow).
//   Governance: the catalog diff review is PLATFORM tooling — even with
//         unreviewed diffs sitting in payer_catalog_changes, the org app never
//         reads the table, never renders the review panel, and never calls the
//         review RPC.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_TREE_HILL = "22222222-2222-4222-8222-222222222222";

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

const globalPayer = (over: Record<string, unknown>) => ({
  id: "gp",
  org_id: null,
  name: "",
  is_active: true,
  avg_decision_days: null,
  payer_kind: "commercial",
  payer_slug: null,
  aliases: [],
  states: [],
  status: "active",
  merged_into_id: null,
  last_synced_at: "2026-07-12T00:00:00Z",
  created_at: "2026-07-12T00:00:00Z",
  ...over,
});

function makeFixtures(over: Record<string, unknown[]> = {}) {
  return {
    organizations: [
      {
        id: ORG_TREE_HILL,
        name: "Tree Hill Sports Therapy",
        lifecycle_state: "active",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    memberships: [
      {
        org_id: ORG_TREE_HILL,
        role: "admin",
        organizations: {
          name: "Tree Hill Sports Therapy",
          lifecycle_state: "active",
          created_at: "2026-07-01T00:00:00Z",
        },
      },
    ],
    profiles: [
      {
        id: USER_ID,
        full_name: "Sowmya Seed",
        email: "sowmya.seed@example.test",
        created_at: "2026-07-09T00:00:00Z",
      },
    ],
    notes: [],
    user_table_prefs: [],
    credential_cases: [],
    status_configs: [],
    payer_catalog_changes: [],
    global_payers: [
      globalPayer({
        id: "gp-bcbsnc",
        name: "Blue Cross and Blue Shield of North Carolina",
        aliases: ["BCBSNC", "Blue Cross NC"],
        states: ["NC"],
        payer_slug: "bcbs-nc",
        avg_decision_days: 45,
      }),
      globalPayer({
        id: "gp-uhc",
        name: "UnitedHealthcare",
        aliases: ["UHC", "UMR"],
        states: ["NC", "SC", "TX"],
        payer_slug: "unitedhealthcare",
      }),
      globalPayer({
        id: "gp-superior",
        name: "Superior HealthPlan (Centene)",
        payer_kind: "medicaid_mco",
        aliases: ["Ambetter from Superior HealthPlan"],
        states: ["TX"],
        payer_slug: "superior-healthplan",
      }),
    ],
    ...over,
  } as Record<string, unknown[]>;
}

function makeHandler(fixtures: Record<string, unknown[]>) {
  const rpcCalls: Array<{ name: string; body: Record<string, unknown> }> = [];
  const tablesRead: string[] = [];
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.endsWith("/rpc/claim_invites")) return json(0);
    if (url.pathname.endsWith("/rpc/list_global_payers")) {
      return json(fixtures.global_payers ?? []);
    }
    if (url.pathname.includes("/rest/v1/rpc/")) {
      const name = url.pathname.split("/rpc/")[1] ?? "";
      rpcCalls.push({
        name,
        body: JSON.parse(req.postData() ?? "{}") as Record<string, unknown>,
      });
      return json(0);
    }

    const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
    tablesRead.push(table);
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    const matchFilters = (row: Record<string, unknown>): boolean => {
      for (const [key, raw] of url.searchParams.entries()) {
        if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) continue;
        if (!(key in row)) continue;
        if (raw.startsWith("eq.")) {
          if (String(row[key]) !== raw.slice(3)) return false;
        }
      }
      return true;
    };
    if (req.method() === "POST" || req.method() === "PATCH") {
      const prefer = req.headers()["prefer"] ?? "";
      if (prefer.includes("return=representation")) return json(wantsObject ? {} : [{}]);
      return json(null, 201);
    }
    const rows = (fixtures[table] ?? []).filter((r) => matchFilters(r as Record<string, unknown>));
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  };
  return { handler, rpcCalls, tablesRead };
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
    [AUTH_KEY, SESSION, ORG_TREE_HILL] as const,
  );
}

test("TS-36 (retargeted): the org payer list filters by name, State, and Kind — no alias search, no commercial default", async ({
  context,
  page,
}) => {
  // The org's own payers now feed the page (payers table ∩ active
  // assignments), not the retired catalog browse.
  const fixtures = makeFixtures();
  fixtures.payers = fixtures.global_payers;
  fixtures.org_payer_assignments = [
    { id: "opa-1", org_id: ORG_TREE_HILL, payer_id: "gp-bcbsnc", starter: false, status: "active" },
    { id: "opa-2", org_id: ORG_TREE_HILL, payer_id: "gp-uhc", starter: false, status: "active" },
    {
      id: "opa-3",
      org_id: ORG_TREE_HILL,
      payer_id: "gp-superior",
      starter: false,
      status: "active",
    },
  ];
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/payer-directory");
  // E6.1 F6.1.6: the /payer-directory goto rides the redirect into the Payer
  // Setup page (the old catalog segment URL — rename is Slice G's).
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({
    timeout: 30000,
  });

  // No commercial-default narrowing anymore: every org payer lists, MCO
  // included (the default went with the catalog browse).
  await expect(page.getByText("Blue Cross and Blue Shield of North Carolina")).toBeVisible();
  await expect(page.getByText("UnitedHealthcare", { exact: true })).toBeVisible();
  await expect(page.getByText("Superior HealthPlan (Centene)")).toBeVisible();

  // Name search narrows; the catalog's ALIAS search is retired (an alias
  // query lands on the honest filtered-empty state). Catalog key + avg
  // decision stay off the list (detail-only facts).
  await page.getByLabel("Search payers").fill("Blue Cross NC");
  await expect(page.getByText("No payers match these filters")).toBeVisible();
  await page.getByLabel("Search payers").fill("Blue Cross and Blue Shield");
  const row = page.locator("tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row.first()).toContainText("Blue Cross and Blue Shield of North Carolina");
  await expect(row.first()).toContainText("NC");
  await expect(row.first()).not.toContainText("bcbs-nc");
  await expect(row.first()).not.toContainText("45 days");

  // Kind narrows to the MCO; the state filter narrows by states[] membership.
  await page.getByLabel("Search payers").fill("");
  await page.getByLabel("Filter by payer kind").click();
  await page.getByRole("option", { name: "Medicaid MCO" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr").first()).toContainText("Superior HealthPlan (Centene)");
  await page.getByLabel("Filter by payer kind").click();
  await page.getByRole("option", { name: "All kinds" }).click();
  await page.getByLabel("Filter by state").click();
  await page.getByRole("option", { name: "TX", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByText("Blue Cross and Blue Shield of North Carolina")).not.toBeVisible();
});

test("payer detail drill-in behind the name link; long state lists truncate to text", async ({
  context,
  page,
}) => {
  // Slice A: identity facts (catalog key), full state coverage, and the
  // payer's SOPs + portals live on the read-only detail page behind the
  // payer-name link (the row's only link). The list truncates long state
  // lists to plain text — the interactive +N-more disclosure went with the
  // catalog — and the In-my-network filter is gone (the list IS the network).
  const fixtures = makeFixtures({
    global_payers: [
      globalPayer({
        id: "gp-bcbsnc",
        name: "Blue Cross and Blue Shield of North Carolina",
        aliases: ["BCBSNC", "Blue Cross NC"],
        states: ["NC"],
        payer_slug: "bcbs-nc",
        avg_decision_days: 45,
      }),
      globalPayer({
        id: "gp-national",
        name: "National Health Plan",
        states: ["NC", "SC", "TX", "CO", "WI", "OR", "GA", "FL"],
        payer_slug: "national-health",
      }),
    ],
    org_payer_assignments: [
      {
        id: "opa-1",
        org_id: ORG_TREE_HILL,
        payer_id: "gp-bcbsnc",
        starter: false,
        status: "active",
        archived_at: null,
        created_at: "2026-07-14T00:00:00Z",
      },
      {
        id: "opa-2",
        org_id: ORG_TREE_HILL,
        payer_id: "gp-national",
        starter: false,
        status: "active",
        archived_at: null,
        created_at: "2026-07-14T00:00:00Z",
      },
    ],
    sop_templates: [
      {
        id: "sop-1",
        org_id: null,
        name: "BCBS NC — Standard Enrollment",
        group_id: null,
        state: "NC",
        specialty: null,
        payer_id: "gp-bcbsnc",
        task_definitions: [],
        archived: false,
        current_version: 1,
        created_at: "2026-07-13T00:00:00Z",
        updated_at: "2026-07-13T00:00:00Z",
      },
    ],
    portals: [
      {
        id: "portal-1",
        org_id: null,
        portal_key: "bcbs_nc_enrollment",
        name: "BCBS NC Enrollment Portal",
        payer_id: "gp-bcbsnc",
        form_url: "https://portal.example.test/enroll",
        is_verified: false,
        last_verified_at: null,
        proven_at: null,
        url_changed_at: null,
        created_at: "2026-07-13T00:00:00Z",
        updated_at: "2026-07-13T00:00:00Z",
      },
    ],
  });
  fixtures.payers = fixtures.global_payers;
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/payer-directory");
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({
    timeout: 30000,
  });

  // A long state list truncates to plain text — the interactive expansion is
  // design-removed; full coverage lives on the detail page.
  const national = page.locator("tbody tr", { hasText: "National Health Plan" });
  await expect(national).toContainText("NC, SC, TX, CO +4");
  await expect(national.getByRole("button", { name: /more/ })).toHaveCount(0);

  // The In-my-network filter went with the catalog: this list IS the network.
  await expect(page.getByLabel("Filter by network")).toHaveCount(0);

  // The payer name is the drill-in (the row's only link).
  await page.getByRole("link", { name: "Blue Cross and Blue Shield of North Carolina" }).click();
  await expect(
    page.getByRole("heading", { name: "Blue Cross and Blue Shield of North Carolina" }),
  ).toBeVisible();
  await expect(page.getByText("In my network")).toBeVisible();
  await expect(page.getByText("bcbs-nc")).toBeVisible(); // catalog key (item 4 relocation)
  // E6.7 PR 2 F6.7.5: stored avg_decision_days lost its writer with the sync,
  // so the detail no longer renders the "Avg decision" fact — pin the absence
  // (the assertion this line replaced was missed by the F6.7.5 retarget).
  await expect(page.getByText("45 days")).toHaveCount(0);
  await expect(page.getByText("State coverage (1)")).toBeVisible();
  await expect(page.getByRole("link", { name: "BCBS NC — Standard Enrollment" })).toBeVisible();
  await expect(page.getByText("BCBS NC Enrollment Portal")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove from my network" })).toBeVisible();

  // Back to the catalog list from the detail.
  await page.getByRole("link", { name: "← Back to catalog" }).click();
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible();
});

test("governance: catalog diff review is not exposed to org users", async ({ context, page }) => {
  // An unreviewed diff EXISTS in the table — and the org app must neither read
  // it nor offer any review affordance (review is service-role/platform
  // tooling; authenticated SELECT/EXECUTE are revoked in the schema, and the
  // app has no code path left that would try).
  const fixtures = makeFixtures({
    payer_catalog_changes: [
      {
        id: "chg-1",
        payer_id: "gp-bcbsnc",
        field: "name",
        old_value: "Blue Cross and Blue Shield of North Carolina",
        new_value: "Blue Cross NC (rebranded)",
        source: "sync",
        review_state: "unreviewed",
        reviewed_by: null,
        reviewed_at: null,
        created_at: "2026-07-12T12:00:00Z",
      },
    ],
    org_payer_assignments: [
      {
        id: "opa-1",
        org_id: ORG_TREE_HILL,
        payer_id: "gp-bcbsnc",
        starter: false,
        status: "active",
      },
    ],
  });
  fixtures.payers = fixtures.global_payers;
  const { handler, rpcCalls, tablesRead } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/payer-directory");
  // E6.1 F6.1.6: the /payer-directory goto rides the redirect into the Payer
  // Setup page (the old catalog segment URL — rename is Slice G's).
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText("Blue Cross and Blue Shield of North Carolina")).toBeVisible();

  // No review panel, no accept/reject controls, the payer row unchanged.
  await expect(page.getByText("Catalog changes to review")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
  await expect(page.getByText("Blue Cross NC (rebranded)")).toHaveCount(0);

  // And at the wire: the diff table was never read, the review RPC never ran.
  expect(tablesRead).not.toContain("payer_catalog_changes");
  expect(rpcCalls.filter((c) => c.name === "review_payer_catalog_change")).toEqual([]);
});
