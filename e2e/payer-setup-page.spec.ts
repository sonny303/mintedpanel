import { test, expect, type Route } from "@playwright/test";
import { withPortalPayerEmbed } from "./portalPayerEmbed";

// Payer & Cases design bundle, screen 1 (Slice A) — the single-view Payer
// Setup page over the mock harness. One test per designed state (the bundle's
// screen index):
//   Populated list  — Payer · State(s) · Kind · Template status, filtered by
//                     the four KPI cards, paginated.
//   Zero payers     — three-step orientation + "Add your first payer" → the
//                     /admin/payers/new set-up stub (Slice B's surface).
//   Filtered to none — Clear filters, never "add a payer".
//   Archived payers — hidden by default; Show archived reveals the Archived
//                     badge + Reactivate (reactivate_payer RPC on the wire).
//   Default template card — the payerless fallback, edit-only.
// Plus the supersession pins: no tab strip, no Ready-for-business funnel, no
// catalog browse on this page.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "00000000-0000-4000-a000-000000000005";
const AETNA_ID = "00000000-0000-4000-a000-0000000000aa";
const UHC_ID = "00000000-0000-4000-a000-0000000000bc";
const BANNER_ID = "00000000-0000-4000-a000-0000000000bd";
const SELECT_ID = "00000000-0000-4000-a000-0000000000be";
const ANTHEM_ID = "00000000-0000-4000-a000-0000000000bf";
const FALLBACK_TPL_ID = "00000000-0000-4000-a000-00000000e17b";

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
type Scenario = "network" | "empty" | "many";

const FIELD_NOT_FOUND = "field not found on this page";

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
    states: ["NC"],
    status: "active",
    delegation_note: null,
    archived_at: null,
    created_at: "2026-07-12T00:00:00Z",
    ...extra,
  };
}

function targetRow(id: string, payerId: string, extra: Row = {}): Row {
  return {
    id,
    org_id: ORG_ID,
    group_id: "g-setup",
    payer_id: payerId,
    state: "NC",
    status: "active",
    payer_issued_id: null,
    created_at: "2026-07-12T00:00:00Z",
    ...extra,
  };
}

function assignmentRow(id: string, payerId: string): Row {
  return { id, org_id: ORG_ID, payer_id: payerId, starter: false, status: "active" };
}

function sopRow(id: string, name: string, payerId: string | null, extra: Row = {}): Row {
  return {
    id,
    org_id: null,
    name,
    payer_id: payerId,
    state: payerId ? "NC" : null,
    specialty: null,
    group_id: null,
    archived: false,
    current_version: 1,
    required_profile_attributes: [],
    task_definitions: [
      {
        title: "Submit the enrollment form",
        sortOrder: 0,
        steps: [{ label: "Fill the form", stepType: "online_form", dataFields: [] }],
      },
    ],
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-07-12T00:00:00Z",
    ...extra,
  };
}

function portalRow(id: string, key: string, payerId: string, extra: Row = {}): Row {
  return {
    id,
    org_id: null,
    portal_key: key,
    name: `${key} portal`,
    payer_id: payerId,
    form_url: `https://portal.example/${key}`,
    is_verified: true,
    last_verified_at: "2026-07-13T00:00:00Z",
    proven_at: null,
    url_changed_at: null,
    created_at: "2026-07-13T00:00:00Z",
    updated_at: "2026-07-13T00:00:00Z",
    ...extra,
  };
}

function fieldMapRow(id: string, key: string, extra: Row = {}): Row {
  return {
    id,
    org_id: null,
    portal_key: key,
    url_pattern: null,
    page_step: null,
    map_type: "web",
    selector: "#npi",
    selector_fallbacks: null,
    source: "token",
    token: "provider.npi",
    hardcoded_value: null,
    transform: null,
    field_type: "text",
    notes: null,
    status: "approved",
    field_label: "NPI Number",
    form_section: null,
    confidence: 90,
    created_at: "2026-07-13T00:00:00Z",
    updated_at: "2026-07-13T00:00:00Z",
    ...extra,
  };
}

