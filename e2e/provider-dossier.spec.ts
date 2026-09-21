import { test, expect, type Route } from "@playwright/test";

// The footprint inspector is mounted on /dev/global-search only. The shell
// palette stays the shallow lookup: same person, no inspect control, no
// dossier request.
//
// The mock returns Marc's NPI from two member orgs and from a foreign org.
// The Kansas license disagrees on expiration. The panel must show both member
// orgs, flag the conflict, and drop the foreign license, group, and facility.
// Copy stays on this page. "Manage in …" is what switches org.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_A = "22222222-2222-4222-8222-222222222222";
const ORG_B = "33333333-3333-4333-8333-333333333333";
const ORG_FOREIGN = "44444444-4444-4444-8444-444444444444";
const MARC_A = "55555555-5555-4555-8555-555555555555";
const MARC_B = "66666666-6666-4666-8666-666666666666";
const NPI = "1234567890";

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

function license(
  id: string,
  orgId: string,
  state: string,
  licenseNumber: string,
  expiration: string,
) {
  return {
    id,
    org_id: orgId,
    state,
    license_number: licenseNumber,
    license_type: "PT",
    expiration_date: expiration,
    status: "active",
    verified_status: "verified",
  };
}

function provider(
  id: string,
  orgId: string,
  orgName: string,
  licenses: unknown[],
  groups: unknown[],
  facilities: unknown[],
) {
  return {
    id,
    org_id: orgId,
    first_name: "Marc",
    last_name: "Ng",
    credentials: "PT",
    npi: NPI,
    status: "active",
    organizations: { name: orgName },
    state_licenses: licenses,
    provider_group_assignments: groups,
    provider_facility_assignments: facilities,
  };
}

