import { test, expect, type Page, type Route } from "@playwright/test";

// E1.2 TE-11 — Facilities wizard-section coverage over the mock harness:
//   TS-31 Tree Hill first facility: CAQH form save (address + state + group +
//         inherited group contact) → row linked to group → section Complete →
//         wizard next action advances to Providers → Account Detail summary
//   TS-32 Outer Banks hours: weekday quick-fill stores the locked jsonb shape
//         (Mon–Fri open 07:00–19:00, Sat/Sun closed) and a single-day
//         override afterward persists per-day
// Plus: close<=open validation blocks save.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_TREE_HILL = "22222222-2222-4222-8222-222222222222";
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

const groupRow = (orgId: string, id: string, over: Record<string, unknown> = {}) => ({
  id,
  org_id: orgId,
  name: "",
  tin: null,
  npi_type2: null,
  states: null,
  is_active: true,
  created_at: "2026-07-10T00:00:00Z",
  billing_street: null,
  billing_city: null,
  billing_state: null,
  billing_zip: null,
  billing_contact_name: null,
  billing_phone: null,
  billing_fax: null,
  billing_email: null,
  credentialing_contact_name: null,
  credentialing_phone: null,
  correspondence_phone: null,
  ...over,
});

const facilityRow = (orgId: string, id: string, over: Record<string, unknown> = {}) => ({
  id,
  org_id: orgId,
  group_id: null,
  name: "",
  street: null,
  suite: null,
  city: null,
  state: null,
  zip: null,
  county: null,
  phone: null,
  fax: null,
  email: null,
  appointment_phone: null,
  contact_name: null,
  accepting_new_patients: true,
  languages_offered: [],
  interpreter_languages: [],
  hours: {},
  ada_compliance: {},
  is_active: true,
  status_id: null,
  effective_date: null,
  reference_only: false,
  created_at: "2026-07-10T00:00:00Z",
  ...over,
});

function makeFixtures(over: {
  provider_groups?: unknown[];
  facilities?: unknown[];
  assignments?: unknown[];
}) {
  const orgs = [
    { id: ORG_TREE_HILL, name: "Tree Hill Sports Therapy", lifecycle_state: "prospect" },
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
    providers: [],
  } as Record<string, unknown[]>;
}

