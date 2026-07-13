// E2.0 TE-13 — generation-preview coverage over the mock harness:
//   TS-48 first full-org preview: two groups, mixed states, every derivable
//         provider × group × payer × state row exactly once with reason and
//         readiness; the in-flight case grayed with the status-aware label;
//         archived targets and non-clinic-assigned members produce no rows;
//         the preview itself writes NOTHING (TE-11, derived not stored).
//   TS-49 persistent reasoned exclusion: uncheck → reason dialog → exclusion
//         row written; a quarterly re-run after two new hires proposes only
//         the genuinely new keys while the exclusion holds, visible and
//         restorable in one click — restore is a VOID (PATCH), never DELETE.
import { test, expect, type Route } from "@playwright/test";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
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

const groupRow = (id: string, name: string) => ({
  id,
  org_id: ORG_SHELBY,
  name,
  tin: "123456789",
  states: ["NC", "KS"],
  is_active: true,
  created_at: "2026-07-10T00:00:00Z",
});

const facilityRow = (id: string, groupId: string, name: string, state: string) => ({
  id,
  org_id: ORG_SHELBY,
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

// A provider whose PROVIDER readiness checklist fully passes.
const providerRow = (id: string, first: string, last: string) => ({
  id,
  org_id: ORG_SHELBY,
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
  caqh_last_attested_date: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10),
  date_of_birth: "1990-01-01",
  ssn_last4: "1234",
  home_street: "4104 S Croatan Hwy",
  home_city: "Nags Head",
  home_zip: "27959",
  malpractice_coverage_end: "2027-12-31",
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
});

const licenseRow = (id: string, providerId: string, state: string) => ({
  id,
  org_id: ORG_SHELBY,
  provider_id: providerId,
  state,
  license_number: `PT-${id}`,
  expiration_date: "2027-12-31",
  verified_status: "verified",
});

const groupAssignment = (providerId: string, groupId: string) => ({
  id: `ga-${providerId}-${groupId}`,
  org_id: ORG_SHELBY,
  provider_id: providerId,
  group_id: groupId,
  is_primary: true,
  start_date: "2026-01-01",
  end_date: null,
  created_at: "2026-07-10T00:00:00Z",
});

const facilityAssignment = (providerId: string, facilityId: string) => ({
  id: `fa-${providerId}-${facilityId}`,
  org_id: ORG_SHELBY,
  provider_id: providerId,
  facility_id: facilityId,
  is_primary: true,
  start_date: "2026-01-01",
  created_at: "2026-07-10T00:00:00Z",
});

const targetRow = (
  id: string,
  groupId: string,
  payerId: string,
  state: string,
  status: string,
) => ({
  id,
  org_id: ORG_SHELBY,
  payer_id: payerId,
  group_id: groupId,
  state,
  status,
  created_at: "2026-07-12T00:00:00Z",
});

const payerRow = (id: string, name: string, states: string[]) => ({
  id,
  org_id: null,
  name,
  payer_kind: "commercial",
  states,
  aliases: [],
  status: "active",
  payer_slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  prerequisite_payer_id: null,
  is_active: true,
  created_at: "2026-07-10T00:00:00Z",
});

const groupDocs = (groupId: string) =>
  ["w9", "coi", "voided_check"].map((docType) => ({
    id: `${groupId}-${docType}`,
    org_id: ORG_SHELBY,
    group_id: groupId,
    doc_type: docType,
    expiration_date: null,
  }));

const STATUS_CONFIGS = [
  {
    id: "st-inprog",
    org_id: ORG_SHELBY,
    track: "credentialing",
    label: "In Progress",
    color: "#888888",
    sort_order: 20,
    required_fields: [],
    action_bucket: "ours",
    created_at: "2026-07-10T00:00:00Z",
  },
  {
    id: "st-contracted",
    org_id: ORG_SHELBY,
    track: "contracting",
    label: "Contracted",
    color: "#888888",
    sort_order: 60,
    required_fields: [],
    action_bucket: "complete",
    created_at: "2026-07-10T00:00:00Z",
  },
];

// TS-48 baseline: Group 1 (NC) with Jane + Noel + Priya, Group 2 (NC, KS)
// with Omar + Tessa; Mira is a Group 2 MEMBER with no clinic assignment (the
// Q1 candidacy filter); targets BCBS-NC (both groups) + BCBS-KS (Group 2) +
// an ARCHIVED Aetna target; Jane's in-flight BCBS-NC case.
function makeFixtures() {
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
    audit_log: [],
    party_role_assignments: [],
    provider_groups: [groupRow("g-1", "Group 1"), groupRow("g-2", "Group 2")],
    facilities: [
      facilityRow("f-g1-nc", "g-1", "Shelby Central Clinic", "NC"),
      facilityRow("f-g2-nc", "g-2", "Shelby Performance NC", "NC"),
      facilityRow("f-g2-ks", "g-2", "Shelby Performance KS", "KS"),
    ],
    providers: [
      providerRow("pr-jane", "Jane", "Whitaker"),
      providerRow("pr-noel", "Noel", "Baxter"),
      providerRow("pr-priya", "Priya", "Raman"),
      providerRow("pr-omar", "Omar", "Sallis"),
      providerRow("pr-tessa", "Tessa", "Nguyen"),
      providerRow("pr-mira", "Mira", "Calloway"),
    ],
    provider_group_assignments: [
      groupAssignment("pr-jane", "g-1"),
      groupAssignment("pr-noel", "g-1"),
      groupAssignment("pr-priya", "g-1"),
      groupAssignment("pr-omar", "g-2"),
      groupAssignment("pr-tessa", "g-2"),
      groupAssignment("pr-mira", "g-2"), // member, but no clinic assignment
    ],
    provider_facility_assignments: [
      facilityAssignment("pr-jane", "f-g1-nc"),
      facilityAssignment("pr-noel", "f-g1-nc"),
      facilityAssignment("pr-priya", "f-g1-nc"),
      facilityAssignment("pr-omar", "f-g2-nc"),
      facilityAssignment("pr-tessa", "f-g2-ks"),
    ],
    state_licenses: [
      licenseRow("l1", "pr-jane", "NC"),
      licenseRow("l2", "pr-noel", "NC"),
      licenseRow("l3", "pr-priya", "NC"),
      licenseRow("l4", "pr-omar", "NC"),
      licenseRow("l5", "pr-omar", "KS"),
      licenseRow("l6", "pr-tessa", "NC"),
      licenseRow("l7", "pr-tessa", "KS"),
    ],
    payers: [
      payerRow("pay-bcbsnc", "BCBS-NC", ["NC"]),
      payerRow("pay-bcbsks", "BCBS-KS", ["KS"]),
      payerRow("pay-aetna", "Aetna", ["NC"]),
      payerRow("pay-cigna", "Cigna-NC", ["NC"]),
    ],
    org_payer_assignments: [],
    payer_network_targets: [
      targetRow("t-1", "g-1", "pay-bcbsnc", "NC", "active"),
      targetRow("t-2", "g-2", "pay-bcbsnc", "NC", "active"),
      targetRow("t-3", "g-2", "pay-bcbsks", "KS", "active"),
      targetRow("t-4", "g-1", "pay-aetna", "NC", "archived"),
    ],
    provider_documents: [...groupDocs("g-1"), ...groupDocs("g-2")],
    group_insurance_policies: [],
    status_configs: STATUS_CONFIGS,
    credential_cases: [
      {
        id: "case-jane",
        org_id: ORG_SHELBY,
        provider_id: "pr-jane",
        payer_id: "pay-bcbsnc",
        state: "NC",
        credentialing_status_id: "st-inprog",
      },
    ],
    contracts: [
      {
        id: "ct-1",
        org_id: ORG_SHELBY,
        group_id: "g-1",
        payer_id: "pay-bcbsnc",
        state: "NC",
        contracting_status_id: "st-contracted",
      },
    ],
    case_generation_exclusions: [],
  } as Record<string, Record<string, unknown>[]>;
}

