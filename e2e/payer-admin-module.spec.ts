import { test, expect, type Route } from "@playwright/test";

// E4.2 TS-76/TS-78/TS-91 — the Payer & SOP admin module over the mock harness.
// Covers: the module is role-gated (P4/admin sees the nav entry + tabs; P2/
// specialist does not and is denied at the route); the reason-code vocabulary
// (global defaults are non-deletable "Managed centrally", org codes can be
// added + deactivated); the org queue-settings surface (four ranking inputs
// with move up/down + Reset); and the F4.2.1 resolution-identifier dialog,
// which — per the E4.2 governance PR — writes org_payer_settings (the org ×
// payer grain), never the Minted-managed payers row. No live payer/extension
// dependency (TE-11).

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
    // One assigned global payer with one active target → one readiness row on
    // the Payer directory tab, which carries the admin-only "Configure ID"
    // control (every other composed query resolves empty via the fallback).
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

test("TS-76 — P4/admin sees the module nav entry and opens the tabs", async ({ page }) => {
  currentRole = "admin";
  await page.goto("/get-started");
  const rail = page.locator("aside").first();
  await expect(rail.getByRole("link", { name: "Payer & SOP Setup" })).toBeVisible({
    timeout: 30000,
  });

  await page.goto("/admin/payer-admin");
  await expect(page.getByRole("tab", { name: "Payer directory" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("tab", { name: "Reason codes" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Queue settings" })).toBeVisible();
});

test("TS-76 — P2/specialist has no nav entry and is denied at the route", async ({ page }) => {
  currentRole = "specialist";
  await page.goto("/get-started");
  const rail = page.locator("aside").first();
  await expect(rail.getByRole("link", { name: "Payer Management" })).toBeVisible({
    timeout: 30000,
  });
  await expect(rail.getByRole("link", { name: "Payer & SOP Setup" })).toHaveCount(0);

  await page.goto("/admin/payer-admin");
  await expect(page.getByText("available to administrators only")).toBeVisible({ timeout: 30000 });
});

test("TS-78 — reason codes: defaults non-deletable, org codes add + deactivate", async ({
  page,
}) => {
  currentRole = "admin";
  await page.goto("/admin/payer-admin");
  await page.getByRole("tab", { name: "Reason codes" }).click({ timeout: 30000 });

  // A seeded global default renders "Managed centrally" (non-deletable).
  const defaultRow = page.locator("tr", { hasText: "Missing Documentation" });
  await expect(defaultRow).toBeVisible();
  await expect(defaultRow.getByText("Managed centrally")).toBeVisible();

  // An org code carries a Deactivate control.
  const orgRow = page.locator("tr", { hasText: "Roster mismatch" });
  await expect(orgRow.getByRole("button", { name: "Deactivate" })).toBeVisible();

  // Adding an org code succeeds (toast).
  await page.getByLabel("Add an organization reason code").fill("Panel full");
  await page.getByRole("button", { name: "Add code" }).click();
  await expect(page.getByText("Reason code added.")).toBeVisible({ timeout: 15000 });
});

test("TS-91 — queue settings show the four inputs, reorder, and reset", async ({ page }) => {
  currentRole = "admin";
  await page.goto("/admin/payer-admin");
  await page.getByRole("tab", { name: "Queue settings" }).click({ timeout: 30000 });

  await expect(page.getByText("Overdue follow-ups", { exact: true })).toBeVisible();
  await expect(page.getByText("Task due dates")).toBeVisible();
  await expect(page.getByText("Provider start dates")).toBeVisible();
  await expect(page.getByText("Location launch dates")).toBeVisible();

  // Accessible move-down on the first input (TE-10, no drag needed).
  await page.getByRole("button", { name: "Move Overdue follow-ups down" }).click();
  await expect(page.getByRole("button", { name: "Save ranking" })).toBeEnabled();

  // Reset is present (disabled on the shipped default until a config is saved).
  await expect(page.getByRole("button", { name: "Reset to default" })).toBeVisible();
});

test("F4.2.1 governance — Configure ID writes org_payer_settings, never the payers row", async ({
  page,
}) => {
  currentRole = "admin";
  await page.goto("/admin/payer-admin");

  // The assigned payer's readiness row carries the admin-only control.
  const row = page.locator("tr", { hasText: "Aetna (CVS Health)" });
  await expect(row).toBeVisible({ timeout: 30000 });
  await row.getByRole("button", { name: "Configure ID" }).click();

  await expect(page.getByRole("heading", { name: /Resolution identifier/ })).toBeVisible();
  await page.getByLabel("Identifier label").fill("Provider PIN");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Resolution identifier saved for this organization.")).toBeVisible({
    timeout: 15000,
  });

  // The write landed on the org × payer settings grain, upserted on its
  // (org_id, payer_id) unique key, org-stamped from the active org…
  const settingWrites = writes.filter((w) => w.table === "org_payer_settings");
  expect(settingWrites).toHaveLength(1);
  expect(settingWrites[0].method).toBe("POST");
  expect(settingWrites[0].url).toContain("on_conflict=org_id%2Cpayer_id");
  const body = JSON.parse(settingWrites[0].body) as Record<string, unknown>;
  expect(body).toMatchObject({
    org_id: ORG_ID,
    payer_id: PAYER_ID,
    resolution_id_label: "Provider PIN",
    resolution_id_expected: true,
  });

  // …and the Minted-managed payers row was never touched.
  expect(writes.filter((w) => w.table === "payers")).toEqual([]);
  // The setting change is audited.
  expect(writes.some((w) => w.table === "audit_log")).toBe(true);
});