function buildDb(scenario: Scenario): Record<string, Row[]> {
  const db: Record<string, Row[]> = {
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
    payers: [],
    org_payer_assignments: [],
    payer_network_targets: [],
    sop_templates: [
      // The payerless fallback — the default-template card's row (always
      // present; the card is edit-only by design).
      sopRow(FALLBACK_TPL_ID, "General Enrollment", null, {
        task_definitions: [
          { title: "Collect documents", sortOrder: 0, steps: [] },
          { title: "Submit application", sortOrder: 1, steps: [] },
          { title: "Confirm receipt", sortOrder: 2, steps: [] },
          { title: "Follow up", sortOrder: 3, steps: [] },
        ],
        updated_at: "2026-07-12T00:00:00Z",
      }),
    ],
    sop_template_versions: [],
    portals: [],
    portal_field_maps: [],
    fill_sessions: [],
    field_dictionary: [],
    provider_groups: [],
    notes: [],
    user_table_prefs: [],
  };

  if (scenario === "empty") return db;

  if (scenario === "many") {
    for (let i = 1; i <= 12; i += 1) {
      const id = `00000000-0000-4000-a000-0000000000${(60 + i).toString(16)}`;
      db.payers.push(payerRow(id, `Payer ${String(i).padStart(2, "0")}`));
      db.org_payer_assignments.push(assignmentRow(`as-${i}`, id));
      db.payer_network_targets.push(targetRow(`t-${i}`, id));
    }
    return db;
  }

  // The rich network: one payer per KPI bucket + one archived row.
  db.payers.push(
    payerRow(AETNA_ID, "Aetna (CVS Health)", { states: ["AZ", "CA", "CO", "NY"] }),
    payerRow(UHC_ID, "UnitedHealthcare", { states: ["AZ", "CO", "NM"] }),
    payerRow(BANNER_ID, "Banner Health Plans", {
      states: ["AZ"],
      payer_kind: "medicare_advantage",
    }),
    payerRow(SELECT_ID, "SelectHealth (Intermountain)", { states: ["CO", "UT"] }),
    payerRow(ANTHEM_ID, "Anthem Legacy CO", {
      states: ["CO"],
      archived_at: "2026-07-25T00:00:00Z",
    }),
  );
  db.org_payer_assignments.push(
    assignmentRow("as-1", AETNA_ID),
    assignmentRow("as-2", UHC_ID),
    assignmentRow("as-3", BANNER_ID),
    assignmentRow("as-4", SELECT_ID),
    assignmentRow("as-5", ANTHEM_ID),
  );
  // OPA-RETIRE: setup inclusion is target-derived (assignments alone are not enough).
  db.payer_network_targets.push(
    targetRow("t-1", AETNA_ID),
    targetRow("t-2", UHC_ID),
    targetRow("t-3", BANNER_ID),
    targetRow("t-4", SELECT_ID),
    targetRow("t-5", ANTHEM_ID),
  );
  // Aetna — published + proven form (fully quiet).
  db.sop_templates.push(
    sopRow("tpl-aetna", "Aetna NC Enrollment", AETNA_ID, {
      task_definitions: [
        {
          title: "Submit",
          sortOrder: 0,
          steps: [
            { label: "Fill", stepType: "online_form", portalKey: "aetna_enroll", dataFields: [] },
          ],
        },
      ],
    }),
  );
  db.portals.push(
    portalRow("portal-aetna", "aetna_enroll", AETNA_ID, { proven_at: "2026-07-14T00:00:00Z" }),
  );
  db.portal_field_maps.push(fieldMapRow("m-aetna", "aetna_enroll"));
  // UHC — published + trained-but-unproven form (Form not proven).
  db.sop_templates.push(
    sopRow("tpl-uhc", "UHC NC Enrollment", UHC_ID, {
      task_definitions: [
        {
          title: "Submit",
          sortOrder: 0,
          steps: [
            { label: "Fill", stepType: "online_form", portalKey: "uhc_enroll", dataFields: [] },
          ],
        },
      ],
    }),
  );
  db.portals.push(portalRow("portal-uhc", "uhc_enroll", UHC_ID));
  db.portal_field_maps.push(fieldMapRow("m-uhc", "uhc_enroll"));
  // Banner — no template at all (Needs template).
  // SelectHealth — published + proven, but the last REAL fill broke a trained
  // mapping (Drift detected; newer than the map's updated_at).
  db.sop_templates.push(
    sopRow("tpl-select", "SelectHealth Enrollment", SELECT_ID, {
      task_definitions: [
        {
          title: "Submit",
          sortOrder: 0,
          steps: [
            { label: "Fill", stepType: "online_form", portalKey: "select_enroll", dataFields: [] },
          ],
        },
      ],
    }),
  );
  db.portals.push(
    portalRow("portal-select", "select_enroll", SELECT_ID, { proven_at: "2026-07-14T00:00:00Z" }),
  );
  db.portal_field_maps.push(fieldMapRow("m-select", "select_enroll"));
  db.fill_sessions.push({
    id: "fill-real-1",
    org_id: ORG_ID,
    case_id: "case-1",
    provider_id: "prov-1",
    portal_key: "select_enroll",
    fill_mode: "web",
    started_at: "2026-07-18T12:00:00Z",
    completed_at: "2026-07-18T12:01:00Z",
    fields_filled: 7,
    fields_skipped: [
      { label: "NPI Number", reason: FIELD_NOT_FOUND, kind: "skipped", mapId: "m-select" },
    ],
    docs_attached: null,
    performed_by: USER_ID,
    is_test: false,
  });
  return db;
}

