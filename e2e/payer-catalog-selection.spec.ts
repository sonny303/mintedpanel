import { test, expect, type Route } from "@playwright/test";

// E4.2 hardening — canonical payer selection & org assignment, over the mock
// harness (extends the E1.6 payer-directory rig with stateful
// org_payer_assignments / payer_network_targets and the archive RPC):
//   - An admin adds a catalog payer (alias search → Add to organization); the
//     row flips to "Added to organization" + "Configure credentialing scope",
//     and the subscription row is written.
//   - Retired/merged payers cannot be newly added; the row explains why and
//     names the canonical successor.
//   - A non-admin browses but sees no mutation controls.
//   - Remove archives the subscription AND its active targets (cascade) and the
//     row offers Reactivate; reactivating flips the subscription back WITHOUT
//     recreating the archived scope.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

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
  last_synced_at: "2026-07-15T00:00:00Z",
  created_at: "2026-07-15T00:00:00Z",
  ...over,
});

function makeFixtures(role: "admin" | "billing", over: Record<string, unknown[]> = {}) {
  return {
    organizations: [
      {
        id: ORG,
        name: "Tree Hill Sports Therapy",
        lifecycle_state: "active",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    memberships: [
      {
        org_id: ORG,
        role,
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
    org_payer_assignments: [],
    payer_network_targets: [],
    global_payers: [
      globalPayer({
        id: "gp-bcbsnc",
        name: "Blue Cross and Blue Shield of North Carolina",
        aliases: ["BCBSNC", "Anthem NC"],
        states: ["NC"],
        payer_slug: "bcbs-nc",
        avg_decision_days: 45,
      }),
      globalPayer({
        id: "gp-uhc",
        name: "UnitedHealthcare",
        aliases: ["UHC"],
        states: ["NC", "SC"],
        payer_slug: "unitedhealthcare",
      }),
    ],
    ...over,
  } as Record<string, unknown[]>;
}

function makeHandler(fixtures: Record<string, unknown[]>) {
  let seq = 700;
  const STATEFUL = new Set(["org_payer_assignments", "payer_network_targets"]);
  const deletes: string[] = [];
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.endsWith("/rpc/claim_invites")) return json(0);
    if (url.pathname.endsWith("/rpc/list_global_payers")) return json(fixtures.global_payers ?? []);
    if (url.pathname.endsWith("/rpc/archive_org_payer_assignment")) {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, string>;
      const assigns = fixtures.org_payer_assignments as Array<Record<string, unknown>>;
      const a = assigns.find((r) => r.org_id === body.p_org_id && r.payer_id === body.p_payer_id);
      if (a) {
        a.status = "archived";
        a.archived_at = "2026-07-15T00:00:00Z";
      }
      const targets = (fixtures.payer_network_targets as Array<Record<string, unknown>>).filter(
        (t) =>
          t.org_id === body.p_org_id && t.payer_id === body.p_payer_id && t.status === "active",
      );
      for (const t of targets) t.status = "archived";
      return json({ assignment: a ?? null, archived_target_count: targets.length });
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    const matchFilters = (row: Record<string, unknown>): boolean => {
      for (const [key, raw] of url.searchParams.entries()) {
        if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(key)) continue;
        if (!(key in row)) continue;
        if (raw.startsWith("eq.") && String(row[key]) !== raw.slice(3)) return false;
      }
      return true;
    };

    if (STATEFUL.has(table) && req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "[]") as
        Record<string, unknown> | Record<string, unknown>[];
      const arr = Array.isArray(body) ? body : [body];
      const created = arr.map((r) => ({
        id: `${table === "payer_network_targets" ? "pnt" : "opa"}-${seq++}`,
        created_at: "2026-07-15T00:00:00Z",
        ...r,
      }));
      (fixtures[table] as unknown[]).push(...created);
      return json(wantsObject ? created[0] : created, 201);
    }
    if (STATEFUL.has(table) && req.method() === "PATCH") {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      const matched = (fixtures[table] as Array<Record<string, unknown>>).filter(matchFilters);
      for (const r of matched) Object.assign(r, body);
      return json(wantsObject ? (matched[0] ?? {}) : matched);
    }
    if (STATEFUL.has(table) && req.method() === "DELETE") {
      deletes.push(table);
      return json([]);
    }
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
  return { handler, deletes };
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
    [AUTH_KEY, SESSION, ORG] as const,
  );
}

test("admin adds a canonical payer by alias → Added + Configure credentialing scope", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures("admin");
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/payer-directory");
  // E6.1 F6.1.6: the /payer-directory goto rides the redirect into the Payer
  // Setup workspace's Catalog tab (browse preserved for all roles).
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({
    timeout: 30000,
  });

  // Alias search narrows to BCBS-NC, which offers "Add to organization".
  await page.getByLabel("Search payers").fill("Anthem NC");
  const row = page.locator("tbody tr");
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Add to organization" }).click();

  // The row flips to Added + a clear "Configure credentialing scope" hand-off,
  // and the subscription row was written for this org.
  await expect(row.getByText("Added to organization")).toBeVisible({ timeout: 15000 });
  await expect(row.getByRole("link", { name: "Configure credentialing scope" })).toBeVisible();
  const assigns = fixtures.org_payer_assignments as Array<Record<string, unknown>>;
  expect(assigns).toHaveLength(1);
  expect(assigns[0]).toMatchObject({ org_id: ORG, payer_id: "gp-bcbsnc", status: "active" });

  // The hand-off lands on the Payer Network wizard section with the payer now in
  // the curated shortlist (visible across surfaces without a manual refresh).
  await row.getByRole("link", { name: "Configure credentialing scope" }).click();
  await expect(page).toHaveURL(/\/onboarding\/wizard\?section=payer_network/);
});

