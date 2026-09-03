import { test, expect, type Route } from "@playwright/test";
import { withPortalPayerEmbed } from "./portalPayerEmbed";

// Payer & Cases design bundle, screen 3 (Slice C) — the TABBED Payer Detail
// over the mock harness, one test per designed state:
//   Overview (#overview)     — identity, ID expectations, aliases, delegation
//                              note, state coverage, contacts.
//   Edit in place (§2.11)    — "Edit payer" swaps Slice B's SAME form onto the
//                              same URL; the retired standalone edit page
//                              redirects here with ?edit=1 and opens it.
//   Enrollments (#enrollments) — providers credentialed with this payer, IDs
//                              under the payer's OWN label; read-only.
//   Cases (#cases)           — open cases by PAYER PIPELINE stage, link-out only.
//   Templates (#process)     — list + state coverage in the header, the
//                              Active-match chip, and the ?intent= next step.
//   No template yet          — the fallback explainer + Author CTA.
//   Scorecard (#scorecard)   — §2.10 fold: the standalone route redirects into
//                              this tab; there is exactly ONE scorecard.
//   Manage (#manage)         — §2.2 collapse: Archive is the ONE removal verb,
//                              and both typed rejections are SURFACED (the
//                              blocking open-case count / the conflicting
//                              C-<n> list), never swallowed into a toast.
//   Portals (#portals)       — the payer-scoped portal inventory, and the
//                              drawer's FIELD MAPPING block: a mapping
//                              decision made here writes the same shared row,
//                              through the same RPC, as the Template Editor's
//                              Form setup step.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "00000000-0000-4000-a000-000000000005";
const AETNA_ID = "00000000-0000-4000-a000-0000000000aa";
const CIGNA_ID = "00000000-0000-4000-a000-0000000000af";
const UHC_ID = "00000000-0000-4000-a000-0000000000ba";
const PROV_A = "22222222-2222-4222-8222-000000000001";
const PROV_B = "22222222-2222-4222-8222-000000000002";
const CASE_APPROVED = "33333333-3333-4333-8333-000000000001";
const CASE_OPEN = "33333333-3333-4333-8333-000000000002";
const CASE_OPEN_2 = "33333333-3333-4333-8333-000000000003";
const TPL_ORG = "44444444-4444-4444-8444-000000000001";
const TPL_GLOBAL = "44444444-4444-4444-8444-000000000002";

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
    email: "owner.dillon@example.test",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Owner Dillon" },
    created_at: "2026-07-09T00:00:00Z",
  },
};

type Row = Record<string, unknown>;

function payerRow(id: string, name: string, extra: Row = {}): Row {
  return {
    id,
    org_id: null,
    name,
    is_active: true,
    avg_decision_days: null,
    payer_kind: "commercial",
    payer_slug: null,
    aliases: [],
    states: ["AZ"],
    status: "active",
    merged_into_id: null,
    delegation_note: null,
    archived_at: null,
    group_id_label: null,
    group_id_expected: false,
    provider_id_label: null,
    provider_id_expected: false,
    resolution_id_label: null,
    resolution_id_expected: null,
    source: "manual",
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-07-12T00:00:00Z",
    ...extra,
  };
}

function templateRow(id: string, extra: Row = {}): Row {
  return {
    id,
    org_id: null,
    name: "Aetna — AZ enrollment",
    payer_id: AETNA_ID,
    state: "AZ",
    group_id: null,
    specialty: null,
    archived: false,
    current_version: 1,
    task_definitions: [
      { title: "Submit the application", steps: [{ label: "Portal", stepType: "online_form" }] },
    ],
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-07-14T00:00:00Z",
    ...extra,
  };
}

function caseRow(id: string, extra: Row = {}): Row {
  return {
    id,
    org_id: ORG_ID,
    case_number: 1001,
    provider_id: PROV_A,
    payer_id: AETNA_ID,
    state: "AZ",
    group_id: null,
    facility_id: null,
    mso_id: null,
    credentialing_status_id: null,
    case_status: "in_progress",
    contract_executed_date: null,
    assigned_to: null,
    submitted_date: null,
    approved_date: null,
    confirmed_effective_date: null,
    expected_effective_date: null,
    termination_date: null,
    generation_run_id: null,
    payer_reference_id: null,
    payer_individual_provider_id: null,
    payer_group_provider_id: null,
    payer_pipeline_state: "in_review",
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-07-12T00:00:00Z",
    ...extra,
  };
}

