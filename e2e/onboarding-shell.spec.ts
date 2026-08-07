import { test, expect, type Route } from "@playwright/test";

// E0.8 TE-9 — Onboarding-shell coverage over the mock harness (CLAUDE.md recipe):
//   TS-17 standalone onboarding page: intake run lands in the wizard flow; the
//         share popup targets exactly one typed-in recipient (no party dropdown)
//   TS-18 People-section role rows on Org Detail (renamed from People Enroll 2026-07-21)
//   TS-19 Account Detail read-only summary of the org-intake outputs
//   TS-20 branded shell (Minted Panel / Workspace / Org space) + branded
//         outbound recipient form
// Fixture personas per seed-universe.md: Rose City Rehab Collective (Owner Rose
// City, customer Candace Devereaux, sales rep Zeb Loewenstine); Point Place
// Physical Therapy is the org created in the TS-17 intake run.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_A = "22222222-2222-4222-8222-222222222222";
const NEW_ORG = "44444444-4444-4444-8444-444444444444";
const CAPTURE_TOKEN = "e2e-fixture-capture-token";

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

const party = (over: Record<string, unknown>) => ({
  id: "p",
  party_type: "person",
  name: "",
  first_name: null,
  last_name: null,
  title: null,
  email: null,
  phone_office: null,
  phone_extension: null,
  phone_mobile: null,
  fax: null,
  address_line1: null,
  address_line2: null,
  city: null,
  state: null,
  postal_code: null,
  country: null,
  created_by: USER_ID,
  created_at: "2026-07-09T00:00:00Z",
  ...over,
});

// party_role_assignments?select=role_key,parties(*) — rows carry the embedded party.
const ASSIGNMENTS = [
  {
    role_key: "owner",
    parties: party({
      id: "p-owner",
      name: "Owner Rose City",
      email: "owner.rose-city@example.test",
    }),
  },
  {
    role_key: "customer_escalation_contact",
    parties: party({
      id: "p-cust",
      name: "Candace Devereaux",
      email: "contact.rose-city@example.test",
      phone_office: "503-555-0121",
      address_line1: "3550 N Mississippi Ave",
      city: "Portland",
      state: "OR",
      postal_code: "97227",
      country: "US",
    }),
  },
  {
    role_key: "sales_rep",
    parties: party({
      id: "p-zeb",
      name: "Zeb Loewenstine",
      email: "zeb@mintedpanel.example.test",
      phone_office: "704-555-0100",
      city: "Charlotte",
      state: "NC",
      postal_code: "28280",
      country: "US",
    }),
  },
];

const FIXTURES: Record<string, unknown[]> = {
  organizations: [
    {
      id: ORG_A,
      name: "Rose City Rehab Collective",
      lifecycle_state: "prospect",
      created_at: "2026-07-01T00:00:00Z",
    },
  ],
  memberships: [
    {
      org_id: ORG_A,
      role: "admin",
      organizations: {
        name: "Rose City Rehab Collective",
        lifecycle_state: "prospect",
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
  parties: [],
  party_role_assignments: ASSIGNMENTS,
  party_role_types: [
    { role_key: "owner", label: "Authorized contact", is_active: true },
    {
      role_key: "customer_escalation_contact",
      label: "Organization contact",
      is_active: true,
    },
    { role_key: "sales_rep", label: "Sales Rep", is_active: true },
  ],
  inbound_leads: [],
  party_capture_links: [],
};

function makeHandler() {
  let createCalled = false;
  return async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);

    if (url.pathname.endsWith("/rpc/create_organization")) {
      createCalled = true;
      return json(NEW_ORG);
    }
    if (url.pathname.endsWith("/rpc/create_capture_link")) {
      return json({
        token: CAPTURE_TOKEN,
        party_id: "p-new-recipient",
        recipient_email: "kitty.forman@example.test",
        recipient_name: "Kitty Forman",
        org_name: "Rose City Rehab Collective",
        expires_at: "2026-07-13T00:00:00Z",
      });
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
            name: "Point Place Physical Therapy",
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

test("TS-17: intake run on the onboarding page lands in the new org's wizard flow (E6.1 F6.1.5)", async ({
  context,
  page,
}) => {
  await context.route(/\/(rest|auth)\/v1\//, makeHandler());
  await seedAuth(context);

  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "New organization" })).toBeVisible({
    timeout: 30000,
  });

  // Residual-org bugfix: the persistent side panel's scope is spelled out so it
  // cannot be mistaken for the new org being created — it names the CURRENT
  // active org and contrasts it with the left-hand intake form.
  await expect(
    page.getByText("These actions apply to your current organization", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Rose City Rehab Collective — not the new organization you're creating", {
      exact: false,
    }),
  ).toBeVisible();

  const form = page.getByLabel("Organization intake");
  const inputs = form.locator("input");
  await inputs.nth(0).fill("Point Place Physical Therapy");
  await inputs.nth(1).fill("Owner Point Place");
  await inputs.nth(2).fill("owner.point-place@example.test");
  // D6: the intake form captures the name SPLIT (payer forms ask for it split).
  await form.locator("#customer-first-name").fill("Kitty");
  await form.locator("#customer-last-name").fill("Forman");
  await form.locator("#customer-email").fill("contact.point-place@example.test");
  await form.locator("#customer-phone").fill("414-555-0120");
  await form.locator("#customer-line1").fill("416 Marie Dr");
  await form.locator("#customer-city").fill("Point Place");
  await form.locator("#customer-state").click();
  await page.getByRole("option", { name: "WI", exact: true }).click();
  await form.locator("#customer-zip").fill("53511");

  await form.getByRole("button", { name: "Create organization" }).click();

  // E6.1 F6.1.5 (supersedes the F0.8.1 Get-started landing): saving the
  // intake form lands IN the new org's one-time wizard flow.
  await expect(page).toHaveURL(/\/onboarding\/wizard\/?$/, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: "Onboarding" })).toBeVisible({
    timeout: 15000,
  });
});

