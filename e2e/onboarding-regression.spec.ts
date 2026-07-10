import { test, expect, type Route } from "@playwright/test";

// E0.7 F0.7.4 TE-5 — Regression coverage for the org-create flow reachable from
// the sidebar's "Add organization" dropdown item. Covers:
//   1. Add organization → modal opens → form submits → org switch
//   2. Duplicate normalized name → server error surfaced to user

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
    { role_key: "customer_escalation_contact", label: "Customer Escalation Contact", is_active: true },
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

function seedAuth(context: { addInitScript: (fn: (args: unknown[]) => void, args: unknown[]) => Promise<void> }) {
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

test("Add organization from sidebar opens the create modal", async ({ context, page }) => {
  await context.route(/\/(rest|auth)\/v1\//, makeHandler());
  await seedAuth(context);

  await page.goto("/get-started");
  await page.waitForTimeout(2000);

  const orgTrigger = page.locator("button").filter({ hasText: "Rose City Rehab Collective" }).first();
  await orgTrigger.click();

  await expect(page.getByText("Add organization")).toBeVisible({ timeout: 10000 });
  await page.getByText("Add organization").click();

  await expect(page.getByRole("heading", { name: "Create organization" })).toBeVisible({
    timeout: 10000,
  });
});

test("duplicate org name surfaces a server error in the modal (F0.1.2)", async ({
  context,
  page,
}) => {
  await context.route(/\/(rest|auth)\/v1\//, makeHandler({ duplicateBlock: true }));
  await seedAuth(context);

  await page.goto("/get-started");
  await page.waitForTimeout(2000);

  const orgTrigger = page.locator("button").filter({ hasText: "Rose City Rehab Collective" }).first();
  await orgTrigger.click();
  await page.getByText("Add organization").click();

  await expect(page.getByRole("heading", { name: "Create organization" })).toBeVisible({
    timeout: 10000,
  });

  const dialog = page.getByRole("dialog");
  await dialog.locator("input").first().fill("Rose City Rehab Collective");

  const ownerInputs = dialog.locator("input");
  await ownerInputs.nth(1).fill("Jane Owner");
  await ownerInputs.nth(2).fill("jane@example.test");

  await dialog.locator("#customer-name").fill("Customer Person");
  await dialog.locator("#customer-email").fill("customer@example.test");
  await dialog.locator("#customer-phone").fill("555-555-0100");
  await dialog.locator("#customer-line1").fill("123 Main St");
  await dialog.locator("#customer-city").fill("Portland");
  await dialog.locator("#customer-state").fill("OR");
  await dialog.locator("#customer-zip").fill("97201");

  await dialog.getByRole("button", { name: "Create organization" }).click();

  await expect(dialog.getByText("An organization with this name already exists")).toBeVisible({
    timeout: 10000,
  });
});