const PROVIDERS = [
  provider(
    MARC_A,
    ORG_A,
    "Kansas PT",
    [license("lic-a", ORG_A, "KS", "KS-100", "2027-01-02")],
    [
      {
        id: "as-a",
        org_id: ORG_A,
        is_primary: true,
        provider_groups: {
          id: "g-a",
          name: "Kansas Group",
          npi_type2: "1987654321",
          tin: "11-1111111",
        },
      },
    ],
    [
      {
        id: "fa-a",
        org_id: ORG_A,
        is_primary: true,
        facilities: { id: "f-a", name: "Kansas Clinic", city: "Kansas City", state: "KS" },
      },
    ],
  ),
  provider(
    MARC_B,
    ORG_B,
    "Missouri Rehab",
    [
      license("lic-b", ORG_B, "KS", "KS-100", "2026-06-01"),
      license("lic-c", ORG_B, "MO", "MO-200", "2028-03-04"),
    ],
    [
      {
        id: "as-b",
        org_id: ORG_B,
        is_primary: false,
        provider_groups: {
          id: "g-b",
          name: "Missouri Group",
          npi_type2: null,
          tin: "22-2222222",
        },
      },
    ],
    [
      {
        id: "fa-b",
        org_id: ORG_B,
        is_primary: false,
        facilities: { id: "f-b", name: "Missouri Clinic", city: "St. Louis", state: "MO" },
      },
    ],
  ),
  provider(
    "77777777-7777-4777-8777-777777777777",
    ORG_FOREIGN,
    "Foreign Health",
    [license("lic-x", ORG_FOREIGN, "CA", "CA-9", "2030-01-01")],
    [
      {
        id: "as-x",
        org_id: ORG_FOREIGN,
        is_primary: true,
        provider_groups: {
          id: "g-x",
          name: "Foreign Group",
          npi_type2: null,
          tin: "99-9999999",
        },
      },
    ],
    [
      {
        id: "fa-x",
        org_id: ORG_FOREIGN,
        is_primary: true,
        facilities: { id: "f-x", name: "Foreign Clinic", city: "Austin", state: "TX" },
      },
    ],
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
        const record = row as { first_name: string; last_name: string; npi: string | null };
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

async function installMock(
  context: import("@playwright/test").BrowserContext,
  dossierRequests: string[],
) {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.route(/\/(rest|auth)\/v1\//, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
    if (table === "providers" && (url.searchParams.get("npi") ?? "").startsWith("eq.")) {
      dossierRequests.push(url.toString());
    }
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
}

test("footprint inspector aggregates member orgs and leaves the active org alone", async ({
  context,
  page,
}) => {
  const dossierRequests: string[] = [];
  await installMock(context, dossierRequests);

  await page.goto("/dev/global-search");
  await expect(page.getByRole("heading", { name: "Global provider search" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Open lookup" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Provider name or NPI").fill("marc");
  await expect(
    dialog.getByRole("button", { name: "Inspect footprint for Marc Ng in Kansas PT" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Inspect footprint for Marc Ng in Kansas PT" }).click();

  const footprint = dialog.getByRole("complementary", { name: "Provider footprint" });
  await expect(footprint.getByRole("button", { name: "Manage in Kansas PT" })).toBeVisible();
  await expect(footprint.getByRole("button", { name: "Manage in Missouri Rehab" })).toBeVisible();
  await expect(footprint.getByText("KS-100", { exact: true })).toBeVisible();
  await expect(footprint.getByText("MO-200", { exact: true })).toBeVisible();
  await expect(footprint.getByText("Conflicts", { exact: true })).toBeVisible();
  await expect(footprint.getByText("Kansas Group", { exact: true })).toBeVisible();
  await expect(footprint.getByText("Missouri Group", { exact: true })).toBeVisible();
  await expect(footprint.getByText("Kansas Clinic", { exact: true })).toBeVisible();
  await expect(footprint.getByText("CA-9")).toHaveCount(0);
  await expect(footprint.getByText("Foreign Group")).toHaveCount(0);
  await expect(footprint.getByText("Foreign Clinic")).toHaveCount(0);
  await expect(footprint.getByText("Foreign Health")).toHaveCount(0);

  expect(dossierRequests.length).toBeGreaterThan(0);
  const dossierUrl = decodeURIComponent(dossierRequests[0]);
  expect(dossierUrl).toContain(`npi=eq.${NPI}`);
  expect(dossierUrl).toContain("state_licenses");
  expect(dossierUrl).not.toContain("org_id=eq");
  expect(dossierUrl).not.toContain("dea_number");
  expect(dossierUrl).not.toContain("ssn_last4");
  expect(dossierUrl).not.toContain("date_of_birth");

  await footprint.getByRole("button", { name: "Copy all licenses" }).click();
  await expect(footprint.getByText("Copied")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("KS-100");
  expect(copied).toContain("MO-200");
  expect(copied).toContain("differs across organizations");
  expect(copied).not.toContain("CA-9");

  // The modal marks the rail inert, so the proof that inspect did not switch
  // org is the URL. "Manage in …" is the action that leaves this page.
  await expect(page).toHaveURL(/\/dev\/global-search/);

  await footprint.getByRole("button", { name: "Manage in Missouri Rehab" }).click();
  await expect(page).toHaveURL(new RegExp(`/providers/${MARC_B}`));
  await expect(
    page.getByRole("button", { name: /Active organization: Missouri Rehab/ }),
  ).toBeVisible();
});

test("the shell palette does not load a footprint", async ({ context, page }) => {
  const dossierRequests: string[] = [];
  await installMock(context, dossierRequests);

  await page.goto("/org-detail");
  const rail = page.locator("aside").first();
  await expect(rail.getByRole("button", { name: "Find a provider" })).toBeVisible({
    timeout: 30000,
  });
  await rail.getByRole("button", { name: "Find a provider" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Provider name or NPI").fill("marc");
  await expect(dialog.getByText("Marc Ng").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Inspect footprint/ })).toHaveCount(0);
  expect(dossierRequests).toEqual([]);
});