test("TS-17: share popup requires one typed-in recipient — no party dropdown", async ({
  context,
  page,
}) => {
  await context.route(/\/(rest|auth)\/v1\//, makeHandler());
  await seedAuth(context);

  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "New organization" })).toBeVisible({
    timeout: 30000,
  });

  await page.getByRole("button", { name: "Share onboarding link" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Share onboarding link" })).toBeVisible();

  // No "Send to / Someone else..." party dropdown anywhere in the popup (F0.8.3).
  await expect(dialog.locator("select")).toHaveCount(0);
  await expect(dialog.getByRole("combobox")).toHaveCount(0);

  // The primary CTA is labeled "Share onboarding link" and blocks until BOTH
  // recipient name and email are present.
  const cta = dialog.getByRole("button", { name: "Share onboarding link" });
  await expect(cta).toBeDisabled();
  await dialog.locator("#share-name").fill("Kitty Forman");
  await expect(cta).toBeDisabled();
  await dialog.locator("#share-email").fill("kitty.forman@example.test");
  await expect(cta).toBeEnabled();

  await cta.click();

  // The issued link is surfaced once, copy-able (re-issue semantics unchanged).
  await expect(dialog.getByText("Secure link", { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(dialog.locator("input").first()).toHaveValue(
    new RegExp(`/capture/${CAPTURE_TOKEN}$`),
  );
});

test("TS-18: the People section lists the intake people with their roles", async ({
  context,
  page,
}) => {
  await context.route(/\/(rest|auth)\/v1\//, makeHandler());
  await seedAuth(context);

  await page.goto("/org-detail");

  await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible({
    timeout: 30000,
  });
  // Authorized person + organization contact created during intake appear here
  // for follow-on edits, alongside the server-defaulted sales rep (F0.8.5).
  await expect(page.getByText("Owner Rose City").first()).toBeVisible();
  await expect(page.getByText("Candace Devereaux").first()).toBeVisible();
  await expect(page.getByText("Zeb Loewenstine").first()).toBeVisible();
  await expect(page.getByText("Sales Rep").first()).toBeVisible();
});

test("TS-19: Org Detail mirrors the org-intake outputs read-only", async ({ context, page }) => {
  await context.route(/\/(rest|auth)\/v1\//, makeHandler());
  await seedAuth(context);

  await page.goto("/org-detail");

  await expect(page.getByRole("heading", { name: "Org Detail" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText("Organization summary")).toBeVisible();
  await expect(page.getByText("Rose City Rehab Collective").first()).toBeVisible();
  // E0.8 terminology, not owner / customer-escalation phrasing.
  await expect(page.getByText("Authorized contact").first()).toBeVisible();
  await expect(page.getByText("Organization contact").first()).toBeVisible();
  await expect(page.getByText("owner.rose-city@example.test").first()).toBeVisible();
  await expect(page.getByText("contact.rose-city@example.test").first()).toBeVisible();

  // F0.8.6: the capture-link and begin-onboarding surfaces are NOT reintroduced
  // here — they live on the onboarding page.
  await expect(page.getByRole("button", { name: "Share onboarding link" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Begin onboarding" })).toHaveCount(0);
});

test("TS-20: workspace shell carries Minted Panel branding with the Workspace segment and org-zone switcher tile", async ({
  context,
  page,
}) => {
  await context.route(/\/(rest|auth)\/v1\//, makeHandler());
  await seedAuth(context);

  await page.goto("/org-detail");

  await expect(page.getByRole("heading", { name: "Org Detail" })).toBeVisible({
    timeout: 30000,
  });
  // F0.8.7 branding holds; the E0.8 "Org space" label was superseded by E0.9
  // F0.9.3 (Sidebar IA v2) — the org zone is now headed by the switcher tile
  // with its ORGANIZATION eyebrow. The sidebar is mounted twice (desktop rail
  // + mobile drawer), hence .first().
  await expect(page.getByText("Minted Panel").first()).toBeVisible();
  await expect(page.getByText("Workspace", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Organization", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Org space", { exact: true })).toHaveCount(0);
});

test("TS-20: the outbound recipient form is branded end-to-end", async ({ context, page }) => {
  // Anonymous surface — only the anon RPC boundary is mocked.
  await context.route(/\/(rest|auth)\/v1\//, async (route: Route) => {
    const url = new URL(route.request().url());
    const json = (b: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (url.pathname.endsWith("/rpc/validate_capture_token")) {
      return json({
        state: "active",
        org_name: "Rose City Rehab Collective",
        recipient_name: "Candace Devereaux",
        recipient_email: "contact.rose-city@example.test",
        expires_at: "2026-07-13T00:00:00Z",
        current: { name: "Candace Devereaux", email: "contact.rose-city@example.test" },
      });
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);
    if (url.pathname.includes("/auth/v1/")) return json({});
    return json([]);
  });

  await page.goto(`/capture/${CAPTURE_TOKEN}`);

  await expect(page.getByRole("heading", { name: "Confirm your details" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText("Minted Panel").first()).toBeVisible();
  await expect(page.getByText("Powered by Minted Panel", { exact: false })).toBeVisible();
});
