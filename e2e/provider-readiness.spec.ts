import { test, expect, type Route } from "@playwright/test";

// E1.8 TE-12 readiness-matrix coverage — relocated 2026-07-21 with the
// surface: the matrix lives on the PROVIDER RECORD's Readiness section now
// (user handoff — Scope Review left the org wizard), same derived logic:
//   TS-43 PSV flip drives readiness: an unverified NC license is a red item;
//         recording the state-board PSV (an outside edit on the SOURCE data —
//         readiness itself stores nothing) flips the check green on re-read.
//   TS-44 group/state gap + advisory behavior: Group 2 targets BCBS-NC with
//         no NC facility → group-owned "No NC facility" red item; a
//         130-day-stale CAQH is a red item carrying the attestation date;
//         nothing anywhere is disabled and no task is auto-created.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_OUTER_BANKS = "22222222-2222-4222-8222-222222222222";
const ORG_SHELBY = "33333333-3333-4333-8333-333333333333";

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
  states: ["NC"],
  is_active: true,
  created_at: "2026-07-10T00:00:00Z",
});

const facilityRow = (orgId: string, id: string, groupId: string, name: string, state: string) => ({
  id,
  org_id: orgId,
  group_id: groupId,
  name,
  street: "1 Main St",
  city: "Charlotte",
  state,
  zip: "28280",
  is_active: true,
  status_id: null,
  effective_date: null,
  reference_only: false,
  created_at: "2026-07-10T00:00:00Z",
});

// A provider whose PROVIDER checklist fully passes (facts fields present).
const readyProvider = (orgId: string, id: string, first: string, last: string) => ({
  id,
  org_id: orgId,
  first_name: first,
  last_name: last,
  credentials: "PT",
  npi: "1093817465",
  status: "onboarding",
  reference_only: false,
  home_state: "NC",
  specialty: "Physical Therapy",
  taxonomy_code: null,
  email: null,
  group_id: null,
  caqh_id: "16224897",
  caqh_last_attested_date: "2026-07-01",
  date_of_birth: "1990-01-01",
  ssn_last4: "1234",
  home_street: "4104 S Croatan Hwy",
  home_city: "Nags Head",
  home_zip: "27959",
  malpractice_coverage_end: "2027-12-31",
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
});

const groupDocs = (orgId: string, groupId: string) => [
  { id: `${groupId}-w9`, org_id: orgId, group_id: groupId, doc_type: "w9", expiration_date: null },
  {
    id: `${groupId}-coi`,
    org_id: orgId,
    group_id: groupId,
    doc_type: "coi",
    expiration_date: null,
  },
  {
    id: `${groupId}-vc`,
    org_id: orgId,
    group_id: groupId,
    doc_type: "voided_check",
    expiration_date: null,
  },
];

const payerRow = (id: string, name: string, states: string[]) => ({
  id,
  org_id: null,
  name,
  payer_kind: "commercial",
  states,
  aliases: [],
  status: "active",
  payer_slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  is_active: true,
  created_at: "2026-07-10T00:00:00Z",
});

function makeFixtures(over: Record<string, unknown[]>) {
  const orgs = [
    { id: ORG_OUTER_BANKS, name: "Outer Banks Rehab Group", lifecycle_state: "active" },
    { id: ORG_SHELBY, name: "Shelby Sports Rehab", lifecycle_state: "active" },
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
    party_role_assignments: [],
    provider_groups: [],
    facilities: [],
    providers: [],
    state_licenses: [],
    provider_group_assignments: [],
    provider_facility_assignments: [],
    payers: [],
    org_payer_assignments: [],
    payer_network_targets: [],
    provider_documents: [],
    group_insurance_policies: [],
    ...over,
  } as Record<string, unknown[]>;
}

