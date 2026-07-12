import { test, expect, type Page, type Route } from "@playwright/test";

// E1.0 TE-10 — wizard scope-section coverage over the mock harness (CLAUDE.md
// recipe):
//   TS-25 fresh-org journey view: framework order, derived chips, disabled
//         "Coming next" previews (non-interactive, aria-disabled)
//   TS-26 derived progress from an outside edit: a facility added through the
//         existing admin facilities surface flips the wizard chip with zero
//         wizard writes (no stored progress flags)
//   TS-27 resume across org switch: "Next: Facilities" is derived, so it
//         survives the E0.0 org-switch state reset; the CTA moves keyboard
//         focus to the section heading
//   TS-28 all-complete state: the CTA hands off to the Assignments preview
// Plus the F1.0.4 shell sweep: approved white logo mark + rail text alphas.
// Fixture personas per seed-universe.md: Lone Star Rehab Group (partially
// scoped) and Outer Banks Rehab Group (TS-26 outside-edit org).

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_LONE_STAR = "22222222-2222-4222-8222-222222222222";
const ORG_OUTER_BANKS = "33333333-3333-4333-8333-333333333333";

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

// Complete owner + customer contact pair for an org (org-details = complete).
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
      phone_office: "512-555-0142",
      address_line1: "100 Congress Ave",
      city: "Austin",
      state: "TX",
      postal_code: "78701",
      country: "US",
    }),
  },
];

const providerGroup = (orgId: string, id: string, name: string) => ({
  id,
  org_id: orgId,
  name,
  tin: null,
  npi_type2: null,
  states: null,
  is_active: true,
  created_at: "2026-07-10T00:00:00Z",
});

const provider = (orgId: string, id: string, first: string, last: string) => ({
  id,
  org_id: orgId,
  first_name: first,
  last_name: last,
  credentials: "PT",
  npi: "1234567893",
  home_state: "TX",
  caqh_id: null,
  caqh_last_attested_date: null,
  taxonomy_code: null,
  status: "active",
  group_id: null,
  specialty: "Physical Therapy",
  email: null,
  reference_only: false,
  updated_at: "2026-07-10T00:00:00Z",
  created_at: "2026-07-10T00:00:00Z",
});

const facilityRow = (orgId: string, id: string, name: string) => ({
  id,
  org_id: orgId,
  group_id: null,
  name,
  street: null,
  city: null,
  state: null,
  zip: null,
  is_active: true,
  status_id: null,
  effective_date: null,
  reference_only: false,
  created_at: "2026-07-10T00:00:00Z",
});

interface FixtureOverrides {
  provider_groups?: unknown[];
  facilities?: unknown[];
  providers?: unknown[];
  party_role_assignments?: unknown[];
}

function makeFixtures(over: FixtureOverrides) {
  const orgs = [
    { id: ORG_LONE_STAR, name: "Lone Star Rehab Group", lifecycle_state: "active" },
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
    party_role_assignments: over.party_role_assignments ?? [],
    provider_groups: over.provider_groups ?? [],
    facilities: over.facilities ?? [],
    providers: over.providers ?? [],
  } as Record<string, unknown[]>;
}

