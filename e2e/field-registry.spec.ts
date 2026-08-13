import { test, expect, type Route } from "@playwright/test";
import { withPortalPayerEmbed } from "./portalPayerEmbed";

// E6.9 — the unified field registry inside the Submit-form task editor
// (TS-144 … TS-149), over the mock harness.
//
// What changed and why these tests exist: the E6.5 panel rendered a TRAIN
// QUEUE — broken rows first, then `proposed` ones — so a field dropped out of
// the UI the instant it was approved. A field approved to the wrong token was
// then unreachable from the editor; the only way to find it was to run a real
// fill and watch the wrong value land in the box. Every assertion below is
// about the registry being a WORKING SURFACE rather than a queue.
//
//   TS-144 — a decided row stays listed, stays editable, and does NOT move
//            when its decision changes (F6.9.3/F6.9.5). The picker is grouped
//            by token family (D8) and offers no "No token" escape.
//   TS-145 — the (status, source) PAIR decides state (F6.9.4). `proposed +
//            manual` is undecided (the classifier must read status BEFORE
//            source); `approved + manual` is decided-but-human-filled — not
//            mapped, not autofilled; `approved + hardcoded` autofills.
//   TS-146 — sections group the list in real-form order with PER-SECTION
//            progress; undecided and human-fill rows stay in the denominator.
//   TS-147 — re-capture is drift repair, not a reset: a renamed/sectioned row
//            keeps its naming and its decision; a field the capture no longer
//            sees is marked stale, never deleted (D7).
//   TS-148 — a junk capture label is renameable through the shared registry
//            RPC, and the rename is clearable back to the payer's own label.
//   TS-149 — Data fields are folded into the ONE registry: the online-form
//            step renders no separate Data-fields editor, "Add field" writes a
//            shared (`org_id IS NULL`) row, and non-form steps keep theirs.
//
// Everything here is the SHARED tier (`org_id IS NULL`) because that is where
// trained forms live (D12): writes must go through the SECURITY DEFINER RPCs,
// never a direct table PATCH, and the spec asserts that at the wire.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "00000000-0000-4000-a000-000000000005";
const PAYER_ID = "00000000-0000-4000-a000-0000000000bb";
const TPL_ID = "00000000-0000-4000-a000-00000000t0b1";
const PORTAL_KEY = "bcbs_ks_enrollment";

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

interface MapSeed {
  id: string;
  selector: string;
  label: string;
  status: "proposed" | "approved" | "retired";
  source: "token" | "manual" | "manual_partial" | "hardcoded";
  token?: string | null;
  hardcodedValue?: string | null;
  section?: string | null;
  displayLabel?: string | null;
  pageStep?: string | null;
  sortOrder?: number | null;
  fieldType?: string | null;
  controlOptions?: { value: string; label: string }[] | null;
  transform?: string | null;
}

function mapRow(seed: MapSeed): Row {
  return {
    id: seed.id,
    org_id: null, // shared tier — the trained-form library (D12)
    portal_key: PORTAL_KEY,
    url_pattern: null,
    page_step: seed.pageStep ?? null,
    map_type: "web",
    selector: seed.selector,
    selector_fallbacks: null,
    source: seed.source,
    token: seed.token ?? null,
    hardcoded_value: seed.hardcodedValue ?? null,
    transform: seed.transform ?? null,
    field_type: seed.fieldType ?? "text",
    // The notes CHECK requires a note on manual/manual_partial rows.
    notes:
      seed.source === "manual" || seed.source === "manual_partial"
        ? "Captured from the form"
        : null,
    status: seed.status,
    field_label: seed.label,
    display_label: seed.displayLabel ?? null,
    section: seed.section ?? null,
    sort_order: seed.sortOrder ?? null,
    form_section: null,
    confidence: 60,
    control_options: seed.controlOptions ?? null,
    created_at: "2026-07-13T00:00:00Z",
    updated_at: "2026-07-13T00:00:00Z",
  };
}

