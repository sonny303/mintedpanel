import { test, expect, type Route } from "@playwright/test";

// E1.3 TE-10 — Provider Roster coverage over the mock harness:
//   TS-33 Tree Hill first provider: CAQH baseline + required group
//         assignment → providers + provider_group_assignments rows →
//         section Complete → wizard all-complete preview
//   TS-34 Shelby two-TIN provider: assigned to both groups (first primary)
//         → two assignment rows, roster lists both groups; removing the
//         last assignment is blocked
//   TS-35 Outer Banks PSV trail: record the NC board URL + mark verified
//         (stamped), then edit the expiration date → back to unverified

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_TREE_HILL = "22222222-2222-4222-8222-222222222222";
const ORG_SHELBY = "33333333-3333-4333-8333-333333333333";
const ORG_OUTER_BANKS = "44444444-4444-4444-8444-444444444444";

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
  email: null,
  phone_office: null,
  phone_mobile: null,
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

const contactAssignments = (orgId: string, slug: string) => [
  {
    org_id: orgId,
    role_key: "owner",
    parties: party({
      id: `p-owner-${slug}`,
      name: `Owner ${slug}`,
      email: `owner.${slug}@example.test`,
    }),
  },
  {
    org_id: orgId,
    role_key: "customer_escalation_contact",
    parties: party({
      id: `p-cust-${slug}`,
      name: `Contact ${slug}`,
      email: `contact.${slug}@example.test`,
      phone_office: "704-555-0142",
      address_line1: "100 Main St",
      city: "Charlotte",
      state: "NC",
      postal_code: "28280",
      country: "US",
    }),
  },
];

const groupRow = (orgId: string, id: string, name: string) => ({
  id,
  org_id: orgId,
  name,
  tin: "123456789",
  npi_type2: null,
  states: ["NC"],
  is_active: true,
  created_at: "2026-07-10T00:00:00Z",
  billing_street: "1 Main St",
  billing_city: "Charlotte",
  billing_state: "NC",
  billing_zip: "28280",
  billing_phone: "704-555-0100",
});

const facilityRow = (orgId: string, id: string, groupId: string) => ({
  id,
  org_id: orgId,
  group_id: groupId,
  name: "Main Clinic",
  street: "1 Main St",
  city: "Charlotte",
  state: "NC",
  zip: "28280",
  phone: "704-555-0100",
  is_active: true,
  hours: {},
  ada_compliance: {},
  languages_offered: [],
  interpreter_languages: [],
  status_id: null,
  effective_date: null,
  reference_only: false,
  created_at: "2026-07-10T00:00:00Z",
});

const providerRow = (orgId: string, id: string, over: Record<string, unknown> = {}) => ({
  id,
  org_id: orgId,
  group_id: null,
  launch_id: null,
  first_name: "",
  last_name: "",
  credentials: null,
  gender: null,
  date_of_birth: null,
  ssn_last4: null,
  email: null,
  phone: null,
  home_street: null,
  home_city: null,
  home_state: null,
  home_zip: null,
  npi: null,
  caqh_id: null,
  caqh_last_attested_date: null,
  dea_number: null,
  taxonomy_code: null,
  specialty: null,
  start_date: null,
  status: "onboarding",
  is_new_grad: null,
  terminated_date: null,
  degree: null,
  school_name: null,
  graduation_date: null,
  malpractice_carrier: null,
  malpractice_policy_number: null,
  malpractice_coverage_start: null,
  malpractice_coverage_end: null,
  middle_initial: null,
  suffix: null,
  ethnicity: null,
  reference_only: false,
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
  ...over,
});

const licenseRow = (
  orgId: string,
  id: string,
  providerId: string,
  over: Record<string, unknown> = {},
) => ({
  id,
  org_id: orgId,
  provider_id: providerId,
  state: "NC",
  license_number: "PT-48213",
  license_type: "full",
  issue_date: "2023-02-01",
  expiration_date: "2027-01-31",
  status: "active",
  verified_status: "unverified",
  verified_at: null,
  verified_by: null,
  verification_source_url: null,
  created_at: "2026-07-10T00:00:00Z",
  ...over,
});