function makeHandler(fixtures: Record<string, unknown[]>) {
  const writes: Array<{ table: string; method: string }> = [];
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.endsWith("/rpc/claim_invites")) return json(0);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

    if (req.method() !== "GET") {
      writes.push({ table, method: req.method() });
      const prefer = req.headers()["prefer"] ?? "";
      if (prefer.includes("return=representation")) return json(wantsObject ? {} : [{}]);
      return json(null, 201);
    }

    const matchFilters = (row: Record<string, unknown>): boolean => {
      for (const [key, raw] of url.searchParams.entries()) {
        if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(key)) continue;
        if (!(key in row)) continue;
        if (raw.startsWith("eq.")) {
          if (String(row[key]) !== raw.slice(3)) return false;
        } else if (raw.startsWith("in.(")) {
          const ids = raw
            .slice(4, -1)
            .split(",")
            .map((s) => s.replace(/^"|"$/g, ""));
          if (!ids.includes(String(row[key]))) return false;
        } else if (raw.startsWith("neq.")) {
          if (String(row[key]) === raw.slice(4)) return false;
        }
      }
      return true;
    };

    const rows = (fixtures[table] ?? []).filter((r) => matchFilters(r as Record<string, unknown>));
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  };
  return { handler, writes };
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

test("TS-43: recording the license PSV flips the readiness check — nothing stored", async ({
  context,
  page,
}) => {
  // Outer Banks: one group/provider/target, everything green EXCEPT the NC
  // license PSV (unverified).
  const license = {
    id: "lic-1",
    org_id: ORG_OUTER_BANKS,
    provider_id: "pr-1",
    state: "NC",
    license_number: "PT-48213",
    expiration_date: "2027-01-31",
    verified_status: "unverified",
  };
  const fixtures = makeFixtures({
    party_role_assignments: contactAssignments(ORG_OUTER_BANKS, "outer-banks"),
    provider_groups: [groupRow(ORG_OUTER_BANKS, "g-ob", "Outer Banks Rehab Group LLC")],
    facilities: [facilityRow(ORG_OUTER_BANKS, "f-ob", "g-ob", "Nags Head Clinic", "NC")],
    providers: [readyProvider(ORG_OUTER_BANKS, "pr-1", "Brooke", "Ostrander")],
    provider_group_assignments: [
      {
        id: "ga-1",
        org_id: ORG_OUTER_BANKS,
        provider_id: "pr-1",
        group_id: "g-ob",
        is_primary: true,
      },
    ],
    state_licenses: [license],
    payers: [payerRow("pay-bcbs", "Blue Cross and Blue Shield of North Carolina", ["NC"])],
    org_payer_assignments: [
      { id: "opa-1", org_id: ORG_OUTER_BANKS, payer_id: "pay-bcbs", starter: false },
    ],
    payer_network_targets: [
      {
        id: "pnt-1",
        org_id: ORG_OUTER_BANKS,
        payer_id: "pay-bcbs",
        group_id: "g-ob",
        state: "NC",
        status: "active",
        created_at: "2026-07-12T00:00:00Z",
      },
    ],
    provider_documents: groupDocs(ORG_OUTER_BANKS, "g-ob"),
  });
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_OUTER_BANKS);

  await page.goto("/providers/pr-1");
  // 2026-07-21 tabbed record: Readiness lives on the Cases tab.
  await page.getByRole("tab", { name: "Cases" }).click();
  const card = page.locator("#readiness");
  await expect(card).toContainText("0 of 1 ready", { timeout: 30000 });
  // Case-centric terminology: the generation entry is "Generate cases".
  await expect(card.getByRole("link", { name: "Generate cases" })).toBeVisible();

  // Drill in: exactly one red item — the unverified license — with its
  // fix-here anchor into the record's own Licenses section.
  await card.locator("tr", { hasText: "Blue Cross" }).first().click();
  await expect(card).toContainText("1 gap");
  await expect(card).toContainText("NC license board-verified");
  await expect(card).toContainText("PSV: unverified");
  await expect(card.getByRole("link", { name: "Fix in Licenses" })).toBeVisible();

  // Outside edit on the SOURCE row (the E1.3 roster PSV recording); the
  // readiness matrix re-derives on re-read — no readiness table exists to
  // write to, and this harness records zero writes of any kind.
  license.verified_status = "verified";
  await page.reload();
  await page.getByRole("tab", { name: "Cases" }).click();
  await expect(card).toContainText("Ready", { timeout: 30000 });
  await expect(card).toContainText("1 of 1 ready");
  expect(writes).toHaveLength(0);
});

