import { test, expect, type Route } from "@playwright/test";

// Payer & Cases design bundle, screen 2 (Slice B) — Add / Edit Payer over the
// mock harness, one test per designed state:
//   Name + near match (#name)  — the duplicate guardrail: existing payers
//                                surface before any other field; exact-name,
//                                alias, and merged (successor) matches; the
//                                primary action flips to "None of these".
//   Details — new (#create)    — required kind/states, alias chips, the two
//                                ID-expectation rows → create_payer on the
//                                wire (org assignment rides the RPC).
//   Edit payer (#edit)         — hydrated from the record, catalog-wide
//                                warning, save → update_payer.
//   Edit — no IDs (#editnone)  — a payer that issues nothing: both rows off
//                                and the "no enrollment ID" explainer.
// Plus the duplicate rejection: create_payer's guard renders inline and the
// user stays on the form with their input intact.

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "00000000-0000-4000-a000-000000000005";
const AETNA_ID = "00000000-0000-4000-a000-0000000000aa";
const AETNA_AZ_ID = "00000000-0000-4000-a000-0000000000ab";
const OLD_BCBS_ID = "00000000-0000-4000-a000-0000000000ac";
const NEW_BCBS_ID = "00000000-0000-4000-a000-0000000000ad";
const NO_ID_PAYER_ID = "00000000-0000-4000-a000-0000000000ae";

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
        states: ["AZ", "CA", "CO", "NY"],
        // The edit fixture: issues BOTH IDs, with the payer's own wording.
        group_id_expected: true,
        group_id_label: "Group PIN",
        provider_id_expected: true,
        provider_id_label: "Provider Number",
        delegation_note: "Delegates credentialing to the group for contracted TINs.",
      }),
      payerRow(AETNA_AZ_ID, "Aetna Better Health of Arizona", { payer_kind: "medicaid_mco" }),
      payerRow(OLD_BCBS_ID, "Old BCBS of Arizona", {
        status: "merged",
        merged_into_id: NEW_BCBS_ID,
      }),
      payerRow(NEW_BCBS_ID, "Blue Cross Blue Shield of Arizona"),
      // The #editnone fixture: a payer that issues no enrollment ID at all.
      payerRow(NO_ID_PAYER_ID, "Kaiser Permanente Colorado", { states: ["CO"] }),
    ],
    org_payer_assignments: [
      { id: "as-1", org_id: ORG_ID, payer_id: AETNA_ID, starter: false, status: "active" },
    ],
    sop_templates: [],
    portals: [],
    notes: [],
    user_table_prefs: [],
  };
}

interface RecordedCall {
  path: string;
  body: Record<string, unknown>;
}

