import { test, expect, type Route } from "@playwright/test";

// E4.2 TS-76/TS-78/TS-91, restructured by E6.5 F6.5.1, E6.6 F6.6.6, and the
// payer-and-cases Slice A retarget — the module head at /admin/payer-admin/
// catalog is now the SINGLE-VIEW Payer Setup page (screen 1: KPI filter cards
// + payer table; the tab strip and Ready-for-business funnel are superseded;
// /admin/payer-admin/sops stays a shareable legacy URL until Slice G folds
// it, and the old ?tab= spellings still redirect via the index mapper).
// Covers: the single nav entry (all roles under the E6.1 interim posture);
// keyboard operability of the new page's KPI filter cards (TE-20c successor);
// the E6.6 fixed-default NEGATIVE pins (TS-78/TS-91 flipped: no reason-code
// or queue-ranking editors render anywhere — TS-115); and the 2026-07-20
// re-scope NEGATIVE pin (supersedes F4.2.1): Org Detail carries no per-org
// resolution-identifier config — the label is a Minted-curated payer fact
// and issued IDs live on enrollment facts / payer network targets.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "00000000-0000-4000-a000-000000000005";
const PAYER_ID = "00000000-0000-4000-a000-0000000000aa";

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
    email: "owner.dillon@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Owner Dillon" },
    created_at: "2026-07-09T00:00:00Z",
  },
};

// Parameterized per test before navigating.
let currentRole: "admin" | "specialist" = "admin";

const DENIAL_CODES = [
  {
    id: "g1",
    org_id: null,
    code: "missing_documentation",
    label: "Missing Documentation",
    active: true,
  },
  { id: "g2", org_id: null, code: "network_closed", label: "Network Closed", active: true },
  { id: "o1", org_id: ORG_ID, code: "roster_mismatch", label: "Roster mismatch", active: true },
];

function fixtures(): Record<string, unknown[]> {
  return {
    memberships: [
      {
        org_id: ORG_ID,
        role: currentRole,
        organizations: {
          name: "Dillon Sports Medicine",
          lifecycle_state: "active",
          created_at: "2026-07-01T00:00:00Z",
        },
      },
    ],
    profiles: [{ id: USER_ID, full_name: "Owner Dillon", email: "owner.dillon@example.test" }],
    denial_reason_codes: DENIAL_CODES,
    // One assigned global payer with one active target → one setup row on the
    // Setup tab (every other composed query resolves empty via the fallback).
    payers: [
      {
        id: PAYER_ID,
        org_id: null,
        name: "Aetna (CVS Health)",
        is_active: true,
        avg_decision_days: null,
        payer_kind: "commercial",
        payer_slug: "aetna",
        aliases: ["Aetna"],
        states: ["NC"],
        status: "active",
        created_at: "2026-07-12T00:00:00Z",
      },
    ],
    payer_network_targets: [
      {
        id: "tgt-1",
        org_id: ORG_ID,
        payer_id: PAYER_ID,
        group_id: "grp-1",
        state: "NC",
        status: "active",
        created_at: "2026-07-12T00:00:00Z",
      },
    ],
    org_payer_assignments: [
      {
        id: "assign-1",
        org_id: ORG_ID,
        payer_id: PAYER_ID,
        starter: false,
        status: "active",
        created_at: "2026-07-12T00:00:00Z",
      },
    ],
    org_payer_settings: [],
  };
}

// Every non-GET REST call, so tests can pin WHERE a mutation landed.
const writes: Array<{ method: string; table: string; url: string; body: string }> = [];

