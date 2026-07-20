// E6.4 — the Providers area (consolidated people record):
//   TS-112  A→Z roster + ambient gaps; inline field editing on the record;
//           in-place Add facility (the assignment-wipe defect regression pin:
//           an inline edit writes ONLY its field — no assignment writes);
//           the cases panel with preserved denial history.
//   TS-113  Enrollment-fact capture on the record + Expire re-opens the
//           candidate (fact flip at the wire; never a case write).
//   TS-129  Gap pill deep-links the focused record section; a zero-facility
//           provider is flagged (not generatable) until assigned.
//   TS-130  PHI sweep: the roster's list read carries no DOB/SSN/home-address
//           columns; the record masks DOB at rest and SSN to last-4.
// TS-128 (the CSV relationship fold + reference sheet) is covered at the scan
// grain by importSections.test.ts and the staged pipeline by
// roster-import.spec.ts — the commit relationship pass is pinned here at the
// wire in TS-113's harness (write-through fact POST).
import { test, expect, type Route } from "@playwright/test";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "88888888-8888-4888-8888-888888888888";

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

const providerRow = (
  id: string,
  first: string,
  last: string,
  over: Record<string, unknown> = {},
) => ({
  id,
  org_id: ORG_ID,
  first_name: first,
  last_name: last,
  credentials: "PT",
  npi: "1093817465",
  status: "active",
  verification_state: "verified",
  reference_only: false,
  home_state: "NC",
  specialty: "Physical Therapy",
  taxonomy_code: "225100000X",
  email: "provider@example.test",
  phone: "252-555-0100",
  group_id: "g-ob",
  start_date: "2026-06-01",
  caqh_id: "16224897",
  caqh_last_attested_date: "2026-07-01",
  date_of_birth: "1990-01-01",
  ssn_last4: "1234",
  home_street: "4104 S Croatan Hwy",
  home_city: "Nags Head",
  home_zip: "27959",
  degree: "DPT",
  school_name: "ECU",
  graduation_date: "2014-05-01",
  malpractice_carrier: "CM&F",
  malpractice_policy_number: "POL-1",
  malpractice_coverage_start: "2026-01-01",
  malpractice_coverage_end: "2028-12-31",
  is_new_grad: false,
  dea_number: null,
  license_number: null,
  license_state: null,
  terminated_date: null,
  launch_id: null,
  is_test_provider: false,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  ...over,
});

