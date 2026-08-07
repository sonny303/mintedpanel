import { test, expect, type Route } from "@playwright/test";

// E1.5 TE-8 — Payer Network wizard-section coverage over the mock harness:
//   TS-41 curated attach + expansion (Shelby): the picker offers ONLY the
//         org-enabled payers (never the wider catalog); attaching BCBS-NC
//         previews Group 1 × NC and Group 2 × NC with facility-count reasons
//         and unchecking Group 1 × NC saves only the other row; BCBS-KS then
//         expands to Group 2 × KS only. Prerequisite note is informational.
//   TS-41b empty expansion: a payer operating in none of the groups' states
//         explains itself instead of listing rows.
//   TS-42 archive/reapply cycle (Cigna): archive flips status (never a row
//         delete), archived view restores in one click, and re-attach re-runs
//         the expansion with the archived row PRE-UNCHECKED.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_SHELBY = "33333333-3333-4333-8333-333333333333";
const ORG_TREE_HILL = "22222222-2222-4222-8222-222222222222";

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
  billing_phone: "704-555-0100",
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

const payerRow = (id: string, slug: string, name: string, states: string[]) => ({
  id,
  org_id: null,
  name,
  payer_kind: "commercial",
  states,
  aliases: [],
  status: "active",
  payer_slug: slug,
  is_active: true,
  created_at: "2026-07-10T00:00:00Z",
});

const enable = (orgId: string, payerId: string, n: number) => ({
  id: `opa-${n}`,
  org_id: orgId,
  payer_id: payerId,
  starter: false,
});

function makeFixtures(over: Record<string, unknown[]>) {
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
    ...over,
  } as Record<string, unknown[]>;
}

function makeHandler(fixtures: Record<string, unknown[]>) {
  let seq = 900;
  const STATEFUL = new Set(["payer_network_targets"]);
  const deletes: string[] = [];
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
        }
      }
      return true;
    };

    if (STATEFUL.has(table) && req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "[]") as
        Record<string, unknown> | Record<string, unknown>[];
      const rows = Array.isArray(body) ? body : [body];
      const created = rows.map((r) => ({
        id: `pnt-${seq++}`,
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
      // TE-5 says this must never happen — record it so the test can assert.
      deletes.push(table);
      return json([]);
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
  return { handler, deletes };
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

// Shelby TS-41 base: two groups, Group 1 in NC, Group 2 in NC + KS; three
// enabled payers (BCBS-NC / BCBS-KS / Cigna-NC) and one unassigned catalog
// payer that must never surface in the picker.
function shelbyFixtures(over: Record<string, unknown[]> = {}) {
  return makeFixtures({
    party_role_assignments: contactAssignments(ORG_SHELBY, "shelby"),
    provider_groups: [
      groupRow(ORG_SHELBY, "g-1", "Shelby Sports Rehab LLC"),
      groupRow(ORG_SHELBY, "g-2", "Shelby Performance Group LLC"),
    ],
    facilities: [
      facilityRow(ORG_SHELBY, "f-1", "g-1", "Shelby Main Clinic", "NC"),
      facilityRow(ORG_SHELBY, "f-2", "g-2", "Performance North", "NC"),
      facilityRow(ORG_SHELBY, "f-3", "g-2", "Performance Wichita", "KS"),
    ],
    payers: [
      payerRow(
        "pay-bcbs-nc",
        "blue-cross-and-blue-shield-of-north-carolina",
        "Blue Cross and Blue Shield of North Carolina",
        ["NC"],
      ),
      payerRow("pay-bcbs-ks", "blue-cross-and-blue-shield-of-kansas", "BCBS of Kansas", ["KS"]),
      payerRow("pay-cigna", "cigna-healthcare", "Cigna Healthcare", ["NC"]),
      payerRow("pay-uhc", "unitedhealthcare", "UnitedHealthcare", ["NC", "KS"]),
    ],
    org_payer_assignments: [
      enable(ORG_SHELBY, "pay-bcbs-nc", 1),
      enable(ORG_SHELBY, "pay-bcbs-ks", 2),
      enable(ORG_SHELBY, "pay-cigna", 3),
    ],
    ...over,
  });
}

test("TS-41: curated picker + two-group expansion with an unchecked exception", async ({
  context,
  page,
}) => {
  const fixtures = shelbyFixtures();
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_SHELBY);

  await page.goto("/onboarding/wizard");
  const card = page.locator("#wizard-payer-network");
  await expect(card).toContainText("Not started", { timeout: 30000 });

  // Curated shortlist: ONLY the three enabled payers are offered (F1.5.1).
  await card.getByRole("button", { name: "Attach payer" }).click();
  const dialog = page.getByRole("dialog", { name: "Attach a payer" });
  await expect(dialog).toContainText("Blue Cross and Blue Shield of North Carolina");
  await expect(dialog).toContainText("BCBS of Kansas");
  await expect(dialog).toContainText("Cigna Healthcare");
  await expect(dialog).not.toContainText("UnitedHealthcare");

  // BCBS-NC expands to BOTH groups' NC rows with facility-count reasons.
  await dialog
    .getByRole("button", { name: /^Blue Cross and Blue Shield of North Carolina/ })
    .click();
  const review = page.getByRole("dialog", {
    name: "Attach Blue Cross and Blue Shield of North Carolina",
  });
  await expect(review).toContainText("Shelby Sports Rehab LLC");
  await expect(review).toContainText("Shelby Performance Group LLC");
  await expect(review).toContainText("1 facility in NC");
  await expect(review).not.toContainText("KS");

  // TS-41 exception: uncheck Group 1 × NC — only Group 2 × NC persists.
  await review.getByLabel("Target Shelby Sports Rehab LLC in NC").click();
  await review.getByRole("button", { name: "Save targets" }).click();
  await expect(card).toContainText("Complete", { timeout: 15000 });
  await expect(card).toContainText("Shelby Performance Group LLC × NC");
  await expect(card).not.toContainText("Shelby Sports Rehab LLC × NC");
  const saved = fixtures.payer_network_targets as Array<Record<string, unknown>>;
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    org_id: ORG_SHELBY,
    payer_id: "pay-bcbs-nc",
    group_id: "g-2",
    state: "NC",
    status: "active",
  });

  // BCBS-KS expands to Group 2 × KS only (Group 1 has no KS facility).
  await card.getByRole("button", { name: "Attach payer" }).click();
  const picker2 = page.getByRole("dialog", { name: "Attach a payer" });
  // BCBS-NC is attached now, so its picker entry is gone.
  await expect(
    picker2.getByRole("button", { name: /^Blue Cross and Blue Shield of North Carolina/ }),
  ).toHaveCount(0);
  await picker2.getByRole("button", { name: /BCBS of Kansas/ }).click();
  const review2 = page.getByRole("dialog", { name: "Attach BCBS of Kansas" });
  await expect(review2).toContainText("Shelby Performance Group LLC");
  await expect(review2).toContainText("1 facility in KS");
  await expect(review2).not.toContainText("Shelby Sports Rehab LLC");
  await review2.getByRole("button", { name: "Save targets" }).click();
  await expect(card).toContainText("Shelby Performance Group LLC × KS", { timeout: 15000 });
  expect(fixtures.payer_network_targets).toHaveLength(2);
});