function providerRow(id: string, first: string, last: string): Row {
  return {
    id,
    org_id: ORG_ID,
    first_name: first,
    last_name: last,
    credentials: "MD",
    email: null,
    npi: "1234567890",
    caqh_id: null,
    caqh_attested_date: null,
    specialty: null,
    taxonomy_code: null,
    dea_number: null,
    status: "active",
    verification_state: "verified",
    reference_only: false,
    is_test_provider: false,
    home_state: "AZ",
    start_date: null,
    group_id: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
  };
}

function buildDb(): Record<string, Row[]> {
  return {
    memberships: [
      {
        org_id: ORG_ID,
        role: "admin",
        organizations: {
          name: "Dillon Sports Medicine",
          lifecycle_state: "active",
          created_at: "2026-07-01T00:00:00Z",
        },
      },
    ],
    profiles: [{ id: USER_ID, full_name: "Owner Dillon", email: "owner.dillon@example.test" }],
    payers: [
      payerRow(AETNA_ID, "Aetna (CVS Health)", {
        aliases: ["Aetna Signature Administrators"],
        states: ["AZ", "CA", "CO"],
        payer_slug: "aetna",
        group_id_expected: true,
        group_id_label: "Group PIN",
        provider_id_expected: true,
        provider_id_label: "Provider Number",
        delegation_note: "Delegates credentialing to the group for contracted TINs.",
      }),
      // The pre-E6.7 shape: NULL expectation columns resolve provider-EXPECTED
      // with the generic label through the SHARED resolver chain.
      payerRow(CIGNA_ID, "Cigna Healthcare", {
        states: ["CO"],
        provider_id_expected: null,
        provider_id_label: null,
        group_id_expected: null,
        group_id_label: null,
      }),
      payerRow(UHC_ID, "UnitedHealthcare", { states: ["AZ"] }),
    ],
    org_payer_assignments: [
      { id: "as-1", org_id: ORG_ID, payer_id: AETNA_ID, starter: false, status: "active" },
      { id: "as-2", org_id: ORG_ID, payer_id: CIGNA_ID, starter: false, status: "active" },
      { id: "as-3", org_id: ORG_ID, payer_id: UHC_ID, starter: false, status: "active" },
    ],
    payer_network_targets: [
      {
        id: "t-1",
        org_id: ORG_ID,
        group_id: "g-1",
        payer_id: AETNA_ID,
        state: "CO",
        status: "active",
        payer_issued_id: null,
        created_at: "2026-07-12T00:00:00Z",
      },
      {
        id: "t-2",
        org_id: ORG_ID,
        group_id: "g-1",
        payer_id: CIGNA_ID,
        state: "CO",
        status: "active",
        payer_issued_id: null,
        created_at: "2026-07-12T00:00:00Z",
      },
      {
        id: "t-3",
        org_id: ORG_ID,
        group_id: "g-1",
        payer_id: UHC_ID,
        state: "AZ",
        status: "active",
        payer_issued_id: null,
        created_at: "2026-07-12T00:00:00Z",
      },
    ],
    payer_contacts: [
      {
        id: "pc-1",
        payer_id: AETNA_ID,
        purpose: "credentialing",
        name: "Provider relations desk",
        email: "credentialing@aetna.test",
        phone: null,
        note: "Mon–Fri, 8–5 MT",
        is_default: true,
        created_at: "2026-07-12T00:00:00Z",
      },
    ],
    providers: [providerRow(PROV_A, "Ada", "Alvarez"), providerRow(PROV_B, "Boone", "Baker")],
    credential_cases: [
      caseRow(CASE_APPROVED, {
        case_number: 1042,
        case_status: "approved",
        payer_pipeline_state: "approved",
        provider_id: PROV_A,
        approved_date: "2026-06-15",
        confirmed_effective_date: "2026-07-01",
        payer_individual_provider_id: "PRV-77",
      }),
      caseRow(CASE_OPEN, {
        case_number: 1043,
        provider_id: PROV_B,
        submitted_date: "2026-07-10",
        payer_pipeline_state: "submitted",
      }),
      caseRow(CASE_OPEN_2, { case_number: 1044, provider_id: PROV_A, payer_id: UHC_ID }),
    ],
    enrollment_facts: [
      {
        id: "ef-1",
        org_id: ORG_ID,
        provider_id: PROV_B,
        group_id: "g-1",
        payer_id: AETNA_ID,
        state: "CO",
        effective_date: "2026-05-01",
        payer_issued_id: null,
        expired_at: null,
        created_at: "2026-05-01T00:00:00Z",
      },
    ],
    sop_templates: [
      templateRow(TPL_GLOBAL, { id: TPL_GLOBAL, name: "Aetna — AZ enrollment (global)" }),
      // An ORG override on the same key shadows the global row — only ONE of
      // the two is the active match a case actually runs.
      templateRow(TPL_ORG, {
        id: TPL_ORG,
        org_id: ORG_ID,
        name: "Aetna — AZ enrollment (our version)",
      }),
    ],
    provider_groups: [
      { id: "g-1", org_id: ORG_ID, name: "Dillon Sports Medicine", is_active: true },
    ],
    portals: [],
    portal_field_maps: [],
    fill_sessions: [],
    status_configs: [],
    notes: [],
    user_table_prefs: [],
  };
}

