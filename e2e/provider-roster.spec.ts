import {
  test,
  expect,
  type Route,
  type Page,
  type BrowserContext,
} from "./fixtures/legacy-access-context";

// E1.3 TE-10 — Provider Roster coverage over the mock harness:
//   TS-33 Tree Hill first provider: CAQH baseline + required group
//         assignment → providers + provider_group_assignments rows →
//         section Complete → wizard all-complete preview
//   TS-34 Shelby two-TIN provider: assigned to both groups (first primary)
//         → two assignment rows, roster lists both groups; removing the
//         last assignment is blocked
//   TS-35 Outer Banks PSV trail: record the NC board URL + mark verified
//         (stamped), then edit the expiration date → back to unverified;
//         add a second license as Verified with a blank board URL

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
  const STATEFUL = new Set([
    "providers",
    "state_licenses",
    "provider_group_assignments",
    "audit_log",
  ]);
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
        } else if (raw === "is.null") {
          if (row[key] !== null) return false;
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
        ...(table === "state_licenses"
          ? {
              status: "active",
              verified_status: "unverified",
              verified_at: null,
              verified_by: null,
              verification_source_url: null,
            }
          : {}),
        id: `${table}-${seq++}`,
        created_at: "2026-07-12T00:00:00Z",
        ...r,
      }));
      fixtures[table]!.push(...created);
      return json(wantsObject ? created[0] : created, 201);
    }
    if (STATEFUL.has(table) && req.method() === "PATCH") {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      // Real PostgREST matches ZERO rows on an empty PATCH body — mirror it
      // so an accidental empty providers patch 406s here exactly like
      // production did (the 2026-07-21 licenses save failure).
      if (Object.keys(body).length === 0)
        return wantsObject ? json({ code: "PGRST116", message: "no rows" }, 406) : json([]);
      const targets = (fixtures[table] as Record<string, unknown>[]).filter(matchFilters);
      for (const t of targets) Object.assign(t, body);
      if (wantsObject && targets.length !== 1)
        return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(wantsObject ? targets[0] : targets);
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
  // 2026-07-21 tabbed record: group memberships live on the Groups & facilities tab.
  await page.getByRole("tab", { name: "Groups & facilities" }).click();
  await expect(page.getByRole("heading", { name: "Groups & facilities" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByLabel("Remove group Shelby Performance Group LLC").click();
  await expect.poll(() => fixtures.provider_group_assignments!.length).toBe(1);
  await expect(page.getByLabel(/Remove group/)).toHaveCount(0);
});

test("TS-35: per-row license editing — PSV verify with board URL, renewal reset, add verified with blank URL, remove; ZERO providers PATCHes", async ({
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
  const handler = makeHandler(fixtures);
  // 2026-07-21 regression pin: license saves must NEVER touch the providers
  // table — the old empty PATCH matched zero rows and 406'd on production
  // PostgREST ("Could not save licenses."). Record every providers PATCH.
  const providerPatches: string[] = [];
  await context.route(/\/(rest|auth)\/v1\//, async (route) => {
    const req = route.request();
    if (req.method() === "PATCH" && new URL(req.url()).pathname.endsWith("/rest/v1/providers"))
      providerPatches.push(req.url());
    return handler(route);
  });
  await seedAuth(context, ORG_OUTER_BANKS);

  // 2026-07-21: license edits live on per-row Edit/Remove + "+ Add license"
  // (the standard record pattern) — each save composes the full list through
  // the licenses-only sync; identity fields and assignments are untouchable.
  await page.goto("/providers/prov-ob");
  // 2026-07-21 tabbed record: licenses live on the Licenses tab.
  await page.getByRole("tab", { name: "Licenses" }).click();
  await expect(page.getByRole("heading", { name: "Licenses" })).toBeVisible({ timeout: 30000 });

  // Verify the NC license against the state board (row Edit → dialog).
  await page.getByRole("button", { name: "Edit NC license" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit license" });
  await dialog.locator("#license-url").fill("https://www.ncbpte.org/license-verification");
  await dialog.locator("#license-psv").click();
  await page.getByRole("option", { name: "Verified", exact: true }).click();
  await dialog.getByRole("button", { name: "Save license" }).click();

  // The dialog closes only after the service write completes.
  await expect(page.getByRole("dialog", { name: "Edit license" })).toHaveCount(0, {
    timeout: 15000,
  });
  const lic = fixtures.state_licenses![0] as Record<string, unknown>;
  await expect.poll(() => lic.verified_status).toBe("verified");
  expect(lic.verified_at).toBeTruthy();
  expect(lic.verification_source_url).toBe("https://www.ncbpte.org/license-verification");

  // Renewal: editing the expiration date resets the PSV trail.
  await page.getByRole("button", { name: "Edit NC license" }).click();
  const dialog2 = page.getByRole("dialog", { name: "Edit license" });
  await dialog2.locator("#license-expires").fill("2029-01-31");
  await expect(dialog2).toContainText("returns to Unverified on save");
  await dialog2.getByRole("button", { name: "Save license" }).click();

  await expect(page.getByRole("dialog", { name: "Edit license" })).toHaveCount(0, {
    timeout: 15000,
  });
  await expect.poll(() => lic.verified_status).toBe("unverified");
  expect(lic.verified_at).toBeNull();
  expect(lic.expiration_date).toBe("2029-01-31");

  // Add a second license as Verified with a BLANK state-board URL — the URL
  // is optional even when recording Verified (email / other source). The
  // save must succeed, stamp the trail, and leave the NC row untouched.
  await page.getByRole("button", { name: "+ Add license" }).click();
  const addDialog = page.getByRole("dialog", { name: "Add license" });
  await addDialog.locator("#license-state").click();
  await page.getByRole("option", { name: "AZ", exact: true }).click();
  await addDialog.locator("#license-number").fill("5678");
  await addDialog.locator("#license-psv").click();
  await page.getByRole("option", { name: "Verified", exact: true }).click();
  await expect(addDialog).not.toContainText("requires the state board URL");
  await addDialog.getByRole("button", { name: "Add license" }).click();
  await expect(page.getByRole("dialog", { name: "Add license" })).toHaveCount(0, {
    timeout: 15000,
  });
  await expect.poll(() => fixtures.state_licenses!.length).toBe(2);
  const added = (fixtures.state_licenses as Record<string, unknown>[]).find(
    (l) => l.state === "AZ",
  )!;
  expect(added.license_number).toBe("5678");
  expect(added.verified_status).toBe("verified");
  expect(added.verified_at).toBeTruthy();
  expect(added.verification_source_url).toBeNull();
  expect(lic.expiration_date).toBe("2029-01-31");
  await expect(page.getByRole("row", { name: /AZ/ })).toBeVisible({ timeout: 15000 });

  // Remove the AZ license (row Remove → confirm) — a real row delete.
  await page.getByRole("button", { name: "Remove AZ license" }).click();
  await page.getByRole("button", { name: "Remove license" }).click();
  await expect.poll(() => fixtures.state_licenses!.length).toBe(1);
  expect((fixtures.state_licenses![0] as Record<string, unknown>).state).toBe("NC");

  // The regression pin: not one PATCH ever hit the providers table.
  expect(providerPatches).toEqual([]);
});

for (const initialRead of ["failed", "loading"] as const) {
  test(`P03: ${initialRead} initial license lookup preserves two stored licenses when adding a third`, async ({
    context,
    page,
  }) => {
    const originals = [
      licenseRow(ORG_OUTER_BANKS, "lic-nc", "prov-ob"),
      licenseRow(ORG_OUTER_BANKS, "lic-sc", "prov-ob", {
        state: "SC",
        license_number: "SC-200",
      }),
    ];
    const fixtures = makeFixtures({
      providers: [
        providerRow(ORG_OUTER_BANKS, "prov-ob", {
          first_name: "Brooke",
          last_name: "Ostrander",
          npi: "1093817465",
        }),
      ],
      state_licenses: structuredClone(originals),
    });
    const handler = makeHandler(fixtures);
    const pendingReads: Route[] = [];
    let initialLookupRecovered = false;
    await context.route(/\/(rest|auth)\/v1\//, async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === "POST" && url.pathname.endsWith("/state_licenses")) {
        await handler(route);
        initialLookupRecovered = true;
        return;
      }
      if (
        !initialLookupRecovered &&
        req.method() === "GET" &&
        url.pathname.endsWith("/state_licenses") &&
        url.searchParams.has("provider_id") &&
        url.searchParams.has("order")
      ) {
        if (initialRead === "loading") {
          pendingReads.push(route);
          return;
        }
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ message: "Synthetic license lookup unavailable" }),
        });
      }
      return handler(route);
    });
    await seedAuth(context, ORG_OUTER_BANKS);
    await page.goto("/providers/prov-ob#licenses");
    // Let the baseline reach the destructive save: its false-empty display is
    // recorded here, then rejected only after checking persisted rows below.
    const expectedStatus =
      initialRead === "loading" ? "Loading licenses…" : "Could not load licenses.";
    await expect(page.locator("#licenses")).toContainText(
      initialRead === "loading"
        ? /Loading licenses…|No state licenses recorded\./
        : /Could not load licenses\.|No state licenses recorded\./,
      { timeout: 15000 },
    );
    const initialReadDisplay = await page.locator("#licenses").innerText();
    await page.getByRole("button", { name: "+ Add license" }).click();
    const dialog = page.getByRole("dialog", { name: "Add license" });
    await dialog.locator("#license-state").click();
    await page.getByRole("option", { name: "AZ", exact: true }).click();
    await dialog.locator("#license-number").fill("AZ-300");
    await dialog.getByRole("button", { name: "Add license", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(fixtures.state_licenses).toHaveLength(3);
    expect(fixtures.state_licenses).toEqual(expect.arrayContaining(originals));
    expect(initialReadDisplay).toContain(expectedStatus);
    expect(initialReadDisplay).not.toContain("No state licenses recorded.");
    for (const route of pendingReads) await route.abort();
  });
}