// The TS-146 shared multi-page fixture: an admin-named "Tax ID" section of
// five fields with two mapped, plus an Identity section. `sort_order` is the
// capture-derived real-form order, which is what the list must honour.
const BASE_MAPS: MapSeed[] = [
  {
    id: "m-npi",
    selector: "#npi",
    label: "NPI Number",
    status: "approved",
    source: "token",
    token: "provider.npi",
    section: "Identity",
    sortOrder: 1,
  },
  {
    id: "m-first",
    selector: "#first",
    label: "First Name",
    status: "approved",
    // TS-144's wrong mapping: approved, but to the LAST-name token. Under the
    // old queue this row was invisible the moment it was approved.
    source: "token",
    token: "provider.lastName",
    section: "Identity",
    sortOrder: 2,
  },
  {
    id: "m-tin",
    selector: "#tin",
    label: "Tax ID",
    status: "approved",
    source: "token",
    token: "group.tin",
    section: "Tax ID",
    sortOrder: 3,
  },
  {
    id: "m-entity",
    selector: "#entity",
    label: "Entity Type",
    status: "approved",
    source: "hardcoded",
    hardcodedValue: "Group",
    section: "Tax ID",
    sortOrder: 4,
  },
  {
    id: "m-w9",
    selector: "#w9-signature",
    label: "W-9 Signature",
    // Decided, but a human fills it — NOT mapped and NOT autofillable.
    status: "approved",
    source: "manual",
    section: "Tax ID",
    sortOrder: 5,
  },
  {
    id: "m-tin-state",
    selector: "#tin-state",
    label: "Tax ID State",
    status: "proposed",
    source: "manual",
    section: "Tax ID",
    sortOrder: 6,
  },
  {
    id: "m-tin-eff",
    selector: "#tin-effective",
    label: "Tax ID Effective Date",
    status: "proposed",
    source: "manual",
    section: "Tax ID",
    sortOrder: 7,
  },
];

function buildDb(maps: MapSeed[] = BASE_MAPS): Record<string, Row[]> {
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
      {
        id: PAYER_ID,
        org_id: null,
        name: "BCBS Kansas",
        is_active: true,
        payer_kind: "commercial",
        aliases: [],
        states: ["NC"],
        status: "active",
        archived_at: null,
        created_at: "2026-07-12T00:00:00Z",
      },
    ],
    org_payer_assignments: [
      { id: "as-1", org_id: ORG_ID, payer_id: PAYER_ID, starter: false, status: "active" },
    ],
    sop_templates: [
      {
        id: TPL_ID,
        org_id: null, // global row → the wizard renders in global-authoring mode
        name: "BCBS Kansas NC Enrollment",
        payer_id: PAYER_ID,
        state: "NC",
        specialty: null,
        group_id: null,
        archived: false,
        current_version: 1,
        required_profile_attributes: [],
        task_definitions: [
          {
            title: "Submit the enrollment form",
            sortOrder: 0,
            steps: [
              {
                label: "Fill the portal form",
                stepType: "online_form",
                portalKey: PORTAL_KEY,
                // F6.9.6 — the ORIGINAL data fields stay in the template JSON
                // (additive rule); the editor simply stops rendering them for
                // online-form steps.
                dataFields: ["provider.npi", "provider.firstName", "group.tin"],
              },
              {
                label: "Email the confirmation",
                stepType: "draft_email",
                dataFields: [],
                emailTemplate: {
                  subject: "Enrollment submitted",
                  body: "Done.",
                  to: [{ source: "token", token: "provider.email" }],
                },
              },
              {
                label: "Fax the signature page",
                stepType: "fax",
                dataFields: [{ label: "Fax number", token: "payer.faxNumber" }],
              },
            ],
          },
        ],
        created_at: "2026-07-13T00:00:00Z",
        updated_at: "2026-07-13T00:00:00Z",
      },
    ],
    sop_template_versions: [
      {
        id: "ver-1",
        template_id: TPL_ID,
        version: 1,
        name: "BCBS Kansas NC Enrollment",
        task_definitions: [],
        change_note: null,
        created_at: "2026-07-13T00:00:00Z",
      },
    ],
    portals: [
      {
        id: "portal-bcbs",
        org_id: null,
        portal_key: PORTAL_KEY,
        name: "BCBS KS Enrollment",
        payer_id: PAYER_ID,
        form_url: "https://portal.example/bcbs",
        is_verified: true,
        last_verified_at: "2026-07-14T00:00:00Z",
        proven_at: null,
        url_changed_at: null,
        created_at: "2026-07-13T00:00:00Z",
        updated_at: "2026-07-13T00:00:00Z",
      },
    ],
    portal_field_maps: maps.map(mapRow),
    fill_sessions: [],
    field_dictionary: [],
    provider_groups: [],
    denial_reason_codes: [],
    notes: [],
    user_table_prefs: [],
  };
}

