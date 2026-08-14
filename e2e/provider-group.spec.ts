import { test, expect, type Route } from "@playwright/test";

// E1.1 TE-10 — Provider Group entity coverage over the mock harness:
//   TS-29 Tree Hill single-group capture: form save → section Complete →
//         wizard-level "Next: Facilities" → Account Detail read-only summary
//   TS-30 Shelby second TIN via "Add another group": two active rows, the
//         section stays Complete, and there is no confirmation gate
// Soft-delete coverage: deactivating the only active group returns the
// section to Not started (resolver counts ACTIVE groups only).

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_TREE_HILL = "22222222-2222-4222-8222-222222222222";
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
  billing_suite: null,
  billing_city: null,
  billing_state: null,
  billing_zip: null,
  billing_contact_name: null,
  billing_phone: null,
  billing_fax: null,
  billing_email: null,
  correspondence_street: null,
  correspondence_suite: null,
  correspondence_city: null,
  correspondence_state: null,
  correspondence_zip: null,
  correspondence_contact_name: null,
  correspondence_phone: null,
  correspondence_fax: null,
  correspondence_email: null,
  credentialing_street: null,
  credentialing_suite: null,
  credentialing_city: null,
  credentialing_state: null,
  credentialing_zip: null,
  credentialing_contact_name: null,
  credentialing_phone: null,
  credentialing_fax: null,
  credentialing_email: null,
  website_url: null,
  ...over,
});

function makeFixtures(over: { provider_groups?: unknown[]; assignments?: unknown[] }) {
  const orgs = [
    { id: ORG_TREE_HILL, name: "Tree Hill Sports Therapy", lifecycle_state: "prospect" },
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
    party_role_assignments: over.assignments ?? [],
    provider_groups: over.provider_groups ?? [],
    group_insurance_policies: [],
    facilities: [],
    providers: [],
  } as Record<string, unknown[]>;
}