interface FixtureOverrides {
  provider_groups?: unknown[];
  facilities?: unknown[];
  providers?: unknown[];
  state_licenses?: unknown[];
  provider_group_assignments?: unknown[];
  assignments?: unknown[];
}

function makeFixtures(over: FixtureOverrides) {
  const orgs = [
    { id: ORG_TREE_HILL, name: "Tree Hill Sports Therapy", lifecycle_state: "prospect" },
    { id: ORG_SHELBY, name: "Shelby Sports Rehab", lifecycle_state: "active" },
    { id: ORG_OUTER_BANKS, name: "Outer Banks Rehab Group", lifecycle_state: "active" },
  ];
  return {
    organizations: orgs.map((o) => ({ ...o, created_at: "2026-07-01T00:00:00Z" })),
    memberships: orgs.map((o) => ({
      org_id: o.id,
      role: "admin",
      organizations: {
        name: o.name,
        lifecycle_state: o.lifecycle_state,
        created_at: "2026-07-01T00:00:00Z",
      },
    })),
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
    audit_log: [],
    party_role_assignments: over.assignments ?? [],
    provider_groups: over.provider_groups ?? [],
    facilities: over.facilities ?? [],
    providers: over.providers ?? [],
    state_licenses: over.state_licenses ?? [],
    provider_group_assignments: over.provider_group_assignments ?? [],
  } as Record<string, unknown[]>;
}

// Stateful PostgREST mock: org/provider/id filters + INSERT/PATCH/DELETE on
// providers, state_licenses, and provider_group_assignments.
function makeHandler(fixtures: Record<string, unknown[]>) {
  let seq = 500;
  const STATEFUL = new Set(["providers", "state_licenses", "provider_group_assignments"]);
  return async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.endsWith("/rpc/claim_invites")) return json(0);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

    const matchFilters = (row: Record<string, unknown>): boolean => {
      for (const [key, raw] of url.searchParams.entries()) {
        if (["select", "order", "limit", "offset"].includes(key)) continue;
        // Filter only on columns the fixture row actually carries (e.g. the
        // memberships user_id filter has no fixture column — single-user rig).
        if (!(key in row)) continue;
        if (raw.startsWith("eq.")) {
          if (String(row[key]) !== raw.slice(3)) return false;
        } else if (raw.startsWith("in.(")) {
          const ids = raw
            .slice(4, -1)
            .split(",")
            .map((s) => s.replace(/^"|"$/g, ""));
          if (!ids.includes(String(row[key]))) return false;
        }
      }
      return true;
    };

    if (STATEFUL.has(table) && req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "[]") as
        Record<string, unknown> | Record<string, unknown>[];
      const rows = Array.isArray(body) ? body : [body];
      const created = rows.map((r) => ({
        id: `${table}-${seq++}`,
        created_at: "2026-07-12T00:00:00Z",
        ...r,
      }));
      fixtures[table]!.push(...created);
      return json(wantsObject ? created[0] : created, 201);
    }
    if (STATEFUL.has(table) && req.method() === "PATCH") {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      const targets = (fixtures[table] as Record<string, unknown>[]).filter(matchFilters);
      for (const t of targets) Object.assign(t, body);
      return json(wantsObject ? (targets[0] ?? {}) : targets);
    }
    if (STATEFUL.has(table) && req.method() === "DELETE") {
      const rows = fixtures[table] as Record<string, unknown>[];
      const removed = rows.filter(matchFilters);
      fixtures[table] = rows.filter((r) => !removed.includes(r));
      return json(removed);
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
}

function seedAuth(
  context: {
    addInitScript: (fn: (args: unknown[]) => void, args: unknown[]) => Promise<void>;
  },
  orgId: string,
) {
  return context.addInitScript(
    ([authKey, session, activeOrg]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: activeOrg }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, orgId] as const,
  );
}