const TOKEN_CATALOG = [
  { table: "providers", token: "provider.npi", column: "npi" },
  { table: "providers", token: "provider.firstName", column: "first_name" },
  { table: "providers", token: "provider.lastName", column: "last_name" },
  { table: "provider_groups", token: "group.tin", column: "tin" },
  { table: "provider_groups", token: "group.legalName", column: "legal_name" },
];

interface RecordedCall {
  kind: "rpc" | "rest";
  path: string;
  method: string;
  body: unknown;
}

let db: Record<string, Row[]> | null = null;
let seedMaps: MapSeed[] = BASE_MAPS;
const calls: RecordedCall[] = [];
let seq = 0;

const nowIso = () => new Date().toISOString();

async function fulfillSupabase(route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  db ??= buildDb(seedMaps);

  if (url.pathname.includes("/auth/v1/")) return json(SESSION);

  if (url.pathname.includes("/rest/v1/rpc/")) {
    const fn = url.pathname.split("/rpc/")[1] ?? "";
    const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    calls.push({ kind: "rpc", path: fn, method: "POST", body });

    if (fn === "list_global_payers") return json(db.payers.filter((p) => p.org_id === null));
    if (fn === "get_sop_field_tokens") return json(TOKEN_CATALOG);
    if (fn === "claim_invites") return json(0);

    // E6.9 F6.9.2 — the widened trainer. `p_hardcoded_value` is the sixth
    // parameter; a non-hardcoded transition CLEARS it, so a row can never keep
    // a stale literal behind a token.
    if (fn === "train_global_field_map") {
      const row = db.portal_field_maps.find((m) => m.id === body.p_id && m.org_id === null);
      if (!row) return json({ message: "Field map not found" }, 400);
      const source = String(body.p_source ?? "");
      const transformRaw = String(body.p_transform ?? "").trim();
      const transform =
        source === "token" || source === "manual_partial"
          ? transformRaw === "state_abbrev" || transformRaw === "date_mmddyyyy"
            ? transformRaw
            : null
          : null;
      Object.assign(row, {
        status: body.p_status,
        source,
        token: body.p_token ?? null,
        hardcoded_value: source === "hardcoded" ? (body.p_hardcoded_value ?? null) : null,
        transform,
        updated_at: nowIso(),
      });
      if ((source === "manual" || source === "manual_partial") && row.notes == null) {
        row.notes = "Marked manual";
      }
      return json(row);
    }

    // F6.9.2 — capture/propose. ON CONFLICT DO NOTHING + re-read, so a repeat
    // returns the EXISTING row with its decision intact (that is what makes
    // re-capture drift repair rather than a reset).
    if (fn === "propose_shared_field_map") {
      const selector = String(body.p_selector ?? "");
      const portalKey = String(body.p_portal_key ?? "");
      const existing = db.portal_field_maps.find(
        (m) => m.org_id === null && m.portal_key === portalKey && m.selector === selector,
      );
      if (existing) {
        if (body.p_field_label) existing.field_label = body.p_field_label;
        if (body.p_sort_order != null) existing.sort_order = body.p_sort_order;
        const options = body.p_control_options;
        if (Array.isArray(options) && options.length > 0) {
          existing.control_options = options;
        }
        return json(existing);
      }
      const row = mapRow({
        id: `m-new-${(seq += 1)}`,
        selector,
        label: String(body.p_field_label ?? ""),
        status: "proposed",
        source: "manual",
        pageStep: (body.p_page_step as string | null) ?? null,
        sortOrder: (body.p_sort_order as number | null) ?? null,
        fieldType: (body.p_field_type as string | null) ?? "text",
        controlOptions:
          Array.isArray(body.p_control_options) && body.p_control_options.length > 0
            ? (body.p_control_options as { value: string; label: string }[])
            : null,
      });
      row.portal_key = portalKey;
      db.portal_field_maps.push(row);
      return json(row);
    }

    // F6.9.5 — the batch presentation writer. jsonb `?` semantics: a key that
    // is PRESENT with null clears; an ABSENT key leaves the column untouched.
    if (fn === "update_shared_field_registry") {
      const entries = (body.p_entries ?? []) as Record<string, unknown>[];
      const out: Row[] = [];
      for (const entry of entries) {
        const row = db.portal_field_maps.find((m) => m.id === entry.id && m.org_id === null);
        if (!row) continue;
        if ("display_label" in entry) row.display_label = entry.display_label ?? null;
        if ("section" in entry) row.section = entry.section ?? null;
        if ("sort_order" in entry) row.sort_order = entry.sort_order ?? null;
        row.updated_at = nowIso();
        out.push(row);
      }
      return json(out);
    }

    if (fn === "set_global_portal_flags") {
      const row = db.portals.find((p) => p.id === body.p_id && p.org_id === null);
      if (!row) return json({ message: "Portal not found" }, 400);
      if (body.p_verified === true) {
        row.is_verified = true;
        row.last_verified_at = nowIso();
      }
      if (body.p_proven === true) row.proven_at = nowIso();
      if (body.p_proven === false) row.proven_at = null;
      return json(row);
    }
    return json(null);
  }

  const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
  const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

  const matchFilters = (row: Row): boolean => {
    for (const [key, raw] of url.searchParams.entries()) {
      if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(key)) continue;
      if (!(key in row)) continue;
      if (raw.startsWith("eq.")) {
        if (String(row[key]) !== raw.slice(3)) return false;
      } else if (raw.startsWith("neq.")) {
        if (String(row[key]) === raw.slice(4)) return false;
      } else if (raw.startsWith("is.")) {
        if (raw.slice(3) === "null" && row[key] !== null) return false;
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

  if (req.method() === "HEAD") {
    const n = (db[table] ?? []).filter(matchFilters).length;
    return route.fulfill({ status: 200, headers: { "content-range": `*/${n}` }, body: "" });
  }
  if (req.method() === "POST") {
    let parsed: unknown = null;
    try {
      parsed = req.postDataJSON();
    } catch {
      parsed = null;
    }
    const bodyRow = (Array.isArray(parsed) ? parsed[0] : parsed) as Row | null;
    calls.push({ kind: "rest", path: table, method: "POST", body: bodyRow });
    const row: Row = { id: `new-${(seq += 1)}`, created_at: nowIso(), ...(bodyRow ?? {}) };
    if (table === "fill_sessions") {
      row.started_at = row.started_at ?? nowIso();
      db[table]?.unshift(row);
    } else db[table]?.push(row);
    return json(wantsObject ? row : [row], 201);
  }
  if (req.method() === "PATCH") {
    let body: Row | null = null;
    try {
      body = req.postDataJSON() as Row;
    } catch {
      body = null;
    }
    calls.push({ kind: "rest", path: table, method: "PATCH", body });
    const rows = (db[table] ?? []).filter(matchFilters);
    for (const r of rows) Object.assign(r, body ?? {}, { updated_at: nowIso() });
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  }

  const select = url.searchParams.get("select");
  const rows = withPortalPayerEmbed(
    table,
    select,
    (db[table] ?? []).filter(matchFilters),
    db.payers ?? [],
  );
  if (wantsObject) {
    if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
    return json(rows[0]);
  }
  return json(rows);
}

/** Open the editor with the online-form panel already expanded (?intent=train
 * is the Slice F deep-link that lands on Actions with the panel open). */
async function openRegistry(page: import("@playwright/test").Page) {
  await page.goto(`/admin/templates/${TPL_ID}?intent=train`);
  await expect(page.getByText("Form setup").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("NPI Number").first()).toBeVisible({ timeout: 30000 });
}

const rowFor = (page: import("@playwright/test").Page, name: string) =>
  page.locator("div.space-y-1\\.5.px-3.py-2", { hasText: name }).first();

/** The decision PILL, not the classifier's reason line underneath it — both
 * legitimately carry the same words. */
const pillIn = (row: import("@playwright/test").Locator, label: string) =>
  row.locator("span.inline-flex", { hasText: label }).first();

test.beforeEach(async ({ context }) => {
  db = null;
  seedMaps = BASE_MAPS;
  calls.length = 0;
  seq = 0;
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
});

test("TS-144 — an already-mapped field stays listed, editable, and positionally stable", async ({
  page,
}) => {
  await openRegistry(page);

  // The regression this whole epic exists for: an APPROVED row is still on
  // screen. The E6.5 queue dropped it, so a wrong mapping was unfindable.
  const first = rowFor(page, "First Name");
  await expect(first).toBeVisible();
  await expect(pillIn(first, "Mapped")).toBeVisible();

  // Position is `sort_order` (capture-derived), and a decision must never
  // reorder the list — that is what makes it workable top-to-bottom.
  const labelsBefore = await page
    .locator("div.space-y-1\\.5.px-3.py-2 span.gap-1.font-medium")
    .allInnerTexts();

  // The grouped picker (D8): families are headings, and there is no "No token"
  // escape hatch — unmapping is its own explicit action.
  const picker = first.getByRole("combobox", { name: /Map First Name to a token/i });
  await picker.click();
  const menu = page.getByRole("listbox", { name: "Token options" });
  // Fuzzy search narrows the catalog without scrolling the whole family list.
  await page.getByRole("textbox", { name: "Search tokens" }).fill("first name");
  await expect(menu.getByRole("option", { name: "provider.firstName" })).toBeVisible();
  await expect(menu.getByRole("option", { name: "provider.lastName" })).toHaveCount(0);
  // Families remain headings over the filtered hits (D8).
  await expect(menu.getByText("Provider", { exact: true })).toBeVisible();
  // Unmapping is its own explicit action — never a "No token" option that
  // silently reads as a decision.
  await expect(menu.getByRole("option", { name: /^No token$/ })).toHaveCount(0);
  await menu.getByRole("option", { name: "provider.firstName" }).click();

  await expect(async () => {
    const row = (db?.portal_field_maps ?? []).find((m) => m.id === "m-first");
    expect(row?.token).toBe("provider.firstName");
  }).toPass({ timeout: 15000 });

  // Re-mapping went through the shared-tier RPC, never a table PATCH.
  expect(calls.some((c) => c.kind === "rpc" && c.path === "train_global_field_map")).toBe(true);
  expect(calls.filter((c) => c.kind === "rest" && c.path === "portal_field_maps")).toEqual([]);

  const labelsAfter = await page
    .locator("div.space-y-1\\.5.px-3.py-2 span.gap-1.font-medium")
    .allInnerTexts();
  expect(labelsAfter).toEqual(labelsBefore);
});

test("TS-145 — the (status, source) PAIR decides state; status is read before source", async ({
  page,
}) => {
  await openRegistry(page);

  // `proposed + manual` — the shape every capture arrives in. Reading SOURCE
  // first would classify these as deliberate human-fill and hide 19 unfinished
  // fields behind a green count; status must win.
  await expect(pillIn(rowFor(page, "Tax ID State"), "Needs a decision")).toBeVisible();
  await expect(pillIn(rowFor(page, "Tax ID Effective Date"), "Needs a decision")).toBeVisible();

  // `approved + manual` — decided, but a person types it. Neither mapped nor
  // autofilled, and the control that would set it again is disabled.
  const w9 = rowFor(page, "W-9 Signature");
  await expect(pillIn(w9, "Human fills this")).toBeVisible();
  await expect(w9.getByRole("button", { name: "Human fills this" })).toBeDisabled();

  // `approved + hardcoded` — a fixed literal, which the extension fills.
  await expect(pillIn(rowFor(page, "Entity Type"), "Fixed value")).toBeVisible();

  // The aggregate read-out counts rows that actually AUTOFILL — the three
  // token rows plus the fixed-value one — and calls out the two undecided
  // ones. The human-fill row is decided but is not "mapped".
  await expect(page.getByText(/4 of 7 mapped/)).toBeVisible();
  await expect(page.getByText(/2 to decide/).first()).toBeVisible();

  // Prove lives in the Workbench — the editor never auto-stamps proven_at.
  await expect(page.getByRole("button", { name: "Run mock dry run" })).toHaveCount(0);
  expect((db?.portals ?? [])[0]?.proven_at ?? null).toBeNull();
});

test("TS-146 — sections group the list in form order with per-section progress", async ({
  page,
}) => {
  await openRegistry(page);

  // Per-section progress is the level a trainer works at. One aggregate over
  // 23 fields says nothing about which part of the form is unfinished.
  const taxHeader = page.locator("div.flex.items-baseline", { hasText: "Tax ID" }).first();
  await expect(taxHeader.getByText("2 of 5 mapped")).toBeVisible();
  const identityHeader = page.locator("div.flex.items-baseline", { hasText: "Identity" }).first();
  await expect(identityHeader.getByText("2 of 2 mapped")).toBeVisible();

  // Undecided AND human-fill rows stay in the denominator — a section is not
  // "done" because the unfinished fields were filtered out of it. Section
  // headings expose a rename control (aria-label "Rename section …").
  const sectionLabels = await page
    .getByRole("button", { name: /^Rename section / })
    .evaluateAll((buttons) =>
      buttons.map((b) => (b.getAttribute("aria-label") ?? "").replace(/^Rename section /, "")),
    );
  expect(sectionLabels).toEqual(["Identity", "Tax ID"]);

  // Real-form order inside a section is `sort_order`, not decision state.
  const taxRows = await page
    .locator("div.space-y-1\\.5", { hasText: "2 of 5 mapped" })
    .first()
    .locator("div.space-y-1\\.5.px-3.py-2 span.gap-1.font-medium")
    .allInnerTexts();
  expect(taxRows.map((t) => t.trim())).toEqual([
    "Tax ID",
    "Entity Type",
    "W-9 Signature",
    "Tax ID State",
    "Tax ID Effective Date",
  ]);
});

test("TS-147 — re-capture keeps naming and decisions; a vanished field goes stale, never deleted", async ({
  page,
}) => {
  await openRegistry(page);

  // Rename + the decision already on the row.
  await rowFor(page, "Tax ID")
    .getByRole("button", { name: /Rename Tax ID/i })
    .click();
  await page.getByRole("textbox", { name: /Rename Tax ID/i }).fill("Group Tax ID (TIN)");
  await page.keyboard.press("Enter");
  await expect(async () => {
    const row = (db?.portal_field_maps ?? []).find((m) => m.id === "m-tin");
    expect(row?.display_label).toBe("Group Tax ID (TIN)");
  }).toPass({ timeout: 15000 });

  // Simulate the extension re-capturing the SAME page: propose is idempotent
  // on (portal_key, selector), so the existing row comes back untouched.
  const before = JSON.parse(
    JSON.stringify((db?.portal_field_maps ?? []).find((m) => m.id === "m-tin")),
  ) as Row;
  // The relative path still matches the harness route pattern (/rest/v1/), so
  // this exercises the REAL propose contract, not a stub.
  const recaptured = await page.evaluate(
    async ([key]) => {
      const res = await fetch("/rest/v1/rpc/propose_shared_field_map", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          p_portal_key: key,
          p_selector: "#tin",
          p_field_label: "Tax ID",
          p_form_section: null,
          p_page_step: "Page 1",
          p_field_type: "text",
          p_sort_order: 1,
        }),
      });
      return (await res.json()) as Record<string, unknown>;
    },
    [PORTAL_KEY] as const,
  );

  // The admin's naming and the row's decision both survived the re-capture —
  // this is what makes re-capture drift repair rather than a reset (D7).
  expect(recaptured.display_label).toBe("Group Tax ID (TIN)");
  expect(recaptured.token).toBe(before.token);
  expect(recaptured.status).toBe("approved");
  expect(recaptured.id).toBe("m-tin");

  // A field the capture NO LONGER sees is marked stale — never deleted. The
  // decision and the naming stay on the row, so if the payer puts the field
  // back (or the capture simply missed a page) nothing has to be redone.
  seedMaps = BASE_MAPS;
  db!.fill_sessions.unshift({
    id: "fill-real-1",
    org_id: ORG_ID,
    case_id: null,
    provider_id: null,
    portal_key: PORTAL_KEY,
    fill_mode: "web",
    started_at: "2026-08-05T12:00:00Z",
    completed_at: "2026-08-05T12:01:00Z",
    fields_filled: 4,
    fields_skipped: [
      {
        label: "Entity Type",
        reason: "field not found on this page",
        kind: "skipped",
        mapId: "m-entity",
      },
    ],
    docs_attached: null,
    performed_by: USER_ID,
    is_test: false,
  });
  await page.reload();
  await expect(page.getByText("Form setup").first()).toBeVisible({ timeout: 30000 });
  const entity = rowFor(page, "Entity Type");
  await expect(entity).toBeVisible();
  await expect(pillIn(entity, "Not found in the latest fill")).toBeVisible();
  expect((db?.portal_field_maps ?? []).some((m) => m.id === "m-entity")).toBe(true);

  // Nothing about a shared row ever became an org row.
  expect((db?.portal_field_maps ?? []).every((m) => m.org_id === null)).toBe(true);
  expect(calls.filter((c) => c.kind === "rest" && c.path === "portal_field_maps")).toEqual([]);
});

