import { test, expect, type Route } from "@playwright/test";

// E4.2 hardening — canonical payer selection & org assignment, retargeted by
// the payer-and-cases Slice A (the catalog browse is retired; the
// subscription actions live on the read-only payer DETAIL page, and the
// Payer Setup list shows only the org's own payers). Same stateful harness
// (org_payer_assignments / payer_network_targets + the archive RPC):
//   - An admin adds a catalog payer from its detail page; the header flips to
//     "In my network" + "Configure credentialing scope", the subscription row
//     is written, and the payer joins the Payer Setup list.
//   - Retired/merged payers cannot be newly added; the detail explains why
//     and names the canonical successor.
//   - A non-admin browses list + detail but sees no mutation controls.
//   - Remove archives the subscription AND its active targets (cascade) and
//     the detail offers Reactivate; reactivating flips the subscription back
//     WITHOUT recreating the archived scope.

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

test("admin adds a canonical payer from its detail → In my network + it joins the Payer Setup list", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures("admin");
  fixtures.payers = fixtures.global_payers;
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  // With no subscriptions yet, the Payer Setup list is honestly empty (the
  // list shows the ORG'S payers, never the retired catalog browse).
  await page.goto("/payer-directory");
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText("No payers yet")).toBeVisible();

  // The subscription action lives on the payer detail.
  await page.goto("/admin/payer-admin/setup/gp-bcbsnc");
  await expect(
    page.getByRole("heading", { name: "Blue Cross and Blue Shield of North Carolina" }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Add to my network" }).click();

  // The header flips to Added + the "Configure credentialing scope" hand-off,
  // and the subscription row was written for this org.
  await expect(page.getByText("In my network")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("link", { name: "Configure credentialing scope" })).toBeVisible();
  const assigns = fixtures.org_payer_assignments as Array<Record<string, unknown>>;
  expect(assigns).toHaveLength(1);
  expect(assigns[0]).toMatchObject({ org_id: ORG, payer_id: "gp-bcbsnc", status: "active" });

  // Back on the list, the payer now renders as an org payer row (visible
  // across surfaces without a manual refresh).
  await page.getByRole("link", { name: "← Back to Payer Setup" }).click();
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible();
  await expect(
    page.locator("tbody tr", { hasText: "Blue Cross and Blue Shield of North Carolina" }),
  ).toBeVisible({ timeout: 15000 });
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

  // Slice A: the browse rows are gone — the unavailable state renders on the
  // payer detail, which stays reachable by URL for history/links.
  await page.goto("/admin/payer-admin/setup/gp-merged");
  await expect(page.getByRole("heading", { name: "Old BCBS of NC" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText(/Merged — can't be added/)).toBeVisible();
  await expect(page.getByText("BCBS-NC (new entity)")).toBeVisible(); // canonical successor
  await expect(page.getByRole("button", { name: "Add to my network" })).toHaveCount(0);

  await page.goto("/admin/payer-admin/setup/gp-retired");
  await expect(page.getByRole("heading", { name: "Defunct Health Plan" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText(/Retired — can't be added/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to my network" })).toHaveCount(0);
});

test("a non-admin browses list + detail but sees no mutation controls", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures("billing", {
    org_payer_assignments: [
      { id: "opa-1", org_id: ORG, payer_id: "gp-bcbsnc", starter: false, status: "active" },
    ],
  });
  fixtures.payers = fixtures.global_payers;
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/payer-directory");
  await expect(page.getByText("Blue Cross and Blue Shield of North Carolina")).toBeVisible({
    timeout: 30000,
  });
  // Browsing is allowed; the create entry and every subscription mutation are
  // admin-only.
  await expect(page.getByRole("link", { name: "+ Set up payer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reactivate" })).toHaveCount(0);
  await page.getByRole("link", { name: "Blue Cross and Blue Shield of North Carolina" }).click();
  await expect(page.getByText("In my network")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button", { name: "Add to my network" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove from my network" })).toHaveCount(0);
});

test("§2.2 the assignment-remove verb is gone; re-adding never recreates archived scope", async ({
  context,
  page,
}) => {
  // Slice C collapsed the two removal verbs into ONE — Archive, on the payer
  // detail's Manage tab (payers.archived_at via archive_payer). The E4.2
  // assignment archive keeps its service/hook and is still reached from the
  // group Payer Network board's "remove payer", so the RE-ADD half of that
  // lifecycle stays live here: it must never resurrect archived scope.
  const fixtures = makeFixtures("admin", {
    org_payer_assignments: [
      {
        id: "opa-1",
        org_id: ORG,
        payer_id: "gp-bcbsnc",
        starter: false,
        status: "archived",
        archived_at: "2026-07-20T00:00:00Z",
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
        status: "archived",
        created_at: "2026-07-14T00:00:00Z",
      },
    ],
  });
  fixtures.payers = fixtures.global_payers;
  const { handler, deletes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/admin/payer-admin/setup/gp-bcbsnc");
  await expect(
    page.getByRole("heading", { name: "Blue Cross and Blue Shield of North Carolina" }),
  ).toBeVisible({ timeout: 30000 });

  // There is no second removal verb anywhere on the payer page — Archive on
  // the Manage tab is the one way out.
  await expect(page.getByRole("button", { name: "Remove from my network" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Manage", exact: true }).click();
  await expect(page.getByRole("button", { name: "Archive payer" })).toBeVisible();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();

  // Re-adding flips the subscription back on WITHOUT recreating the archived
  // scope (the target stays archived for the existing restore/review flow),
  // and NOTHING is ever deleted.
  await page.getByRole("button", { name: "Add back to my network" }).click();
  await expect(page.getByText("In my network")).toBeVisible({ timeout: 15000 });
  const assigns = fixtures.org_payer_assignments as Array<Record<string, unknown>>;
  const targets = fixtures.payer_network_targets as Array<Record<string, unknown>>;
  expect(assigns[0].status).toBe("active");
  expect(targets[0].status).toBe("archived");
  expect(deletes).toHaveLength(0); // history preserved — never a DELETE
});