interface RecordedWrite {
  table: string;
  method: string;
  body: Record<string, unknown> | null;
}

// The shared mock harness, extended with WRITE-THROUGH for the exclusions
// table so the real invalidate-and-refetch loop is what the test exercises.
function makeHandler(fixtures: Record<string, Record<string, unknown>[]>) {
  const writes: RecordedWrite[] = [];
  let nextId = 1;
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
      let body: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = req.postDataJSON();
        body = Array.isArray(parsed)
          ? ((parsed[0] ?? null) as Record<string, unknown> | null)
          : (parsed as Record<string, unknown> | null);
      } catch {
        body = null;
      }
      writes.push({ table, method: req.method(), body });

      if (table === "case_generation_exclusions" && req.method() === "POST") {
        const row = {
          id: `x-${nextId++}`,
          status: "active",
          note: null,
          voided_by: null,
          voided_at: null,
          created_at: "2026-07-13T00:00:00Z",
          ...(body ?? {}),
        };
        fixtures.case_generation_exclusions.push(row);
        return json(wantsObject ? row : [row], 201);
      }
      if (table === "case_generation_exclusions" && req.method() === "PATCH") {
        const idFilter = url.searchParams.get("id") ?? "";
        const id = idFilter.startsWith("eq.") ? idFilter.slice(3) : idFilter;
        const row = fixtures.case_generation_exclusions.find((r) => r.id === id);
        if (!row) return json({ code: "PGRST116", message: "no rows" }, 406);
        Object.assign(row, body ?? {});
        return json(wantsObject ? row : [row]);
      }
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

    const rows = (fixtures[table] ?? []).filter((r) => matchFilters(r));
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

