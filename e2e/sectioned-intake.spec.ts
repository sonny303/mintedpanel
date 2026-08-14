import { readFileSync } from "fs";
import { test, expect, type Page, type Route } from "@playwright/test";

// E3.3 TE-12 — Sectioned Intake Uniformity e2e:
//   TS-65 The wizard's Provider Group, Facilities, and Providers sections each
//         show the manual form AND a CSV upload; each downloadable template
//         matches its section's fields; the upload UX is identical.
//   TS-66 Facilities upload is blocked without a group (disabled drop zone,
//         pointer to Provider Group), then proceeds after a group exists;
//         a committed facility import flows into the wizard (chip reflects it).
//   TS-67 The retired combined template is rejected naming the per-section
//         templates; /admin/import shows three uploads and no combined; an
//         in-flight combined-era run stays reviewable.
//   TS-68 The capture surface gains NO upload/group/facility/provider
//         capability (the TE-9 fence); a converted org lands in the same
//         sectioned wizard.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-07-14T12:00:00Z";

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

/* ---------------------- per-section template header lines ------------------ */
// These mirror the descriptors in src/lib/importSections (derived from the
// manual forms). The template DOWNLOAD must equal these exactly (F3.3.1).

const GROUP_HEADER_LINE = [
  "group_name",
  "group_tin",
  "npi_type2",
  "operating_states",
  "website_url",
  "billing_street",
  "billing_suite",
  "billing_city",
  "billing_state",
  "billing_zip",
  "billing_contact_name",
  "billing_phone",
  "billing_fax",
  "billing_email",
  "corr_street",
  "corr_suite",
  "corr_city",
  "corr_state",
  "corr_zip",
  "corr_contact_name",
  "corr_phone",
  "corr_fax",
  "corr_email",
  "cred_street",
  "cred_suite",
  "cred_city",
  "cred_state",
  "cred_zip",
  "cred_contact_name",
  "cred_phone",
  "cred_fax",
  "cred_email",
].join(",");

const FACILITY_HEADER_LINE = [
  "facility_name",
  "group_name",
  "group_tin",
  "street",
  "suite",
  "city",
  "state",
  "zip",
  "county",
  "phone",
  "fax",
  "email",
  "appointment_phone",
  "contact_name",
  "accepting_new_patients",
  "languages_offered",
  "interpreter_languages",
  "ada_accessible",
  "ada_notes",
].join(",");

const PROVIDER_HEADER_LINE = [
  "group_name",
  "group_tin",
  "provider_first_name",
  "provider_middle_initial",
  "provider_last_name",
  "npi",
  "caqh_id",
  "specialty",
  "taxonomy_code",
  "license_number",
  "license_state",
  "license_issue_date",
  "license_expiration_date",
  "ssn_last4",
  "date_of_birth",
  // E6.4 F6.4.6 — the one-row-per-relationship columns.
  "facility_name",
  "enrollment_payer",
  "enrollment_state",
  "enrollment_effective_date",
].join(",");

// The retired E3.0 combined 20-column template (provider identity + facility
// columns in one file — the signature the gate detects, TE-7).
const COMBINED_HEADER_LINE = [
  "group_name",
  "group_tin",
  "provider_first_name",
  "provider_middle_initial",
  "provider_last_name",
  "npi",
  "caqh_id",
  "specialty",
  "taxonomy_code",
  "license_number",
  "license_state",
  "license_issue_date",
  "license_expiration_date",
  "ssn_last4",
  "date_of_birth",
  "facility_name",
  "facility_street",
  "facility_city",
  "facility_state",
  "facility_zip",
].join(",");

function csvFile(name: string, content: string) {
  return { name, mimeType: "text/csv", buffer: Buffer.from(content, "utf8") };
}

/* -------------------------------- Fixtures ------------------------------- */