interface RecordedCall {
  kind: "rpc" | "rest";
  path: string;
  method: string;
  body: unknown;
}

let scenario: Scenario = "network";
let db: Record<string, Row[]> | null = null;
const calls: RecordedCall[] = [];

async function fulfillSupabase(route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  db ??= buildDb(scenario);

  if (url.pathname.includes("/auth/v1/")) return json(SESSION);

  if (url.pathname.includes("/rest/v1/rpc/")) {
    const fn = url.pathname.split("/rpc/")[1] ?? "";
    const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    calls.push({ kind: "rpc", path: fn, method: "POST", body });
    if (fn === "reactivate_payer") {
      const row = db.payers.find((p) => p.id === body.p_payer_id);
      if (!row) return json({ message: "payer_not_found" }, 400);
      row.archived_at = null;
      return json(row);
    }
    if (fn === "list_global_payers") return json(db.payers.filter((p) => p.org_id === null));
    if (fn === "get_sop_field_tokens") return json([]);
    if (fn === "claim_invites") return json(0);
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
  if (req.method() === "POST" || req.method() === "PATCH") {
    let parsed: unknown = null;
    try {
      parsed = req.postDataJSON();
    } catch {
      parsed = null;
    }
    calls.push({ kind: "rest", path: table, method: req.method(), body: parsed });
    return json(wantsObject ? {} : [{}], req.method() === "POST" ? 201 : 200);
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

test.beforeEach(async ({ context }) => {
  scenario = "network";
  db = null;
  calls.length = 0;
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

test("populated list — table columns, live count, KPI cards filter and toggle", async ({
  page,
}) => {
  await page.goto("/admin/payer-admin/setup");
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({ timeout: 30000 });
  // Live count includes the archived row (it is still a payer in the network).
  await expect(page.getByText("5 payers in your network")).toBeVisible();

  // Single view: no tab strip, no funnel head, no catalog browse (all
  // superseded by this screen).
  await expect(page.getByRole("navigation", { name: "Payer Setup areas" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ready for business" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add to my network" })).toHaveCount(0);

  // The four KPI cards carry honest counts over ACTIVE payers.
  await expect(page.getByRole("button", { name: /All payers/ })).toContainText("4");
  await expect(page.getByRole("button", { name: /Needs template/ })).toContainText("1");
  await expect(page.getByRole("button", { name: /Form not proven/ })).toContainText("1");
  await expect(page.getByRole("button", { name: /Drift detected/ })).toContainText("1");

  // Table: 4 active rows; per-row template status is ONE badge.
  await expect(page.locator("tbody tr")).toHaveCount(4);
  const aetnaRow = page.locator("tbody tr", { hasText: "Aetna (CVS Health)" });
  await expect(aetnaRow.getByText("Published")).toBeVisible();
  await expect(aetnaRow).toContainText("AZ, CA, CO, NY");
  await expect(aetnaRow).toContainText("Commercial");
  const bannerRow = page.locator("tbody tr", { hasText: "Banner Health Plans" });
  await expect(bannerRow.getByText("Needs template")).toBeVisible();
  await expect(bannerRow).toContainText("Medicare Advantage");

  // KPI cards are filter TOGGLES (aria-pressed; click again clears).
  const needsCard = page.getByRole("button", { name: /Needs template/ });
  await needsCard.click();
  await expect(needsCard).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr").first()).toContainText("Banner Health Plans");
  await needsCard.click();
  await expect(needsCard).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("tbody tr")).toHaveCount(4);

  await page.getByRole("button", { name: /Form not proven/ }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr").first()).toContainText("UnitedHealthcare");

  await page.getByRole("button", { name: /Drift detected/ }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr").first()).toContainText("SelectHealth (Intermountain)");

  // The payer name is the only link — it drills into the payer detail.
  await page.getByRole("button", { name: /All payers/ }).click();
  await page.getByRole("link", { name: "Aetna (CVS Health)" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/payer-admin/setup/${AETNA_ID}$`), {
    timeout: 15000,
  });
});

test("search + State + Kind filters; filtered-to-none offers Clear filters, never add", async ({
  page,
}) => {
  await page.goto("/admin/payer-admin/setup");
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({ timeout: 30000 });

  // Name search narrows (alias search went with the catalog).
  await page.getByLabel("Search payers").fill("united");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr").first()).toContainText("UnitedHealthcare");
  await page.getByLabel("Search payers").fill("");

  // State narrows by states[] membership; Kind by payer kind.
  await page.getByLabel("Filter by state").click();
  await page.getByRole("option", { name: "AZ", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await page.getByLabel("Filter by payer kind").click();
  await page.getByRole("option", { name: "Medicare Advantage" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr").first()).toContainText("Banner Health Plans");

  // Filters that match nothing → the honest empty state with Clear filters
  // (the org HAS payers, so no "add a payer" pitch here).
  await page.getByLabel("Search payers").fill("no such payer");
  await expect(page.getByText("No payers match these filters")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
  await expect(page.getByText("Add your first payer")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(4);
});

test("archived rows — hidden by default; Show archived reveals badge + Reactivate on the wire", async ({
  page,
}) => {
  await page.goto("/admin/payer-admin/setup");
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Anthem Legacy CO")).toHaveCount(0);

  await page.getByLabel("Show archived").click();
  const anthemRow = page.locator("tbody tr", { hasText: "Anthem Legacy CO" });
  await expect(anthemRow).toBeVisible();
  await expect(anthemRow.getByText("Archived")).toBeVisible();
  await expect(anthemRow.getByRole("button", { name: "Reactivate" })).toBeVisible();

  // Archived rows bypass the KPI filter (they are listed for what they are,
  // not counted or filtered as working payers).
  const driftCard = page.getByRole("button", { name: /Drift detected/ });
  await driftCard.click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.locator("tbody tr", { hasText: "SelectHealth (Intermountain)" })).toBeVisible();
  await expect(anthemRow).toBeVisible();
  await driftCard.click();

  // Reactivate rides the E6.8 RPC; the row returns to the active set.
  await anthemRow.getByRole("button", { name: "Reactivate" }).click();
  await expect
    .poll(
      () =>
        calls.filter(
          (c) =>
            c.kind === "rpc" &&
            c.path === "reactivate_payer" &&
            (c.body as Record<string, unknown>).p_payer_id === ANTHEM_ID,
        ).length,
      { timeout: 15000 },
    )
    .toBe(1);
  await expect(anthemRow.getByText("Needs template")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: /All payers/ })).toContainText("5");
  // Never a direct payers table write — the RPC is the only writer.
  expect(calls.filter((c) => c.kind === "rest" && c.path === "payers")).toEqual([]);
});

test("zero payers — three-step orientation; Add your first payer opens the create flow", async ({
  page,
}) => {
  scenario = "empty";
  await page.goto("/admin/payer-admin/setup");
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("0 payers in your network")).toBeVisible();

  await expect(page.getByText("No payers yet")).toBeVisible();
  await expect(page.getByText("Add a payer", { exact: true })).toBeVisible();
  await expect(page.getByText("Author a template", { exact: true })).toBeVisible();
  await expect(page.getByText("Generate cases", { exact: true })).toBeVisible();

  // Slice B: the CTA lands on step 1 of the guided create flow (name +
  // near-match), whose Cancel returns to this page.
  await page.getByRole("link", { name: "+ Add your first payer" }).click();
  await expect(page).toHaveURL(/\/admin\/payers\/new$/, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: "Add a payer" })).toBeVisible();
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/admin\/payer-admin\/setup$/, { timeout: 15000 });
});

test("default template card — payerless fallback, edit-only, below the list", async ({ page }) => {
  await page.goto("/admin/payer-admin/setup");
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({ timeout: 30000 });

  await expect(page.getByText("Default template", { exact: true })).toBeVisible();
  await expect(page.getByText(/Used when no payer template matches · 4 tasks/)).toBeVisible();
  const editLink = page.getByRole("link", { name: "Edit", exact: true });
  await expect(editLink).toHaveAttribute("href", `/admin/templates/${FALLBACK_TPL_ID}`);
  // Edit-only: no create path for the fallback anywhere on this page.
  await expect(page.getByRole("button", { name: /New template/i })).toHaveCount(0);
});

test("pagination — 5–100 rows per page with an honest range", async ({ page }) => {
  scenario = "many";
  await page.goto("/admin/payer-admin/setup");
  await expect(page.getByRole("heading", { name: "Payer Setup" })).toBeVisible({ timeout: 30000 });

  await expect(page.locator("tbody tr")).toHaveCount(10);
  await expect(page.getByText("Showing 1–10 of 12 payers")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Pagination" })
    .getByRole("button", { name: "2" })
    .click();
  await expect(page.getByText("Showing 11–12 of 12 payers")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(2);

  await page.getByLabel("Rows per page").click();
  await page.getByRole("option", { name: "5", exact: true }).click();
  await expect(page.getByText("Showing 1–5 of 12 payers")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(5);
  const pager = page.getByRole("navigation", { name: "Pagination" });
  await expect(pager.getByRole("button", { name: "3" })).toBeVisible();
});