test("TS-48: the preview computes the full candidate set with reasons, readiness, and the grayed in-flight case", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_SHELBY);

  await page.goto("/generation");
  await expect(page.getByRole("heading", { name: "Generate applications" })).toBeVisible({
    timeout: 30000,
  });

  // Every derivable row exactly once: 3 Group 1 × BCBS-NC + 2 Group 2 ×
  // BCBS-NC + 2 Group 2 × BCBS-KS = 7. Jane's row is the existing case.
  await expect(
    page.getByText("7 combinations: 6 proposed · 1 already exists · 0 excluded", { exact: false }),
  ).toBeVisible({ timeout: 30000 });
  const dataRows = page.locator("table tbody tr");
  await expect(dataRows).toHaveCount(7);

  // The archived Aetna target produces no rows (F2.0.3); Mira is a Group 2
  // member with no clinic assignment, so she is not a candidate (Q1).
  await expect(page.getByText("Aetna")).toHaveCount(0);
  await expect(page.getByText("Mira")).toHaveCount(0);

  // Jane's Group 1 × BCBS-NC row: grayed indicator, status-aware label, and
  // NO checkbox — never re-creatable from here.
  const janeRow = dataRows.filter({ hasText: "Jane Whitaker" });
  await expect(janeRow).toHaveCount(1);
  await expect(janeRow).toContainText("already exists — in progress");
  await expect(janeRow.getByRole("checkbox")).toHaveCount(0);

  // Proposed rows carry a checked checkbox, the derivation reason, and a
  // readiness signal (Group 1 is fully ready incl. its Contracted contract;
  // Group 2 rows carry the group_contract gap).
  const noelRow = dataRows.filter({ hasText: "Noel Baxter" });
  await expect(noelRow.getByRole("checkbox")).toBeChecked();
  await expect(noelRow).toContainText(
    "Noel Baxter works at a Group 1 clinic; Group 1 targets BCBS-NC in NC",
  );
  await expect(noelRow).toContainText("Ready");
  const omarNcRow = dataRows.filter({ hasText: "Omar Sallis" }).filter({ hasText: "NC" });
  await expect(omarNcRow).toContainText("gap");

  // Derived, never stored (TE-11): rendering the preview wrote NOTHING.
  expect(writes).toHaveLength(0);
});