test("TS-33: first provider — CAQH baseline + group assignment → Complete + all-complete preview", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures({
    assignments: contactAssignments(ORG_TREE_HILL, "tree-hill"),
    provider_groups: [groupRow(ORG_TREE_HILL, "g-th", "Tree Hill Sports Therapy LLC")],
    facilities: [facilityRow(ORG_TREE_HILL, "f-th", "g-th")],
  });
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
  await seedAuth(context, ORG_TREE_HILL);

  await page.goto("/onboarding/wizard");
  const card = page.locator("#wizard-providers");
  await expect(card).toContainText("Not started", { timeout: 30000 });

  await card.getByRole("button", { name: "Add provider" }).click();
  const dialog = page.getByRole("dialog", { name: "Add provider" });

  // Home address was removed from this dialog by user request (2026-07-19):
  // the section reads "Contact" (Email + Phone only); the address lives on
  // the provider record's inline fields and in the CSV import instead.
  await expect(dialog.getByRole("heading", { name: "Contact", exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Contact & home address" })).toHaveCount(0);
  await expect(dialog.locator("#prov-home-street")).toHaveCount(0);
  await expect(dialog.getByLabel("ZIP")).toHaveCount(0);
  await expect(dialog.locator("#prov-email")).toBeVisible();
  await expect(dialog.locator("#prov-phone")).toBeVisible();

  // Malpractice moved to the provider GROUP form (user request 2026-07-19).
  await expect(dialog.getByRole("heading", { name: "Malpractice coverage" })).toHaveCount(0);

  // License date fields get ≥150px so the native picker icon never clips
  // (user-reported 2026-07-19 — the old 4-equal-column row starved them).
  await dialog.getByRole("button", { name: "Add license" }).click();
  const issued = dialog.locator("#lic-0-issue");
  await expect(issued).toBeVisible();
  expect((await issued.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(150);

  await dialog.getByLabel("Assign Tree Hill Sports Therapy LLC").click();
  await dialog.locator("#prov-first").fill("Nathan");
  await dialog.locator("#prov-last").fill("Scott");
  await dialog.locator("#prov-npi").fill("1234567893");
  await dialog.locator("#prov-caqh").fill("16224897");
  await dialog.getByRole("button", { name: "Save provider" }).click();

  await expect(card).toContainText("Complete", { timeout: 15000 });
  await expect(card).toContainText("Nathan Scott");
  await expect(card).toContainText("NPI 1234567893");
  await expect(card).toContainText("Tree Hill Sports Therapy LLC");

  // Rows exist: providers + provider_group_assignments (primary mirrored).
  const createdProvider = fixtures.providers![0] as Record<string, unknown>;
  expect(createdProvider.group_id).toBe("g-th");
  expect(createdProvider.status ?? "onboarding").toBe("onboarding");
  const ga = fixtures.provider_group_assignments![0] as Record<string, unknown>;
  expect(ga.group_id).toBe("g-th");
  expect(ga.is_primary).toBe(true);

  // E1.4: the new provider is unassigned, so the journey continues to the
  // (now active) Assignments section instead of the all-complete handoff.
  await expect(
    page.locator("#wizard-next-action").getByRole("button", { name: "Next: Assignments" }),
  ).toBeVisible();
});

test("TS-34: two-TIN provider — both groups assigned, first primary; last-assignment removal blocked", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures({
    assignments: contactAssignments(ORG_SHELBY, "shelby"),
    provider_groups: [
      groupRow(ORG_SHELBY, "g-s1", "Shelby Sports Rehab LLC"),
      groupRow(ORG_SHELBY, "g-s2", "Shelby Performance Group LLC"),
    ],
  });
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
  await seedAuth(context, ORG_SHELBY);

  await page.goto("/onboarding/wizard");
  const card = page.locator("#wizard-providers");
  await card.getByRole("button", { name: "Add provider" }).click({ timeout: 30000 });
  const dialog = page.getByRole("dialog", { name: "Add provider" });
  await dialog.getByLabel("Assign Shelby Sports Rehab LLC").click();
  await dialog.getByLabel("Assign Shelby Performance Group LLC").click();
  await dialog.locator("#prov-first").fill("Quinn");
  await dialog.locator("#prov-last").fill("James");
  await dialog.locator("#prov-npi").fill("1093817465");
  await dialog.getByRole("button", { name: "Save provider" }).click();

  await expect(card).toContainText("Quinn James", { timeout: 15000 });
  // Roster row lists both groups, primary first (F1.3.2).
  await expect(card).toContainText("Shelby Sports Rehab LLC, Shelby Performance Group LLC");
  expect(fixtures.provider_group_assignments!.length).toBe(2);
  const primaries = (fixtures.provider_group_assignments as Array<{ is_primary: boolean }>).filter(
    (a) => a.is_primary,
  );
  expect(primaries.length).toBe(1);

  // E6.4: ongoing membership edits live on the RECORD (Groups & facilities).
  // Remove the non-primary group; the remaining PRIMARY chip carries no
  // remove affordance — the last assignment is structurally unremovable.
  await card.getByRole("link", { name: "Open record" }).click();
  await expect(page.getByRole("heading", { name: "Groups & facilities" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByLabel("Remove group Shelby Performance Group LLC").click();
  await expect.poll(() => fixtures.provider_group_assignments!.length).toBe(1);
  await expect(page.getByLabel(/Remove group/)).toHaveCount(0);
});

test("TS-35: PSV verify with board URL, then renewal edit resets to unverified", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures({
    assignments: contactAssignments(ORG_OUTER_BANKS, "outer-banks"),
    provider_groups: [groupRow(ORG_OUTER_BANKS, "g-ob", "Outer Banks Rehab Group LLC")],
    providers: [
      providerRow(ORG_OUTER_BANKS, "prov-ob", {
        group_id: "g-ob",
        first_name: "Brooke",
        last_name: "Ostrander",
        credentials: "PT, DPT",
        npi: "1093817465",
      }),
    ],
    provider_group_assignments: [
      {
        id: "ga-ob",
        org_id: ORG_OUTER_BANKS,
        provider_id: "prov-ob",
        group_id: "g-ob",
        is_primary: true,
        created_at: "2026-07-10T00:00:00Z",
      },
    ],
    state_licenses: [licenseRow(ORG_OUTER_BANKS, "lic-nc", "prov-ob")],
  });
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
  await seedAuth(context, ORG_OUTER_BANKS);

  // E6.4: license edits live on the RECORD's licenses-only dialog — an empty
  // provider patch, so identity fields and assignments are untouchable here.
  await page.goto("/providers/prov-ob");
  await expect(page.getByRole("heading", { name: "Licenses" })).toBeVisible({ timeout: 30000 });

  // Verify the NC license against the state board.
  await page.getByRole("button", { name: "Edit licenses" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit state licenses" });
  await expect(dialog.getByText("Unverified").first()).toBeVisible({ timeout: 15000 });
  await dialog.locator("#lic-0-url").fill("https://www.ncbpte.org/license-verification");
  await dialog.locator("#lic-0-psv").click();
  await page.getByRole("option", { name: "Verified", exact: true }).click();
  await dialog.getByRole("button", { name: "Save licenses" }).click();

  // The dialog closes only after the service write completes.
  await expect(page.getByRole("dialog", { name: "Edit state licenses" })).toHaveCount(0, {
    timeout: 15000,
  });
  const lic = fixtures.state_licenses![0] as Record<string, unknown>;
  await expect.poll(() => lic.verified_status).toBe("verified");
  expect(lic.verified_at).toBeTruthy();
  expect(lic.verification_source_url).toBe("https://www.ncbpte.org/license-verification");

  // Renewal: editing the expiration date resets the PSV trail.
  await page.getByRole("button", { name: "Edit licenses" }).click();
  const dialog2 = page.getByRole("dialog", { name: "Edit state licenses" });
  await expect(dialog2.getByText("Verified", { exact: true }).first()).toBeVisible({
    timeout: 15000,
  });
  await dialog2.locator("#lic-0-expiration").fill("2029-01-31");
  await expect(dialog2).toContainText("returns to Unverified on save");
  await dialog2.getByRole("button", { name: "Save licenses" }).click();

  await expect(page.getByRole("dialog", { name: "Edit state licenses" })).toHaveCount(0, {
    timeout: 15000,
  });
  await expect.poll(() => lic.verified_status).toBe("unverified");
  expect(lic.verified_at).toBeNull();
  expect(lic.expiration_date).toBe("2029-01-31");
});