function makeFixtures() {
  return {
    organizations: [
      { id: ORG_ID, name: "Tree Hill Sports Therapy", lifecycle_state: "active", created_at: NOW },
    ],
    memberships: [
      {
        org_id: ORG_ID,
        role: "admin",
        organizations: {
          name: "Tree Hill Sports Therapy",
          lifecycle_state: "active",
          created_at: NOW,
        },
      },
    ],
    profiles: [
      { id: USER_ID, full_name: "Sowmya Seed", email: "sowmya.seed@example.test", created_at: NOW },
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
    contracts: [],
    tasks: [],
    import_runs: [],
    import_rows: [],
  } as Record<string, Record<string, unknown>[]>;
}

function activeGroup() {
  return {
    id: GROUP_ID,
    org_id: ORG_ID,
    name: "Tree Hill Sports Therapy LLC",
    tin: "123456789",
    is_active: true,
    states: ["NC"],
    created_at: NOW,
  };
}

const LIVE_TABLES = ["providers", "provider_groups", "facilities", "state_licenses"];

function makeHandler(
  fixtures: Record<string, Record<string, unknown>[]>,
  writes: Array<{ table: string; method: string }>,
) {
  let seq = 100;
  return async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.endsWith("/rpc/claim_invites")) return json(0);

    if (url.pathname.endsWith("/rpc/stage_import_rows")) {
      const body = JSON.parse(req.postData() ?? "{}") as {
        p_run_id: string;
        p_rows: Array<Record<string, unknown>>;
      };
      const rows = fixtures.import_rows;
      const claimed = new Set(
        rows.filter((r) => r.run_id === body.p_run_id).map((r) => r.line as number),
      );
      for (const e of body.p_rows) {
        const line = e.line as number;
        if (claimed.has(line)) continue;
        claimed.add(line);
        rows.push({
          id: `import-row-${seq++}`,
          org_id: ORG_ID,
          run_id: body.p_run_id,
          line,
          raw: e.raw,
          mapped: e.mapped,
          row_state: e.row_state,
          error_column: e.error_column,
          error_reason: e.error_reason,
          created_at: NOW,
        });
      }
      const run = fixtures.import_runs.find((r) => r.id === body.p_run_id);
      if (run) {
        const mine = rows.filter((r) => r.run_id === run.id);
        run.staged_rows = mine.filter((r) => r.row_state === "staged").length;
        run.error_rows = mine.filter((r) => r.row_state === "error").length;
      }
      return json(null);
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

    const matchFilters = (row: Record<string, unknown>): boolean => {
      for (const [key, raw] of url.searchParams.entries()) {
        if (["select", "order", "limit", "offset"].includes(key)) continue;
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

    if (req.method() === "POST") {
      writes.push({ table, method: "POST" });
      const body = JSON.parse(req.postData() ?? "[]") as
        Record<string, unknown> | Record<string, unknown>[];
      const rows = Array.isArray(body) ? body : [body];
      if (table === "import_runs") {
        const created = rows.map((r) => ({
          id: `run-${seq++}`,
          created_at: NOW,
          updated_at: NOW,
          error_report: null,
          ...r,
        }));
        fixtures.import_runs.push(...created);
        return json(wantsObject ? created[0] : created, 201);
      }
      if (table === "audit_log") {
        fixtures.audit_log.push(...rows);
        return json(null, 201);
      }
      // Mirror the DB default: provider_groups/facilities are active on insert
      // (so a committed import shows in the wizard's active list, F3.3.2 chip).
      const created = rows.map((r) => ({
        id: `${table}-${seq++}`,
        created_at: NOW,
        is_active: r.is_active ?? true,
        ...r,
      }));
      fixtures[table] = [...(fixtures[table] ?? []), ...created];
      return json(wantsObject ? created[0] : created, 201);
    }
    if (req.method() === "PATCH") {
      writes.push({ table, method: "PATCH" });
      const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
      const targets = (fixtures[table] ?? []).filter(matchFilters);
      for (const t of targets) Object.assign(t, body);
      return json(wantsObject ? (targets[0] ?? {}) : targets);
    }
    if (req.method() === "DELETE") {
      writes.push({ table, method: "DELETE" });
      const rows = fixtures[table] ?? [];
      const removed = rows.filter(matchFilters);
      fixtures[table] = rows.filter((r) => !removed.includes(r));
      return json(removed);
    }

    const rows = (fixtures[table] ?? []).filter(matchFilters);
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  };
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

async function downloadText(page: Page, click: () => Promise<void>): Promise<string> {
  const p = page.waitForEvent("download");
  await click();
  const dl = await p;
  return readFileSync((await dl.path()) as string, "utf8");
}

/* --------------------------------- TS-65 --------------------------------- */

test("TS-65: each wizard section shows manual + upload; templates match the form", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  fixtures.provider_groups = [activeGroup()]; // so facility/provider uploads are allowed
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures, []));
  await seedAuth(context);

  await page.goto("/onboarding/wizard");

  const groupCard = page.locator("#wizard-provider-group");
  const facilityCard = page.locator("#wizard-facilities");
  const providerCard = page.locator("#wizard-providers");
  await expect(groupCard).toBeVisible({ timeout: 30000 });

  // Each section: manual form beside the shared COLLAPSED import disclosure
  // (2026-07-20) — the labeled trigger shows; template + drop zone on expand.
  await expect(groupCard.getByRole("button", { name: "Add another group" })).toBeVisible();
  await expect(groupCard.getByText("Bulk provider group import")).toBeVisible();
  await expect(
    groupCard.getByRole("button", { name: "Download Provider group template" }),
  ).toHaveCount(0);
  await groupCard.getByText("Bulk provider group import").click();
  await expect(
    groupCard.getByRole("button", { name: "Download Provider group template" }),
  ).toBeVisible();
  await expect(groupCard.getByRole("button", { name: /Upload roster CSV/ })).toBeVisible();

  // Facilities: manual + upload.
  await expect(facilityCard.getByRole("button", { name: "Add facility" })).toBeVisible();
  await expect(facilityCard.getByText("Bulk facility import")).toBeVisible();
  await facilityCard.getByText("Bulk facility import").click();
  await expect(
    facilityCard.getByRole("button", { name: "Download Facility template" }),
  ).toBeVisible();
  await expect(facilityCard.getByRole("button", { name: /Upload roster CSV/ })).toBeVisible();

  // Providers: manual + upload.
  await expect(providerCard.getByRole("button", { name: "Add provider" })).toBeVisible();
  await expect(providerCard.getByText("Bulk provider import")).toBeVisible();
  await providerCard.getByText("Bulk provider import").click();
  await expect(
    providerCard.getByRole("button", { name: "Download Provider template" }),
  ).toBeVisible();
  await expect(providerCard.getByRole("button", { name: /Upload roster CSV/ })).toBeVisible();

  // Each downloadable template matches its section's fields exactly (F3.3.1).
  expect(
    await downloadText(page, () =>
      groupCard.getByRole("button", { name: "Download Provider group template" }).click(),
    ),
  ).toBe(GROUP_HEADER_LINE);
  expect(
    await downloadText(page, () =>
      facilityCard.getByRole("button", { name: "Download Facility template" }).click(),
    ),
  ).toBe(FACILITY_HEADER_LINE);
  expect(
    await downloadText(page, () =>
      providerCard.getByRole("button", { name: "Download Provider template" }).click(),
    ),
  ).toBe(PROVIDER_HEADER_LINE);
});

