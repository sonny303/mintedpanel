// E6.6 F6.6.5 — the unified global Add touch (TS-115 touch half + TS-137).
// One logging action everywhere: the /cases toolbar's Add touch opens the
// multi-case dialog (the E4.1 batch semantics — one touch row per selected
// case + one TOUCH_LOGGED audit per touch + a batch summary), the F6.0.3
// bump suggestion rides the same dialog per case (each case's OWN touch is
// the set_case_status evidence), and the separate "Log Payer Call" dialog is
// GONE. Harness: the unified-case-status recipe — fixture PostgREST with
// write-throughs for touches inserts + the set_case_status RPC; assertions
// run on the recorded wire writes AND the UI. (Supersedes the E4.1 skipped
// placeholders this file used to hold — the single-case form contract stays
// pinned by unified-case-status TS-105.)
import { expect, test, type Route } from "@playwright/test";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_DILLON = "44444444-4444-4444-8444-444444444444";

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

const STATUS_CONFIGS = [
  ["st-notstarted", "Not Started", 5, "ours"],
  ["st-inprog", "In Progress", 30, "ours"],
  ["st-submitted", "Submitted", 32, "waiting_payer"],
  ["st-waiting", "Waiting on Provider", 31, "waiting_provider"],
  ["st-approved", "Approved", 35, "complete"],
  ["st-denied", "Denied", 40, "ours"],
  ["st-notrequired", "Not Required", 45, "complete"],
].map(([id, label, sortOrder, bucket]) => ({
  id,
  org_id: ORG_DILLON,
  track: "credentialing",
  label,
  color: "#2563EB",
  sort_order: sortOrder,
  required_fields: [],
  action_bucket: bucket,
  created_at: "2026-07-01T00:00:00Z",
}));

const CANONICAL_MIRROR_LABEL: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  submitted: "Submitted",
  in_review: "Submitted",
  action_required: "Waiting on Provider",
  approved: "Approved",
  denied: "Denied",
  not_pursuing: "Not Required",
};

const MIRROR_STATUS_ID: Record<string, string> = {
  "Not Started": "st-notstarted",
  "In Progress": "st-inprog",
  Submitted: "st-submitted",
  "Waiting on Provider": "st-waiting",
  Approved: "st-approved",
  Denied: "st-denied",
  "Not Required": "st-notrequired",
};

function caseRow(
  id: string,
  over: Record<string, unknown> & { case_status: string },
): Record<string, unknown> {
  return {
    id,
    org_id: ORG_DILLON,
    provider_id: "pr-dana",
    payer_id: "pay-anthem",
    state: "NC",
    group_id: "g-dillon",
    facility_id: null,
    specialty: null,
    mso_id: null,
    assigned_to: null,
    credentialing_status_id: MIRROR_STATUS_ID[CANONICAL_MIRROR_LABEL[over.case_status]] ?? null,
    payer_pipeline_state: "not_started",
    contract_executed_date: null,
    submitted_date: null,
    approved_date: null,
    confirmed_effective_date: null,
    expected_effective_date: null,
    termination_date: null,
    payer_reference_id: null,
    payer_individual_provider_id: null,
    payer_group_provider_id: null,
    generation_run_id: null,
    case_email_token: `tok-${id}`,
    created_by: USER_ID,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-10T00:00:00Z",
    ...over,
  };
}