// Org-scoped PostgREST mock: respects `org_id=eq.<id>` filters so switching
// orgs serves each org's own scope rows, and accepts facility INSERTs (the
// TS-26 outside edit) by appending to the fixture state.
function makeHandler(fixtures: Record<string, unknown[]>) {
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

    if (table === "facilities" && req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      const created = {
        ...facilityRow(String(body.org_id), `fac-${fixtures.facilities!.length + 1}`, ""),
        ...body,
      };
      fixtures.facilities!.push(created);
      return json(wantsObject ? created : [created], 201);
    }
    if (req.method() === "POST" || req.method() === "PATCH") {
      const prefer = req.headers()["prefer"] ?? "";
      if (prefer.includes("return=representation")) return json(wantsObject ? {} : [{}]);
      return json(null, 201);
    }

    let rows = fixtures[table] ?? [];
    const orgFilter = url.searchParams.get("org_id");
    if (orgFilter?.startsWith("eq.")) {
      const orgId = orgFilter.slice(3);
      rows = rows.filter((r) => (r as { org_id?: string }).org_id === orgId);
    }

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

function sectionCard(page: Page, domId: string) {
  return page.locator(`#${domId}`);
}

test("TS-25: fresh org shows the full journey — derived chips and disabled previews", async ({
  context,
  page,
}) => {
  // Tree Hill scenario: intake done (contacts complete), zero scope rows.
  const fixtures = makeFixtures({
    party_role_assignments: contactAssignments(ORG_LONE_STAR, "tree-hill"),
  });
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
  await seedAuth(context, ORG_LONE_STAR);

  await page.goto("/onboarding/wizard");
  await expect(page.getByRole("heading", { name: "Onboarding" })).toBeVisible({ timeout: 30000 });

  // Section order per the registry (F1.0.1).
  const headings = page.locator("main h2");
  await expect(headings).toHaveText([
    "Org details",
    "Provider Group",
    "Facilities",
    "Providers",
    "Assignments",
    "Payer Network",
    "Scope Review",
  ]);

  // Derived chips: org details complete, scope sections not started (F1.0.2).
  await expect(sectionCard(page, "wizard-org-details")).toContainText("Complete");
  await expect(sectionCard(page, "wizard-provider-group")).toContainText("Not started");
  await expect(sectionCard(page, "wizard-facilities")).toContainText("Not started");
  await expect(sectionCard(page, "wizard-providers")).toContainText("Not started");

  // Active sections render a start state with a real CTA (never NotYetAvailable).
  // E1.1 replaced the Provider Group start placeholder with the entity form
  // entry point (a button opening the form dialog).
  await expect(
    sectionCard(page, "wizard-provider-group").getByRole("button", {
      name: "Add provider group",
    }),
  ).toBeVisible();
  await expect(page.getByText("isn't available yet")).toHaveCount(0);

  // Previews: visible, labeled Coming next, aria-disabled, non-interactive.
  for (const domId of ["wizard-assignments", "wizard-payer-network", "wizard-scope-review"]) {
    const previewCard = sectionCard(page, domId);
    await expect(previewCard).toBeVisible();
    await expect(previewCard).toContainText("Coming next");
    await expect(previewCard).toHaveAttribute("aria-disabled", "true");
    await expect(previewCard.locator("a, button")).toHaveCount(0);
  }

  // Next action targets the first incomplete section (F1.0.3).
  await expect(page.getByRole("button", { name: "Next: Provider Group" })).toBeVisible();
});

test("TS-26: a facility added through the admin surface flips the wizard chip — zero wizard writes", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures({
    party_role_assignments: contactAssignments(ORG_OUTER_BANKS, "outer-banks"),
    provider_groups: [providerGroup(ORG_OUTER_BANKS, "g-ob", "Outer Banks Rehab Group")],
  });
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
  await seedAuth(context, ORG_OUTER_BANKS);

  await page.goto("/onboarding/wizard");
  await expect(sectionCard(page, "wizard-facilities")).toContainText("Not started", {
    timeout: 30000,
  });

  // Outside edit: the EXISTING admin facilities surface, not the wizard.
  await page.goto("/admin/settings");
  await page.getByRole("button", { name: "Add facility" }).click();
  const dialog = page.getByRole("dialog", { name: "Add facility" });
  // The Name field is the dialog's first input (its Label isn't htmlFor-linked).
  await dialog.locator("input").first().fill("Kill Devil Hills Clinic");
  await dialog.getByRole("button", { name: "Create facility" }).click();
  await expect(page.getByText("Facility created")).toBeVisible({ timeout: 15000 });

  // Reopen the wizard: the chip is derived from row presence (F1.0.2).
  await page.goto("/onboarding/wizard");
  await expect(sectionCard(page, "wizard-facilities")).toContainText("Complete", {
    timeout: 30000,
  });
  // E1.2: the section lists the facility rather than a count summary.
  await expect(sectionCard(page, "wizard-facilities")).toContainText("Kill Devil Hills Clinic");
});

