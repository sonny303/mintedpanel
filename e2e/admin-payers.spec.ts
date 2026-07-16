import { test, expect, type Route } from "@playwright/test";

// E4.2 payer governance — Admin → Payers is a read-only governance surface:
//   - an org ADMIN sees no free-text "Add payer" and no per-row Edit control;
//     the canonical path ("Browse payer catalog" → /payer-directory) is offered
//     instead;
//   - an assigned global row is visibly Minted-managed ("Minted catalog");
//   - a legacy org-scoped row shows the read-only "Legacy — catalog migration
//     required" state;
//   - the starter toggle (org-owned org_payer_assignments fact) renders only
//     where an assignment row exists, and only for admins — a control never
//     renders unless the caller can complete the action.

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

test("admin sees no free-text creation and no edit controls; catalog is the path", async ({
  page,
}) => {
  currentRole = "admin";
  await page.goto("/admin/payers");
  await expect(page.getByRole("heading", { name: "Payers" })).toBeVisible({ timeout: 30000 });

  // No free-text payer creation, anywhere on the page.
  await expect(page.getByRole("button", { name: "Add payer" })).toHaveCount(0);
  // No per-row Edit control (identity + Minted-curated facts are read-only).
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  // The canonical path is offered instead.
  await expect(page.getByRole("link", { name: "Browse payer catalog" })).toBeVisible();

  // The assigned global row is visibly Minted-managed…
  const globalRow = page.locator("tr", { hasText: "Aetna (CVS Health)" });
  await expect(globalRow.getByText("Minted catalog")).toBeVisible();
  // …with its Minted-curated avg decision days displayed read-only.
  await expect(globalRow).toContainText("45 d");

  // The legacy org row carries the read-only migration-required state.
  const legacyRow = page.locator("tr", { hasText: "BCBS of Kansas" });
  await expect(legacyRow.getByText("Legacy — catalog migration required")).toBeVisible();

  // Starter toggle: only the assigned global payer has one; the legacy row
  // (no assignment) renders none.
  await expect(
    globalRow.getByRole("switch", { name: "Toggle starter pack for Aetna (CVS Health)" }),
  ).toBeVisible();
  await expect(legacyRow.getByRole("switch")).toHaveCount(0);

  // Nothing on this page wrote anywhere.
  expect(writes).toEqual([]);
});

test("non-admin sees no mutation controls at all", async ({ page }) => {
  currentRole = "specialist";
  await page.goto("/admin/payers");
  await expect(page.getByRole("heading", { name: "Payers" })).toBeVisible({ timeout: 30000 });

  await expect(page.getByRole("button", { name: "Add payer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  // The starter toggle never renders for a role that couldn't complete it.
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.locator("tr", { hasText: "BCBS of Kansas" })).toBeVisible();
});
