// E6.0 — unified case status (TS-104, TS-105, TS-116, TS-117; TS-118's
// rollup reactivity is pure-function territory pinned in caseRollups.test.ts).
// The harness is the case-creation mock recipe: fixture PostgREST over
// context.route with write-throughs that mirror the E6.0 server behavior —
// the set_case_status RPC (canonical flip + legacy-mirror lockstep + an
// appended case_status_history row) and the touches-INSERT auto-transition
// trigger (first recorded work → In Progress, attributed system with the
// touch as evidence). Assertions run on the recorded wire writes AND the UI.
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

// The org's canonical credentialing status_configs — the retained legacy
// mirror rows the RPC keeps in lockstep (and the legacy history panel names).
const STATUS_CONFIGS = [
  ["st-notstarted", "Not Started", 5, "ours"],
  ["st-innetwork", "In-Network", 10, "complete"],
  ["st-inprog", "In Progress", 30, "ours"],
  ["st-waiting", "Waiting on Provider", 31, "waiting_provider"],
  ["st-submitted", "Submitted", 32, "waiting_payer"],
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

const REASON_CODES = [
  {
    id: "reason-panel",
    org_id: null,
    code: "network_closed",
    label: "Panel closed",
    active: true,
    created_at: "2026-07-01T00:00:00Z",
  },
  {
    id: "reason-other",
    org_id: null,
    code: "other",
    label: "Other",
    active: true,
    created_at: "2026-07-01T00:00:00Z",
  },
];

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

function makeFixtures(role: "admin" | "specialist" = "admin") {
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
        role,
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
        resolution_id_label: "Provider ID",
        resolution_id_expected: true,
        created_at: "2026-07-01T00:00:00Z",
      },
      {
        id: "pay-cigna",
        org_id: null,
        name: "Cigna",
        is_active: true,
        payer_kind: "commercial",
        status: "active",
        resolution_id_label: null,
        resolution_id_expected: null,
        created_at: "2026-07-01T00:00:00Z",
      },
      // Slice D (screen 5) fixtures — the E6.7 ID-expectation split: Kaiser
      // issues BOTH IDs under its own wording; Humana issues neither.
      {
        id: "pay-kaiser",
        org_id: null,
        name: "Kaiser Permanente Colorado",
        is_active: true,
        payer_kind: "commercial",
        status: "active",
        resolution_id_label: null,
        resolution_id_expected: null,
        group_id_label: "Group PIN",
        group_id_expected: true,
        provider_id_label: "Provider Number",
        provider_id_expected: true,
        created_at: "2026-07-01T00:00:00Z",
      },
      {
        id: "pay-humana",
        org_id: null,
        name: "Humana",
        is_active: true,
        payer_kind: "commercial",
        status: "active",
        resolution_id_label: null,
        resolution_id_expected: null,
        group_id_label: null,
        group_id_expected: false,
        provider_id_label: null,
        provider_id_expected: false,
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    status_configs: STATUS_CONFIGS,
    denial_reason_codes: REASON_CODES,
    credential_cases: [] as Record<string, unknown>[],
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
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
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
    status_history: fixtures.status_history.filter((h) => h.case_id === row.id),
    payer_pipeline_history: fixtures.payer_pipeline_history.filter((h) => h.case_id === row.id),
    case_status_history: fixtures.case_status_history.filter((h) => h.case_id === row.id),
  });

  // The 120200 auto-transition trigger, mirrored: any touchpoint on a
  // not_started case is first recorded work; an extension-logged submission
  // touch is THE submission evidence. Attributed system, evidence-linked.
  const applyAutoStatus = (touch: Record<string, unknown>) => {
    if (!touch.case_id || touch.entry_type !== "touchpoint") return;
    const row = fixtures.credential_cases.find((c) => c.id === touch.case_id);
    if (!row) return;
    const from = (row.case_status as string | undefined) ?? "not_started";
    const isExtensionSubmit = touch.source === "extension" && touch.outcome === "submitted";
    const to = isExtensionSubmit
      ? from === "not_started" || from === "in_progress"
        ? "submitted"
        : null
      : from === "not_started"
        ? "in_progress"
        : null;
    if (!to) return;
    row.case_status = to;
    row.credentialing_status_id = MIRROR_STATUS_ID[CANONICAL_MIRROR_LABEL[to]];
    fixtures.case_status_history.push({
      id: `csh-${nextId++}`,
      org_id: ORG_DILLON,
      case_id: row.id,
      from_status: from,
      to_status: to,
      actor_kind: "system",
      reason_code_id: null,
      evidence_touch_id: touch.id,
      is_correction: false,
      note: null,
      changed_by: USER_ID,
      changed_at: "2026-07-19T00:00:00Z",
    });
  };

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
      // E6.7/E6.8 Approved evidence rules, mirrored BEFORE any mutation (a
      // rejected close writes nothing): each expected ID must be supplied OR
      // explicitly acknowledged missing — silence raises the named error.
      if (to === "approved" && !body.p_is_correction) {
        const payer = fixtures.payers.find((p) => p.id === row.payer_id) as
          Record<string, unknown> | undefined;
        const providerExpected =
          (payer?.provider_id_expected ?? payer?.resolution_id_expected ?? true) === true;
        const groupExpected = payer?.group_id_expected === true;
        if (!body.p_effective_date) {
          return route.fulfill(json({ message: "case_status_approved_needs_effective_date" }, 400));
        }
        if (
          providerExpected &&
          !body.p_individual_provider_id &&
          body.p_provider_id_missing_ack !== true
        ) {
          return route.fulfill(json({ message: "case_status_approved_needs_provider_id" }, 400));
        }
        if (groupExpected && !body.p_group_provider_id && body.p_group_id_missing_ack !== true) {
          return route.fulfill(
            json({ message: "case_status_approved_needs_group_provider_id" }, 400),
          );
        }
      }
      row.case_status = to;
      row.credentialing_status_id = MIRROR_STATUS_ID[CANONICAL_MIRROR_LABEL[to]];
      if (to === "approved" && !body.p_is_correction) {
        row.confirmed_effective_date = body.p_effective_date ?? null;
        // An acked-missing ID stays NULL — the Awaiting-ID derivation input.
        row.payer_individual_provider_id = body.p_individual_provider_id ?? null;
        row.payer_group_provider_id = body.p_group_provider_id ?? null;
        row.contract_executed_date = body.p_contract_executed_date ?? null;
      }
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
          const row = {
            id: `touch-${nextId++}`,
            created_at: "2026-07-19T00:30:00Z",
            ...body,
          };
          fixtures.touches.push(row);
          applyAutoStatus(row);
          return row;
        });
        return route.fulfill(json(wantsObject ? inserted[0] : inserted, 201));
      }
      if (table === "tasks" && req.method() === "POST") {
        const inserted = bodies.map((body) => {
          const row = { id: `task-${nextId++}`, ...body };
          fixtures.tasks.push(row);
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

test("TS-104: every surface renders THE status from the same field; old ledgers stay readable; the Statuses admin page redirects", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  // A migrated case: legacy pair (In Progress × pipeline submitted) mapped
  // deterministically to canonical Submitted, with the migration-seeded
  // unified history row and its retained pre-unification ledgers.
  fixtures.credential_cases.push(
    caseRow("case-sub", {
      case_status: "submitted",
      payer_pipeline_state: "submitted",
      submitted_date: "2026-07-05",
    }),
  );
  fixtures.case_status_history.push({
    id: "csh-mig",
    org_id: ORG_DILLON,
    case_id: "case-sub",
    from_status: null,
    to_status: "submitted",
    actor_kind: "system",
    reason_code_id: null,
    evidence_touch_id: null,
    is_correction: false,
    note: "Unified case status migration (E6.0)",
    changed_by: null,
    changed_at: "2026-07-19T00:00:00Z",
  });
  fixtures.status_history.push({
    id: "sh-legacy",
    org_id: ORG_DILLON,
    case_id: "case-sub",
    track: "credentialing",
    from_status_id: "st-notstarted",
    to_status_id: "st-inprog",
    metadata: {},
    changed_by: USER_ID,
    changed_at: "2026-06-01T00:00:00Z",
  });
  fixtures.payer_pipeline_history.push({
    id: "pph-legacy",
    org_id: ORG_DILLON,
    case_id: "case-sub",
    from_state: "drafting",
    to_state: "submitted",
    reason_code_id: null,
    is_correction: false,
    justification: null,
    changed_by: USER_ID,
    changed_at: "2026-06-20T00:00:00Z",
  });
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_DILLON);

  // The cases work list (the redesigned Flat view) renders the canonical pill —
  // ONE "Case Status" column, no pipeline / contract machine columns.
  await page.goto("/cases");
  await expect(page.getByRole("columnheader", { name: "Case Status" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole("columnheader", { name: "Payer Pipeline" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Group Contract" })).toHaveCount(0);
  const listRow = page.locator("table tbody tr").filter({ hasText: "Dana Whitley" });
  await expect(listRow).toContainText("Submitted");

  // Case detail: the same value from the same field, attributed system with
  // the documented migration note; both retained ledgers readable. Case# is
  // the row click-through (the redesign retired the whole-row/Open affordance).
  await listRow.getByRole("link").click();
  await expect(page.getByText("Status", { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Set by system")).toBeVisible();
  await expect(page.getByText("Status history", { exact: true })).toBeVisible();
  await expect(page.getByText("Unified case status migration (E6.0)")).toBeVisible();
  await expect(page.getByText("Payer pipeline history")).toBeVisible();
  await expect(page.getByText("Legacy status history")).toBeVisible();

  // Provider record (2026-07-21 tabbed record): the Cases panel renders the
  // same canonical value through the shared pill.
  await page.goto("/providers/pr-dana");
  await page.getByRole("tab", { name: "Cases" }).click();
  await expect(page.getByRole("heading", { name: "Cases", exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator("li").filter({ hasText: "Anthem" }).first()).toContainText("Submitted");

  // The Statuses configuration page is retired — the route redirects.
  await page.goto("/admin/statuses");
  await expect(page).toHaveURL(/\/cases\/?$/, { timeout: 30000 });
});

test("TS-105: first recorded work auto-flips to In Progress (system + evidence); a human marks Submitted; the Add-touch bump carries the touch as evidence", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  fixtures.credential_cases.push(caseRow("case-ns", { case_status: "not_started" }));
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_DILLON);

  await page.goto("/cases/case-ns");
  await expect(page.getByRole("button", { name: "Update" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Not Started").first()).toBeVisible();

  // AUTO: logging a touchpoint is first recorded work — the trigger flips the
  // case with zero user action, attributed system, the touch as evidence.
  await page.getByRole("button", { name: "Add touch" }).click();
  await page.getByRole("button", { name: "Save touch" }).click();
  await expect(page.getByText("Touch logged")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("In Progress").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Set by system")).toBeVisible();

  // HUMAN: the fax/mail submission is never presumed — the person marks
  // Submitted from the header control.
  await page.getByRole("button", { name: "Update" }).click();
  await page.getByRole("menuitem", { name: "Submitted" }).click();
  const submitDialog = page.getByRole("dialog");
  await expect(submitDialog).toContainText("In Progress → Submitted");
  await submitDialog.getByRole("button", { name: "Mark Submitted" }).click();
  await expect(page.getByText("Status updated — Submitted")).toBeVisible({ timeout: 30000 });
  const submitRpc = writes.find(
    (w) => w.table === "rpc/set_case_status" && w.body?.p_to_status === "submitted",
  );
  expect(submitRpc?.body).toMatchObject({
    p_case_id: "case-ns",
    p_expected_status: "in_progress",
  });

  // F6.0.3 — a successful payer call at Submitted implies In Review; accepting
  // records touch + transition together, the touch linked as evidence.
  await page.getByRole("button", { name: "Add touch" }).click();
  // The Outcome disposition select shows the "— No outcome —" default.
  await page.getByRole("combobox").filter({ hasText: "No outcome" }).click();
  await page.getByRole("option", { name: "Successful", exact: true }).click();
  await expect(page.getByText("Also move the case to In Review")).toBeVisible();
  await page.getByText("Also move the case to In Review").click();
  await page.getByRole("button", { name: "Save touch" }).click();
  await expect(page.getByText("Status updated with the touch as evidence")).toBeVisible({
    timeout: 30000,
  });
  const bumpRpc = writes.find(
    (w) => w.table === "rpc/set_case_status" && w.body?.p_to_status === "in_review",
  );
  const loggedTouch = writes.filter((w) => w.table === "touches" && w.method === "POST").at(-1);
  expect(bumpRpc?.body?.p_evidence_touch_id).toBeTruthy();
  expect(loggedTouch).toBeTruthy();
  await expect(page.getByText("In Review").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Evidence:", { exact: false }).first()).toBeVisible();
});

test("TS-105 (Slice D retarget): Approved asks for exactly what the payer issues under its own label — the effective date gates, the ID never does; Denied demands a reason from the fixed list", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  fixtures.credential_cases.push(
    caseRow("case-rev", { case_status: "in_review", payer_pipeline_state: "in_review" }),
    caseRow("case-rev2", {
      case_status: "in_review",
      payer_id: "pay-cigna",
      state: "SC",
      payer_pipeline_state: "in_review",
    }),
  );
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_DILLON);

  // Approved (screen 5 "one ID" shape): Anthem's legacy pair resolves to a
  // provider ID only, under the payer's OWN label ("Provider ID"); no group
  // row renders because the payer doesn't issue one.
  await page.goto("/cases/case-rev");
  await expect(page.getByRole("button", { name: "Update" })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Update" }).click();
  await page.getByRole("menuitem", { name: "Approved" }).click();
  const approvedDialog = page.getByRole("dialog");
  await expect(approvedDialog).toContainText("IDs Anthem issues");
  await expect(approvedDialog.getByPlaceholder("Enter the Provider ID")).toBeVisible();
  await expect(approvedDialog.getByPlaceholder(/Enter the Group/)).toHaveCount(0);
  const confirmApproved = approvedDialog.getByRole("button", { name: "Approve", exact: true });
  // The ONE client-side gate is the effective date…
  await expect(confirmApproved).toBeDisabled();
  await approvedDialog.getByRole("button", { name: "Effective date" }).click();
  await page.getByRole("button", { name: /15th/ }).first().click();
  // …and NEVER the ID (handoff §2.1): the button enables with the ID blank.
  await expect(confirmApproved).toBeEnabled();
  await approvedDialog.getByPlaceholder("Enter the Provider ID").fill("ANTH-8891");
  await confirmApproved.click();
  await expect(page.getByText("Case approved")).toBeVisible({ timeout: 30000 });
  const approveRpc = writes.find(
    (w) => w.table === "rpc/set_case_status" && w.body?.p_to_status === "approved",
  );
  expect(approveRpc?.body?.p_individual_provider_id).toBe("ANTH-8891");
  expect(approveRpc?.body?.p_effective_date).toBeTruthy();
  expect(approveRpc?.body?.p_provider_id_missing_ack).toBe(false);

  // Denied: the reason is required from the governed word-list.
  await page.goto("/cases/case-rev2");
  await expect(page.getByRole("button", { name: "Update" })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Update" }).click();
  await page.getByRole("menuitem", { name: "Denied" }).click();
  const deniedDialog = page.getByRole("dialog");
  const confirmDenied = deniedDialog.getByRole("button", { name: "Mark Denied" });
  await expect(confirmDenied).toBeDisabled();
  await deniedDialog.getByRole("combobox").click();
  await page.getByRole("option", { name: "Panel closed" }).click();
  await confirmDenied.click();
  await expect(page.getByText("Denial recorded")).toBeVisible({ timeout: 30000 });
  const denyRpc = writes.find(
    (w) => w.table === "rpc/set_case_status" && w.body?.p_to_status === "denied",
  );
  expect(denyRpc?.body?.p_reason_code_id).toBe("reason-panel");
});

test("Slice D (screen 5, both IDs): silence is rejected by the RPC and surfaced; the “Didn't receive” ack approves with the ID NULL; the enrollment reads Awaiting ID and links the capturing case", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  fixtures.credential_cases.push(
    caseRow("case-both", {
      case_status: "in_review",
      payer_id: "pay-kaiser",
      state: "CO",
      payer_pipeline_state: "in_review",
    }),
  );
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_DILLON);

  await page.goto("/cases/case-both");
  await expect(page.getByRole("button", { name: "Update" })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Update" }).click();
  await page.getByRole("menuitem", { name: "Approved" }).click();
  const dialog = page.getByRole("dialog");

  // Both expected IDs render under the payer's OWN wording (E6.7 split).
  await expect(dialog).toContainText("IDs Kaiser Permanente Colorado issues");
  await expect(dialog).toContainText("one per group");
  await expect(dialog).toContainText("one per provider");
  const groupInput = dialog.getByPlaceholder("Enter the Group PIN");
  const providerInput = dialog.getByPlaceholder("Enter the Provider Number");
  await expect(groupInput).toBeVisible();
  await expect(providerInput).toBeVisible();

  const confirm = dialog.getByRole("button", { name: "Approve", exact: true });
  await dialog.getByRole("button", { name: "Effective date" }).click();
  await page.getByRole("button", { name: /15th/ }).first().click();
  await expect(confirm).toBeEnabled();
  await groupInput.fill("GP-448210");

  // SILENCE (expected provider ID, no value, no ack) is the RPC's rejection —
  // surfaced to the user, never pre-blocked client-side (handoff §2.1).
  await confirm.click();
  await expect(page.getByText(/This payer issues a provider ID — enter it or tick/)).toBeVisible({
    timeout: 30000,
  });
  await expect(dialog).toBeVisible();

  // The per-field escape: tick "Didn't receive" — the input locks, the amber
  // Awaiting-ID note + footer count appear, and the approve goes through.
  await dialog.getByRole("checkbox", { name: "Didn't receive the Provider Number" }).click();
  await expect(providerInput).toBeDisabled();
  await expect(dialog.getByText(/the enrollment will show “Awaiting ID”/)).toBeVisible();
  await expect(dialog.getByText("1 ID flagged as outstanding.")).toBeVisible();
  await confirm.click();
  await expect(page.getByText("Case approved")).toBeVisible({ timeout: 30000 });

  // The wire: the ack rides the RPC params; the acked ID is NULL — and stays
  // NULL on the stored row (Awaiting ID is DERIVED, never stored).
  const approveRpc = writes
    .filter((w) => w.table === "rpc/set_case_status" && w.body?.p_to_status === "approved")
    .at(-1);
  expect(approveRpc?.body).toMatchObject({
    p_case_id: "case-both",
    p_individual_provider_id: null,
    p_provider_id_missing_ack: true,
    p_group_provider_id: "GP-448210",
    p_group_id_missing_ack: false,
  });
  expect(
    fixtures.credential_cases.find((c) => c.id === "case-both")?.payer_individual_provider_id,
  ).toBeNull();

  // The provider record's Enrollments panel derives the wait and links back
  // to the capturing case.
  await page.goto("/providers/pr-dana");
  await page.getByRole("tab", { name: "Enrollments" }).click();
  const enrollRow = page.locator("#enrollments li").filter({ hasText: "Kaiser Permanente" });
  await expect(enrollRow).toBeVisible({ timeout: 30000 });
  await expect(enrollRow.getByText("Awaiting ID")).toBeVisible();
  await expect(enrollRow.getByRole("link", { name: "Open case" })).toHaveAttribute(
    "href",
    "/cases/case-both",
  );
});

test("Slice D (screen 5, no IDs): a payer that issues nothing gets effective date only; the enrollment reads No ID issued", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  fixtures.credential_cases.push(
    caseRow("case-none", {
      case_status: "in_review",
      payer_id: "pay-humana",
      state: "CO",
      payer_pipeline_state: "in_review",
    }),
  );
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_DILLON);

  await page.goto("/cases/case-none");
  await expect(page.getByRole("button", { name: "Update" })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Update" }).click();
  await page.getByRole("menuitem", { name: "Approved" }).click();
  const dialog = page.getByRole("dialog");

  // No ID fields, no escape checkboxes — just the honest explainer.
  await expect(
    dialog.getByText("Humana issues no enrollment ID, so there's nothing else to capture."),
  ).toBeVisible();
  await expect(dialog.getByText("Approving records the effective date.")).toBeVisible();
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);

  await dialog.getByRole("button", { name: "Effective date" }).click();
  await page.getByRole("button", { name: /15th/ }).first().click();
  await dialog.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Case approved")).toBeVisible({ timeout: 30000 });
  const approveRpc = writes.find(
    (w) => w.table === "rpc/set_case_status" && w.body?.p_to_status === "approved",
  );
  expect(approveRpc?.body).toMatchObject({
    p_individual_provider_id: null,
    p_group_provider_id: null,
    p_provider_id_missing_ack: false,
    p_group_id_missing_ack: false,
  });

  // The enrollment row: no wait to chase — the payer issues nothing.
  await page.goto("/providers/pr-dana");
  await page.getByRole("tab", { name: "Enrollments" }).click();
  const enrollRow = page.locator("#enrollments li").filter({ hasText: "Humana" });
  await expect(enrollRow).toBeVisible({ timeout: 30000 });
  await expect(enrollRow.getByText("No ID issued")).toBeVisible();
  await expect(enrollRow.getByText("Awaiting ID")).toHaveCount(0);
});

test("TS-116: reapply returns the SAME denied case to In Progress with a fresh cycle; the prior denial stays visible; never a second case", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  fixtures.credential_cases.push(
    caseRow("case-den", { case_status: "denied", payer_pipeline_state: "denied" }),
  );
  fixtures.case_status_history.push({
    id: "csh-den",
    org_id: ORG_DILLON,
    case_id: "case-den",
    from_status: "in_review",
    to_status: "denied",
    actor_kind: "user",
    reason_code_id: "reason-panel",
    evidence_touch_id: null,
    is_correction: false,
    note: null,
    changed_by: USER_ID,
    changed_at: "2026-06-15T00:00:00Z",
  });
  fixtures.tasks.push({
    id: "task-orig",
    org_id: ORG_DILLON,
    case_id: "case-den",
    provider_id: "pr-dana",
    title: "Original submission",
    description: null,
    sop_content: [],
    status: "completed",
    sort_order: 0,
    due_date: null,
    is_auto_generated: true,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  });
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_DILLON);

  await page.goto("/cases/case-den");
  await expect(page.getByText("This application was denied.", { exact: false })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Reapply" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Denied → In Progress");
  await dialog.getByRole("button", { name: "Reapply" }).click();
  await expect(page.getByText("Case reopened — In Progress.", { exact: false })).toBeVisible({
    timeout: 30000,
  });

  // The reapply edge rides the atomic RPC against the expected Denied state.
  const statusRpc = writes.find((w) => w.table === "rpc/set_case_status");
  expect(statusRpc?.body).toMatchObject({
    p_case_id: "case-den",
    p_to_status: "in_progress",
    p_expected_status: "denied",
  });

  // The SAME case: no create RPC, one case row, prior cycle intact.
  expect(writes.filter((w) => w.table === "rpc/create_case_with_tasks")).toHaveLength(0);
  expect(fixtures.credential_cases).toHaveLength(1);
  await expect(page.getByText("In Progress").first()).toBeVisible({ timeout: 30000 });
  // The prior denial (with its reason) stands beneath the new entry.
  await expect(page.getByText("Reason: Panel closed")).toBeVisible();
  await expect(page.getByText("Original submission")).toBeVisible();
});

test("TS-117: Not Pursuing requires a note; a backward correction is admin-only and APPENDS — the original entry stands", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  fixtures.credential_cases.push(
    caseRow("case-open", { case_status: "in_progress" }),
    caseRow("case-app", {
      case_status: "approved",
      payer_id: "pay-cigna",
      state: "SC",
      payer_pipeline_state: "approved",
      confirmed_effective_date: "2026-07-01",
      payer_individual_provider_id: "CIG-1",
    }),
  );
  fixtures.case_status_history.push({
    id: "csh-app",
    org_id: ORG_DILLON,
    case_id: "case-app",
    from_status: "in_review",
    to_status: "approved",
    actor_kind: "user",
    reason_code_id: null,
    evidence_touch_id: null,
    is_correction: false,
    note: null,
    changed_by: USER_ID,
    changed_at: "2026-07-01T00:00:00Z",
  });
  const { handler, writes } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_DILLON);

  // Not Pursuing requires the note.
  await page.goto("/cases/case-open");
  await expect(page.getByRole("button", { name: "Update" })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Update" }).click();
  await page.getByRole("menuitem", { name: "Not Pursuing" }).click();
  const npDialog = page.getByRole("dialog");
  const confirmNp = npDialog.getByRole("button", { name: "Mark Not Pursuing" });
  await expect(confirmNp).toBeDisabled();
  await npDialog.getByRole("textbox").fill("Group dropped this payer in NC");
  await confirmNp.click();
  await expect(page.getByText("Marked Not Pursuing")).toBeVisible({ timeout: 30000 });
  const npRpc = writes.find(
    (w) => w.table === "rpc/set_case_status" && w.body?.p_to_status === "not_pursuing",
  );
  expect(npRpc?.body?.p_note).toBe("Group dropped this payer in NC");

  // Admin backward correction: mis-clicked Approved → In Review, note
  // required; history shows the correction as a NEW entry above the original.
  await page.goto("/cases/case-app");
  await expect(page.getByRole("button", { name: "Update" })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Update" }).click();
  await page.getByRole("menuitem", { name: "Correct status…" }).click();
  const correctDialog = page.getByRole("dialog");
  const saveCorrection = correctDialog.getByRole("button", { name: "Save correction" });
  await expect(saveCorrection).toBeDisabled();
  await correctDialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "In Review" }).click();
  await correctDialog.getByRole("textbox").last().fill("Letter was for the SC sibling");
  await saveCorrection.click();
  await expect(page.getByText("Correction recorded")).toBeVisible({ timeout: 30000 });
  const correctionRpc = writes.find(
    (w) => w.table === "rpc/set_case_status" && w.body?.p_is_correction === true,
  );
  expect(correctionRpc?.body).toMatchObject({
    p_to_status: "in_review",
    p_note: "Letter was for the SC sibling",
  });
  // Append-only: the original Approved entry AND the correction both render.
  await expect(page.getByText("Correction", { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("“Letter was for the SC sibling”")).toBeVisible();
  expect(fixtures.case_status_history.filter((h) => h.case_id === "case-app")).toHaveLength(2);
});

test("TS-117: a specialist gets no backward-correction affordance on a closed case", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures("specialist");
  fixtures.credential_cases.push(
    caseRow("case-app", {
      case_status: "approved",
      payer_pipeline_state: "approved",
      confirmed_effective_date: "2026-07-01",
    }),
  );
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context, ORG_DILLON);

  await page.goto("/cases/case-app");
  await expect(page.getByText("Approved").first()).toBeVisible({ timeout: 30000 });
  // Approved is fully terminal for a specialist: no legal moves, no
  // correction item — the Update menu itself is gone.
  await expect(page.getByRole("button", { name: "Update" })).toHaveCount(0);
});