test("retired and merged payers cannot be newly added; the successor is named", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures("admin", {
    global_payers: [
      globalPayer({
        id: "gp-new",
        name: "BCBS-NC (new entity)",
        states: ["NC"],
        payer_slug: "bcbs-nc-new",
      }),
      globalPayer({
        id: "gp-merged",
        name: "Old BCBS of NC",
        status: "merged",
        merged_into_id: "gp-new",
        states: ["NC"],
        payer_slug: "old-bcbs-nc",
      }),
      globalPayer({
        id: "gp-retired",
        name: "Defunct Health Plan",
        status: "retired",
        payer_slug: "defunct",
      }),
    ],
  });
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/payer-directory");
  await page.getByLabel("Filter by payer kind").click({ timeout: 30000 });
  await page.getByRole("option", { name: "All kinds" }).click();

  const merged = page.locator("tbody tr", { hasText: "Old BCBS of NC" });
  await expect(merged).toContainText("Merged");
  await expect(merged).toContainText("BCBS-NC (new entity)"); // canonical successor
  await expect(merged.getByRole("button", { name: "Add to organization" })).toHaveCount(0);

  const retired = page.locator("tbody tr", { hasText: "Defunct Health Plan" });
  await expect(retired).toContainText("Retired");
  await expect(retired.getByRole("button", { name: "Add to organization" })).toHaveCount(0);
});

test("a non-admin browses the catalog but sees no mutation controls", async ({ context, page }) => {
  const fixtures = makeFixtures("billing");
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/payer-directory");
  await expect(page.getByText("Blue Cross and Blue Shield of North Carolina")).toBeVisible({
    timeout: 30000,
  });
  // Browsing is allowed; adding is not.
  await expect(page.getByRole("button", { name: "Add to organization" })).toHaveCount(0);
});

test("Remove archives the subscription + active targets; Reactivate never recreates scope", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures("admin", {
    org_payer_assignments: [
      {
        id: "opa-1",
        org_id: ORG,
        payer_id: "gp-bcbsnc",
        starter: false,
        status: "active",
        archived_at: null,
        created_at: "2026-07-14T00:00:00Z",
      },
    ],
    payer_network_targets: [
      {
        id: "pnt-1",
        org_id: ORG,
        payer_id: "gp-bcbsnc",
        group_id: "g-1",
        state: "NC",
        status: "active",
        created_at: "2026-07-14T00:00:00Z",
      },
    ],
  });
  const { handler, deletes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/payer-directory");
  const row = page.locator("tbody tr", { hasText: "Blue Cross and Blue Shield of North Carolina" });
  await expect(row.getByText("Added to organization")).toBeVisible({ timeout: 30000 });

  // Remove → confirm → the subscription AND its active target archive (cascade),
  // and NOTHING is deleted (status flips only).
  await row.getByRole("button", { name: "Remove" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Remove Blue Cross and Blue Shield of North Carolina");
  await dialog.getByRole("button", { name: "Remove" }).click();

  await expect(row.getByRole("button", { name: "Reactivate" })).toBeVisible({ timeout: 15000 });
  const assigns = fixtures.org_payer_assignments as Array<Record<string, unknown>>;
  const targets = fixtures.payer_network_targets as Array<Record<string, unknown>>;
  expect(assigns[0].status).toBe("archived");
  expect(targets[0].status).toBe("archived");
  expect(deletes).toHaveLength(0); // history preserved — never a DELETE

  // Reactivate flips the subscription back on WITHOUT recreating the archived
  // scope (the target stays archived for the existing restore/review flow).
  await row.getByRole("button", { name: "Reactivate" }).click();
  await expect(row.getByText("Added to organization")).toBeVisible({ timeout: 15000 });
  expect(assigns[0].status).toBe("active");
  expect(targets[0].status).toBe("archived");
  expect(deletes).toHaveLength(0);
});