test("TS-49: exclusions persist with reasons across delta runs and restore by void, never delete", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  // Add the TS-49 Cigna target so Jane has a proposed Group 1 × Cigna row.
  fixtures.payer_network_targets.push(targetRow("t-5", "g-1", "pay-cigna", "NC", "active"));
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_SHELBY);

  await page.goto("/generation");
  await expect(page.getByText("10 combinations", { exact: false })).toBeVisible({ timeout: 30000 });

  // Uncheck Jane × Group 1 × Cigna-NC → the reason prompt (required).
  await page
    .getByRole("checkbox", { name: "Uncheck to exclude Jane Whitaker — Cigna-NC NC (Group 1)" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Exclude from generation");
  await dialog.getByRole("combobox", { name: "Exclusion reason" }).click();
  await page.getByRole("option", { name: "Already credentialed" }).click();
  await dialog.getByRole("button", { name: "Exclude" }).click();

  // The write carries the 4-part key + reason; org and actor set client-side
  // from the active org/user, never guessed by the server.
  await expect(page.getByText("· 1 excluded", { exact: false })).toBeVisible();
  const post = writes.find((w) => w.table === "case_generation_exclusions" && w.method === "POST");
  expect(post?.body).toMatchObject({
    org_id: ORG_SHELBY,
    provider_id: "pr-jane",
    group_id: "g-1",
    payer_id: "pay-cigna",
    state: "NC",
    reason: "already_credentialed",
    created_by: USER_ID,
  });

  // Quarterly re-run after TWO new hires (outside edits on the source data —
  // the preview stores nothing and recomputes on open).
  for (const [id, first, last] of [
    ["pr-nora", "Nora", "Vance"],
    ["pr-theo", "Theo", "Marsh"],
  ] as const) {
    fixtures.providers.push(providerRow(id, first, last));
    fixtures.provider_group_assignments.push(groupAssignment(id, "g-1"));
    fixtures.provider_facility_assignments.push(facilityAssignment(id, "f-g1-nc"));
    fixtures.state_licenses.push(licenseRow(`l-${id}`, id, "NC"));
  }
  await page.reload();

  // Only genuinely new keys joined the proposal (the two hires × Group 1's
  // two targets); the exclusion still holds and is visible with its reason.
  await expect(
    page.getByText("14 combinations: 12 proposed · 1 already exists · 1 excluded", {
      exact: false,
    }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator("table tbody tr").filter({ hasText: "Nora Vance" })).toHaveCount(2);
  await expect(
    page
      .locator("table tbody tr")
      .filter({ hasText: "Jane Whitaker" })
      .filter({ hasText: "Cigna" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Excluded \(1\)/ }).click();
  const excludedItem = page.locator("li", { hasText: "Cigna-NC in NC under Group 1" });
  await expect(excludedItem).toContainText("Already credentialed");

  // Restore in one click: a VOID (PATCH with the voided stamp) — never a
  // DELETE — and the row is proposed again on the re-derivation.
  await excludedItem.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("· 0 excluded", { exact: false })).toBeVisible();
  await expect(
    page
      .locator("table tbody tr")
      .filter({ hasText: "Jane Whitaker" })
      .filter({ hasText: "Cigna" }),
  ).toHaveCount(1);
  const patch = writes.find(
    (w) => w.table === "case_generation_exclusions" && w.method === "PATCH",
  );
  expect(patch?.body).toMatchObject({ status: "voided", voided_by: USER_ID });
  expect(writes.filter((w) => w.method === "DELETE")).toHaveLength(0);
  // The only tables written in the whole flow: the exclusions table + audit.
  expect(new Set(writes.map((w) => w.table))).toEqual(
    new Set(["case_generation_exclusions", "audit_log"]),
  );
});