test("TS-44: group state gap + stale CAQH stay advisory — nothing blocked, no tasks", async ({
  context,
  page,
}) => {
  // Shelby Group 2 targets BCBS-NC but only has a KS facility; the provider's
  // CAQH attestation is ~130 days old. Today is live, so the fixture derives
  // "130 days ago" instead of pinning a date.
  const stale = new Date(Date.now() - 130 * 86_400_000).toISOString().slice(0, 10);
  const fixtures = makeFixtures({
    party_role_assignments: contactAssignments(ORG_SHELBY, "shelby"),
    provider_groups: [groupRow(ORG_SHELBY, "g-2", "Shelby Performance Group LLC")],
    facilities: [facilityRow(ORG_SHELBY, "f-ks", "g-2", "Performance Wichita", "KS")],
    providers: [
      { ...readyProvider(ORG_SHELBY, "pr-q", "Quinn", "James"), caqh_last_attested_date: stale },
    ],
    provider_group_assignments: [
      { id: "ga-q", org_id: ORG_SHELBY, provider_id: "pr-q", group_id: "g-2", is_primary: true },
    ],
    state_licenses: [
      {
        id: "lic-q",
        org_id: ORG_SHELBY,
        provider_id: "pr-q",
        state: "NC",
        license_number: "PT-9",
        expiration_date: "2027-01-31",
        verified_status: "verified",
      },
    ],
    payers: [payerRow("pay-bcbs", "Blue Cross and Blue Shield of North Carolina", ["NC"])],
    org_payer_assignments: [
      { id: "opa-1", org_id: ORG_SHELBY, payer_id: "pay-bcbs", starter: false },
    ],
    payer_network_targets: [
      {
        id: "pnt-1",
        org_id: ORG_SHELBY,
        payer_id: "pay-bcbs",
        group_id: "g-2",
        state: "NC",
        status: "active",
        created_at: "2026-07-12T00:00:00Z",
      },
    ],
    provider_documents: groupDocs(ORG_SHELBY, "g-2"),
  });
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_SHELBY);

  await page.goto("/providers/pr-q");
  // 2026-07-21 tabbed record: Readiness lives on the Cases tab.
  await page.getByRole("tab", { name: "Cases" }).click();
  const card = page.locator("#readiness");
  await expect(card).toContainText("2 gaps", { timeout: 30000 });

  await card.locator("tr", { hasText: "Blue Cross" }).first().click();
  // Group checklist: the state-coverage gap, owned by the group, with its
  // fix-here anchor into the record's Groups & facilities section.
  await expect(card).toContainText("Group checklist");
  await expect(card).toContainText("No NC facility");
  await expect(card.getByRole("link", { name: "Fix in Groups & facilities" })).toBeVisible();
  // Provider checklist: the stale CAQH red item CARRIES the attestation date.
  await expect(card).toContainText(`Attested ${stale}`);

  // Advisory (F1.8.3): no disabled control anywhere in the section, and the
  // whole flow wrote nothing — no auto-created tasks, no readiness rows.
  expect(await card.locator("button[disabled], [aria-disabled='true']").count()).toBe(0);
  expect(writes.filter((w) => w.table === "tasks")).toHaveLength(0);
  expect(writes).toHaveLength(0);

  // The gap-type filter narrows to rows carrying that OPEN gap.
  await card.getByLabel("Filter by gap type").click();
  await page.getByRole("option", { name: "CAQH stale" }).click();
  await expect(card).toContainText("Blue Cross");
  await card.getByLabel("Filter by gap type").click();
  await page.getByRole("option", { name: "License not verified" }).click();
  await expect(card).toContainText("No rows match the current filters.");
});