test("TS-41b: payer outside the groups' states yields an explanatory empty expansion", async ({
  context,
  page,
}) => {
  // Tree Hill: one NC group/facility; the only enabled payer operates in KS.
  const fixtures = makeFixtures({
    party_role_assignments: contactAssignments(ORG_TREE_HILL, "tree-hill"),
    provider_groups: [groupRow(ORG_TREE_HILL, "g-th", "Tree Hill Sports Therapy LLC")],
    facilities: [facilityRow(ORG_TREE_HILL, "f-th", "g-th", "Tree Hill Riverfront Clinic", "NC")],
    payers: [
      payerRow("pay-bcbs-ks", "blue-cross-and-blue-shield-of-kansas", "BCBS of Kansas", ["KS"]),
    ],
    org_payer_assignments: [enable(ORG_TREE_HILL, "pay-bcbs-ks", 1)],
  });
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_TREE_HILL);

  await page.goto("/onboarding/wizard");
  const card = page.locator("#wizard-payer-network");
  await card.getByRole("button", { name: "Attach payer" }).click({ timeout: 30000 });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /BCBS of Kansas/ })
    .click();
  const review = page.getByRole("dialog", { name: "Attach BCBS of Kansas" });
  await expect(review).toContainText(
    "doesn't operate in any state where this organization's groups have active facilities",
  );
  await expect(review.getByRole("button", { name: "Save targets" })).toHaveCount(0);
  expect(fixtures.payer_network_targets).toHaveLength(0);
});

test("TS-42: archive flips status (no delete); re-attach pre-unchecks and restores", async ({
  context,
  page,
}) => {
  const fixtures = shelbyFixtures({
    payer_network_targets: [
      {
        id: "pnt-cigna",
        org_id: ORG_SHELBY,
        payer_id: "pay-cigna",
        group_id: "g-1",
        state: "NC",
        status: "active",
        created_at: "2026-07-11T00:00:00Z",
      },
    ],
  });
  const { handler, deletes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_SHELBY);

  await page.goto("/onboarding/wizard");
  const card = page.locator("#wizard-payer-network");
  await expect(card).toContainText("Cigna Healthcare", { timeout: 30000 });
  await expect(card).toContainText("Shelby Sports Rehab LLC × NC");

  // Archive the payer: the target leaves the active list, the row survives.
  await card.getByRole("button", { name: "Archive payer" }).click();
  await expect(card).toContainText("No payers attached yet", { timeout: 15000 });
  const rows = fixtures.payer_network_targets as Array<Record<string, unknown>>;
  expect(rows).toHaveLength(1);
  expect(rows[0]!.status).toBe("archived");
  expect(deletes).toHaveLength(0);

  // Archived view: visible with one-click Restore + payer-level Re-attach.
  await card.getByRole("button", { name: "Show archived (1)" }).click();
  await expect(card).toContainText("Archived");

  // Re-attach re-runs the expansion with the archived row PRE-UNCHECKED.
  await card.getByRole("button", { name: "Re-attach payer" }).click();
  const review = page.getByRole("dialog", { name: "Attach Cigna Healthcare" });
  const archivedRowCheckbox = review.getByLabel("Target Shelby Sports Rehab LLC in NC");
  await expect(archivedRowCheckbox).not.toBeChecked();
  await expect(review).toContainText("Archived");

  // Checking it plans a RESTORE (status flip on the same row, no new insert);
  // uncheck the fresh Group 2 row so only the restore is saved.
  await archivedRowCheckbox.click();
  await review.getByLabel("Target Shelby Performance Group LLC in NC").click();
  await review.getByRole("button", { name: "Save targets" }).click();

  await expect(card).toContainText("Shelby Sports Rehab LLC × NC", { timeout: 15000 });
  await expect(card).toContainText("Complete");
  expect(rows).toHaveLength(1);
  expect(rows[0]!.status).toBe("active");
  expect(deletes).toHaveLength(0);
});
