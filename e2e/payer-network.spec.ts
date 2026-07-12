import { test, expect, type Route } from "@playwright/test";

// E1.5 TE-8 — Payer Network wizard-section coverage over the mock harness:
//   TS-41 Curated attach + expansion: the picker offers ONLY the org-enabled
//         payers (never the wider catalog), shows kind/states metadata and
//         the informational prerequisite note (F1.5.4); attaching BCBS-NC
//         previews Group One × NC + Group Two × NC, unchecking one exception
//         saves only the other row; BCBS-KS expands to Group Two × KS only.
//   TS-42 Archive/reapply cycle: archiving the Cigna attachment flips the
//         target to archived (no DELETE, cases untouched); the archived view
//         restores in one click; re-attaching re-runs the expansion with the
//         previously archived row pre-UNCHECKED and restores it (no insert).
// Fixture persona per seed-universe.md: Shelby Sports Rehab (two groups).

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_SHELBY = "33333333-3333-4333-8333-333333333333";

const PAYER_BCBS_NC = "aaaa1111-1111-4111-8111-111111111111";
const PAYER_BCBS_KS = "aaaa2222-2222-4222-8222-222222222222";
const PAYER_CIGNA_NC = "aaaa3333-3333-4333-8333-333333333333";
const PAYER_AETNA_TX = "aaaa4444-4444-4444-8444-444444444444";

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

const contactAssignments = () => [
  {
    org_id: ORG_SHELBY,
    role_key: "owner",
    parties: party({
      id: "p-owner-shelby",
      name: "Owner Shelby",
      email: "owner.shelby@example.test",
    }),
  },
  {
    org_id: ORG_SHELBY,
    role_key: "customer_escalation_contact",
    parties: party({
      id: "p-cust-shelby",
      name: "April Buchanon",
      email: "contact.shelby@example.test",
      phone_office: "704-555-0113",
      address_line1: "210 Stadium Dr",
      city: "Shelby",
      state: "NC",
      postal_code: "28150",
      country: "US",
    }),
  },
];

const groupRow = (id: string, name: string) => ({
  id,
  org_id: ORG_SHELBY,
  name,
  tin: "123456789",
  states: ["NC"],
  is_active: true,
  created_at: "2026-07-10T00:00:00Z",
});

const facilityRow = (id: string, groupId: string, name: string, state: string) => ({
  id,
  org_id: ORG_SHELBY,
  group_id: groupId,
  name,
  street: "1 Main St",
  city: "Shelby",
  state,
  zip: "28150",
  is_active: true,
  status_id: null,
  effective_date: null,
  reference_only: false,
  created_at: "2026-07-10T00:00:00Z",
});

const payerRow = (
  id: string,
  name: string,
  states: string[],
  prerequisitePayerId: string | null = null,
) => ({
  id,
  org_id: null,
  name,
  is_active: true,
  payer_kind: "commercial",
  states,
  prerequisite_payer_id: prerequisitePayerId,
  portal_url: null,
  created_at: "2026-07-10T00:00:00Z",
});

const assignmentRow = (id: string, payerId: string) => ({
  id,
  org_id: ORG_SHELBY,
  payer_id: payerId,
  starter: false,
  created_at: "2026-07-10T00:00:00Z",
});

