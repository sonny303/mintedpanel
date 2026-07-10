import { test, expect, type Route } from "@playwright/test";

// E0.7 F0.7.4 TE-5 — Regression coverage for the org-create flow reachable from
// the sidebar's "Add organization" dropdown item. REWRITTEN for E0.8 TE-2: Add
// organization now routes to the standalone /onboarding page (the modal is no
// longer the entry point). Covers:
//   1. Add organization → /onboarding page with the intake form + side panel
//   2. Duplicate normalized name → server error surfaced on the onboarding form

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_A = "22222222-2222-4222-8222-222222222222";
const NEW_ORG = "44444444-4444-4444-8444-444444444444";

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
    email: "test@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Test User" },
    created_at: "2026-07-09T00:00:00Z",
  },
};

const FIXTURES: Record<string, unknown[]> = {
  organizations: [
    {
      id: ORG_A,
      name: "Rose City Rehab Collective",
      lifecycle_state: "active",
      created_at: "2026-07-01T00:00:00Z",
    },
  ],
  memberships: [
    {
      org_id: ORG_A,
      role: "admin",
      organizations: {
        name: "Rose City Rehab Collective",
        lifecycle_state: "active",
        created_at: "2026-07-01T00:00:00Z",
      },
    },
  ],
  profiles: [
    {
      id: USER_ID,
      full_name: "Test User",
      email: "test@example.test",
      created_at: "2026-07-09T00:00:00Z",
    },
  ],
  notes: [],
  user_table_prefs: [],
  parties: [],
  party_role_assignments: [],
  party_role_types: [
    { role_key: "owner", label: "Owner", is_active: true },
    {
      role_key: "customer_escalation_contact",
      label: "Customer Escalation Contact",
      is_active: true,
    },
    { role_key: "sales_rep", label: "Sales Rep", is_active: true },
  ],
  inbound_leads: [],
  party_capture_links: [],
};

function makeHandler(opts: { duplicateBlock?: boolean } = {}) {
  let createCalled = false;
  return async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);

    if (url.pathname.endsWith("/rpc/create_organization")) {
      if (opts.duplicateBlock) {
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            code: "P0001",
            message: "An organization with this name already exists",
          }),
        });
      }
      createCalled = true;
      return json(NEW_ORG);
    }

    if (url.pathname.endsWith("/rpc/claim_invites")) return json(0);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";

    if (table === "memberships" && createCalled) {
      return json([
        ...FIXTURES.memberships!,
        {
          org_id: NEW_ORG,
          role: "admin",
          organizations: {
            name: "New Test Org",
            lifecycle_state: "prospect",
            created_at: "2026-07-10T00:00:00Z",
          },
        },
      ]);
    }

    const rows = FIXTURES[table] ?? [];
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }

    if (req.method() === "POST" || req.method() === "PATCH") {
      const prefer = req.headers()["prefer"] ?? "";
      if (prefer.includes("return=representation")) {
        return json(wantsObject ? {} : [{}]);
      }
      return json(null, 201);
    }

    return json(rows);
  };
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
    [AUTH_KEY, SESSION, ORG_A] as const,
  );
}

test("Add organization from sidebar routes to the standalone onboarding page (E0.8 TE-2)", async ({
  context,
  page,
}) => {
  await context.route(/\/(rest|auth)\/v1\//, makeHandler());
  await seedAuth(context);

  await page.goto("/get-started");
  await page.waitForTimeout(2000);

  const orgTrigger = page
    .locator("button")
    .filter({ hasText: "Rose City Rehab Collective" })
    .first();
  await orgTrigger.click();

  await expect(page.getByText("Add organization")).toBeVisible({ timeout: 10000 });
  await page.getByText("Add organization").click();

  // The standalone onboarding page, not a modal (F0.8.1).
  await expect(page).toHaveURL(/\/onboarding\/?$/, { timeout: 10000 });
  await expect(page.getByRole("heading", { name: "New organization" })).toBeVisible({
    timeout: 10000,
  });
  // Intake form on the left, persistent side panel with both journeys on the right.
  await expect(page.getByLabel("Organization intake")).toBeVisible();
  await expect(page.getByRole("button", { name: "Share onboarding link" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Begin onboarding" })).toBeVisible();
});

test("duplicate org name surfaces a server error on the onboarding form (F0.1.2)", async ({
  context,
  page,
}) => {
  await context.route(/\/(rest|auth)\/v1\//, makeHandler({ duplicateBlock: true }));
  await seedAuth(context);

  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "New organization" })).toBeVisible({
    timeout: 30000,
  });

  const form = page.getByLabel("Organization intake");
  const inputs = form.locator("input");
  await inputs.nth(0).fill("Rose City Rehab Collective");
  await inputs.nth(1).fill("Jane Owner");
  await inputs.nth(2).fill("jane@example.test");

  await form.locator("#customer-name").fill("Customer Person");
  await form.locator("#customer-email").fill("customer@example.test");
  await form.locator("#customer-phone").fill("555-555-0100");
  await form.locator("#customer-line1").fill("123 Main St");
  await form.locator("#customer-city").fill("Portland");
  await form.locator("#customer-state").fill("OR");
  await form.locator("#customer-zip").fill("97201");

  await form.getByRole("button", { name: "Create organization" }).click();

  await expect(form.getByText("An organization with this name already exists")).toBeVisible({
    timeout: 10000,
  });
});