function p03Fixtures() {
  const groups = ["NC", "SC", "AZ"].map((state, index) => ({
    ...groupRow(ORG_OUTER_BANKS, `g-${state}`, `Synthetic ${state} Group`),
    npi_type2: `200000000${index}`,
    states: [state],
  }));
  return makeFixtures({
    provider_groups: groups,
    providers: [
      providerRow(ORG_OUTER_BANKS, "prov-ob", {
        group_id: "g-NC",
        first_name: "Brooke",
        last_name: "Ostrander",
        npi: "1093817465",
      }),
    ],
    provider_group_assignments: groups.map((group, index) => ({
      id: `ga-${index}`,
      org_id: ORG_OUTER_BANKS,
      provider_id: "prov-ob",
      group_id: group.id,
      is_primary: index === 0,
      created_at: "2026-07-10T00:00:00Z",
    })),
    state_licenses: ["NC", "SC", "AZ"].map((state, index) =>
      licenseRow(ORG_OUTER_BANKS, `lic-${state.toLowerCase()}`, "prov-ob", {
        state,
        license_number: `${state}-${index + 1}00`,
      }),
    ),
  });
}

function licenseFixture(fixtures: Record<string, unknown[]>, id: string) {
  const row = (fixtures.state_licenses as Record<string, unknown>[]).find((r) => r.id === id);
  if (!row) throw new Error(`Missing synthetic license ${id}`);
  return row;
}