// Org- and id-filtered PostgREST mock with stateful provider_groups
// INSERT/UPDATE so the create → refetch → list round-trip is real.
function makeHandler(fixtures: Record<string, unknown[]>) {
  let groupSeq = 100;
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

    if (table === "provider_groups" && req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      const created = groupRow(String(body.org_id), `g-${groupSeq++}`, body);
      fixtures.provider_groups!.push(created);
      return json(wantsObject ? created : [created], 201);
    }
    if (table === "group_insurance_policies" && req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      const created = { id: `pol-${groupSeq++}`, notes: null, ...body };
      fixtures.group_insurance_policies!.push(created);
      return json(wantsObject ? created : [created], 201);
    }
    if (table === "provider_groups" && req.method() === "PATCH") {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      const id = idFilter?.startsWith("eq.") ? idFilter.slice(3) : null;
      const rows = fixtures.provider_groups as Record<string, unknown>[];
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

test("TS-29: single-group capture — save flips the section, dual-path exits, Groups summary", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures({
    assignments: contactAssignments(ORG_TREE_HILL, "tree-hill"),
  });
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
  await seedAuth(context, ORG_TREE_HILL);

  await page.goto("/onboarding/wizard");
  const groupCard = page.locator("#wizard-provider-group");
  await expect(groupCard).toContainText("Not started", { timeout: 30000 });

  // Open the entity form and fill the required set.
  await groupCard.getByRole("button", { name: "Add provider group" }).click();
  const dialog = page.getByRole("dialog", { name: "Add provider group" });
  await dialog.locator("#group-name").fill("Tree Hill Sports Therapy LLC");
  await dialog.locator("#group-tin").fill("123456789");
  await dialog.locator("#group-npi").fill("1234567890");
  await dialog.getByRole("button", { name: "Operating states" }).click();
  await page.getByRole("menuitemcheckbox", { name: "NC", exact: true }).click();
  await page.keyboard.press("Escape");
  await dialog.locator("#billing-street").fill("500 River Court");
  await dialog.locator("#billing-city").fill("Tree Hill");
  await dialog.locator("#billing-state").click();
  await page.getByRole("option", { name: "NC", exact: true }).click();
  await dialog.locator("#billing-zip").fill("27514");
  await dialog.locator("#group-website").fill("treehill.example.test");
  // The group form is high-level metadata ONLY (2026-07-29) — malpractice
  // coverage is captured in the group's own panel, below.
  await expect(dialog.getByText("Malpractice coverage")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Save provider group" }).click();

  // Derived progress: the section flips to Complete with the saved row listed
  // (TIN formatted XX-XXXXXXX) and "Add another group" available.
  await expect(groupCard).toContainText("Complete", { timeout: 15000 });
  await expect(groupCard).toContainText("Tree Hill Sports Therapy LLC");
  await expect(groupCard).toContainText("TIN 12-3456789");
  await expect(groupCard.getByRole("button", { name: "Add another group" })).toBeVisible();
  expect((fixtures.provider_groups![0] as { website_url: string | null }).website_url).toBe(
    "https://treehill.example.test",
  );

  // The wizard-level next action advances past the group section — and it is
  // the ONLY "Next: Facilities" CTA: the E1.1 inline section-body exit was
  // removed by user request (2026-07-19).
  await expect(page.getByRole("button", { name: "Next: Facilities" })).toHaveCount(1);
  await expect(groupCard.getByRole("button", { name: "Next: Facilities" })).toHaveCount(0);

  // Malpractice coverage is captured beside the group as a LIST, so the
  // primary policy and any secondary coverage can both be tracked. It writes
  // the group's professional_liability row (group_insurance_policies), never
  // provider columns.
  await groupCard.getByRole("button", { name: "Malpractice & insurance" }).click();
  await groupCard.getByRole("button", { name: "Add policy" }).click();
  const policyDialog = page.getByRole("dialog", { name: "Add policy" });
  await policyDialog.locator("#policy-insurer").fill("State Farm");
  await policyDialog.locator("#policy-number").fill("SF-12345");
  await policyDialog.locator("#policy-start").fill("2026-01-01");
  await policyDialog.locator("#policy-end").fill("2027-01-01");
  await policyDialog.getByRole("button", { name: "Create policy" }).click();
  await expect(policyDialog).toBeHidden();

  const policy = (fixtures.group_insurance_policies![0] ?? {}) as Record<string, unknown>;
  expect(policy.insurance_type).toBe("professional_liability");
  expect(policy.coverage_level).toBe("primary");
  expect(policy.insurer_name).toBe("State Farm");
  expect(policy.policy_number).toBe("SF-12345");
  expect(policy.policy_start_date).toBe("2026-01-01");
  expect(policy.policy_end_date).toBe("2027-01-01");
  expect(policy.group_id).toBe("g-100");

  // F1.1.3 (re-homed by E6.2 F6.2.1): the group facts live on the group hub —
  // a single-group org auto-lands there from /groups (zero extra clicks).
  await page.goto("/groups");
  await expect(page.getByRole("heading", { name: "Tree Hill Sports Therapy LLC" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole("heading", { name: "Group facts" })).toBeVisible();
  await expect(page.getByText("12-3456789")).toBeVisible();

  // Parity (2026-07-29): editing a group outside onboarding opens the SAME
  // full form, and the hub carries the same coverage surface.
  await expect(page.getByText("Malpractice & insurance")).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).first().click();
  const hubDialog = page.getByRole("dialog", { name: "Edit provider group" });
  await expect(hubDialog.locator("#group-npi")).toHaveValue("1234567890");
  await expect(hubDialog.locator("#billing-street")).toHaveValue("500 River Court");
});

test("TS-30: second TIN via Add another group — both rows listed, still Complete, no gate", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures({
    assignments: contactAssignments(ORG_SHELBY, "shelby"),
    provider_groups: [
      groupRow(ORG_SHELBY, "g-1", {
        name: "Shelby Sports Rehab LLC",
        tin: "987654321",
        states: ["TN"],
        billing_street: "1 Main St",
        billing_city: "Shelby",
        billing_state: "TN",
        billing_zip: "37160",
      }),
    ],
  });
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
  await seedAuth(context, ORG_SHELBY);

  await page.goto("/onboarding/wizard");
  const groupCard = page.locator("#wizard-provider-group");
  await expect(groupCard).toContainText("Complete", { timeout: 30000 });
  await expect(groupCard).toContainText("Shelby Sports Rehab LLC");

  await groupCard.getByRole("button", { name: "Add another group" }).click();
  const dialog = page.getByRole("dialog", { name: "Add provider group" });
  await dialog.locator("#group-name").fill("Shelby Performance Group LLC");
  await dialog.locator("#group-tin").fill("11-2233445");
  await dialog.getByRole("button", { name: "Operating states" }).click();
  await page.getByRole("menuitemcheckbox", { name: "TN", exact: true }).click();
  await page.keyboard.press("Escape");
  await dialog.locator("#billing-street").fill("2 Depot St");
  await dialog.locator("#billing-city").fill("Shelby");
  await dialog.locator("#billing-state").click();
  await page.getByRole("option", { name: "TN", exact: true }).click();
  await dialog.locator("#billing-zip").fill("37160");
  await dialog.getByRole("button", { name: "Save provider group" }).click();

  // Both active groups listed; section stays Complete; "Add another group"
  // persists (no "no more groups" confirmation gate anywhere).
  await expect(groupCard).toContainText("Shelby Performance Group LLC", { timeout: 15000 });
  await expect(groupCard).toContainText("Shelby Sports Rehab LLC");
  await expect(groupCard).toContainText("TIN 11-2233445");
  await expect(groupCard).toContainText("Complete");
  await expect(groupCard.getByRole("button", { name: "Add another group" })).toBeVisible();
});

test("soft delete: deactivating the only active group returns the section to Not started", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures({
    assignments: contactAssignments(ORG_SHELBY, "shelby"),
    provider_groups: [
      groupRow(ORG_SHELBY, "g-1", {
        name: "Shelby Sports Rehab LLC",
        tin: "987654321",
        states: ["TN"],
      }),
    ],
  });
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
  await seedAuth(context, ORG_SHELBY);

  await page.goto("/onboarding/wizard");
  const groupCard = page.locator("#wizard-provider-group");
  await expect(groupCard).toContainText("Complete", { timeout: 30000 });

  await groupCard.getByRole("button", { name: "Deactivate" }).click();
  await page
    .getByRole("dialog", { name: /Deactivate Shelby Sports Rehab LLC/ })
    .getByRole("button", { name: "Deactivate" })
    .click();

  // Soft delete only: the row survives (is_active=false) but the section is
  // derived from ACTIVE groups, so it returns to Not started.
  await expect(groupCard).toContainText("Not started", { timeout: 15000 });
  await expect(groupCard.getByRole("button", { name: "Add provider group" })).toBeVisible();
  const row = fixtures.provider_groups![0] as { is_active: boolean };
  expect(row.is_active).toBe(false);
});

// Bugfix regression (2026-07-19, user-reported): the Operating states menu is
// portaled outside the Add-provider-group Dialog while modal={false}, so the
// Dialog's scroll lock (react-remove-scroll) swallowed wheel events over it —
// the menu was geometrically scrollable but the wheel never moved it, leaving
// every state below the fold unreachable. StatesMultiSelect now owns the wheel
// event on the menu content; this pins that a wheel gesture really scrolls the
// internal region and the bottom of the list is reachable and clickable.
test("operating-states menu wheel-scrolls inside the dialog", async ({ context, page }) => {
  const fixtures = makeFixtures({
    assignments: contactAssignments(ORG_TREE_HILL, "tree-hill"),
  });
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures));
  await seedAuth(context, ORG_TREE_HILL);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/onboarding/wizard");
  const groupCard = page.locator("#wizard-provider-group");
  await groupCard.getByRole("button", { name: "Add provider group" }).click();
  const dialog = page.getByRole("dialog", { name: "Add provider group" });
  await dialog.getByRole("button", { name: "Operating states" }).click();
  const menu = page.getByRole("menu");
  await expect(page.getByRole("menuitemcheckbox", { name: "AL", exact: true })).toBeVisible();

  // A real wheel gesture over the menu must move its internal scroll region
  // (Playwright's auto scroll-into-view on click would mask the defect, so the
  // scrollTop assertion is the honest pin).
  const box = await menu.boundingBox();
  if (!box) throw new Error("menu not measurable");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 1600);
  await expect.poll(() => menu.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);

  // The bottom of the list is genuinely inside the visible menu box now.
  const wy = page.getByRole("menuitemcheckbox", { name: "WY", exact: true });
  await expect
    .poll(async () => {
      const r = await wy.boundingBox();
      const m = await menu.boundingBox();
      return r && m && r.y >= m.y && r.y + r.height <= m.y + m.height + 1 ? "inside" : "outside";
    })
    .toBe("inside");
  await wy.click();
  await expect(dialog.getByRole("button", { name: "Operating states" })).toContainText("WY");

  // Toggling the menu closed from its trigger leaves the dialog standing —
  // the modal={false} contract StatesMultiSelect documents.
  await dialog.getByRole("button", { name: "Operating states" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "WY", exact: true })).toBeHidden();
  await expect(dialog).toBeVisible();
});
