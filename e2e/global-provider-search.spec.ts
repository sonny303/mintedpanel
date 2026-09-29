import { test, expect, type Route } from "./fixtures/legacy-access-context";

// Approach A, in the shell. A user who belongs to two orgs looks up a provider
// who lives only in the other org, copies the NPI without leaving the active
// org, then opens the record and lands in that provider's org.
//
// The mock returns a third provider from an org the user is NOT a member of.
// The palette must drop that row. The real wall is providers_select; this
// asserts the client narrowing and that the request itself names no org.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_A = "22222222-2222-4222-8222-222222222222";
const ORG_B = "33333333-3333-4333-8333-333333333333";
const ORG_FOREIGN = "44444444-4444-4444-8444-444444444444";
const JANE_ID = "55555555-5555-4555-8555-555555555555";

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

function provider(
  id: string,
  orgId: string,
  orgName: string,
  first: string,
  last: string,
  npi: string,
) {
  return {
    id,
    org_id: orgId,
    first_name: first,
    last_name: last,
    credentials: "PT",
    npi,
    status: "active",
    organizations: { name: orgName },
  };
}

const PROVIDERS = [
  provider(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ORG_A,
    "Kansas PT",
    "Ada",
    "Lovelace",
    "1111111111",
  ),
  provider(JANE_ID, ORG_B, "Missouri Rehab", "Jane", "Smith", "1234567890"),
  provider(
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ORG_FOREIGN,
    "Foreign Health",
    "John",
    "Smith",
    "9999999999",
  ),
];

const FIXTURES: Record<string, unknown[]> = {
  memberships: [
    {
      user_id: USER_ID,
      org_id: ORG_A,
      role: "admin",
      organizations: {
        name: "Kansas PT",
        lifecycle_state: "active",
        created_at: "2026-07-01T00:00:00Z",
      },
    },
    {
      user_id: USER_ID,
      org_id: ORG_B,
      role: "specialist",
      organizations: {
        name: "Missouri Rehab",
        lifecycle_state: "active",
        created_at: "2026-07-02T00:00:00Z",
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
  providers: PROVIDERS,
  notes: [],
  user_table_prefs: [],
};

function filteredRows(table: string, url: URL): unknown[] {
  let rows = FIXTURES[table] ?? [];
  for (const [key, value] of url.searchParams) {
    if (!value.startsWith("eq.")) continue;
    const expected = value.slice(3);
    rows = rows.filter((row) => {
      if (!row || typeof row !== "object") return false;
      return String((row as Record<string, unknown>)[key] ?? "") === expected;
    });
  }
  if (table === "providers") {
    const or = url.searchParams.get("or") ?? "";
    const term = or.match(/ilike\.%?([^%)]+)%?/)?.[1]?.toLowerCase();
    if (term) {
      rows = rows.filter((row) => {
        const record = row as {
          first_name: string;
          last_name: string;
          npi: string | null;
        };
        return (
          record.first_name.toLowerCase().includes(term) ||
          record.last_name.toLowerCase().includes(term) ||
          (record.npi ?? "").toLowerCase().includes(term)
        );
      });
    }
  }
  return rows;
}

test("lookup finds a provider in another member org and switches only on open", async ({
  context,
  page,
}) => {
  const searches: string[] = [];
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.route(/\/(rest|auth)\/v1\//, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
    if (table === "providers" && url.searchParams.has("or")) searches.push(url.toString());
    const rows = filteredRows(table, url);
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  });

  await context.addInitScript(
    ([authKey, session, orgId]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_A] as const,
  );

  await page.goto("/org-detail");
  const rail = page.locator("aside").first();
  await expect(rail.getByRole("button", { name: "Find a provider" })).toBeVisible({
    timeout: 30000,
  });
  await expect(rail.getByRole("button", { name: /Active organization: Kansas PT/ })).toBeVisible();

  await rail.getByRole("button", { name: "Find a provider" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Searches 2 organizations you belong to/)).toBeVisible();

  await dialog.getByLabel("Provider name or NPI").fill("smith");
  await expect(dialog.getByText("Jane Smith")).toBeVisible();
  await expect(dialog.getByText("Missouri Rehab")).toBeVisible();
  await expect(dialog.getByText("1234567890")).toBeVisible();
  await expect(dialog.getByText("John Smith")).toHaveCount(0);
  await expect(dialog.getByText("Foreign Health")).toHaveCount(0);

  expect(searches.length).toBeGreaterThan(0);
  const searchUrl = searches[0];
  expect(searchUrl).not.toContain("org_id=eq");
  expect(searchUrl).not.toContain("ssn_last4");
  expect(searchUrl).not.toContain("date_of_birth");

  await dialog.getByRole("button", { name: "Copy NPI for Jane Smith" }).click();
  await expect(dialog.getByText("Copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("1234567890");
  // Copy stays on this page, in this org. The rail is inert while the dialog
  // is open, so the proof is the URL plus the dialog still showing the hit.
  await expect(page).toHaveURL(/\/org-detail/);
  await expect(dialog.getByText("Jane Smith")).toBeVisible();

  await dialog.getByLabel("Provider name or NPI").press("Enter");
  await expect(page).toHaveURL(new RegExp(`/providers/${JANE_ID}`));
  await expect(
    rail.getByRole("button", { name: /Active organization: Missouri Rehab/ }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Jane Smith" })).toBeVisible();
});