async function fulfillSupabase(route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  if (url.pathname.includes("/auth/v1/")) return json(SESSION);
  if (url.pathname.endsWith("/rpc/list_global_payers")) return json([]);
  if (url.pathname.includes("/rest/v1/rpc/")) return json(null);

  const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
  const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
  if (req.method() !== "GET") {
    writes.push({ method: req.method(), table, url: req.url(), body: req.postData() ?? "" });
    // Echo the inserted/updated row back (return=representation callers).
    const parsed = JSON.parse(req.postData() || "{}") as unknown;
    const row = { id: "new-row", ...((Array.isArray(parsed) ? parsed[0] : parsed) as object) };
    return json(wantsObject ? row : [row], 201);
  }
  const rows = fixtures()[table] ?? [];
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

test("TS-76 / TE-18 — P4/admin sees the single Payer Setup entry; the module head is the single-view page", async ({
  page,
}) => {
  currentRole = "admin";
  await page.goto("/get-started");
  const rail = page.locator("aside").first();
  await expect(rail.getByRole("link", { name: "Payer Setup" })).toBeVisible({
    timeout: 30000,
  });
  // The superseded two-destination Payers section is gone (TE-18).
  await expect(rail.getByRole("link", { name: "Payer Management" })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: "Payer & SOP Setup" })).toHaveCount(0);

  await page.goto("/admin/payer-admin");
  // The bare module URL still maps to the catalog segment (shareable URL; the
  // segment RENAME is Slice G's).
  await expect(page).toHaveURL(/\/admin\/payer-admin\/catalog$/, { timeout: 30000 });
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({ timeout: 30000 });

  // Slice A: ONE view — no tab strip, no funnel; the assigned payer renders
  // an honest table row with the single Template-status badge.
  await expect(page.getByRole("navigation", { name: "Payer Setup areas" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ready for business" })).toHaveCount(0);
  const row = page.locator("tbody tr", { hasText: "Aetna (CVS Health)" }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText("Needs template")).toBeVisible();

  // The legacy SOPs segment keeps the F6.5.6 interim-governance note until
  // Slice G folds it.
  await page.goto("/admin/payer-admin/sops");
  await expect(page.getByText(/authored once and inherited by every organization/i)).toBeVisible({
    timeout: 30000,
  });
});

test("TE-20c — the nav entry and the KPI filter cards are keyboard-operable", async ({ page }) => {
  currentRole = "admin";
  await page.goto("/get-started");
  const rail = page.locator("aside").first();
  const navEntry = rail.getByRole("link", { name: "Payer Setup" });
  await expect(navEntry).toBeVisible({ timeout: 30000 });
  await navEntry.focus();
  await expect(navEntry).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/payer-admin\/catalog$/, { timeout: 15000 });

  // Slice A: the KPI cards are real buttons — focus + Enter toggles the
  // filter and aria-pressed reports it.
  const needsCard = page.getByRole("button", { name: /Needs template/ });
  await expect(needsCard).toBeVisible({ timeout: 30000 });
  await needsCard.focus();
  await expect(needsCard).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(needsCard).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(needsCard).toHaveAttribute("aria-pressed", "false");
});

test("P2/specialist sees the Payer Setup entry and reaches the workspace (E6.1 F6.1.1 supersedes the TS-76 admin-only pin)", async ({
  page,
}) => {
  currentRole = "specialist";
  await page.goto("/org-detail");
  const rail = page.locator("aside").first();
  // E6.1 interim posture: Payer Setup renders for ALL roles; the superseded
  // pre-consolidation entries never return.
  await expect(rail.getByRole("link", { name: "Payer Setup" })).toBeVisible({ timeout: 30000 });
  await expect(rail.getByRole("link", { name: "Payer Management" })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: "Payer & SOP Setup" })).toHaveCount(0);

  await page.goto("/admin/payer-admin");
  await expect(page).toHaveURL(/\/admin\/payer-admin\/catalog$/, { timeout: 30000 });
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({
    timeout: 30000,
  });
});

test("TS-78/TS-115 — fixed defaults (E6.6 F6.6.6): no reason-code editor renders anywhere; the legacy tab URL still redirects", async ({
  page,
}) => {
  currentRole = "admin";
  // The legacy org-settings tab spelling lands on Org Detail (org data left
  // the module with the E6.5 consolidation).
  await page.goto("/admin/payer-admin?tab=org-settings");
  await expect(page).toHaveURL(/\/org-detail$/, { timeout: 30000 });
  await expect(page.getByRole("heading", { name: "Org Detail" })).toBeVisible({ timeout: 30000 });

  // The denial word-list ships as the fixed default set — the org editor is
  // GONE (no add input, no Add code, no Deactivate, no Reason codes section).
  await expect(page.getByRole("heading", { name: "Reason codes" })).toHaveCount(0);
  await expect(page.getByLabel("Add an organization reason code")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add code" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
});

test("TS-91/TS-115 — fixed defaults (E6.6 F6.6.6): no queue-ranking editor renders anywhere", async ({
  page,
}) => {
  currentRole = "admin";
  await page.goto("/org-detail");
  await expect(page.getByRole("heading", { name: "Org Detail" })).toBeVisible({ timeout: 30000 });

  // Queue ranking runs the shipped default order — the config UI is GONE.
  await expect(page.getByRole("heading", { name: "Queue settings" })).toHaveCount(0);
  await expect(page.getByText("Overdue follow-ups", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save ranking" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset to default" })).toHaveCount(0);

  // 2026-07-20 re-scope: the Resolution identifiers table is gone too — Org
  // Detail carries NO payer-settings editors at all now (the identifier label
  // is a Minted-curated payer fact; issued IDs live on enrollments).
  await expect(page.getByRole("heading", { name: "Resolution identifiers" })).toHaveCount(0);
});

test("2026-07-20 re-scope — Org Detail carries NO per-org identifier config; nothing writes org_payer_settings or payers", async ({
  page,
}) => {
  currentRole = "admin";
  // Supersedes the F4.2.1 Configure-ID flow: a payer-issued enrollment ID is
  // not an org-wide value. The LABEL is a Minted-curated payer-definition
  // fact (shown in Payer Setup); the issued VALUE is captured on the
  // provider's enrollment fact or the group's Payer Network entry. Org
  // Detail keeps no identifier table and no Configure-ID affordance, and the
  // dormant org_payer_settings grain is never written.
  await page.goto("/org-detail");
  await expect(page.getByRole("heading", { name: "Org Detail" })).toBeVisible({ timeout: 30000 });

  await expect(page.getByRole("heading", { name: "Resolution identifiers" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Configure ID" })).toHaveCount(0);

  expect(writes.filter((w) => w.table === "org_payer_settings")).toEqual([]);
  expect(writes.filter((w) => w.table === "payers")).toEqual([]);
});