const PORTAL_KEY = "aetna_az_enrollment";

const TOKEN_CATALOG = [
  { table: "providers", token: "provider.npi", column: "npi" },
  { table: "providers", token: "provider.firstName", column: "first_name" },
  { table: "provider_groups", token: "group.tin", column: "tin" },
];

function portalRow(extra: Row = {}): Row {
  return {
    id: "portal-aetna",
    org_id: null, // global tier — inherited by every org
    portal_key: PORTAL_KEY,
    name: "Aetna AZ Enrollment",
    payer_id: AETNA_ID,
    form_url: "https://portal.aetna.test/enroll",
    is_verified: true,
    last_verified_at: "2026-07-14T00:00:00Z",
    proven_at: null,
    url_changed_at: null,
    created_at: "2026-07-13T00:00:00Z",
    updated_at: "2026-07-14T00:00:00Z",
    ...extra,
  };
}

/** Shared-tier (`org_id IS NULL`) field map — where trained forms live. */
function fieldMapRow(
  id: string,
  label: string,
  extra: { status: string; source: string; token?: string | null; sortOrder: number },
): Row {
  return {
    id,
    org_id: null,
    portal_key: PORTAL_KEY,
    url_pattern: null,
    page_step: null,
    map_type: "web",
    selector: `#${id}`,
    selector_fallbacks: null,
    source: extra.source,
    token: extra.token ?? null,
    hardcoded_value: null,
    transform: null,
    field_type: "text",
    notes: extra.source === "manual" ? "Captured from the form" : null,
    status: extra.status,
    field_label: label,
    display_label: null,
    section: "Identity",
    sort_order: extra.sortOrder,
    form_section: null,
    confidence: 60,
    control_options: null,
    created_at: "2026-07-13T00:00:00Z",
    updated_at: "2026-07-13T00:00:00Z",
  };
}

interface RecordedCall {
  path: string;
  body: Record<string, unknown>;
}

let db: Record<string, Row[]> | null = null;
const rpcCalls: RecordedCall[] = [];
const tableWrites: Array<{ table: string; method: string }> = [];
let archiveError: string | null = null;
let mergeError: string | null = null;