test("TS-27: resume survives an org switch; the CTA moves focus to the section heading", async ({
  context,
  page,
}) => {
  // Lone Star: org details + provider group complete, nothing else.
  const fixtures = makeFixtures({
    party_role_assignments: [
      ...contactAssignments(ORG_LONE_STAR, "lone-star"),
      ...contactAssignments(ORG_OUTER_BANKS, "outer-banks"),
    ],
    provider_groups: [providerGroup(ORG_LONE_STAR, "g-ls", "Lone Star Rehab Group")],
  });
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
  await seedAuth(context, ORG_LONE_STAR);

  await page.goto("/onboarding/wizard");
  // .first(): E1.1's dual-path exit adds a second "Next: Facilities" inside
  // the Provider Group section; the top next-action card stays the resume CTA.
  await expect(page.getByRole("button", { name: "Next: Facilities" }).first()).toBeVisible({
    timeout: 30000,
  });

  // Switch away and back (E0.0 reset clears all query state).
  await page.getByRole("button", { name: /Switch organization/ }).click();
  await page.getByRole("menuitem", { name: "Outer Banks Rehab Group" }).click();
  await expect(page.getByRole("button", { name: "Next: Provider Group" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: /Switch organization/ }).click();
  await page.getByRole("menuitem", { name: "Lone Star Rehab Group" }).click();

  // Derived resume: still Facilities, no per-user storage involved (F1.0.3).
  const nextCta = page.getByRole("button", { name: "Next: Facilities" }).first();
  await expect(nextCta).toBeVisible({ timeout: 30000 });

  // One click opens the section and moves keyboard focus to its heading (TE-4).
  await nextCta.click();
  await expect(page.locator("#wizard-facilities-heading")).toBeFocused();
});

test("TS-28: all four sections complete hands off to the Assignments preview", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures({
    party_role_assignments: contactAssignments(ORG_LONE_STAR, "lone-star"),
    provider_groups: [providerGroup(ORG_LONE_STAR, "g-ls", "Lone Star Rehab Group")],
    facilities: [facilityRow(ORG_LONE_STAR, "f-ls", "Lone Star HQ")],
    providers: [provider(ORG_LONE_STAR, "pr-1", "Karen", "Filippelli")],
  });
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
  await seedAuth(context, ORG_LONE_STAR);

  await page.goto("/onboarding/wizard");
  await expect(page.getByText("All scope sections are complete.")).toBeVisible({
    timeout: 30000,
  });
  // The next-action card hands off to the preview — no CTA there. (E1.1's
  // section-level dual-path button may still render inside its own section.)
  await expect(page.locator("#wizard-next-action").getByRole("button")).toHaveCount(0);
});

test("F1.0.4: sidebar shows the approved white mark and conformed rail text alphas", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures({});
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
  await seedAuth(context, ORG_LONE_STAR);

  await page.goto("/onboarding/wizard");
  const logo = page.getByRole("img", { name: "Minted Panel" }).first();
  await expect(logo).toBeVisible({ timeout: 30000 });
  await expect(logo).toHaveAttribute("src", /logo-white/);

  // Rail text conformance (TE-8 semantic white-alpha values, not a blanket
  // brightening): section headings white/35, inactive nav items white/60.
  // .first() — the Sidebar renders in both the desktop rail and mobile drawer.
  // Tailwind v4 computes white-alpha as oklab(…white… / alpha) — assert the
  // white channel and the exact alpha.
  const sectionLabel = page.locator("aside").getByText("Workspace", { exact: true }).first();
  await expect(sectionLabel).toHaveCSS("color", /^oklab\(0\.99\d* [\d.e-]+ [\d.e-]+ \/ 0\.35\)$/);
  const inactiveNav = page.locator("aside").getByRole("link", { name: "Payer Management" }).first();
  await expect(inactiveNav).toHaveCSS("color", /^oklab\(0\.99\d* [\d.e-]+ [\d.e-]+ \/ 0\.6\)$/);

  // E0.9 TS-24 focus-ring conformance not regressed: white-alpha outline on
  // keyboard focus.
  await inactiveNav.focus();
  await expect(inactiveNav).toHaveCSS("outline-color", "rgba(255, 255, 255, 0.35)");
});