function makeHandler(fixtures: Record<string, unknown[]>) {
  let seq = 100;
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
    const idFilter = url.searchParams.get("id");
    const orgFilter = url.searchParams.get("org_id");

    if (table === "facilities" && req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      const created = facilityRow(String(body.org_id), `f-${seq++}`, body);
      fixtures.facilities!.push(created);
      return json(wantsObject ? created : [created], 201);
    }
    if (table === "facilities" && req.method() === "PATCH") {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      const id = idFilter?.startsWith("eq.") ? idFilter.slice(3) : null;
      const rows = fixtures.facilities as Record<string, unknown>[];
      const target = rows.find((r) => r.id === id);
      if (target) Object.assign(target, body);
      return json(wantsObject ? (target ?? {}) : [target ?? {}]);
    }
    if (req.method() === "POST" || req.method() === "PATCH") {
      const prefer = req.headers()["prefer"] ?? "";
      if (prefer.includes("return=representation")) return json(wantsObject ? {} : [{}]);
      return json(null, 201);
    }

    let rows = fixtures[table] ?? [];
    if (orgFilter?.startsWith("eq.")) {
      const orgId = orgFilter.slice(3);
      rows = rows.filter((r) => (r as { org_id?: string }).org_id === orgId);
    }
    if (idFilter?.startsWith("eq.")) {
      const id = idFilter.slice(3);
      rows = rows.filter((r) => (r as { id?: string }).id === id);
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

async function fillRequiredAddress(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  await dialog.locator("#facility-street").fill("500 River Court");
  await dialog.locator("#facility-city").fill("Tree Hill");
  await dialog.locator("#facility-state").click();
  await page.getByRole("option", { name: "NC", exact: true }).click();
  await dialog.locator("#facility-zip").fill("27514");
}

test("TS-31: first facility — inherited group contact, group link, Complete, Groups summary", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures({
    assignments: contactAssignments(ORG_TREE_HILL, "tree-hill"),
    provider_groups: [
      groupRow(ORG_TREE_HILL, "g-th", {
        name: "Tree Hill Sports Therapy LLC",
        tin: "123456789",
        states: ["NC"],
        // Group default contact: credentialing block wins the precedence.
        credentialing_contact_name: "Casey Credential",
        credentialing_phone: "919-555-0100",
        billing_phone: "919-555-0999",
      }),
    ],
  });
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
  await seedAuth(context, ORG_TREE_HILL);

  await page.goto("/onboarding/wizard");
  const card = page.locator("#wizard-facilities");
  await expect(card).toContainText("Not started", { timeout: 30000 });

  await card.getByRole("button", { name: "Add facility" }).click();
  const dialog = page.getByRole("dialog", { name: "Add facility" });
  await dialog.locator("#facility-name").fill("Tree Hill Riverfront Clinic");
  await dialog.locator("#facility-group").click();
  await page.getByRole("option", { name: "Tree Hill Sports Therapy LLC" }).click();
  await fillRequiredAddress(page, dialog);

  // TE-4: with no own contact typed, the group default is shown as inherited
  // (credentialing block wins) — and it satisfies the minimum-to-save rule.
  await expect(dialog).toContainText("Inherited from the group's credentialing contact");
  await expect(dialog).toContainText("Casey Credential");

  await dialog.getByRole("button", { name: "Save facility" }).click();

  await expect(card).toContainText("Complete", { timeout: 15000 });
  await expect(card).toContainText("Tree Hill Riverfront Clinic");
  await expect(card).toContainText("Tree Hill Sports Therapy LLC");
  await expect(card).toContainText("Inherited from group");

  // The facility row is linked to the group and its contact columns stay
  // null — inheritance is display-only, never a copy.
  const saved = fixtures.facilities![0] as Record<string, unknown>;
  expect(saved.group_id).toBe("g-th");
  expect(saved.phone).toBeNull();
  expect(saved.contact_name).toBeNull();

  // Wizard next action advances to Providers.
  await expect(
    page.locator("#wizard-next-action").getByRole("button", { name: "Next: Providers" }),
  ).toBeVisible();

  // F1.2.3 (re-homed by E6.2 F6.2.2): facilities live on the group's
  // Facilities area — /groups auto-lands the single group's hub.
  await page.goto("/groups");
  await expect(page.getByRole("link", { name: /Facilities/ })).toBeVisible({ timeout: 30000 });
  await page.getByRole("link", { name: /Facilities/ }).click();
  await expect(page.getByText("Tree Hill Riverfront Clinic")).toBeVisible({ timeout: 30000 });
});

test("TS-32: weekday quick-fill stores the locked shape; single-day override persists", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures({
    assignments: contactAssignments(ORG_OUTER_BANKS, "outer-banks"),
    provider_groups: [
      groupRow(ORG_OUTER_BANKS, "g-ob", {
        name: "Outer Banks Rehab Group LLC",
        tin: "987654321",
        states: ["NC"],
        billing_phone: "252-555-0100",
      }),
    ],
  });
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
  await seedAuth(context, ORG_OUTER_BANKS);

  await page.goto("/onboarding/wizard");
  const card = page.locator("#wizard-facilities");
  await card.getByRole("button", { name: "Add facility" }).click({ timeout: 30000 });
  const dialog = page.getByRole("dialog", { name: "Add facility" });
  await dialog.locator("#facility-name").fill("Kill Devil Hills Clinic");
  await dialog.locator("#facility-group").click();
  await page.getByRole("option", { name: "Outer Banks Rehab Group LLC" }).click();
  await fillRequiredAddress(page, dialog);

  // Quick-fill 07:00–19:00 across weekdays.
  await dialog.locator("#hours-default-open").fill("07:00");
  await dialog.locator("#hours-default-close").fill("19:00");
  await dialog.getByRole("button", { name: "Apply weekday default" }).click();

  // Single-day override afterward: Thursday 09:00–13:00.
  await dialog.getByLabel("Thursday opening time").fill("09:00");
  await dialog.getByLabel("Thursday closing time").fill("13:00");

  await dialog.getByRole("button", { name: "Save facility" }).click();
  await expect(card).toContainText("Complete", { timeout: 15000 });

  // The stored payload is exactly the locked jsonb contract.
  const saved = fixtures.facilities![0] as { hours: Record<string, unknown> };
  expect(saved.hours.mon).toEqual({ status: "open", open: "07:00", close: "19:00" });
  expect(saved.hours.wed).toEqual({ status: "open", open: "07:00", close: "19:00" });
  expect(saved.hours.thu).toEqual({ status: "open", open: "09:00", close: "13:00" });
  expect(saved.hours.sat).toEqual({ status: "closed" });
  expect(saved.hours.sun).toEqual({ status: "closed" });
});

test("hours validation: close must be after open — save is blocked", async ({ context, page }) => {
  const fixtures = makeFixtures({
    assignments: contactAssignments(ORG_OUTER_BANKS, "outer-banks"),
    provider_groups: [
      groupRow(ORG_OUTER_BANKS, "g-ob", {
        name: "Outer Banks Rehab Group LLC",
        billing_phone: "252-555-0100",
      }),
    ],
  });
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
  await seedAuth(context, ORG_OUTER_BANKS);

  await page.goto("/onboarding/wizard");
  const card = page.locator("#wizard-facilities");
  await card.getByRole("button", { name: "Add facility" }).click({ timeout: 30000 });
  const dialog = page.getByRole("dialog", { name: "Add facility" });
  await dialog.locator("#facility-name").fill("Backwards Hours Clinic");
  await dialog.locator("#facility-group").click();
  await page.getByRole("option", { name: "Outer Banks Rehab Group LLC" }).click();
  await fillRequiredAddress(page, dialog);

  await dialog.getByLabel("Monday open").click();
  await dialog.getByLabel("Monday opening time").fill("17:00");
  await dialog.getByLabel("Monday closing time").fill("09:00");
  await dialog.getByRole("button", { name: "Save facility" }).click();

  await expect(dialog).toContainText("Closing time must be after opening time");
  expect(fixtures.facilities!.length).toBe(0);
});