function makeFixtures() {
  return {
    organizations: [
      {
        id: ORG_DILLON,
        name: "Dillon Sports Medicine",
        lifecycle_state: "active",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    memberships: [
      {
        org_id: ORG_DILLON,
        role: "specialist",
        organizations: {
          name: "Dillon Sports Medicine",
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
    providers: [
      {
        id: "pr-dana",
        org_id: ORG_DILLON,
        first_name: "Dana",
        last_name: "Whitley",
        credentials: "PT",
        npi: "1234567890",
        specialty: "Physical Therapy",
        email: "dana@example.test",
        home_state: "NC",
        status: "active",
        reference_only: false,
        verification_state: "verified",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    provider_groups: [
      {
        id: "g-dillon",
        org_id: ORG_DILLON,
        name: "Dillon Group",
        tin: "123456789",
        is_active: true,
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    payers: [
      {
        id: "pay-anthem",
        org_id: null,
        name: "Anthem",
        is_active: true,
        payer_kind: "commercial",
        status: "active",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    status_configs: STATUS_CONFIGS,
    denial_reason_codes: [] as Record<string, unknown>[],
    // Three open Anthem cases already SUBMITTED — a successful payer call
    // implies In Review for every one (the TS-115/Gherkin batch-call shape).
    credential_cases: [
      caseRow("case-a", { case_status: "submitted", state: "NC" }),
      caseRow("case-b", { case_status: "submitted", state: "SC" }),
      caseRow("case-c", { case_status: "submitted", state: "TX" }),
    ],
    case_status_history: [] as Record<string, unknown>[],
    status_history: [] as Record<string, unknown>[],
    payer_pipeline_history: [] as Record<string, unknown>[],
    tasks: [] as Record<string, unknown>[],
    touches: [] as Record<string, unknown>[],
    sop_templates: [] as Record<string, unknown>[],
    org_payer_settings: [] as Record<string, unknown>[],
    contracts: [] as Record<string, unknown>[],
    notes: [] as Record<string, unknown>[],
    user_table_prefs: [] as Record<string, unknown>[],
  };
}

interface RecordedWrite {
  table: string;
  method: string;
  body: Record<string, unknown> | null;
}

function json(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

function makeHandler(fixtures: ReturnType<typeof makeFixtures>) {
  const writes: RecordedWrite[] = [];
  let nextId = 1;

  const enrichCase = (row: Record<string, unknown>) => ({
    ...row,
    provider: fixtures.providers.find((p) => p.id === row.provider_id) ?? null,
    payer: fixtures.payers.find((p) => p.id === row.payer_id) ?? null,
    mso: null,
    group: fixtures.provider_groups.find((g) => g.id === row.group_id) ?? null,
    facility: null,
    credentialing_status:
      fixtures.status_configs.find((s) => s.id === row.credentialing_status_id) ?? null,
    tasks: fixtures.tasks.filter((t) => t.case_id === row.id),
    touches: fixtures.touches.filter((t) => t.case_id === row.id),
    status_history: [],
    payer_pipeline_history: [],
    case_status_history: fixtures.case_status_history.filter((h) => h.case_id === row.id),
  });

  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());

    if (url.pathname.includes("/auth/v1/")) return route.fulfill(json(SESSION));
    if (url.pathname.endsWith("/rpc/claim_invites")) return route.fulfill(json(0));

    if (url.pathname.endsWith("/rpc/set_case_status") && req.method() === "POST") {
      const body = req.postDataJSON() as Record<string, unknown>;
      writes.push({ table: "rpc/set_case_status", method: "POST", body });
      const row = fixtures.credential_cases.find((c) => c.id === body.p_case_id);
      if (!row) return route.fulfill(json({ message: "case_status_case_not_found" }, 400));
      const from = (row.case_status as string | undefined) ?? "not_started";
      if (body.p_expected_status && body.p_expected_status !== from) {
        return route.fulfill(json({ message: `case_status_conflict:${from}` }, 400));
      }
      const to = body.p_to_status as string;
      row.case_status = to;
      row.credentialing_status_id = MIRROR_STATUS_ID[CANONICAL_MIRROR_LABEL[to]];
      fixtures.case_status_history.push({
        id: `csh-${nextId++}`,
        org_id: ORG_DILLON,
        case_id: row.id,
        from_status: from,
        to_status: to,
        actor_kind: "user",
        reason_code_id: body.p_reason_code_id ?? null,
        evidence_touch_id: body.p_evidence_touch_id ?? null,
        is_correction: body.p_is_correction ?? false,
        note: body.p_note ?? null,
        changed_by: USER_ID,
        changed_at: "2026-07-19T01:00:00Z",
      });
      return route.fulfill(json(row));
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return route.fulfill(json(0));

    const table = url.pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

    if (req.method() !== "GET") {
      const raw = req.postDataJSON() as Record<string, unknown> | Record<string, unknown>[] | null;
      const bodies = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const body of bodies) writes.push({ table, method: req.method(), body });

      if (table === "touches" && req.method() === "POST") {
        const inserted = bodies.map((body) => {
          const row = { id: `touch-${nextId++}`, created_at: "2026-07-19T00:30:00Z", ...body };
          fixtures.touches.push(row);
          return row;
        });
        return route.fulfill(json(wantsObject ? inserted[0] : inserted, 201));
      }
      const prefer = req.headers()["prefer"] ?? "";
      if (prefer.includes("return=representation")) {
        return route.fulfill(json(wantsObject ? {} : [{}]));
      }
      return route.fulfill(json(null, 201));
    }

    const matchFilters = (row: Record<string, unknown>): boolean => {
      for (const [key, rawValue] of url.searchParams.entries()) {
        if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(key)) continue;
        if (!(key in row)) continue;
        if (rawValue.startsWith("eq.")) {
          if (String(row[key]) !== rawValue.slice(3)) return false;
        } else if (rawValue.startsWith("in.(")) {
          const ids = rawValue
            .slice(4, -1)
            .split(",")
            .map((v) => v.replaceAll('"', "").trim());
          if (!ids.includes(String(row[key]))) return false;
        } else if (rawValue.startsWith("neq.")) {
          if (String(row[key]) === rawValue.slice(4)) return false;
        }
      }
      return true;
    };

    const all = (fixtures as unknown as Record<string, Record<string, unknown>[]>)[table] ?? [];
    const rows = all.filter((r) => matchFilters(r));
    const out = table === "credential_cases" ? rows.map(enrichCase) : rows;
    if (wantsObject) {
      if (out.length === 0) return route.fulfill(json({ code: "PGRST116" }, 406));
      return route.fulfill(json(out[0]));
    }
    return route.fulfill(json(out));
  };

  return { handler, writes };
}

async function seedAuth(context: import("@playwright/test").BrowserContext) {
  await context.addInitScript(
    ([authKey, session, activeOrg]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: activeOrg }, version: 0 }),
      );
    },
    [AUTH_KEY, SESSION, ORG_DILLON] as const,
  );
}

test("TS-115 — one Add touch spans three cases: per-case touch rows + accepted bumps with each touch as evidence; no Log Payer Call anywhere", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/cases?pivot=payer");
  await expect(page.getByRole("heading", { name: "Cases", exact: true })).toBeVisible({
    timeout: 30000,
  });

  // The batch dialog's entry points folded into ONE verb: "Log payer call"
  // (and the old "Log touch" label) are gone.
  await expect(page.getByRole("button", { name: "Log payer call" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log touch", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Add touch" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Add touch" })).toBeVisible();

  // Select all three Anthem cases.
  await page.getByRole("dialog").getByText("Select all").click();
  await expect(page.getByRole("dialog").getByText("Cases (3 selected)")).toBeVisible();

  // A successful payer call on three Submitted cases implies In Review for
  // all three — ONE grouped suggestion, accepted.
  await page.getByRole("combobox").filter({ hasText: "No outcome" }).click();
  await page.getByRole("option", { name: "Successful", exact: true }).click();
  await expect(page.getByText("Also move 3 cases to In Review")).toBeVisible();
  await page.getByText("Also move 3 cases to In Review").click();

  await page.getByRole("button", { name: "Save touch" }).click();
  await expect(page.getByText("Touch logged on 3 cases")).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByText("Status updated on 3 cases with the touches as evidence"),
  ).toBeVisible({ timeout: 30000 });

  // The follow-up landing: the payer pivot pinned to exactly the touched set.
  await expect(page).toHaveURL(/pivot=payer/, { timeout: 30000 });
  await expect(page).toHaveURL(/ids=case-a%2Ccase-b%2Ccase-c|ids=case-a,case-b,case-c/);

  // WIRE: one touch row per case (the E4.1 batch semantics)…
  const touchWrites = writes.filter((w) => w.table === "touches" && w.method === "POST");
  expect(touchWrites).toHaveLength(3);
  expect(new Set(touchWrites.map((w) => w.body?.case_id))).toEqual(
    new Set(["case-a", "case-b", "case-c"]),
  );
  // …one TOUCH_LOGGED audit per touch + the batch summary…
  const auditWrites = writes.filter(
    (w) => w.table === "audit_log" && (w.body?.action_type as string) === "TOUCH_LOGGED",
  );
  expect(auditWrites.length).toBeGreaterThanOrEqual(4);
  // …and one accepted bump per case, each linking THAT case's own touch.
  const bumpWrites = writes.filter((w) => w.table === "rpc/set_case_status");
  expect(bumpWrites).toHaveLength(3);
  expect(new Set(bumpWrites.map((w) => w.body?.p_case_id))).toEqual(
    new Set(["case-a", "case-b", "case-c"]),
  );
  for (const bump of bumpWrites) {
    expect(bump.body?.p_to_status).toBe("in_review");
    const evidence = bump.body?.p_evidence_touch_id as string;
    const touch = fixtures.touches.find((t) => t.id === evidence);
    expect(touch?.case_id).toBe(bump.body?.p_case_id);
  }
});

test("TS-137 — a non-implying touch never offers a bump; declining an offered bump logs the touch alone", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/cases?pivot=payer");
  await page.getByRole("button", { name: "Add touch" }).click();
  await page.getByRole("dialog").getByText("Select all").click();

  // No outcome selected → the touch implies nothing → no suggestion appears.
  await expect(page.getByText(/Also move/)).toHaveCount(0);

  // An attempted call (voicemail) still implies nothing.
  await page.getByRole("combobox").filter({ hasText: "No outcome" }).click();
  await page.getByRole("option", { name: "Attempted", exact: true }).click();
  await expect(page.getByText(/Also move/)).toHaveCount(0);

  // Successful DOES imply — but declining (leaving it unchecked) logs the
  // touches alone: zero status writes.
  await page.getByRole("combobox").filter({ hasText: "Attempted" }).click();
  await page.getByRole("option", { name: "Successful", exact: true }).click();
  await expect(page.getByText("Also move 3 cases to In Review")).toBeVisible();
  await page.getByRole("button", { name: "Save touch" }).click();
  await expect(page.getByText("Touch logged on 3 cases")).toBeVisible({ timeout: 30000 });

  expect(writes.filter((w) => w.table === "touches" && w.method === "POST")).toHaveLength(3);
  expect(writes.filter((w) => w.table === "rpc/set_case_status")).toHaveLength(0);
});