let db: Record<string, Row[]> | null = null;
const rpcCalls: RecordedCall[] = [];
const tableWrites: Array<{ table: string; method: string }> = [];
let duplicateOnCreate = false;

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
    if (fn === "create_payer") {
      if (duplicateOnCreate) {
        return json(
          { message: 'payer_duplicate: a payer named "Aetna (CVS Health)" already exists.' },
          400,
        );
      }
      const row = payerRow(`payer-new-${db.payers.length}`, String(body.p_name), {
        payer_kind: body.p_payer_kind,
        states: body.p_states ?? [],
        aliases: body.p_aliases ?? [],
        group_id_expected: body.p_group_id_expected ?? false,
        group_id_label: body.p_group_id_label ?? null,
        provider_id_expected: body.p_provider_id_expected ?? false,
        provider_id_label: body.p_provider_id_label ?? null,
        delegation_note: body.p_delegation_note ?? null,
      });
      db.payers.push(row);
      db.org_payer_assignments.push({
        id: `as-${db.org_payer_assignments.length + 1}`,
        org_id: ORG_ID,
        payer_id: row.id,
        starter: false,
        status: "active",
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

  const rows = (db[table] ?? []).filter(matchFilters);
  if (wantsObject) {
    if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
    return json(rows[0]);
  }
  return json(rows);
}

test.beforeEach(async ({ context }) => {
  db = null;
  rpcCalls.length = 0;
  tableWrites.length = 0;
  duplicateOnCreate = false;
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

test("name + near match — existing payers surface before any other field", async ({ page }) => {
  await page.goto("/admin/payers/new");
  await expect(page.getByRole("heading", { name: "Add a payer" })).toBeVisible({ timeout: 30000 });
  // Step 1 asks the name ONLY — no details until the check has run.
  await expect(page.getByLabel("Payer kind")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();

  // An exact name AND an alias-only match both surface (they are what
  // create_payer's duplicate guard rejects).
  await page.getByLabel("Payer name", { exact: true }).fill("Aetna");
  await expect(page.getByText(/existing payers look like a match/)).toBeVisible();
  await expect(page.getByText("Aetna (CVS Health)")).toBeVisible();
  await expect(page.getByText("Aetna Better Health of Arizona")).toBeVisible();

  // With matches on screen the primary action states the choice honestly.
  await expect(page.getByRole("button", { name: "None of these — set up new" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);

  // A merged match names + targets its successor (merge itself is Payer Detail).
  await page.getByLabel("Payer name", { exact: true }).fill("Old BCBS of Arizona");
  await expect(page.getByText("Merged", { exact: true })).toBeVisible();
  await expect(page.getByText(/merged into Blue Cross Blue Shield of Arizona/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Use this one" })).toHaveAttribute(
    "href",
    `/admin/payer-admin/catalog/${NEW_BCBS_ID}`,
  );

  // A genuinely new name clears the panel and restores Continue.
  await page.getByLabel("Payer name", { exact: true }).fill("Banner Health Plans");
  await expect(page.getByText(/look like a match/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();

  // Nothing on step 1 wrote anywhere.
  expect(rpcCalls.filter((c) => c.path === "create_payer")).toEqual([]);
  expect(tableWrites).toEqual([]);
});

test("details — new: required fields, aliases, ID expectations → create_payer", async ({
  page,
}) => {
  await page.goto("/admin/payers/new");
  await page.getByLabel("Payer name", { exact: true }).fill("Banner Health Plans");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Add Banner Health Plans" })).toBeVisible();
  // A brand-new payer starts genuinely empty — no kind, no states, no IDs.
  await expect(page.getByLabel("Payer kind")).toContainText("Select kind…");
  await expect(page.getByLabel("States this payer operates in")).toContainText("Select states…");
  await expect(page.getByText(/This payer issues no enrollment ID/)).toBeVisible();

  // Submitting incomplete blocks locally — nothing reaches the RPC.
  await page.getByRole("button", { name: "Create payer" }).click();
  await expect(page.getByText("Pick the payer type.")).toBeVisible();
  await expect(page.getByText("Pick at least one state this payer operates in.")).toBeVisible();
  expect(rpcCalls.filter((c) => c.path === "create_payer")).toEqual([]);

  await page.getByLabel("Payer kind").click();
  await page.getByRole("option", { name: "Medicare Advantage" }).click();

  // The states picker is searchable over all 50 + DC.
  await page.getByLabel("States this payer operates in").click();
  await page.getByLabel("Search states").fill("A");
  await page.getByRole("option", { name: "AZ", exact: true }).click();
  await page.getByRole("option", { name: "AL", exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByLabel("States this payer operates in")).toContainText("AL, AZ");

  // Aliases are removable chips.
  await page.getByLabel("New alias").fill("Banner");
  await page.getByRole("button", { name: "+ Add alias" }).click();
  await page.getByLabel("New alias").fill("Banner|Aetna");
  await page.getByRole("button", { name: "+ Add alias" }).click();
  await page.getByRole("button", { name: "Remove alias Banner|Aetna" }).click();
  await expect(page.getByRole("button", { name: "Remove alias Banner" })).toBeVisible();

  // Ticking an ID expectation asks for the payer's own word for it.
  await page.getByLabel("Provider-level ID", { exact: false }).first().check();
  await page.getByRole("button", { name: "Create payer" }).click();
  await expect(page.getByText("Name the provider-level ID the way this payer does.")).toBeVisible();
  expect(rpcCalls.filter((c) => c.path === "create_payer")).toEqual([]);
  await page
    .getByLabel("Provider-level ID — the payer's name for it")
    .fill("Banner Provider Number");

  await page.getByLabel("Delegation note").fill("Roster adds process in 30 days.");
  await page.getByRole("button", { name: "Create payer" }).click();

  // The RPC carries the whole record; no direct payers table write ever.
  await expect
    .poll(() => rpcCalls.filter((c) => c.path === "create_payer").length, { timeout: 15000 })
    .toBe(1);
  const body = rpcCalls.find((c) => c.path === "create_payer")?.body ?? {};
  expect(body).toMatchObject({
    p_org_id: ORG_ID,
    p_name: "Banner Health Plans",
    p_payer_kind: "medicare_advantage",
    p_states: ["AL", "AZ"],
    p_aliases: ["Banner"],
    p_provider_id_expected: true,
    p_provider_id_label: "Banner Provider Number",
    p_group_id_expected: false,
    p_delegation_note: "Roster adds process in 30 days.",
  });
  expect(body.p_group_id_label ?? null).toBeNull();
  expect(tableWrites.filter((w) => w.table === "payers")).toEqual([]);

  // Creating lands on the new payer, already in the org's network.
  await expect(page).toHaveURL(/\/admin\/payer-admin\/catalog\/payer-new-/, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: "Banner Health Plans" })).toBeVisible();
  await expect(page.getByText("In my network")).toBeVisible();
});

test("duplicate rejection renders inline and keeps the form", async ({ page }) => {
  duplicateOnCreate = true;
  await page.goto("/admin/payers/new");
  await page.getByLabel("Payer name", { exact: true }).fill("Aetna (CVS Health)");
  // The near-match panel already warns; the user insists.
  await page.getByRole("button", { name: "None of these — set up new" }).click();
  await page.getByLabel("Payer kind").click();
  await page.getByRole("option", { name: "Commercial" }).click();
  await page.getByLabel("States this payer operates in").click();
  await page.getByRole("option", { name: "AZ", exact: true }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Create payer" }).click();

  await expect(page.getByRole("alert")).toContainText(/already exists/, { timeout: 15000 });
  // Still on the form, input intact — never a silent bounce.
  await expect(page.getByRole("heading", { name: "Add Aetna (CVS Health)" })).toBeVisible();
  await expect(page.getByLabel("Payer name", { exact: true })).toHaveValue("Aetna (CVS Health)");
});

test("edit payer — hydrated from the record, catalog-wide, saved through update_payer", async ({
  page,
}) => {
  await page.goto(`/admin/payers/${AETNA_ID}/edit`);
  await expect(page.getByRole("heading", { name: "Edit payer" })).toBeVisible({ timeout: 30000 });

  // Catalog facts: the blast radius is stated in the header AND the footer.
  await expect(page.getByText("Affects every organization")).toBeVisible();
  await expect(
    page.getByText("Changes apply to every organization using this payer."),
  ).toBeVisible();

  // Every field hydrates, including both ID expectations with their labels.
  await expect(page.getByLabel("Payer name", { exact: true })).toHaveValue("Aetna (CVS Health)");
  await expect(page.getByLabel("Payer kind")).toContainText("Commercial");
  await expect(page.getByLabel("States this payer operates in")).toContainText("AZ, CA, CO, NY");
  await expect(
    page.getByRole("button", { name: "Remove alias Aetna Signature Administrators" }),
  ).toBeVisible();
  await expect(page.getByLabel("Group-level ID — the payer's name for it")).toHaveValue(
    "Group PIN",
  );
  await expect(page.getByLabel("Provider-level ID — the payer's name for it")).toHaveValue(
    "Provider Number",
  );

  // Edit the payer's wording + drop the group ID entirely.
  await page.getByLabel("Provider-level ID — the payer's name for it").fill("Aetna PIN");
  await page.getByLabel("Group-level ID", { exact: false }).first().uncheck();
  await expect(page.getByText("Not issued")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect
    .poll(() => rpcCalls.filter((c) => c.path === "update_payer").length, { timeout: 15000 })
    .toBe(1);
  const body = rpcCalls.find((c) => c.path === "update_payer")?.body ?? {};
  expect(body).toMatchObject({
    p_payer_id: AETNA_ID,
    p_name: "Aetna (CVS Health)",
    p_provider_id_expected: true,
    p_provider_id_label: "Aetna PIN",
    p_group_id_expected: false,
  });
  // Unticking CLEARS the stored label instead of leaving a stale one.
  expect(body.p_group_id_label ?? null).toBeNull();
  expect(tableWrites.filter((w) => w.table === "payers")).toEqual([]);
  await expect(page).toHaveURL(new RegExp(`/admin/payer-admin/catalog/${AETNA_ID}$`), {
    timeout: 15000,
  });
});

test("edit — a payer that issues no enrollment ID", async ({ page }) => {
  await page.goto(`/admin/payers/${NO_ID_PAYER_ID}/edit`);
  await expect(page.getByRole("heading", { name: "Edit payer" })).toBeVisible({ timeout: 30000 });

  // Both rows are off, both read "Not issued", and the consequence is stated.
  await expect(page.getByText("Not issued")).toHaveCount(2);
  await expect(page.getByLabel("Group-level ID — the payer's name for it")).toHaveCount(0);
  await expect(page.getByLabel("Provider-level ID — the payer's name for it")).toHaveCount(0);
  await expect(
    page.getByText(/This payer issues no enrollment ID. Approving a case will just confirm/),
  ).toBeVisible();
});

test("the payer detail carries the Edit entry for admins", async ({ page }) => {
  await page.goto(`/admin/payer-admin/catalog/${AETNA_ID}`);
  await expect(page.getByRole("heading", { name: "Aetna (CVS Health)" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("link", { name: "Edit payer" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/payers/${AETNA_ID}/edit$`), { timeout: 15000 });
  await expect(page.getByRole("heading", { name: "Edit payer" })).toBeVisible();
});