test("TS-148 — a junk capture label is renameable, and the rename is clearable", async ({
  page,
}) => {
  // A generic-markup portal: the capture could only see placeholder text.
  seedMaps = [
    {
      id: "m-junk",
      selector: "#ctl00_txt1",
      label: "Field 1",
      status: "proposed",
      source: "manual",
      section: "Identity",
      sortOrder: 1,
    },
    ...BASE_MAPS.filter((m) => m.id === "m-npi"),
  ];
  await openRegistry(page);

  const junk = rowFor(page, "Field 1");
  await junk.getByRole("button", { name: /Rename Field 1/i }).click();
  await page.getByRole("textbox", { name: /Rename Field 1/i }).fill("Practice Phone");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Practice Phone").first()).toBeVisible({ timeout: 15000 });
  // The payer's own words stay visible underneath — that is what makes a
  // rename safe to make and easy to audit.
  await expect(page.getByText("Payer’s label: Field 1")).toBeVisible();

  const renameCalls = calls.filter(
    (c) => c.kind === "rpc" && c.path === "update_shared_field_registry",
  );
  expect(renameCalls.length).toBeGreaterThan(0);
  const stored = (db?.portal_field_maps ?? []).find((m) => m.id === "m-junk");
  expect(stored?.display_label).toBe("Practice Phone");
  // The captured label is NEVER overwritten by a rename.
  expect(stored?.field_label).toBe("Field 1");

  // Clearing falls back to the captured label rather than storing a blank.
  await rowFor(page, "Practice Phone")
    .getByRole("button", { name: /Rename Practice Phone/i })
    .click();
  await page.getByRole("textbox", { name: /Rename Practice Phone/i }).fill("");
  await page.keyboard.press("Enter");
  await expect(async () => {
    const row = (db?.portal_field_maps ?? []).find((m) => m.id === "m-junk");
    expect(row?.display_label ?? null).toBeNull();
  }).toPass({ timeout: 15000 });

  // No audit row under the interim no-history posture (D14): `audit_log.org_id`
  // is NOT NULL and a shared row has no org.
  expect(calls.filter((c) => c.kind === "rest" && c.path === "audit_log")).toEqual([]);
});

