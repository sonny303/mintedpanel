import { test, expect, type Route } from "@playwright/test";

// E1.6 TE-6 + E4.2 payer governance — Payer Directory coverage over the mock
// harness:
//   TS-36 directory browse/search/filter: finds BCBS-NC by alias, commercial
//         default hides MCO/government rows, state filter narrows by states[]
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

test("TS-36: directory search by alias, commercial default, state + kind filters", async ({
  context,
  page,
}) => {
  const { handler } = makeHandler(makeFixtures());
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/payer-directory");
  // E6.1 F6.1.6: the /payer-directory goto rides the redirect into the Payer
  // Setup workspace's Catalog tab (browse preserved for all roles).
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({
    timeout: 30000,
  });

  // Commercial default: the MCO row is hidden until the kind filter widens.
  await expect(page.getByText("Blue Cross and Blue Shield of North Carolina")).toBeVisible();
  await expect(page.getByText("UnitedHealthcare", { exact: true })).toBeVisible();
  await expect(page.getByText("Superior HealthPlan (Centene)")).not.toBeVisible();

  // Alias search finds BCBS-NC with its states. Catalog key + avg decision
  // moved OFF the list to the per-payer detail drill-in (2026-07-20 catalog
  // UX pass) — the list keeps browse columns only.
  await page.getByLabel("Search payers").fill("Blue Cross NC");
  const row = page.locator("tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row.first()).toContainText("Blue Cross and Blue Shield of North Carolina");
  await expect(row.first()).toContainText("NC");
  await expect(row.first()).not.toContainText("bcbs-nc");
  await expect(row.first()).not.toContainText("45 days");

  // Widen kind to all → the Medicaid MCO appears; state filter narrows to TX.
  await page.getByLabel("Search payers").fill("");
  await page.getByLabel("Filter by payer kind").click();
  await page.getByRole("option", { name: "All kinds" }).click();
  await expect(page.getByText("Superior HealthPlan (Centene)")).toBeVisible();
  await page.getByLabel("Filter by state").click();
  await page.getByRole("option", { name: "TX", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByText("Blue Cross and Blue Shield of North Carolina")).not.toBeVisible();
});

test("catalog detail drill-in, In-my-network filter, and in-place states expansion", async ({
  context,
  page,
}) => {
  // 2026-07-20 catalog UX pass: the list keeps browse columns; identity facts
  // (catalog key, avg decision), full state coverage, and the payer's SOPs +
  // portals live on the read-only detail page behind the payer-name link. The
  // network filter narrows to ACTIVE org_payer_assignments client-side.
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
      // A NON-commercial adopted payer: hidden by the commercial default kind
      // filter, but "In my network" must still surface it (Devin review, #221).
      globalPayer({
        id: "gp-mco",
        name: "Sunshine Medicaid MCO",
        payer_kind: "medicaid_mco",
        states: ["TX"],
        payer_slug: "sunshine-mco",
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
        payer_id: "gp-mco",
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
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/payer-directory");
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({
    timeout: 30000,
  });

  // Item 3: a long state list expands in place instead of truncating.
  const national = page.locator("tbody tr", { hasText: "National Health Plan" });
  await expect(national).toContainText("NC, SC, TX, CO");
  await national.getByRole("button", { name: "+4 more" }).click();
  await expect(page.getByText("8 states")).toBeVisible();
  await expect(page.getByText("FL", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  // Item 7: the adopted-payers filter narrows to active subscriptions only —
  // and selecting it WIDENS the commercial-default kind filter, so an adopted
  // non-commercial payer is never silently hidden (Devin review, PR #221).
  await expect(page.getByText("Sunshine Medicaid MCO")).not.toBeVisible();
  await page.getByLabel("Filter by network").click();
  await page.getByRole("option", { name: "In my network" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByText("Sunshine Medicaid MCO")).toBeVisible();
  await expect(page.getByText("National Health Plan")).not.toBeVisible();
  await expect(page.getByLabel("Filter by payer kind")).toContainText("All kinds");

  // Item 8: the payer name is the drill-in.
  await page.getByRole("link", { name: "Blue Cross and Blue Shield of North Carolina" }).click();
  await expect(
    page.getByRole("heading", { name: "Blue Cross and Blue Shield of North Carolina" }),
  ).toBeVisible();
  await expect(page.getByText("In my network")).toBeVisible();
  await expect(page.getByText("bcbs-nc")).toBeVisible(); // catalog key (item 4 relocation)
  await expect(page.getByText("45 days")).toBeVisible(); // curated avg decision (item 2 relocation)
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
  });
  const { handler, rpcCalls, tablesRead } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/payer-directory");
  // E6.1 F6.1.6: the /payer-directory goto rides the redirect into the Payer
  // Setup workspace's Catalog tab (browse preserved for all roles).
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