function baseFixtures() {
  return {
    organizations: [
      {
        id: ORG_ID,
        name: "Outer Banks Rehab Group",
        lifecycle_state: "active",
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    memberships: [
      {
        id: "m-1",
        org_id: ORG_ID,
        user_id: USER_ID,
        role: "admin",
        created_at: "2026-06-01T00:00:00Z",
        organizations: {
          name: "Outer Banks Rehab Group",
          lifecycle_state: "active",
          created_at: "2026-06-01T00:00:00Z",
        },
        profiles: { full_name: "Sowmya Seed", email: "sowmya.seed@example.test" },
      },
    ],
    profiles: [
      {
        id: USER_ID,
        full_name: "Sowmya Seed",
        email: "sowmya.seed@example.test",
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    provider_groups: [
      {
        id: "g-ob",
        org_id: ORG_ID,
        name: "Outer Banks Rehab Group LLC",
        tin: "123456789",
        states: ["NC"],
        is_active: true,
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    facilities: [
      {
        id: "f-1",
        org_id: ORG_ID,
        group_id: "g-ob",
        name: "Kill Devil Hills Clinic",
        street: "12 Figure Eight Rd",
        city: "Kill Devil Hills",
        state: "NC",
        zip: "27948",
        is_active: true,
        status_id: null,
        effective_date: null,
        reference_only: false,
        hours: {},
        created_at: "2026-06-01T00:00:00Z",
      },
      {
        id: "f-2",
        org_id: ORG_ID,
        group_id: "g-ob",
        name: "Nags Head Clinic",
        street: "1 Beach Rd",
        city: "Nags Head",
        state: "NC",
        zip: "27959",
        is_active: true,
        status_id: null,
        effective_date: null,
        reference_only: false,
        hours: {},
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    // A→Z fixture: Chen before Ostrander by last name.
    providers: [
      providerRow("pr-brooke", "Brooke", "Ostrander"),
      providerRow("pr-alex", "Alex", "Chen", { caqh_id: null, npi: "1093817465" }),
    ],
    provider_group_assignments: [
      {
        id: "ga-1",
        org_id: ORG_ID,
        provider_id: "pr-brooke",
        group_id: "g-ob",
        is_primary: true,
        created_at: "2026-06-01T00:00:00Z",
      },
      {
        id: "ga-2",
        org_id: ORG_ID,
        provider_id: "pr-alex",
        group_id: "g-ob",
        is_primary: true,
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    // Brooke assigned; Alex has NO facility assignment (the TS-129 flag).
    provider_facility_assignments: [
      {
        id: "fa-1",
        org_id: ORG_ID,
        provider_id: "pr-brooke",
        facility_id: "f-1",
        is_primary: true,
        start_date: "2026-06-01",
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    state_licenses: [
      {
        id: "lic-1",
        org_id: ORG_ID,
        provider_id: "pr-brooke",
        state: "NC",
        license_number: "PT-1",
        license_type: "full",
        issue_date: "2023-01-01",
        expiration_date: "2027-06-01",
        verified_status: "verified",
        verified_at: "2026-07-01T00:00:00Z",
        verified_by: USER_ID,
        verification_source_url: "https://www.ncbpte.org",
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    payers: [
      {
        id: "p1",
        org_id: null,
        name: "Aetna",
        payer_kind: "commercial",
        states: ["NC"],
        aliases: [],
        status: "active",
        payer_slug: "aetna",
        avg_decision_days: null,
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    org_payer_assignments: [
      {
        id: "a-p1",
        org_id: ORG_ID,
        payer_id: "p1",
        starter: false,
        status: "active",
        archived_at: null,
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    payer_network_targets: [],
    enrollment_facts: [] as Record<string, unknown>[],
    credential_cases: [
      {
        id: "c-1",
        org_id: ORG_ID,
        provider_id: "pr-brooke",
        payer_id: "p1",
        state: "NC",
        group_id: "g-ob",
        facility_id: null,
        mso_id: null,
        credentialing_status_id: null,
        case_status: "in_progress",
        submitted_date: null,
        approved_date: null,
        payer_reference_id: null,
        payer_pipeline_state: "not_started",
        generation_run_id: null,
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T00:00:00Z",
      },
    ],
    case_status_history: [
      // A prior denial on the SAME case (reapplied since) — must stay visible.
      {
        id: "h-1",
        org_id: ORG_ID,
        case_id: "c-1",
        from_status: "submitted",
        to_status: "denied",
        actor_kind: "user",
        reason_code_id: "rc-1",
        evidence_touch_id: null,
        is_correction: false,
        note: null,
        changed_by: USER_ID,
        changed_at: "2026-07-05T00:00:00Z",
      },
    ],
    denial_reason_codes: [
      {
        id: "rc-1",
        org_id: null,
        code: "panel_closed",
        label: "Panel closed",
        active: true,
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    case_generation_exclusions: [],
    contracts: [],
    tasks: [],
    status_configs: [],
    sop_templates: [],
    provider_documents: [],
    group_insurance_policies: [],
    import_runs: [],
    import_rows: [],
    notes: [],
    user_table_prefs: [],
    audit_log: [],
    touches: [],
  } as Record<string, Record<string, unknown>[]>;
}

interface RecordedRequest {
  method: string;
  path: string;
  url: string;
  body: unknown;
}

function makeHandler(fixtures: Record<string, Record<string, unknown>[]>) {
  const requests: RecordedRequest[] = [];
  let seq = 0;
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
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
        } else if (raw.startsWith("neq.")) {
          if (String(row[key]) === raw.slice(4)) return false;
        } else if (raw.startsWith("is.")) {
          if (raw.slice(3) === "null" && row[key] !== null) return false;
        }
      }
      return true;
    };

    if (req.method() === "HEAD") {
      const n = (fixtures[table] ?? []).filter((r) => matchFilters(r)).length;
      return route.fulfill({ status: 200, headers: { "content-range": `*/${n}` }, body: "" });
    }

    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = null;
    }
    if (req.method() !== "GET") {
      requests.push({ method: req.method(), path: table, url: req.url(), body });
    } else {
      requests.push({ method: "GET", path: table, url: req.url(), body: null });
    }

    if (req.method() === "POST") {
      const bodies = Array.isArray(body)
        ? (body as Record<string, unknown>[])
        : [(body ?? {}) as Record<string, unknown>];
      const inserted = bodies.map((b) => ({
        id: `new-${(seq += 1)}`,
        created_at: "2026-07-19T00:00:00Z",
        ...(table === "enrollment_facts" ? { expired_at: null, expired_by: null } : {}),
        ...b,
      }));
      if (fixtures[table]) fixtures[table].push(...inserted);
      return json(wantsObject ? inserted[0] : inserted, 201);
    }
    if (req.method() === "PATCH") {
      const rows = (fixtures[table] ?? []).filter((r) => matchFilters(r));
      for (const r of rows) Object.assign(r, (body ?? {}) as Record<string, unknown>);
      if (wantsObject && rows.length === 0)
        return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(wantsObject ? rows[0] : rows);
    }
    if (req.method() === "DELETE") {
      const keep = (fixtures[table] ?? []).filter((r) => !matchFilters(r));
      if (fixtures[table]) fixtures[table] = keep;
      return json([]);
    }

    const rows = (fixtures[table] ?? []).filter((r) => matchFilters(r));
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  };
  return { handler, requests };
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
    [AUTH_KEY, SESSION, ORG_ID] as const,
  );
}

test("TS-112: A→Z roster with ambient gaps; inline edit writes ONLY its field; + Add facility persists; denial history preserved on the cases panel", async ({
  context,
  page,
}) => {
  const fixtures = baseFixtures();
  const { handler, requests } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/providers");
  await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Sorted A→Z by last name", { exact: false })).toBeVisible();

  // A→Z by LAST name: Chen before Ostrander, regardless of insertion order.
  const names = page.locator("tbody tr td:first-child a");
  await expect(names.first()).toContainText("Chen, Alex", { timeout: 15000 });
  await expect(names.nth(1)).toContainText("Ostrander, Brooke");

  // Ambient gaps: Alex has no facility assignment + no CAQH id; Brooke is clean.
  const alexRow = page.getByRole("row", { name: /Chen, Alex/ });
  await expect(alexRow.getByText("No facility assignment")).toBeVisible();
  await expect(alexRow.getByText("Missing CAQH ID")).toBeVisible();
  await expect(
    page.getByRole("row", { name: /Ostrander/ }).getByText(/Missing|No facility/),
  ).toHaveCount(0);

  // Open Brooke's record; inline-edit the phone — the ONLY write is a
  // single-field providers PATCH (the assignment-wipe regression pin).
  await page.getByRole("link", { name: /Ostrander, Brooke/ }).click();
  await expect(page.getByRole("heading", { name: "Identity" })).toBeVisible({ timeout: 30000 });
  const writesBefore = requests.filter((r) => r.method !== "GET" && r.method !== "HEAD").length;
  await page.getByRole("button", { name: "Edit Phone" }).click();
  await page.getByLabel("Phone value").fill("252-555-0199");
  await page.getByRole("button", { name: "Save Phone" }).click();
  await expect(page.getByText("252-555-0199")).toBeVisible({ timeout: 15000 });
  const writesAfter = requests.filter((r) => r.method !== "GET" && r.method !== "HEAD");
  const newWrites = writesAfter.slice(writesBefore);
  const providerPatches = newWrites.filter((w) => w.method === "PATCH" && w.path === "providers");
  expect(providerPatches).toHaveLength(1);
  expect((providerPatches[0].body as Record<string, unknown>).phone).toBe("252-555-0199");
  // NO assignment-table writes rode along — the defect is dead by construction.
  expect(
    newWrites.filter(
      (w) => w.path === "provider_facility_assignments" || w.path === "provider_group_assignments",
    ),
  ).toHaveLength(0);
  // The single-field patch touched nothing else on the provider.
  const patchKeys = Object.keys(providerPatches[0].body as Record<string, unknown>);
  expect(patchKeys).toEqual(["phone"]);

  // + Add facility in place: pick the second clinic with a start date.
  await page.getByRole("button", { name: "+ Add facility" }).click();
  const dialog = page.getByRole("dialog", { name: "Add facility" });
  await dialog.getByLabel("Facility to add").click();
  await page.getByRole("option", { name: "Nags Head Clinic" }).click();
  await dialog.getByLabel("Start date").click();
  // Day buttons carry full accessible names (the assignments-wizard idiom).
  await page.getByRole("button", { name: /July 15th/ }).click();
  await dialog.getByRole("button", { name: "Add facility", exact: true }).click();
  // The write-through lands, then the list re-derives with the new location.
  await expect
    .poll(() => fixtures.provider_facility_assignments.length, { timeout: 15000 })
    .toBe(2);
  await expect(page.locator("li").filter({ hasText: "Nags Head Clinic" }).first()).toBeVisible({
    timeout: 15000,
  });

  // Cases panel: the reapplied case shows its CURRENT status with the prior
  // denial preserved beneath (reason + date from the unified history).
  await expect(page.getByRole("heading", { name: "Cases", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Aetna — NC/ })).toBeVisible();
  await expect(page.getByText(/Previously denied — Panel closed, Jul 5, 2026/)).toBeVisible();
});

test("TS-113: enrollment-fact capture on the record; Expire flips the fact at the wire — zero case writes anywhere", async ({
  context,
  page,
}) => {
  const fixtures = baseFixtures();
  const { handler, requests } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/providers/pr-brooke");
  await expect(page.getByRole("heading", { name: "Enrollments" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Prior-employer status does NOT belong here/)).toBeVisible();

  // Record a fact under the group's contract.
  await page.getByRole("button", { name: "Add enrollment" }).click();
  const dialog = page.getByRole("dialog", { name: "Record an enrollment fact" });
  await dialog.getByLabel("Enrollment group").click();
  await page.getByRole("option", { name: "Outer Banks Rehab Group LLC" }).click();
  await dialog.getByLabel("Enrollment payer").click();
  await page.getByRole("option", { name: "Aetna" }).click();
  await dialog.getByLabel("State", { exact: true }).click();
  await page.getByRole("option", { name: "NC", exact: true }).click();
  // 2026-07-20 re-scope: the payer-issued ID (PIN) is captured WITH the
  // enrollment it belongs to — optional, payer-labeled field.
  await dialog.getByLabel(/Payer-issued ID \(optional\)/).fill("PIN-12345");
  await dialog.getByRole("button", { name: "Record fact" }).click();

  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 15000 });
  const factPost = requests.find((r) => r.method === "POST" && r.path === "enrollment_facts");
  expect(factPost).toBeTruthy();
  const factBody = (Array.isArray(factPost!.body) ? factPost!.body[0] : factPost!.body) as Record<
    string,
    unknown
  >;
  expect(factBody.provider_id).toBe("pr-brooke");
  expect(factBody.payer_id).toBe("p1");
  expect(factBody.source).toBe("migration");
  expect(factBody.payer_issued_id).toBe("PIN-12345");

  // The PIN renders on the fact row with its payer-labeled chip.
  await expect(page.getByText("Payer-issued ID: PIN-12345")).toBeVisible({ timeout: 15000 });

  // Expire: a status FLIP (PATCH sets expired_at), never a delete.
  await page.getByRole("button", { name: "Expire", exact: true }).click();
  await page.getByRole("button", { name: "Expire enrollment" }).click();
  await expect(page.getByText(/Expired/)).toBeVisible({ timeout: 15000 });
  const factPatch = requests.find(
    (r) =>
      r.method === "PATCH" &&
      r.path === "enrollment_facts" &&
      (r.body as Record<string, unknown>).expired_at,
  );
  expect(factPatch).toBeTruthy();
  expect((factPatch!.body as Record<string, unknown>).expired_at).toBeTruthy();
  expect(requests.filter((r) => r.method === "DELETE")).toHaveLength(0);

  // Facts NEVER create cases: no case insert and no case RPC anywhere.
  expect(
    requests.filter(
      (r) =>
        (r.method === "POST" && r.path === "credential_cases") ||
        r.url.includes("create_case_with_tasks"),
    ),
  ).toHaveLength(0);
});

test("TS-129: the roster's no-facility gap pill deep-links the focused Groups & facilities section", async ({
  context,
  page,
}) => {
  const fixtures = baseFixtures();
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/providers");
  const alexRow = page.getByRole("row", { name: /Chen, Alex/ });
  await alexRow.getByRole("link", { name: /No facility assignment/ }).click();

  // The pill lands on the record with the section focused (#groups-facilities).
  await expect(page).toHaveURL(/\/providers\/pr-alex#groups-facilities$/);
  await expect(page.getByRole("heading", { name: "Groups & facilities" })).toBeVisible({
    timeout: 30000,
  });
  // The record repeats the not-generatable flag until an assignment exists.
  await expect(
    page.getByText(/No facility assignment — this provider cannot generate cases/),
  ).toBeVisible();
});

test("TS-130: PHI sweep — the roster list read selects no DOB/SSN/home-address columns; the record masks DOB and SSN", async ({
  context,
  page,
}) => {
  const fixtures = baseFixtures();
  const { handler, requests } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/providers");
  await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible({ timeout: 30000 });

  // The list projection is PHI-safe AT THE WIRE: the providers select never
  // names ssn_last4, date_of_birth, or home street/city/zip.
  const providerSelects = requests
    .filter((r) => r.method === "GET" && r.path === "providers")
    .map((r) => decodeURIComponent(new URL(r.url).searchParams.get("select") ?? ""));
  expect(providerSelects.length).toBeGreaterThan(0);
  for (const sel of providerSelects) {
    expect(sel).not.toContain("ssn_last4");
    expect(sel).not.toContain("date_of_birth");
    expect(sel).not.toContain("home_street");
    expect(sel).not.toContain("home_city");
    expect(sel).not.toContain("home_zip");
  }

  // The record masks: DOB hidden at rest (reveal only on edit); SSN last-4.
  await page.goto("/providers/pr-brooke");
  await expect(page.getByRole("heading", { name: "Identity" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("••••••••")).toBeVisible();
  await expect(page.getByText("1990-01-01")).toHaveCount(0);
  await expect(page.getByText("***--1234")).toBeVisible();
  // Reveal-on-edit: opening the DOB editor exposes the date input with value.
  await page.getByRole("button", { name: "Edit Date of birth" }).click();
  await expect(page.getByLabel("Date of birth value")).toHaveValue("1990-01-01");
});