test("TS-149 — Data fields are folded into the ONE registry; Add field writes a shared row", async ({
  page,
}) => {
  await openRegistry(page);

  // Three steps: online form, email, fax. Two field systems for the same
  // boxes — each with its own label and its own picker over the same catalog —
  // was the whole problem, so the online-form step's Data-fields editor is
  // gone from view. The fold is SCOPED: the fax step keeps its editor
  // untouched, and the stored JSON is retained on both (additive rule).
  const dataFieldLabels = page.getByText("Data fields", { exact: true });
  await expect(dataFieldLabels).toHaveCount(2);
  await expect(dataFieldLabels.nth(0)).toBeHidden(); // the online-form step
  await expect(dataFieldLabels.nth(1)).toBeVisible(); // the fax step

  // The email step's own controls are untouched by the fold (it never had a
  // Data-fields editor — it carries the email template instead).
  await expect(page.getByRole("combobox", { name: "To recipient token" })).toBeVisible();

  const addFieldBox = page.getByRole("textbox", { name: "Add a field to the registry" });
  await addFieldBox.fill("Referral Contact");
  await page
    .locator('div:has(> input[aria-label="Add a field to the registry"])')
    .getByRole("button", { name: "Add field" })
    .click();

  await expect(page.getByText("Referral Contact").first()).toBeVisible({ timeout: 15000 });
  const proposals = calls.filter((c) => c.kind === "rpc" && c.path === "propose_shared_field_map");
  expect(proposals).toHaveLength(1);
  const added = (db?.portal_field_maps ?? []).find(
    (m) => String(m.field_label ?? "").toLowerCase() === "referral contact",
  );
  expect(added).toBeTruthy();
  // Shared tier, undecided, and reachable by all three decisions like any
  // captured row.
  expect(added?.org_id ?? null).toBeNull();
  expect(added?.status).toBe("proposed");
  expect(String(added?.selector ?? "")).toMatch(/^manual:/);

  // The template JSON keeps its original dataFields (additive rule): the
  // editor stopped READING them, it did not rewrite the stored template.
  const tpl = (db?.sop_templates ?? []).find((t) => t.id === TPL_ID);
  const tasks = tpl?.task_definitions as Array<{ steps: Array<Record<string, unknown>> }>;
  expect(tasks[0].steps[0].dataFields).toEqual(["provider.npi", "provider.firstName", "group.tin"]);
});