function makeFixtures(over: Record<string, unknown[]>) {
  return {
    organizations: [
      {
        id: ORG_SHELBY,
        name: "Shelby Sports Rehab",
        lifecycle_state: "active",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    memberships: [
      {
        org_id: ORG_SHELBY,
        role: "admin",
        organizations: {
          name: "Shelby Sports Rehab",
          lifecycle_state: "active",
          created_at: "2026-07-01T00:00:00Z",
        },
      },
    ],
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
    party_role_assignments: contactAssignments(),
    provider_groups: [groupRow("g-1", "Shelby Group One"), groupRow("g-2", "Shelby Group Two")],
    facilities: [
      facilityRow("f-1", "g-1", "Shelby Uptown Clinic", "NC"),
      facilityRow("f-2", "g-2", "Shelby Eastside Clinic", "NC"),
      facilityRow("f-3", "g-2", "Shelby Wichita Clinic", "KS"),
    ],
    providers: [],
    state_licenses: [],
    provider_group_assignments: [],
    provider_facility_assignments: [],
    payers: [
      payerRow(PAYER_BCBS_NC, "BCBS-NC", ["NC"]),
      payerRow(PAYER_BCBS_KS, "BCBS-KS", ["KS"]),
      // Prerequisite metadata present → the informational note (F1.5.4).
      payerRow(PAYER_CIGNA_NC, "Cigna-NC", ["NC"], PAYER_BCBS_NC),
      // In the catalog but NOT org-enabled — must never be offered (F1.5.1).
      payerRow(PAYER_AETNA_TX, "Aetna-TX", ["TX"]),
    ],
    org_payer_assignments: [
      assignmentRow("opa-1", PAYER_BCBS_NC),
      assignmentRow("opa-2", PAYER_BCBS_KS),
      assignmentRow("opa-3", PAYER_CIGNA_NC),
    ],
    payer_network_targets: [],
    ...over,
  } as Record<string, unknown[]>;
}

interface RecordedWrite {
  table: string;
  method: string;
  body: unknown;
}

function makeHandler(fixtures: Record<string, unknown[]>) {
  let seq = 900;
  const STATEFUL = new Set(["payer_network_targets"]);
  const writes: RecordedWrite[] = [];
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
        if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) continue;
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
      writes.push({ table, method: "POST", body: rows });
      const created = rows.map((r) => ({
        id: `pnt-${seq++}`,
        status: "active",
        created_at: "2026-07-12T00:00:00Z",
        ...r,
      }));
      fixtures[table]!.push(...created);
      return json(wantsObject ? created[0] : created, 201);
    }
    if (STATEFUL.has(table) && req.method() === "PATCH") {
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      const targets = (fixtures[table] as Record<string, unknown>[]).filter(matchFilters);
      writes.push({ table, method: "PATCH", body: { patch: body, matched: targets.length } });
      for (const t of targets) Object.assign(t, body);
      return json(wantsObject ? (targets[0] ?? {}) : targets);
    }
    if (req.method() === "POST" || req.method() === "PATCH" || req.method() === "DELETE") {
      writes.push({ table, method: req.method(), body: req.postData() });
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
  return { handler, writes };
}

function seedAuth(context: {
  addInitScript: (fn: (args: unknown[]) => void, args: unknown[]) => Promise<void>;
}) {
  return context.addInitScript(
    ([authKey, session, activeOrg]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: activeOrg }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_SHELBY] as const,
  );
}

test("TS-41: curated shortlist, prerequisite note, two-group expansion with an exception", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures({});
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/onboarding/wizard");
  const card = page.locator("#wizard-payer-network");
  await expect(card).toContainText("Not started", { timeout: 30000 });

  // Open the attach dialog and the curated picker (F1.5.1).
  await card.getByRole("button", { name: "Attach payer" }).click();
  const dialog = page.getByRole("dialog", { name: "Attach payer" });
  await dialog.getByRole("combobox").click();

  // Only the three org-enabled payers are offered — with kind + states
  // metadata; the wider catalog (Aetna-TX) never appears.
  await expect(page.getByRole("option", { name: "BCBS-NC — commercial · NC" })).toBeVisible();
  await expect(page.getByRole("option", { name: "BCBS-KS — commercial · KS" })).toBeVisible();
  await expect(page.getByRole("option", { name: /Cigna-NC/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Aetna-TX/ })).toHaveCount(0);

  // F1.5.4: prerequisite metadata renders as an informational note only —
  // nothing blocks, the expansion still renders.
  await page.getByRole("option", { name: /Cigna-NC/ }).click();
  await expect(dialog).toContainText("Requires BCBS-NC");
  await expect(
    dialog.getByRole("checkbox", { name: "Target Shelby Group One in NC" }),
  ).toBeVisible();

  // Switch to BCBS-NC: both groups have NC facilities → two derived rows
  // with their facility-count reasons (F1.5.2).
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: "BCBS-NC — commercial · NC" }).click();
  await expect(dialog).toContainText("Shelby Group One");
  await expect(dialog).toContainText("Shelby Group Two");
  await expect(dialog).toContainText("1 facility in NC");

  // Uncheck the Group One × NC exception; only the checked row saves.
  await dialog.getByRole("checkbox", { name: "Target Shelby Group One in NC" }).click();
  await dialog.getByRole("button", { name: "Attach 1 target" }).click();
  await expect(page.getByText("BCBS-NC attached")).toBeVisible({ timeout: 15000 });

  const posts = writes.filter((w) => w.table === "payer_network_targets" && w.method === "POST");
  expect(posts).toHaveLength(1);
  expect(posts[0].body).toEqual([
    {
      org_id: ORG_SHELBY,
      payer_id: PAYER_BCBS_NC,
      group_id: "g-2",
      state: "NC",
    },
  ]);

  // The section now lists the attachment and the chip derives Complete.
  await expect(card).toContainText("Complete");
  await expect(card).toContainText("Shelby Group Two · NC");
  await expect(card).not.toContainText("Shelby Group One · NC");

  // BCBS-KS covers KS only → the expansion intersects to Group Two × KS.
  await card.getByRole("button", { name: "Attach payer" }).click();
  const dialog2 = page.getByRole("dialog", { name: "Attach payer" });
  await dialog2.getByRole("combobox").click();
  await page.getByRole("option", { name: "BCBS-KS — commercial · KS" }).click();
  await expect(
    dialog2.getByRole("checkbox", { name: "Target Shelby Group Two in KS" }),
  ).toBeVisible();
  await expect(dialog2.getByRole("checkbox")).toHaveCount(1);
  await dialog2.getByRole("button", { name: "Attach 1 target" }).click();
  await expect(page.getByText("BCBS-KS attached")).toBeVisible({ timeout: 15000 });
  await expect(card).toContainText("Shelby Group Two · KS");
});

