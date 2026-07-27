import { test, expect, type Route } from "@playwright/test";

// E6.1 F6.1.6 / TS-106 + TS-120 — the wholesale redirect table over the mock
// harness. The six-item restructure retires sixteen surfaces; every retired
// route redirects to its job's new home (interim homes where the final target
// is a sibling epic's — E6.2/E6.3 generation, E6.5 Payer Setup module, E6.6
// reports), and no legacy URL dead-ends (the E0.4 rule). Param preservation
// is pinned for the named set (?section=, the ?payerId/state/groupId match
// key, ?draftId) per TS-120. Supersedes the E0.9 TS-23 sweep's route sets.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

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

const FIXTURES: Record<string, unknown[]> = {
  organizations: [
    {
      id: ORG_ID,
      name: "Outer Banks Rehab Group",
      lifecycle_state: "active",
      created_at: "2026-07-01T00:00:00Z",
    },
  ],
  memberships: [
    {
      org_id: ORG_ID,
      role: "admin",
      organizations: {
        name: "Outer Banks Rehab Group",
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
};

async function fulfillSupabase(route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  if (url.pathname.includes("/auth/v1/")) return json(SESSION);
  if (url.pathname.endsWith("/rpc/get_sop_field_tokens")) return json([]);
  if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

  const table = url.pathname.split("/rest/v1/")[1] ?? "";
  const rows = FIXTURES[table] ?? [];
  const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
  if (wantsObject) {
    if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
    return json(rows[0]);
  }
  if (req.method() === "POST" || req.method() === "PATCH") return json(null, 201);
  return json(rows);
}

function seedAuth(context: {
  addInitScript: (fn: (args: unknown[]) => void, args: unknown[]) => Promise<void>;
}) {
  return context.addInitScript(
    ([authKey, session, orgId]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_ID] as const,
  );
}

// Routes that must RENDER (a page heading appears, no router dead end): the
// six nav destinations + the still-live working sub-surfaces (the templates
// wizard is the SOP-templates tab's authoring flow; /import/$runId reviews
// in-flight staged runs; the E6.6 reports render under /reporting/*).
const RENDERING_ROUTES = [
  // E6.3 — the generation door + run history are ALIVE again.
  "/generation",
  "/generation/runs",
  "/generation/runs/run-1",
  "/cases",
  "/admin/payer-admin",
  "/reporting",
  "/reporting/launches",
  "/reporting/denials",
  "/reporting/audit-log",
  "/reporting/leads",
  "/reporting/facilities-without-providers",
  "/reporting/locations-per-group",
  "/org-detail",
  "/groups",
  "/providers",
  "/reports",
  "/admin/templates/new",
  // Slice B — the manual payer-setup doors (create + edit; a stale id renders
  // an honest "Payer not found", never a dead end).
  "/admin/payers/new",
  "/admin/payers/pay-1/edit",
  "/onboarding",
  "/onboarding/wizard",
];

// The F6.1.6 redirect table (old → new). Every retired route redirects to its
// job's new home; interim homes stand in where the final target is a sibling
// epic's (noted inline). Old links live — never a dead end.
const REDIRECTING_ROUTES: Array<{ from: string; to: RegExp }> = [
  // E6.1's own retirements.
  { from: "/home", to: /\/cases\/?$/ },
  { from: "/work", to: /\/cases\/?$/ },
  { from: "/work?run=run-1", to: /\/cases\?run=run-1$/ },
  { from: "/get-started", to: /\/org-detail\/?$/ },
  { from: "/admin/settings", to: /\/org-detail\/?$/ },
  { from: "/scope", to: /\/onboarding\/wizard\/?$/ },
  { from: "/outcomes", to: /\/reporting\/?$/ },
  { from: "/soon?title=Facilities", to: /\/reporting\/?$/ },
  // Deprecated owner views → their E6.6 reports (F6.6.2/F6.6.3).
  { from: "/client-progress", to: /\/reporting\/denials\/?$/ },
  { from: "/progress", to: /\/reporting\/denials\/?$/ },
  { from: "/launches", to: /\/reporting\/launches\/?$/ },
  { from: "/launches/loc-1", to: /\/reporting\/launches\/?$/ },
  // E6.6 F6.6.4 — the Audit Log admin page re-homed into the Center.
  { from: "/admin/audit", to: /\/reporting\/audit-log\/?$/ },
  // Imports live with data (E6.4 carries them; wizard uploads meanwhile).
  { from: "/admin/import", to: /\/providers\/?$/ },
  // Payer Setup consolidations (E6.5 finalizes the module).
  { from: "/fix-it", to: /\/admin\/payer-admin\/sops$/ },
  { from: "/admin/mso-routing", to: /\/admin\/payer-admin\/catalog$/ },
  { from: "/admin/portals", to: /\/admin\/payer-admin\/sops$/ },
  // E6.5: the Forms-tab payer context retired with the tab — registration
  // lives in the SOP editor, so the param is deliberately dropped.
  { from: "/admin/portals?payerId=pay-77", to: /\/admin\/payer-admin\/sops$/ },
  { from: "/admin/templates", to: /\/admin\/payer-admin\/sops$/ },
  { from: "/admin/sops", to: /\/admin\/payer-admin\/sops$/ },
  { from: "/payer-directory", to: /\/admin\/payer-admin\/catalog$/ },
  { from: "/portals/bcbs_ks/train", to: /\/admin\/payer-admin\/sops$/ },
  { from: "/admin/payers", to: /\/admin\/payer-admin\/catalog$/ },
  // Generation re-homes on the group's Payer Network (E6.2/E6.3).
  // Pre-E6.1 stubs, retargeted or preserved.
  { from: "/portfolio", to: /\/reporting\/portfolio\/?$/ },
  { from: "/admin/statuses", to: /\/cases\/?$/ },
  { from: "/admin/sops/tpl-1", to: /\/admin\/templates\/tpl-1\/?$/ },
  // E6.4 — the monolithic provider edit form retired to the record.
  { from: "/providers/prov-1/edit", to: /\/providers\/prov-1\/?$/ },
];

// TS-120 — the named param-preservation set, honored at the destination:
//   ?section=            a wizard section deep link (via the retired /scope)
//   ?payerId/state/groupId  the "Needs SOP" match-key trio (templates wizard)
//   ?draftId             a template draft resume (templates wizard)
// The wizard sub-routes still render (the SOP-templates tab's authoring flow),
// so the match-key/draft URLs are pinned as rendering-with-params.
const PARAM_PRESERVING: Array<{ from: string; to: RegExp }> = [
  { from: "/scope?section=payer_network", to: /\/onboarding\/wizard\?section=payer_network$/ },
  {
    from: "/admin/templates/new?payerId=pay-1&state=NC&groupId=g-1",
    to: /\/admin\/templates\/new\?.*payerId=pay-1.*state=NC.*groupId=g-1/,
  },
  { from: "/admin/templates/new?draftId=draft-1", to: /\/admin\/templates\/new\?draftId=draft-1/ },
];

test.describe("legacy-route sweep (E6.1 F6.1.6 / TS-106, TS-120)", () => {
  test.beforeEach(async ({ context }) => {
    await context.route(/\/(rest|auth)\/v1\//, fulfillSupabase);
    await seedAuth(context);
  });

  for (const path of RENDERING_ROUTES) {
    test(`${path} renders a page (no dead end)`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main h1, h1").first()).toBeVisible({ timeout: 30000 });
      await expect(page.locator("body")).not.toContainText("Not Found");
    });
  }

  for (const { from, to } of REDIRECTING_ROUTES) {
    test(`${from} redirects (old links live)`, async ({ page }) => {
      await page.goto(from);
      await expect(page).toHaveURL(to, { timeout: 30000 });
    });
  }

  for (const { from, to } of PARAM_PRESERVING) {
    test(`${from} preserves its params (TS-120)`, async ({ page }) => {
      await page.goto(from);
      await expect(page).toHaveURL(to, { timeout: 30000 });
      await expect(page.locator("main h1, h1").first()).toBeVisible({ timeout: 30000 });
    });
  }
});
