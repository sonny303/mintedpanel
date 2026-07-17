import { test, expect, type Route } from "@playwright/test";

// E4.2 TS-76/TS-78/TS-91 + the unified-payer-setup consolidation (§5 amendment
// TE-18–TE-20) — the "Payer Setup" workspace over the mock harness. Covers:
// the single admin-only nav entry (TE-18; P2/specialist has NO Payers entry
// and is denied at the route with a read-only catalog pointer); the five
// workspace areas (Setup / Catalog / SOP templates / Forms & portals /
// Organization settings) with arrow-key tab traversal (TE-20c); the
// reason-code vocabulary and org queue settings now living under Organization
// settings; and the F4.2.1 resolution-identifier dialog, which — per the
// e4-2c governance PR — writes org_payer_settings (the org × payer grain),
// never the Minted-managed payers row. No live payer/extension dependency
// (TE-11).

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

test("TS-76 / TE-18 — P4/admin sees the single Payer Setup entry and the five workspace areas", async ({
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
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("tab", { name: "Setup" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Catalog" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "SOP templates" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Forms & portals" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Organization settings" })).toBeVisible();

  // The assigned payer's setup row is present with its scope + SOP dimensions
  // (targets exist; no payer SOP → Needs payer SOP with a prefilled create link).
  const row = page.locator("tr", { hasText: "Aetna (CVS Health)" }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText("Needs payer SOP")).toBeVisible();
  await expect(row.getByRole("link", { name: "Create payer SOP" })).toBeVisible();
});

test("TE-20c — workspace tabs are arrow-key traversable; the nav entry is keyboard-operable", async ({
  page,
}) => {
  currentRole = "admin";
  await page.goto("/get-started");
  const rail = page.locator("aside").first();
  const navEntry = rail.getByRole("link", { name: "Payer Setup" });
  await expect(navEntry).toBeVisible({ timeout: 30000 });
  await navEntry.focus();
  await expect(navEntry).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/payer-admin\/?$/, { timeout: 15000 });

  // Radix tabs: focus the active tab, ArrowRight moves + activates the next.
  const setupTab = page.getByRole("tab", { name: "Setup" });
  await expect(setupTab).toBeVisible({ timeout: 30000 });
  await setupTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Catalog" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Search payers")).toBeVisible();
});

test("TS-76 — P2/specialist has NO Payers nav entry and is denied at the route", async ({
  page,
}) => {
  currentRole = "specialist";
  await page.goto("/get-started");
  const rail = page.locator("aside").first();
  // The specialist still has a nav (Workspace zone) — just no Payers entry of
  // any name (TE-18 pin).
  await expect(rail.getByRole("link", { name: "My Cases" })).toBeVisible({ timeout: 30000 });
  await expect(rail.getByRole("link", { name: "Payer Setup" })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: "Payer Management" })).toHaveCount(0);
  await expect(rail.getByRole("link", { name: "Payer & SOP Setup" })).toHaveCount(0);

  await page.goto("/admin/payer-admin");
  await expect(page.getByText("available to administrators only")).toBeVisible({ timeout: 30000 });
  // The denial still points at the read-only catalog (TE-20b — no dead end).
  await expect(page.getByRole("link", { name: "Browse payer catalog" })).toBeVisible();
});

test("TS-78 — reason codes live under Organization settings: defaults non-deletable, org codes add + deactivate", async ({
  page,
}) => {
  currentRole = "admin";
  await page.goto("/admin/payer-admin?tab=org-settings");

  // A seeded global default renders "Managed centrally" (non-deletable).
  const defaultRow = page.locator("tr", { hasText: "Missing Documentation" });
  await expect(defaultRow).toBeVisible({ timeout: 30000 });
  await expect(defaultRow.getByText("Managed centrally")).toBeVisible();

  // An org code carries a Deactivate control.
  const orgRow = page.locator("tr", { hasText: "Roster mismatch" });
  await expect(orgRow.getByRole("button", { name: "Deactivate" })).toBeVisible();

  // Adding an org code succeeds (toast).
  await page.getByLabel("Add an organization reason code").fill("Panel full");
  await page.getByRole("button", { name: "Add code" }).click();
  await expect(page.getByText("Reason code added.")).toBeVisible({ timeout: 15000 });
});

test("TS-91 — queue settings live under Organization settings: four inputs, reorder, reset", async ({
  page,
}) => {
  currentRole = "admin";
  await page.goto("/admin/payer-admin?tab=org-settings");

  await expect(page.getByText("Overdue follow-ups", { exact: true })).toBeVisible({
    timeout: 30000,
  });
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
  // The resolution-identifier config is payer-relevant org config → the
  // Organization settings tab carries a per-payer Configure control (the same
  // e4-2c dialog is also reachable from each setup row's actions menu).
  await page.goto("/admin/payer-admin?tab=org-settings");

  const row = page.locator("tr", { hasText: "Aetna (CVS Health)" });
  await expect(row).toBeVisible({ timeout: 30000 });
  await expect(row.getByText("Generic fallback")).toBeVisible();
  await row.getByRole("button", { name: "Configure ID" }).click();

  await expect(page.getByRole("heading", { name: /Resolution identifier/ })).toBeVisible();
  await page.getByLabel("Identifier label").fill("Provider PIN");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
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