async function fulfillSupabase(route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  db ??= buildDb();

  if (url.pathname.includes("/auth/v1/")) return json(SESSION);

  if (url.pathname.includes("/rest/v1/rpc/")) {
    const fn = url.pathname.split("/rpc/")[1] ?? "";
    const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    rpcCalls.push({ path: fn, body });

    if (fn === "list_global_payers") return json(db.payers.filter((p) => p.org_id === null));
    if (fn === "claim_invites") return json(0);
    if (fn === "get_sop_field_tokens") return json(TOKEN_CATALOG);
    // The shared-tier trainer. Field maps carry no org, so this RPC is the
    // ONLY way a decision can be written — the Portals-drawer test asserts the
    // drawer uses it rather than a table PATCH.
    if (fn === "train_global_field_map") {
      const row = db.portal_field_maps.find((m) => m.id === body.p_id && m.org_id === null);
      if (!row) return json({ message: "Field map not found" }, 400);
      const source = String(body.p_source ?? "");
      Object.assign(row, {
        status: body.p_status,
        source,
        token: body.p_token ?? null,
        hardcoded_value: source === "hardcoded" ? (body.p_hardcoded_value ?? null) : null,
        updated_at: "2026-07-28T00:00:00Z",
      });
      return json(row);
    }
    if (fn === "update_payer") {
      const row = db.payers.find((p) => p.id === body.p_payer_id);
      if (!row) return json({ message: "payer_not_found" }, 400);
      Object.assign(row, {
        name: body.p_name,
        payer_kind: body.p_payer_kind,
        states: body.p_states ?? [],
        aliases: body.p_aliases ?? [],
        group_id_expected: body.p_group_id_expected ?? false,
        group_id_label: body.p_group_id_label ?? null,
        provider_id_expected: body.p_provider_id_expected ?? false,
        provider_id_label: body.p_provider_id_label ?? null,
        delegation_note: body.p_delegation_note ?? null,
      });
      return json(row);
    }
    if (fn === "archive_payer") {
      if (archiveError) return json({ message: archiveError }, 400);
      const row = db.payers.find((p) => p.id === body.p_payer_id);
      if (row) row.archived_at = "2026-07-28T00:00:00Z";
      return json(row ?? null);
    }
    if (fn === "reactivate_payer") {
      const row = db.payers.find((p) => p.id === body.p_payer_id);
      if (row) row.archived_at = null;
      return json(row ?? null);
    }
    if (fn === "merge_payer") {
      if (mergeError) return json({ message: mergeError }, 400);
      const loser = db.payers.find((p) => p.id === body.p_loser_id);
      const survivor = db.payers.find((p) => p.id === body.p_survivor_id);
      if (loser) {
        loser.status = "merged";
        loser.merged_into_id = survivor?.id ?? null;
      }
      return json({
        survivor,
        moved_open_cases: 1,
        moved_templates: 2,
        moved_targets: 0,
        moved_facts: 0,
      });
    }
    if (fn === "upsert_payer_contact") {
      const row = {
        id: body.p_id ?? `pc-${db.payer_contacts.length + 1}`,
        payer_id: body.p_payer_id,
        purpose: body.p_purpose,
        name: body.p_name ?? null,
        email: body.p_email ?? null,
        phone: body.p_phone ?? null,
        note: body.p_note ?? null,
        is_default: body.p_is_default ?? false,
        created_at: "2026-07-28T00:00:00Z",
      };
      const existing = db.payer_contacts.findIndex((c) => c.id === row.id);
      if (existing >= 0) db.payer_contacts[existing] = row;
      else db.payer_contacts.push(row);
      if (row.is_default) {
        for (const c of db.payer_contacts) {
          if (c.id !== row.id && c.payer_id === row.payer_id && c.purpose === row.purpose) {
            c.is_default = false;
          }
        }
      }
      return json(row);
    }
    if (fn === "delete_payer_contact") {
      db.payer_contacts = db.payer_contacts.filter((c) => c.id !== body.p_id);
      return json(null);
    }
    return json(null);
  }

  const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
  const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

  const matchFilters = (row: Row): boolean => {
    for (const [key, raw] of url.searchParams.entries()) {
      if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(key)) continue;
      if (!(key in row)) continue;
      if (raw.startsWith("eq.") && String(row[key]) !== raw.slice(3)) return false;
      if (raw.startsWith("neq.") && String(row[key]) === raw.slice(4)) return false;
      if (raw.startsWith("is.") && raw.slice(3) === "null" && row[key] !== null) return false;
    }
    return true;
  };

  if (req.method() !== "GET" && req.method() !== "HEAD") {
    tableWrites.push({ table, method: req.method() });
    return json(wantsObject ? {} : [{}], 201);
  }

  // listPortals selects a `payers(...)` embed and the harness must synthesize
  // it, or a portals fixture drifts from the real wire shape.
  const rows = withPortalPayerEmbed(
    table,
    url.searchParams.get("select"),
    (db[table] ?? []).filter(matchFilters),
    db.payers ?? [],
  );
  if (wantsObject) {
    if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
    return json(rows[0]);
  }
  return json(rows);
}

