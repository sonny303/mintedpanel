import { test, expect, type Route } from "@playwright/test";

// E4.2 payer governance + the unified-payer-setup consolidation (TE-18/TE-19),
// post the 2026-07-18 legacy-payer close-out and the payer-and-cases Slice A
// retarget (the module head is the single-view Payer Setup page):
// /admin/payers is a REDIRECT SHELL into the Payer Setup page —
//   - the old deep link lands safely on the single-view page;
//   - payer CREATION is now sanctioned but never free-text: the "+ Set up
//     payer" entry (admin-only) opens the guided /admin/payers/new flow on
//     the E6.7 create_payer seam — no per-row Edit control, no inline
//     identity edit anywhere on the list;
//   - NO starter toggle anywhere (E6.3 F6.3.5 retired starter cases; the
//     org_payer_assignments.starter column stays dormant per the additive
//     rule);
//   - a specialist following the old URL lands on the same page read-only
//     (E6.1 interim posture — no create entry, no Reactivate).

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const GLOBAL_PAYER_ID = "33333333-3333-4333-8333-333333333331";

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

// Parameterized per test before navigating.
let currentRole: "admin" | "specialist" = "admin";

function fixtures(): Record<string, unknown[]> {
  return {
    memberships: [
      {
        org_id: ORG_ID,
        role: currentRole,
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
    payers: [
      {
        id: GLOBAL_PAYER_ID,
        org_id: null,
        name: "Aetna (CVS Health)",
        is_active: true,
        avg_decision_days: 45,
        payer_kind: "commercial",
        payer_slug: "aetna",
        aliases: ["Aetna"],
        states: ["NC"],
        status: "active",
        created_at: "2026-07-12T00:00:00Z",
      },
    ],
    // OPA-RETIRE: setup inclusion is target-derived; assignments stay dormant.
    org_payer_assignments: [],
    payer_network_targets: [
      {
        id: "t-1",
        org_id: ORG_ID,
        group_id: "g-1",
        payer_id: GLOBAL_PAYER_ID,
        state: "NC",
        status: "active",
        created_at: "2026-07-12T00:00:00Z",
      },
    ],
    sop_templates: [],
    portals: [],
    portal_field_maps: [],
    fill_sessions: [],
    provider_groups: [],
  };
}

const writes: Array<{ method: string; table: string; body: string }> = [];

async function fulfillSupabase(route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  if (url.pathname.includes("/auth/v1/")) return json(SESSION);
  if (url.pathname.endsWith("/rpc/claim_invites")) return json(0);
  if (url.pathname.endsWith("/rpc/list_global_payers")) return json([]);
  if (url.pathname.includes("/rest/v1/rpc/")) return json(null);

  const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
  if (req.method() !== "GET") {
    writes.push({ method: req.method(), table, body: req.postData() ?? "" });
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    return json(wantsObject ? {} : [{}], 201);
  }
  const rows = fixtures()[table] ?? [];
  const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
  if (wantsObject) {
    if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
    return json(rows[0]);
  }
  return json(rows);
}

test.beforeEach(async ({ context }) => {
  writes.length = 0;
  await context.route(/\/(rest|auth)\/v1\//, fulfillSupabase);
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
});

test("old /admin/payers deep link redirects into Payer Setup with the governance affordances intact", async ({
  page,
}) => {
  currentRole = "admin";
  await page.goto("/admin/payers");
  // The old URL still lands on the catalog segment (rename is Slice G's).
  await expect(page).toHaveURL(/\/admin\/payer-admin\/setup$/, { timeout: 30000 });
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({ timeout: 30000 });

  // Slice A: creation is the guided "+ Set up payer" entry (admin-only) —
  // never free-text on the list, and no per-row Edit control anywhere.
  await expect(page.getByRole("link", { name: "+ Set up payer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add payer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);

  // The assigned catalog payer renders as ONE table row with the single
  // Template-status badge; the funnel + catalog browse are superseded, and
  // the retired legacy migration state never appears.
  await expect(page.getByRole("heading", { name: "Ready for business" })).toHaveCount(0);
  const row = page.locator("tbody tr", { hasText: "Aetna (CVS Health)" });
  await expect(row).toBeVisible();
  await expect(row.getByText("Needs template")).toBeVisible();
  await expect(page.getByText("Legacy — catalog migration required")).toHaveCount(0);

  // E6.3 F6.3.5: the starter toggle is GONE with starter cases — NO switch
  // renders anywhere on the page.
  await expect(page.getByRole("switch")).toHaveCount(0);

  // Nothing on this page wrote anywhere.
  expect(writes).toEqual([]);
});

test("specialist following the old URL lands on the workspace — all roles for now (E6.1 F6.1.1), writes still gated", async ({
  page,
}) => {
  currentRole = "specialist";
  await page.goto("/admin/payers");
  await expect(page).toHaveURL(/\/admin\/payer-admin\/setup$/, { timeout: 30000 });
  // E6.1 interim posture: Payer Setup renders for ALL roles (two trusted
  // users; revisit at the third hire) — the old admin-only denial is gone.
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator("tbody tr", { hasText: "Aetna (CVS Health)" })).toBeVisible();
  // Admin-only write affordances still never render for a specialist: no
  // create entry, no Reactivate, no switch.
  await expect(page.getByRole("link", { name: "+ Set up payer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reactivate" })).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
});
