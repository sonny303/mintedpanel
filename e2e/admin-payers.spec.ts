import { test, expect, type Route } from "@playwright/test";

// E4.2 payer governance + the unified-payer-setup consolidation (TE-18/TE-19):
// /admin/payers is a REDIRECT SHELL into the Payer Setup workspace, and the
// governance affordances the old route carried live on the workspace's Setup
// tab —
//   - a legacy deep link lands safely in Payer Setup (funnel step 12);
//   - no free-text "Add payer" and no per-row Edit control anywhere; the
//     canonical path is the workspace's Catalog tab;
//   - an assigned global row is visibly Minted-managed ("Minted catalog");
//   - a legacy org-scoped row shows the read-only "Legacy — catalog migration
//     required" state and its next action points at the catalog;
//   - the starter toggle (org-owned org_payer_assignments fact) renders only
//     where an assignment row exists, and only for admins — a control never
//     renders unless the caller can complete the action;
//   - a specialist following the old URL gets the module's explicit denial
//     with a read-only catalog pointer (TE-20b — no dead end).

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const GLOBAL_PAYER_ID = "33333333-3333-4333-8333-333333333331";
const LEGACY_PAYER_ID = "33333333-3333-4333-8333-333333333332";

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
      {
        id: LEGACY_PAYER_ID,
        org_id: ORG_ID,
        name: "BCBS of Kansas",
        is_active: true,
        avg_decision_days: null,
        payer_kind: "commercial",
        payer_slug: null,
        aliases: null,
        states: null,
        status: "active",
        created_at: "2026-06-30T00:00:00Z",
      },
    ],
    org_payer_assignments: [
      {
        id: "assign-1",
        org_id: ORG_ID,
        payer_id: GLOBAL_PAYER_ID,
        starter: false,
        status: "active",
        created_at: "2026-07-12T00:00:00Z",
      },
    ],
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

test("legacy /admin/payers deep link redirects into Payer Setup with the governance affordances intact", async ({
  page,
}) => {
  currentRole = "admin";
  await page.goto("/admin/payers");
  await expect(page).toHaveURL(/\/admin\/payer-admin\/?$/, { timeout: 30000 });
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({ timeout: 30000 });

  // No free-text payer creation and no per-row Edit control, anywhere.
  await expect(page.getByRole("button", { name: "Add payer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);

  // The assigned global row is visibly Minted-managed; the legacy org row
  // carries the read-only migration-required state and its action points at
  // the catalog (a legacy payer can't take the configure-scope path).
  const globalRow = page.locator("tr", { hasText: "Aetna (CVS Health)" }).first();
  await expect(globalRow.getByText("Minted catalog")).toBeVisible();
  const legacyRow = page.locator("tr", { hasText: "BCBS of Kansas" }).first();
  await expect(legacyRow.getByText("Legacy — catalog migration required")).toBeVisible();
  await expect(legacyRow.getByRole("link", { name: "Find canonical payer" })).toBeVisible();

  // Starter toggle: only the assigned global payer has one (in its expanded
  // setup detail); the legacy row (no assignment) renders none.
  await globalRow.getByRole("button", { name: "Show setup detail for Aetna (CVS Health)" }).click();
  await expect(
    page.getByRole("switch", { name: "Toggle starter pack for Aetna (CVS Health)" }),
  ).toBeVisible();
  await legacyRow.getByRole("button", { name: "Show setup detail for BCBS of Kansas" }).click();
  await expect(page.getByRole("switch")).toHaveCount(1); // still just Aetna's

  // Nothing on this page wrote anywhere.
  expect(writes).toEqual([]);
});

test("specialist following the old URL lands on the explicit denial with a catalog pointer", async ({
  page,
}) => {
  currentRole = "specialist";
  await page.goto("/admin/payers");
  await expect(page).toHaveURL(/\/admin\/payer-admin\/?$/, { timeout: 30000 });
  await expect(page.getByText("available to administrators only")).toBeVisible({ timeout: 30000 });
  const catalogLink = page.getByRole("link", { name: "Browse payer catalog" });
  await expect(catalogLink).toBeVisible();
  await expect(catalogLink).toHaveAttribute("href", "/payer-directory");
  await expect(page.getByRole("switch")).toHaveCount(0);
});