async function openP03Record(context: BrowserContext, page: Page) {
  await seedAuth(context, ORG_OUTER_BANKS);
  await page.goto("/providers/prov-ob#licenses");
  await expect(page.getByRole("button", { name: "Edit NC license" })).toBeVisible();
}

async function openP03Roster(context: BrowserContext, page: Page) {
  await seedAuth(context, ORG_OUTER_BANKS);
  await page.route("**/__p03-roster", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><div id="p03-roster"></div>
        <script type="module">
          import RefreshRuntime from '/@react-refresh';
          RefreshRuntime.injectIntoGlobalHook(window);
          window.$RefreshReg$ = () => {};
          window.$RefreshSig$ = () => (type) => type;
          window.__vite_plugin_react_preamble_installed__ = true;
        </script>
        <script type="module" src="/e2e/fixtures/p03-roster.tsx"></script>
      </body></html>`,
    }),
  );
  await page.goto("/__p03-roster");
  return page.getByRole("dialog", { name: "Edit provider", exact: true });
}

test("P03: loaded empty is distinct and adding the first license persists its values", async ({
  context,
  page,
}) => {
  const fixtures = p03Fixtures();
  fixtures.state_licenses = [];
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
  await seedAuth(context, ORG_OUTER_BANKS);
  await page.goto("/providers/prov-ob#licenses");
  await expect(page.getByText("No state licenses recorded.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "+ Add license" }).click();
  const dialog = page.getByRole("dialog", { name: "Add license" });
  await dialog.locator("#license-state").click();
  await page.getByRole("option", { name: "NC", exact: true }).click();
  await dialog.locator("#license-number").fill("NC-FIRST");
  await dialog.getByRole("button", { name: "Add license", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(fixtures.state_licenses).toHaveLength(1);
  expect(fixtures.state_licenses[0]).toMatchObject({ state: "NC", license_number: "NC-FIRST" });
  await expect(page.getByText("No state licenses recorded.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /NC-FIRST/ })).toBeVisible();
});

test("P03: one provider in three groups preserves unrelated concurrent licenses during edit and explicit removal", async ({
  context,
  page,
}) => {
  const fixtures = p03Fixtures();
  const providerBefore = structuredClone(fixtures.providers);
  const groupsBefore = structuredClone(fixtures.provider_groups);
  const assignmentsBefore = structuredClone(fixtures.provider_group_assignments);
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
  await openP03Record(context, page);
  await page.getByRole("button", { name: "Edit NC license" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit license" });
  licenseFixture(fixtures, "lic-sc").license_number = "SC-CONCURRENT";
  const concurrent = licenseRow(ORG_OUTER_BANKS, "lic-co", "prov-ob", {
    state: "CO",
    license_number: "CO-CONCURRENT",
  });
  fixtures.state_licenses.push(concurrent);
  const unrelatedBefore = structuredClone(fixtures.state_licenses.slice(1));
  await dialog.locator("#license-number").fill("NC-EDITED");
  await dialog.getByRole("button", { name: "Save license" }).click();
  await expect(dialog).toHaveCount(0);
  expect(licenseFixture(fixtures, "lic-nc").license_number).toBe("NC-EDITED");
  expect(fixtures.state_licenses.slice(1)).toEqual(unrelatedBefore);
  await page.getByRole("button", { name: "Remove AZ license" }).click();
  await page.getByRole("button", { name: "Remove license", exact: true }).click();
  await expect.poll(() => fixtures.state_licenses.length).toBe(3);
  expect(fixtures.state_licenses.map((r) => (r as Record<string, unknown>).id)).toEqual([
    "lic-nc",
    "lic-sc",
    "lic-co",
  ]);
  await page.getByRole("button", { name: "+ Add license" }).click();
  const addDialog = page.getByRole("dialog", { name: "Add license" });
  await addDialog.locator("#license-state").click();
  await page.getByRole("option", { name: "AZ", exact: true }).click();
  await addDialog.locator("#license-number").fill("AZ-300");
  await addDialog.getByRole("button", { name: "Add license", exact: true }).click();
  await expect(addDialog).toHaveCount(0);
  expect(fixtures.state_licenses).toHaveLength(4);
  expect(licenseFixture(fixtures, "lic-sc").license_number).toBe("SC-CONCURRENT");
  expect(licenseFixture(fixtures, "lic-co")).toEqual(concurrent);
  expect(fixtures.providers).toEqual(providerBefore);
  expect(fixtures.provider_groups).toEqual(groupsBefore);
  expect(fixtures.provider_group_assignments).toEqual(assignmentsBefore);
  expect(fixtures.audit_log).toHaveLength(3);
});

for (const race of ["changed", "deleted"] as const) {
  test(`P03: ${race} target rejects stale edit without replacing other licenses`, async ({
    context,
    page,
  }) => {
    const fixtures = p03Fixtures();
    await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
    await openP03Record(context, page);
    await page.getByRole("button", { name: "Edit NC license" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit license" });
    await dialog.locator("#license-number").fill("NC-STALE");
    if (race === "changed") licenseFixture(fixtures, "lic-nc").license_number = "NC-CURRENT";
    else
      fixtures.state_licenses = fixtures.state_licenses.filter(
        (r) => (r as { id: string }).id !== "lic-nc",
      );
    const storedBefore = structuredClone(fixtures.state_licenses);
    await dialog.getByRole("button", { name: "Save license" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    expect(fixtures.state_licenses).toEqual(storedBefore);
    expect(fixtures.audit_log).toEqual([]);
    await expect(page.getByText("License saved.", { exact: true })).toHaveCount(0);
  });
}

test("P03: service read failure performs no writes and reports an error", async ({
  context,
  page,
}) => {
  const fixtures = p03Fixtures();
  const storedBefore = structuredClone(fixtures);
  const handler = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() === "GET" &&
      url.pathname.endsWith("/state_licenses") &&
      url.searchParams.has("provider_id") &&
      !url.searchParams.has("order")
    )
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic required read failed" }),
      });
    return handler(route);
  });
  await openP03Record(context, page);
  await page.getByRole("button", { name: "Edit NC license" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit license" });
  await dialog.locator("#license-number").fill("NC-UNSAVED");
  await dialog.getByRole("button", { name: "Save license" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(fixtures).toEqual(storedBefore);
  await expect(page.getByText("License saved.", { exact: true })).toHaveCount(0);
});

test("P03: failed write blocks blind retry until persisted data reloads", async ({
  context,
  page,
}) => {
  const fixtures = p03Fixtures();
  const storedBefore = structuredClone(fixtures.state_licenses);
  const handler = makeHandler(fixtures);
  let attempts = 0;
  await context.route(/\/(rest|auth)\/v1\//, (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "PATCH" && url.pathname.endsWith("/state_licenses")) {
      attempts += 1;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic write failed" }),
      });
    }
    return handler(route);
  });
  await openP03Record(context, page);
  await page.getByRole("button", { name: "Edit NC license" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit license" });
  await dialog.locator("#license-number").fill("NC-UNSAVED");
  await dialog.getByRole("button", { name: "Save license" }).click();
  await expect(dialog.getByRole("button", { name: "Save license" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Reload saved data" })).toBeVisible();
  expect(fixtures.state_licenses).toEqual(storedBefore);
  expect(attempts).toBe(1);
  await expect(page.getByText("License saved.", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Reload saved data" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("row", { name: /NC-100/ })).toBeVisible();
});

test("P03: roster editor keeps its original target snapshot across a background refresh", async ({
  context,
  page,
}) => {
  const fixtures = p03Fixtures();
  const handler = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  const dialog = await openP03Roster(context, page);
  await expect(dialog.locator("#lic-0-number")).toHaveValue("NC-100");
  await dialog.locator("#lic-0-number").fill("NC-STALE");
  licenseFixture(fixtures, "lic-nc").license_number = "NC-CURRENT";
  const refreshed = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/state_licenses") && url.searchParams.has("order");
  });
  await page
    .locator("button")
    .filter({ hasText: "Refresh fixture queries" })
    .evaluate((element: HTMLButtonElement) => element.click());
  await refreshed;
  await expect(dialog.locator("#lic-0-number")).toHaveValue("NC-STALE");
  const storedBefore = structuredClone(fixtures);
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("button", { name: "Reload saved data" })).toBeVisible();
  expect(fixtures).toEqual(storedBefore);
  await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();
});

test("P03: roster edit writes only dirty targets and explicit removals", async ({
  context,
  page,
}) => {
  const fixtures = p03Fixtures();
  licenseFixture(fixtures, "lic-sc").license_type = null;
  const handler = makeHandler(fixtures);
  const licenseWrites: string[] = [];
  await context.route(/\/(rest|auth)\/v1\//, (route) => {
    const req = route.request();
    if (
      ["PATCH", "DELETE"].includes(req.method()) &&
      new URL(req.url()).pathname.endsWith("/state_licenses")
    )
      licenseWrites.push(req.url());
    return handler(route);
  });
  const dialog = await openP03Roster(context, page);
  await expect(dialog.locator("#lic-0-number")).toHaveValue("NC-100");
  await dialog.locator("#lic-0-number").fill("NC-EDITED");
  await dialog.getByRole("button", { name: "Remove license 3", exact: true }).click();
  licenseFixture(fixtures, "lic-sc").license_number = "SC-CONCURRENT";
  const scBefore = structuredClone(licenseFixture(fixtures, "lic-sc"));
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
  expect(fixtures.state_licenses).toHaveLength(2);
  expect(licenseFixture(fixtures, "lic-nc").license_number).toBe("NC-EDITED");
  expect(licenseFixture(fixtures, "lic-sc")).toEqual(scBefore);
  expect(licenseWrites).toHaveLength(2);
  expect(licenseWrites.every((url) => !url.includes("id=eq.lic-sc"))).toBe(true);
  expect(fixtures.provider_group_assignments).toHaveLength(3);
});

test("P03: partial roster save reloads stored values before any retry", async ({
  context,
  page,
}) => {
  const fixtures = p03Fixtures();
  const handler = makeHandler(fixtures);
  let attempts = 0;
  let failedWrite = false;
  let failRefresh = true;
  await context.route(/\/(rest|auth)\/v1\//, (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "PATCH" && url.pathname.endsWith("/state_licenses")) {
      attempts += 1;
      if (url.searchParams.get("id") === "eq.lic-sc") {
        failedWrite = true;
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "Synthetic second write failed" }),
        });
      }
    }
    if (
      failedWrite &&
      failRefresh &&
      route.request().method() === "GET" &&
      url.pathname.endsWith("/state_licenses") &&
      url.searchParams.has("order")
    ) {
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic partial-save refresh failed" }),
      });
    }
    return handler(route);
  });
  const dialog = await openP03Roster(context, page);
  await expect(dialog.locator("#lic-0-number")).toHaveValue("NC-100");
  await dialog.locator("#lic-0-number").fill("NC-SAVED");
  await dialog.locator("#lic-1-number").fill("SC-UNSAVED");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("button", { name: "Reload saved data" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(licenseFixture(fixtures, "lic-nc").license_number).toBe("NC-SAVED");
  expect(licenseFixture(fixtures, "lic-sc").license_number).toBe("SC-200");
  expect(attempts).toBe(2);
  await expect(page.getByText("Provider updated", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Reload saved data" }).click();
  await expect(dialog).toContainText("Could not reload saved data. Try again.");
  await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(attempts).toBe(2);
  failRefresh = false;
  await dialog.getByRole("button", { name: "Reload saved data" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Open roster editor" }).click();
  await expect(dialog.locator("#lic-0-number")).toHaveValue("NC-SAVED");
  await expect(dialog.locator("#lic-1-number")).toHaveValue("SC-200");
  expect(attempts).toBe(2);
});

test("P03: roster initial lookup failure shows error and successful empty retry opens the editor", async ({
  context,
  page,
}) => {
  const fixtures = p03Fixtures();
  fixtures.state_licenses = [];
  const handler = makeHandler(fixtures);
  let failLookup = true;
  await context.route(/\/(rest|auth)\/v1\//, (route) => {
    const url = new URL(route.request().url());
    if (
      failLookup &&
      route.request().method() === "GET" &&
      url.pathname.endsWith("/state_licenses") &&
      url.searchParams.has("order")
    )
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic initial lookup failed" }),
      });
    return handler(route);
  });
  const dialog = await openP03Roster(context, page);
  await expect(dialog.getByText("Could not load provider data.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  failLookup = false;
  await dialog.getByRole("button", { name: "Retry provider data" }).click();
  await expect(dialog.getByRole("button", { name: "Save changes" })).toBeVisible();
  await expect(dialog.locator("#lic-0-number")).toHaveCount(0);
  expect(fixtures.state_licenses).toEqual([]);
});

test("P03: a saved add with failed cache refresh requires reload and never repeats the insert", async ({
  context,
  page,
}) => {
  const fixtures = p03Fixtures();
  const originals = structuredClone(fixtures.state_licenses);
  const handler = makeHandler(fixtures);
  let added = false;
  let failRefresh = true;
  let insertAttempts = 0;
  await context.route(/\/(rest|auth)\/v1\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "POST" && url.pathname.endsWith("/state_licenses")) {
      insertAttempts += 1;
      added = true;
    }
    if (
      added &&
      failRefresh &&
      req.method() === "GET" &&
      url.pathname.endsWith("/state_licenses") &&
      url.searchParams.has("order")
    ) {
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "Synthetic refresh failed after persistence" }),
      });
    }
    return handler(route);
  });
  await openP03Record(context, page);
  await page.getByRole("button", { name: "+ Add license" }).click();
  const dialog = page.getByRole("dialog", { name: "Add license" });
  await dialog.locator("#license-state").click();
  await page.getByRole("option", { name: "CO", exact: true }).click();
  await dialog.locator("#license-number").fill("CO-SAVED");
  await dialog.getByRole("button", { name: "Add license", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Reload saved data" })).toBeVisible({
    timeout: 15000,
  });
  await expect(dialog.getByRole("button", { name: "Add license", exact: true })).toBeDisabled();
  await expect(page.locator("#licenses")).toContainText("Could not load licenses.");
  await expect(page.locator("#licenses")).not.toContainText("No state licenses recorded.");
  expect(fixtures.state_licenses).toHaveLength(4);
  expect(fixtures.state_licenses).toEqual(expect.arrayContaining(originals));
  expect(insertAttempts).toBe(1);
  await expect(page.getByText("License added.", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Reload saved data" }).click();
  await expect(dialog).toContainText("Could not reload saved data. Try again.", { timeout: 15000 });
  await expect(dialog.getByRole("button", { name: "Add license", exact: true })).toBeDisabled();
  failRefresh = false;
  await dialog.getByRole("button", { name: "Reload saved data" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("row", { name: /CO-SAVED/ })).toBeVisible();
  expect(insertAttempts).toBe(1);
});