test("TS-160 — a fixed value is picked from the portal's captured options", async ({ page }) => {
  seedMaps = [
    {
      id: "m-state",
      selector: "#practice-state",
      label: "Practice State",
      status: "proposed",
      source: "manual",
      section: "Identity",
      sortOrder: 1,
      fieldType: "select",
      controlOptions: [
        { value: "KS", label: "Kansas" },
        { value: "MO", label: "Missouri" },
        { value: "NE", label: "Nebraska" },
      ],
    },
    {
      id: "m-npi",
      selector: "#npi",
      label: "NPI Number",
      status: "approved",
      source: "token",
      token: "provider.npi",
      section: "Identity",
      sortOrder: 2,
    },
    {
      id: "m-radio",
      selector: 'input[name="accepting"]',
      label: "Accepting new patients",
      status: "proposed",
      source: "manual",
      section: "Identity",
      sortOrder: 3,
      fieldType: "radio",
    },
  ];
  await openRegistry(page);

  const state = rowFor(page, "Practice State");
  await expect(state).toBeVisible();
  await expect(pillIn(state, "Dropdown")).toBeVisible();
  await expect(state.getByText("3 options this control accepts")).toBeVisible();
  await state.getByText("3 options this control accepts").click();
  await expect(state.getByText("KS — Kansas")).toBeVisible();

  await state.getByRole("combobox", { name: "Fixed value for Practice State" }).click();
  await page.getByRole("option", { name: "KS — Kansas" }).click();

  await expect(pillIn(state, "Fixed value")).toBeVisible({ timeout: 15000 });
  const trained = (db?.portal_field_maps ?? []).find((m) => m.id === "m-state");
  expect(trained?.hardcoded_value).toBe("KS");
  expect(trained?.source).toBe("hardcoded");
  expect(trained?.status).toBe("approved");
  const trainCalls = calls.filter((c) => c.kind === "rpc" && c.path === "train_global_field_map");
  expect(trainCalls.some((c) => (c.body as { p_hardcoded_value?: string }).p_hardcoded_value === "KS")).toBe(
    true,
  );

  const radio = rowFor(page, "Accepting new patients");
  await expect(pillIn(radio, "Radio")).toBeVisible();
  await expect(radio.getByText(/No captured options/)).toBeVisible();

  const npi = rowFor(page, "NPI Number");
  await expect(pillIn(npi, "Text")).toBeVisible();
  await npi.getByLabel("Value shaping for NPI Number").selectOption("state_abbrev");
  await expect(npi.getByText("Shapes the value: Kansas → KS")).toBeVisible({ timeout: 15000 });
  const npiRow = (db?.portal_field_maps ?? []).find((m) => m.id === "m-npi");
  expect(npiRow?.transform).toBe("state_abbrev");
  expect(npiRow?.token).toBe("provider.npi");
});