/* --------------------------------- TS-66 --------------------------------- */

test("TS-66: facilities upload blocked without a group, proceeds + commits after one exists", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  const writes: Array<{ table: string; method: string }> = [];
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures, writes));
  await seedAuth(context);

  await page.goto("/onboarding/wizard");
  const facilityCard = page.locator("#wizard-facilities");
  await expect(facilityCard).toBeVisible({ timeout: 30000 });

  // Blocked without a group: a disabled drop zone with a pointer, never a
  // file input (behind the shared collapsed disclosure — expand first).
  await facilityCard.getByText("Bulk facility import").click();
  await expect(facilityCard.getByText("Add a provider group first")).toBeVisible();
  await expect(
    facilityCard.getByRole("button", { name: "Download Facility template" }),
  ).toHaveCount(0);

  // A group exists → the upload proceeds (reload resets the disclosure).
  fixtures.provider_groups = [activeGroup()];
  await page.reload();
  await expect(facilityCard.getByText("Bulk facility import")).toBeVisible({ timeout: 15000 });
  await facilityCard.getByText("Bulk facility import").click();
  await expect(facilityCard.getByText("Add a provider group first")).toHaveCount(0);
  await expect(
    facilityCard.getByRole("button", { name: "Download Facility template" }),
  ).toBeVisible();

  // Upload one facility referencing the group by TIN → stage → ready_for_review.
  const facilityRow = "Riverside Clinic,,123456789,10 Dockside Dr,,Wilmington,NC,28401,,,,,,,,,,,";
  await facilityCard
    .locator('input[type="file"]')
    .setInputFiles(csvFile("facilities.csv", [FACILITY_HEADER_LINE, facilityRow].join("\n")));
  await expect(facilityCard.getByText("1 data row")).toBeVisible();
  await facilityCard.getByRole("button", { name: "Start import" }).click();
  await expect(facilityCard.getByRole("link", { name: /Review & commit/ })).toBeVisible({
    timeout: 15000,
  });

  // Review → commit through the facility fan-out.
  await facilityCard.getByRole("link", { name: /Review & commit/ }).click();
  await expect(page.getByRole("heading", { name: "Review import" })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("New facilities to create")).toBeVisible();
  await page.getByRole("button", { name: "Commit Changes" }).click();
  await page.getByRole("button", { name: "Yes, commit changes" }).click();

  await expect(page.getByText("This facility import has been committed.")).toBeVisible({
    timeout: 15000,
  });

  // The facility was created via createFacility (not the provider RPC), the run
  // committed, and staged rows purged.
  expect(fixtures.facilities).toHaveLength(1);
  expect(fixtures.facilities[0].name).toBe("Riverside Clinic");
  expect(writes.some((w) => w.table === "facilities" && w.method === "POST")).toBe(true);
  expect(fixtures.import_runs[0].state).toBe("committed");
  expect(fixtures.import_rows).toHaveLength(0);

  // The chip reflects upload-created data: back in the wizard, the Facilities
  // section lists the imported facility exactly as a manually-added one.
  await page.goto("/onboarding/wizard");
  await expect(page.locator("#wizard-facilities").getByText("Riverside Clinic")).toBeVisible({
    timeout: 15000,
  });
});