test("TS-42: archive keeps history, one-click restore, re-attach pre-unchecks archived rows", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures({
    payer_network_targets: [
      {
        id: "pnt-cigna",
        org_id: ORG_SHELBY,
        payer_id: PAYER_CIGNA_NC,
        group_id: "g-1",
        state: "NC",
        status: "active",
        created_at: "2026-07-10T00:00:00Z",
      },
    ],
    // Generated-case history rides alongside — it must stay untouched.
    credential_cases: [
      {
        id: "case-1",
        org_id: ORG_SHELBY,
        provider_id: "pr-x",
        payer_id: PAYER_CIGNA_NC,
        state: "NC",
        created_at: "2026-07-10T00:00:00Z",
      },
    ],
  });
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/onboarding/wizard");
  const card = page.locator("#wizard-payer-network");
  await expect(card).toContainText("Complete", { timeout: 30000 });
  await expect(card).toContainText("Shelby Group One · NC");

  // Archive the payer attachment: a status flip, never a DELETE (TE-5).
  await card.getByRole("button", { name: "Archive Cigna-NC attachment" }).click();
  await expect(card).toContainText("Not started");
  await expect(card).toContainText("Archived (1)");
  const deletes = writes.filter((w) => w.method === "DELETE");
  expect(deletes).toHaveLength(0);

  // One-click restore from the archived view (F1.5.3).
  await card.getByRole("button", { name: "Archived (1)" }).click();
  await expect(card).toContainText("Cigna-NC — Shelby Group One · NC");
  await card.getByRole("button", { name: "Restore Cigna-NC target for NC" }).click();
  await expect(card).toContainText("Complete");
  await expect(card).toContainText("Shelby Group One · NC");

  // Archive again, then re-attach through the picker: the expansion re-runs
  // and the previously archived row arrives pre-UNCHECKED for review.
  await card.getByRole("button", { name: "Archive Cigna-NC attachment" }).click();
  await expect(card).toContainText("Not started");
  await card.getByRole("button", { name: "Attach payer" }).click();
  const dialog = page.getByRole("dialog", { name: "Attach payer" });
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: /Cigna-NC/ }).click();
  const archivedRow = dialog.getByRole("checkbox", { name: "Target Shelby Group One in NC" });
  await expect(archivedRow).not.toBeChecked();
  await expect(dialog).toContainText("previously archived");
  // Group Two also has an NC facility, so the re-run expansion offers it as
  // a NEW checked row — uncheck it so this save is a pure restore, and pin
  // the zero-selection disabled state along the way.
  await dialog.getByRole("checkbox", { name: "Target Shelby Group Two in NC" }).click();
  await expect(dialog.getByRole("button", { name: "Attach 0 targets" })).toBeDisabled();

  // Restoring the target makes it active again — an UPDATE, never an insert.
  await archivedRow.click();
  await dialog.getByRole("button", { name: "Attach 1 target" }).click();
  await expect(page.getByText("Cigna-NC attached")).toBeVisible({ timeout: 15000 });
  await expect(card).toContainText("Complete");
  await expect(card).toContainText("Shelby Group One · NC");

  const targetPosts = writes.filter(
    (w) => w.table === "payer_network_targets" && w.method === "POST",
  );
  expect(targetPosts).toHaveLength(0);

  // Existing cases were never touched (F1.5.3).
  const caseWrites = writes.filter((w) => w.table === "credential_cases");
  expect(caseWrites).toHaveLength(0);
});