async function seed(context: import("@playwright/test").BrowserContext, role = "admin") {
  db = buildDb();
  db.memberships[0].role = role;
  rpcCalls.length = 0;
  tableWrites.length = 0;
  archiveError = null;
  mergeError = null;
  await context.route(/\/(rest|auth)\/v1\//, fulfillSupabase);
  await context.addInitScript(
    ([authKey, session, orgId]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_ID] as const,
  );
}

async function openDetail(page: import("@playwright/test").Page, payerId = AETNA_ID, search = "") {
  await page.goto(`/admin/payer-admin/setup/${payerId}${search}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30000 });
}

const tab = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("tab", { name, exact: true });

test("overview — identity, both ID expectations, aliases, delegation, coverage, contacts", async ({
  context,
  page,
}) => {
  await seed(context);
  await openDetail(page);

  await expect(page.getByRole("heading", { name: "Aetna (CVS Health)" })).toBeVisible();
  await expect(page.getByText("In my network")).toBeVisible();

  // Catalog facts read through the SHARED resolvers — never a local default.
  await expect(page.getByText("aetna", { exact: true })).toBeVisible(); // catalog key
  await expect(page.getByText("Provider Number")).toBeVisible();
  await expect(page.getByText("Group PIN")).toBeVisible();
  await expect(page.getByText(/Delegates credentialing to the group/)).toBeVisible();
  await expect(page.getByText("Aetna Signature Administrators")).toBeVisible();
  await expect(page.getByText("State coverage (3)")).toBeVisible();

  // Contacts: one default row per purpose, on the payer_contacts seam.
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect(page.getByText("credentialing@aetna.test")).toBeVisible();
  await expect(page.getByText("Default", { exact: true })).toBeVisible();

  // Adding a contact writes through the audited RPC — never a table INSERT.
  await page.getByRole("button", { name: "+ Add contact" }).click();
  await page.getByLabel("Email", { exact: true }).fill("escalations@aetna.test");
  await page.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByText("escalations@aetna.test")).toBeVisible({ timeout: 15000 });
  expect(rpcCalls.filter((c) => c.path === "upsert_payer_contact")).toHaveLength(1);
  expect(tableWrites.filter((w) => w.table === "payer_contacts")).toEqual([]);
});

test("a NULL-column payer reads provider-EXPECTED (the shared chain, never a local default)", async ({
  context,
  page,
}) => {
  await seed(context);
  await openDetail(page, CIGNA_ID);
  await expect(page.getByRole("heading", { name: "Cigna Healthcare" })).toBeVisible();
  // Provider side defaults EXPECTED with the generic label; group side does not.
  await expect(page.getByText("Payer-issued ID")).toBeVisible();
  await expect(page.getByText("Not issued")).toBeVisible();
});

test("§2.11 editable in place — Edit swaps in the SAME form, and /edit redirects into it", async ({
  context,
  page,
}) => {
  await seed(context);
  await openDetail(page);

  await page.getByRole("button", { name: "Edit payer" }).click();
  await expect(page.getByRole("heading", { name: "Edit payer" })).toBeVisible();
  // Slice B's form, hydrated through the resolver chain — same fields, same
  // blast-radius warning, no second form implementation.
  await expect(page.getByLabel("Payer name", { exact: true })).toHaveValue("Aetna (CVS Health)");
  await expect(page.getByLabel("Provider-level ID — payer's name for it")).toHaveValue(
    "Provider Number",
  );
  await expect(
    page.getByText("Changes apply to every organization using this payer."),
  ).toBeVisible();

  await page.getByLabel("Provider-level ID — payer's name for it").fill("Aetna PIN");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect
    .poll(() => rpcCalls.filter((c) => c.path === "update_payer").length, { timeout: 15000 })
    .toBe(1);
  expect(rpcCalls.find((c) => c.path === "update_payer")?.body).toMatchObject({
    p_payer_id: AETNA_ID,
    p_provider_id_expected: true,
    p_provider_id_label: "Aetna PIN",
  });
  // Saving returns to the read card ON THE SAME PAGE — no navigation.
  await expect(page.getByRole("heading", { name: "Identity & enrollment ID" })).toBeVisible({
    timeout: 15000,
  });
  expect(tableWrites.filter((w) => w.table === "payers")).toEqual([]);

  // The retired standalone edit page keeps its URL AND its intent.
  await page.goto(`/admin/payers/${AETNA_ID}/edit`);
  await expect(page).toHaveURL(/\/admin\/payer-admin\/setup\//, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: "Edit payer" })).toBeVisible({ timeout: 30000 });
});

test("enrollments — captured IDs under the payer's own label, Awaiting ID, read-only", async ({
  context,
  page,
}) => {
  await seed(context);
  await openDetail(page);
  await tab(page, "Enrollments").click();

  await expect(page.getByRole("heading", { name: "Enrolled providers" })).toBeVisible();
  // The column header IS the payer's own wording for its ID.
  await expect(page.getByRole("columnheader", { name: "Provider Number" })).toBeVisible();
  // The approved case captured a value; the manual fact has none yet and the
  // payer DOES issue one, so it reads Awaiting ID (never a silent blank).
  await expect(page.getByText("PRV-77")).toBeVisible();
  await expect(page.getByText("Awaiting ID")).toBeVisible();
  await expect(page.getByRole("link", { name: "C-1042" })).toBeVisible();
  // Read-only: displaying enrollments never writes.
  expect(tableWrites).toEqual([]);
});

test("cases — this payer's OPEN cases by payer pipeline stage, link-out only", async ({
  context,
  page,
}) => {
  await seed(context);
  await openDetail(page);
  await tab(page, "Cases").click();

  await expect(page.getByRole("heading", { name: "Open cases" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Payer pipeline stage" })).toBeVisible();
  // The open case shows; the approved one does not, and another payer's never does.
  await expect(page.getByRole("link", { name: "C-1043" })).toBeVisible();
  await expect(page.getByRole("link", { name: "C-1042" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "C-1044" })).toHaveCount(0);
  // The EXTERNAL machine's stage, on the row itself.
  await expect(page.locator("tbody tr", { hasText: "C-1043" })).toContainText("Submitted");

  await page.getByRole("link", { name: "C-1043" }).click();
  await expect(page).toHaveURL(new RegExp(`/cases/${CASE_OPEN}$`), { timeout: 15000 });
});

test("templates — coverage in the header, the Active-match chip, and the ?intent= next step", async ({
  context,
  page,
}) => {
  await seed(context);
  await openDetail(page);
  await tab(page, "Templates").click();

  await expect(page.getByRole("heading", { name: "Templates" })).toBeVisible();
  // Coverage is counted against the payer's OWN states (AZ, CA, CO → 1 of 3).
  await expect(page.getByText("1 of 3 states covered.")).toBeVisible();

  // Both rows list, but only the one the LOCKED resolver runs is the active
  // match — the org override shadows the global row on the same key.
  const orgRow = page.locator("tbody tr", { hasText: "our version" });
  const globalRow = page.locator("tbody tr", { hasText: "(global)" });
  await expect(orgRow.getByText("Active match")).toBeVisible();
  await expect(globalRow.getByText("Active match")).toHaveCount(0);

  // The re-homed ?intent= producer: a published SOP with an online-form step
  // and no portal → "Register portal" deep-links the editor's register mode.
  const next = page.getByRole("link", { name: /Register portal/ });
  await expect(next).toBeVisible();
  await expect(next).toHaveAttribute("href", /intent=register/);
});

test("templates — the no-template empty state explains the fallback and offers Author", async ({
  context,
  page,
}) => {
  await seed(context);
  await openDetail(page, UHC_ID);
  await tab(page, "Templates").click();

  await expect(page.getByText("No template for this payer yet")).toBeVisible();
  await expect(page.getByText(/fall back to the default template/)).toBeVisible();
  await expect(page.getByRole("link", { name: "+ Author template" })).toBeVisible();
});

test("§2.10 scorecard fold — the standalone route redirects into the tab, and there is ONE scorecard", async ({
  context,
  page,
}) => {
  await seed(context);
  await page.goto(`/admin/payers/${AETNA_ID}/scorecard`);
  await expect(page).toHaveURL(/\/admin\/payer-admin\/setup\/.*tab=scorecard/, {
    timeout: 15000,
  });
  await expect(page.getByRole("heading", { name: "Scorecard" })).toHaveCount(1, {
    timeout: 30000,
  });
  await expect(page.getByText("Admin & billing")).toBeVisible();
  await expect(page.getByText("Mapping coverage")).toBeVisible();
});

test("§2.2 manage — Archive is the ONE removal verb, and the blocking open-case count is SURFACED", async ({
  context,
  page,
}) => {
  await seed(context);
  await openDetail(page);

  // The old assignment-remove verb is gone from the payer page entirely.
  await expect(page.getByRole("button", { name: "Remove from my network" })).toHaveCount(0);

  await tab(page, "Manage").click();
  await expect(page.getByRole("heading", { name: "Manage payer" })).toBeVisible();

  archiveError = "payer_archive_open_cases: 2";
  await page.getByRole("button", { name: "Archive payer" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Archive Aetna (CVS Health)");
  await dialog.getByRole("button", { name: "Archive payer" }).click();

  // The typed rejection renders its COUNT with a way to act on it, and the
  // confirm stays disabled — never a generic toast that loses the number.
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("2 open cases must be closed or moved first.", {
    timeout: 15000,
  });
  await expect(alert.getByRole("link", { name: "View open cases" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Archive payer" })).toBeDisabled();

  // Cleared: the archive lands and the page offers the reverse verb.
  archiveError = null;
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Archive payer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive payer" }).click();
  await expect(page.getByRole("button", { name: "Reactivate payer" })).toBeVisible({
    timeout: 15000,
  });
  expect(rpcCalls.filter((c) => c.path === "archive_payer")).toHaveLength(2);
  expect(tableWrites.filter((w) => w.table === "payers")).toEqual([]);
});

test("§2.2 manage — a merge conflict names the colliding cases; a clean merge reports what moved", async ({
  context,
  page,
}) => {
  await seed(context);
  await openDetail(page);
  await tab(page, "Manage").click();

  mergeError = "payer_merge_case_conflict: C-1043, C-1044";
  await page.getByRole("button", { name: "Merge payer" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Surviving payer").click();
  await page.getByRole("option", { name: "UnitedHealthcare" }).click();
  await dialog.getByRole("button", { name: "Merge", exact: true }).click();

  // The conflicting case numbers are RENDERED — the user can go close exactly
  // those instead of guessing.
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("C-1043 · C-1044", { timeout: 15000 });

  mergeError = null;
  await dialog.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(page.getByText(/merged into UnitedHealthcare/)).toBeVisible({ timeout: 15000 });
  expect(rpcCalls.filter((c) => c.path === "merge_payer")).toHaveLength(2);
});

test("a non-admin reads every tab but is offered no lifecycle verb", async ({ context, page }) => {
  await seed(context, "billing");
  await openDetail(page);

  await expect(page.getByRole("button", { name: "Edit payer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ Add contact" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Attach to a group" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add to my network" })).toHaveCount(0);

  await tab(page, "Manage").click();
  await expect(page.getByText("Managed by an admin")).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive payer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Merge payer" })).toHaveCount(0);
});

test("portals — the inventory lists this payer's portals and the row opens maintenance", async ({
  context,
  page,
}) => {
  await seed(context);
  db!.portals = [portalRow()];
  // One template step links the portal, so "Used by" is a real count and the
  // drawer's reference list is not the empty state.
  db!.sop_templates[0].task_definitions = [
    {
      title: "Submit the application",
      steps: [{ label: "Portal", stepType: "online_form", portalKey: PORTAL_KEY }],
    },
  ];
  await openDetail(page);
  await tab(page, "Portals").click();

  await expect(page.getByText(PORTAL_KEY)).toBeVisible({ timeout: 15000 });
  const row = page.getByRole("row").filter({ hasText: PORTAL_KEY });
  await expect(row).toContainText("Global");
  await expect(row).toContainText("1 step");

  await row.click();
  // The maintenance jobs the redesign exists for, on the portal itself.
  await expect(page.getByLabel("Form URL")).toHaveValue("https://portal.aetna.test/enroll");
  await expect(page.getByRole("button", { name: "Stop using this portal" }).first()).toBeVisible();
  await expect(page.getByText("Keys cannot be renamed", { exact: false })).toBeVisible();
});

test("portals — the drawer trains fields through the shared RPC, same as the editor", async ({
  context,
  page,
}) => {
  await seed(context);
  db!.portals = [portalRow()];
  db!.portal_field_maps = [
    fieldMapRow("npi", "NPI Number", {
      status: "approved",
      source: "token",
      token: "provider.npi",
      sortOrder: 1,
    }),
    fieldMapRow("tinstate", "Tax ID State", {
      status: "proposed",
      source: "manual",
      sortOrder: 2,
    }),
    // A second undecided row keeps the attention queue non-empty, so the
    // verification stamp never fires and this test stays about the decision.
    fieldMapRow("tineff", "Tax ID Effective Date", {
      status: "proposed",
      source: "manual",
      sortOrder: 3,
    }),
  ];
  await openDetail(page);
  await tab(page, "Portals").click();
  await page.getByRole("row").filter({ hasText: PORTAL_KEY }).click();

  // Field mapping is a first-class block in the drawer, opened on the work:
  // two rows need a decision, so the section is expanded on mount.
  await expect(page.getByText("Field mapping")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("2 to decide")).toBeVisible();
  await expect(page.getByText("1 of 3 mapped", { exact: true })).toBeVisible();
  // A DECIDED row stays listed and editable here too — the registry is a
  // working surface, never a queue.
  await expect(page.getByText("NPI Number")).toBeVisible();

  const target = page.locator("div.space-y-1\\.5.px-3.py-2", { hasText: "Tax ID State" }).first();
  await target.getByRole("combobox", { name: /Map Tax ID State to a token/i }).click();
  const menu = page.getByRole("listbox", { name: "Token options" });
  // A modal dialog turns off pointer events on everything outside its own
  // layer, and the picker's options are portaled to <body>. Filtering by
  // keyboard and clicking an option must BOTH work here, or the drawer looks
  // like a working trainer and is not one.
  await page.keyboard.type("tin");
  await expect(menu.getByRole("option", { name: "group.tin" })).toBeVisible();
  await menu.getByRole("option", { name: "group.tin" }).click();

  await expect(async () => {
    const written = (db?.portal_field_maps ?? []).find((m) => m.id === "tinstate");
    expect(written?.token).toBe("group.tin");
    expect(written?.status).toBe("approved");
  }).toPass({ timeout: 15000 });

  // The wire contract is the editor's: shared rows are written ONLY through
  // the SECURITY DEFINER RPC, never a direct table PATCH.
  expect(rpcCalls.some((c) => c.path === "train_global_field_map")).toBe(true);
  expect(tableWrites.filter((w) => w.table === "portal_field_maps")).toEqual([]);
});

test("portals — a settled form folds its mapping block away", async ({ context, page }) => {
  await seed(context);
  db!.portals = [portalRow()];
  db!.portal_field_maps = [
    fieldMapRow("npi", "NPI Number", {
      status: "approved",
      source: "token",
      token: "provider.npi",
      sortOrder: 1,
    }),
  ];
  await openDetail(page);
  await tab(page, "Portals").click();
  await page.getByRole("row").filter({ hasText: PORTAL_KEY }).click();

  // Nothing needs attention, so the drawer stays a maintenance summary: the
  // count is on the header, the row list is not dumped into the dialog.
  await expect(page.getByText("1 of 1 mapped", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("NPI Number")).toHaveCount(0);
  await page.getByText("Field mapping").click();
  await expect(page.getByText("NPI Number")).toBeVisible();
});
