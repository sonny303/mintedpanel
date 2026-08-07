import { test, expect, type Route } from "@playwright/test";

// E0.2 FR-5 / TE-4 — Playwright verification that the seeded CRM contacts render
// on a seeded org's workspace. The sandbox/CI can't reach *.supabase.co, so this
// uses the mock harness documented in CLAUDE.md: seed the GoTrue session +
// minted-panel-active-org in localStorage (addInitScript), and answer the
// Supabase HTTP layer from fixtures via context.route. Fixture values come from
// seed-universe.md (Dillon Sports Medicine → Coach Eric Taylor + Zeb Loewenstine).

// CI sets VITE_SUPABASE_URL=https://example.supabase.co (.github/workflows/ci.yml),
// so supabase-js persists the session under sb-example-auth-token. The route mock
// below matches on path only, so it is host-agnostic regardless.
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

const party = (over: Record<string, unknown>) => ({
  id: "p",
  org_id: ORG_ID,
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
    parties: party({ id: "p-owner", name: "Owner Dillon", email: "owner.dillon@example.test" }),
  },
  {
    role_key: "customer_escalation_contact",
    parties: party({
      id: "p-cust",
      name: "Coach Eric Taylor",
      email: "contact.dillon@example.test",
      phone_office: "432-555-0118",
      address_line1: "500 Panther Field Rd",
      city: "Dillon",
      state: "TX",
      postal_code: "79714",
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
      address_line1: "101 S Tryon St",
      address_line2: "Suite 400",
      city: "Charlotte",
      state: "NC",
      postal_code: "28280",
      country: "US",
    }),
  },
];

const FIXTURES: Record<string, unknown[]> = {
  memberships: [
    { org_id: ORG_ID, role: "admin", organizations: { name: "Dillon Sports Medicine" } },
  ],
  profiles: [
    {
      id: USER_ID,
      full_name: "Sowmya Seed",
      email: "sowmya.seed@example.test",
      created_at: "2026-07-09T00:00:00Z",
    },
  ],
  party_role_assignments: ASSIGNMENTS,
  notes: [],
  user_table_prefs: [],
};

async function fulfillSupabase(route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  if (url.pathname.includes("/auth/v1/")) return json(SESSION);
  if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

  const table = url.pathname.split("/rest/v1/")[1] ?? "";
  const rows = FIXTURES[table] ?? [];
  const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
  if (wantsObject) {
    if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
    return json(rows[0]);
  }
  return json(rows);
}

test("seeded org contacts (customer + Zeb sales rep) render on the workspace", async ({
  context,
  page,
}) => {
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

  await page.goto("/get-started");

  // Wait out the cold dev-server compile + SSR/hydrate + auth init + fetch on the
  // first assertion, then the rest resolve immediately. Since E0.8, /get-started
  // renders the customer's name/email in BOTH the read-only AccountDetailSummary
  // and PartiesManager — .first() keeps strict mode satisfied while still
  // asserting visibility.
  await expect(page.getByText("Coach Eric Taylor").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Zeb Loewenstine").first()).toBeVisible();
  await expect(
    page.getByText("contact.dillon@example.test", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("zeb@mintedpanel.example.test", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText("Organization contact").first()).toBeVisible();
  await expect(page.getByText("Sales Rep").first()).toBeVisible();
});