/* --------------------------------- TS-67 --------------------------------- */

test("TS-67: combined template retired — rejected with guidance; three uploads; combined run reviewable", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  // A pre-existing combined-era staged run stays reviewable (F3.3.3).
  fixtures.import_runs = [
    {
      id: RUN_ID,
      org_id: ORG_ID,
      created_by: USER_ID,
      source: "internal",
      entity_kind: "combined",
      file_name: "legacy-roster.csv",
      state: "ready_for_review",
      total_rows: 1,
      staged_rows: 1,
      error_rows: 0,
      error_report: [],
      created_at: NOW,
      updated_at: NOW,
    },
  ];
  fixtures.import_rows = [
    {
      id: "row-legacy",
      org_id: ORG_ID,
      run_id: RUN_ID,
      line: 2,
      row_state: "staged",
      mapped: {
        group_name: "Legacy Group",
        group_tin: "223344556",
        provider_first_name: "Peyton",
        provider_last_name: "Sawyer",
        npi: "1902833742",
      },
      created_at: NOW,
    },
  ];
  fixtures.provider_groups = [activeGroup()]; // ladder: allow all three uploads
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures, []));
  await seedAuth(context);

  // /admin/import retired (E6.1 F6.1.6) — the three per-section uploads live
  // beside the manual forms in the wizard sections (E3.3), which is where the
  // combined-template gate now meets users.
  await page.goto("/onboarding/wizard");
  await expect(page.getByRole("heading", { name: "Onboarding" })).toBeVisible({
    timeout: 30000,
  });

  // Three per-section uploads, no combined uploader anywhere (each behind
  // the shared collapsed disclosure — expand to reach the controls).
  const groupCard = page.locator("#wizard-provider-group");
  const facilityCard = page.locator("#wizard-facilities");
  const providerCard = page.locator("#wizard-providers");
  await groupCard.getByText("Bulk provider group import").click();
  await facilityCard.getByText("Bulk facility import").click();
  await providerCard.getByText("Bulk provider import").click();
  await expect(
    groupCard.getByRole("button", { name: "Download Provider group template" }),
  ).toBeVisible();
  await expect(
    facilityCard.getByRole("button", { name: "Download Facility template" }),
  ).toBeVisible();
  await expect(
    providerCard.getByRole("button", { name: "Download Provider template" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Download CSV template" })).toHaveCount(0);

  // The legacy combined file is rejected at the gate naming the replacements.
  const combinedRow = "Tree Hill,12-3456789,Nathan,R,Scott,1234567893,,,,,,,,,,,,,,";
  await providerCard
    .locator('input[type="file"]')
    .setInputFiles(csvFile("combined.csv", [COMBINED_HEADER_LINE, combinedRow].join("\n")));
  const alert = providerCard.getByRole("alert");
  await expect(alert).toContainText("retired combined roster template");
  await expect(alert).toContainText("per-section");

  // The in-flight combined run stays reviewable at its review URL.
  await page.goto(`/import/${RUN_ID}`);
  await expect(page.getByRole("heading", { name: "Review import" })).toBeVisible({
    timeout: 15000,
  });
  // The provider dedupe engine renders for a combined/provider run.
  await expect(page.getByText("New providers to create")).toBeVisible();
});

/* --------------------------------- TS-68 --------------------------------- */

const CAPTURE_ACTIVE = {
  state: "active",
  org_name: "Rose City Rehab Collective",
  recipient_name: "Candace Devereaux",
  recipient_email: "contact.rose-city@example.test",
  expires_at: "2026-12-31T17:00:00Z",
  required_fields: ["name", "email"],
  current: {
    name: "Candace Devereaux",
    email: "contact.rose-city@example.test",
    phone_office: null,
    phone_mobile: null,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    postal_code: null,
    country: null,
  },
};

test("TS-68: capture surface gains no upload/section capability; converted org lands in the sectioned wizard", async ({
  context,
  page,
}) => {
  // The public capture route (anon; no session). TE-9 fence: the surface gains
  // ZERO upload/group/facility/provider capability.
  await context.route(/\/(rest|auth)\/v1\//, async (route: Route) => {
    const url = new URL(route.request().url());
    const json = (b: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (url.pathname.endsWith("/rpc/validate_capture_token")) return json(CAPTURE_ACTIVE);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);
    if (url.pathname.includes("/auth/v1/")) return json({});
    return json([]);
  });

  await page.goto("/capture/testtoken123");
  await expect(page.getByRole("heading", { name: "Confirm your details" })).toBeVisible({
    timeout: 30000,
  });
  // The fence: no roster upload / section affordances anywhere on the surface.
  await expect(page.getByRole("button", { name: /Upload roster CSV/ })).toHaveCount(0);
  await expect(page.getByText(/Bulk .* import/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Download .* template/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add facility" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add provider" })).toHaveCount(0);

  // A converted org continues into the SAME sectioned wizard (org-intake done,
  // ladder sections with uploads ready). Re-route to the authenticated harness.
  const fixtures = makeFixtures();
  fixtures.provider_groups = [activeGroup()];
  await context.unroute(/\/(rest|auth)\/v1\//);
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures, []));
  await seedAuth(context);

  await page.goto("/onboarding/wizard");
  await expect(page.locator("#wizard-facilities").getByText("Bulk facility import")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator("#wizard-providers").getByText("Bulk provider import")).toBeVisible();
});

test("no live-table writes occur just by rendering the sectioned wizard", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  fixtures.provider_groups = [activeGroup()];
  const writes: Array<{ table: string; method: string }> = [];
  await context.route(/\/(rest|auth)\/v1\//, makeHandler(fixtures, writes));
  await seedAuth(context);

  await page.goto("/onboarding/wizard");
  await expect(page.locator("#wizard-providers").getByText("Bulk provider import")).toBeVisible({
    timeout: 30000,
  });
  expect(writes.filter((w) => LIVE_TABLES.includes(w.table) && w.method !== "GET")).toHaveLength(0);
});
