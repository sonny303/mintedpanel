// Slice E — Case Detail (payer-and-cases screen 6). Covers the screen's
// states end to end on the mock harness: the header card (identity, payer
// link, group, tracking ID, ONE status pill + the Update-status menu with its
// per-move hints + the attribution sentence), the two-column body, the single
// task list with execution types and inline steps + the step drawer, the
// touchlog composer/entries, the Details card (case facts incl. the facility's
// full address · identifiers incl. the payer-issued IDs · provenance), the
// unified status timeline with its evidence link, and the §2.7 removals.
import { expect, test, type Route } from "@playwright/test";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "44444444-4444-4444-8444-444444444444";

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

function makeFixtures(over: { caseStatus?: string; approved?: boolean } = {}) {
  const caseStatus = over.caseStatus ?? "in_review";
  return {
    organizations: [
      {
        id: ORG_ID,
        name: "Dillon Sports Medicine",
        lifecycle_state: "active",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
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
        id: "pr-jim",
        org_id: ORG_ID,
        first_name: "Jim",
        last_name: "Apple",
        credentials: "PT",
        npi: "1234567890",
        caqh_id: "123456678",
        taxonomy_code: "2251X0800X",
        specialty: "Physical Therapy",
        status: "active",
        reference_only: false,
        verification_state: "verified",
        home_state: "CO",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    provider_groups: [
      {
        id: "g-yc",
        org_id: ORG_ID,
        name: "YC PT",
        tin: "841234567",
        npi_type2: "1770001112",
        is_active: true,
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    facilities: [
      {
        id: "f-boulder",
        org_id: ORG_ID,
        group_id: "g-yc",
        name: "Boulder Main St Clinic",
        street: "1200 Main St",
        suite: "Suite 4",
        city: "Boulder",
        state: "CO",
        zip: "80301",
        is_active: true,
        status_id: null,
        effective_date: null,
        reference_only: false,
        hours: {},
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    payers: [
      {
        id: "pay-banner",
        org_id: null,
        name: "Banner Health Plans",
        is_active: true,
        payer_kind: "commercial",
        status: "active",
        states: ["CO"],
        aliases: [],
        provider_id_label: "Provider Number",
        provider_id_expected: true,
        group_id_label: "Group PIN",
        group_id_expected: true,
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    credential_cases: [
      {
        id: "case-1046",
        case_number: 1046,
        org_id: ORG_ID,
        provider_id: "pr-jim",
        payer_id: "pay-banner",
        group_id: "g-yc",
        facility_id: "f-boulder",
        state: "CO",
        specialty: "Physical Therapy",
        mso_id: null,
        assigned_to: USER_ID,
        credentialing_status_id: null,
        case_status: caseStatus,
        payer_pipeline_state: "in_review",
        submitted_date: "2026-07-21",
        expected_effective_date: "2026-09-01",
        confirmed_effective_date: over.approved ? "2026-08-01" : null,
        contract_executed_date: null,
        approved_date: over.approved ? "2026-07-28" : null,
        termination_date: null,
        payer_reference_id: "BH-20441",
        // The Slice D outcome under test: the provider ID was captured, the
        // expected group ID was acked missing (stays NULL → Awaiting ID).
        payer_individual_provider_id: over.approved ? "A1234567" : null,
        payer_group_provider_id: null,
        generation_run_id: null,
        case_email_token: "c1046",
        created_by: USER_ID,
        created_at: "2026-07-20T00:00:00Z",
        updated_at: "2026-07-24T00:00:00Z",
      },
    ],
    tasks: [
      {
        id: "task-1",
        org_id: ORG_ID,
        case_id: "case-1046",
        provider_id: "pr-jim",
        title: "Confirm the provider is enrollment-ready",
        description: null,
        sop_content: [{ id: "s1", order: 1, label: "Check the roster record", isCompleted: true }],
        status: "completed",
        sort_order: 0,
        due_date: "2026-07-21",
        completed_date: "2026-07-21",
        is_auto_generated: true,
        execution_type: null,
        sop_template_id: null,
        sop_version: null,
        sop_resolution_tier: null,
        created_at: "2026-07-20T00:00:00Z",
        updated_at: "2026-07-21T00:00:00Z",
      },
      {
        id: "task-2",
        org_id: ORG_ID,
        case_id: "case-1046",
        provider_id: "pr-jim",
        title: "Complete the enrollment form in the portal",
        description: null,
        sop_content: [
          {
            id: "s2",
            order: 1,
            label: "Complete Banner PNM enrollment",
            isCompleted: false,
            stepType: "online_form",
          },
          { id: "s3", order: 2, label: "Capture the confirmation number", isCompleted: false },
        ],
        status: "in_progress",
        sort_order: 1,
        due_date: "2026-07-28",
        completed_date: null,
        is_auto_generated: true,
        execution_type: "extension_fill",
        sop_template_id: null,
        sop_version: null,
        sop_resolution_tier: null,
        created_at: "2026-07-20T00:00:00Z",
        updated_at: "2026-07-21T00:00:00Z",
      },
    ],
    touches: [
      {
        id: "t-portal",
        org_id: ORG_ID,
        case_id: "case-1046",
        entry_type: "touchpoint",
        touch_type: "portal",
        outcome: "successful",
        touch_date: "2026-07-24",
        notes: "Resubmitted the PNM application with the corrected TIN.",
        recipient_name: "Banner PNM portal",
        recipient_contact: null,
        next_follow_up_date: "2026-07-31",
        clears_follow_up: false,
        corrects_touch_id: null,
        communication_event_id: null,
        coordinator_id: USER_ID,
        source: "manual",
        created_at: "2026-07-24T00:00:00Z",
      },
    ],
    case_status_history: [
      {
        id: "csh-1",
        org_id: ORG_ID,
        case_id: "case-1046",
        from_status: "submitted",
        to_status: caseStatus,
        actor_kind: "user",
        reason_code_id: null,
        evidence_touch_id: "t-portal",
        is_correction: false,
        note: null,
        changed_by: USER_ID,
        changed_at: "2026-07-24T01:00:00Z",
      },
    ],
    // Retained-but-unrendered legacy ledgers: rows exist, the screen shows none.
    payer_pipeline_history: [
      {
        id: "pph-legacy",
        org_id: ORG_ID,
        case_id: "case-1046",
        from_state: "drafting",
        to_state: "submitted",
        reason_code_id: null,
        is_correction: false,
        justification: null,
        changed_by: USER_ID,
        changed_at: "2026-07-21T00:00:00Z",
      },
    ],
    status_history: [
      {
        id: "sh-legacy",
        org_id: ORG_ID,
        case_id: "case-1046",
        track: "credentialing",
        from_status_id: null,
        to_status_id: null,
        metadata: {},
        changed_by: USER_ID,
        changed_at: "2026-07-20T00:00:00Z",
      },
    ],
    status_configs: [] as Record<string, unknown>[],
    denial_reason_codes: [] as Record<string, unknown>[],
    portals: [] as Record<string, unknown>[],
    portal_field_maps: [] as Record<string, unknown>[],
    provider_documents: [] as Record<string, unknown>[],
    sop_templates: [] as Record<string, unknown>[],
    notes: [] as Record<string, unknown>[],
    user_table_prefs: [] as Record<string, unknown>[],
  };
}

function json(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

function makeHandler(fixtures: ReturnType<typeof makeFixtures>) {
  const writes: { table: string; method: string; body: Record<string, unknown> | null }[] = [];
  let seq = 0;

  const enrichCase = (row: Record<string, unknown>) => ({
    ...row,
    provider: fixtures.providers.find((p) => p.id === row.provider_id) ?? null,
    payer: fixtures.payers.find((p) => p.id === row.payer_id) ?? null,
    mso: null,
    group: fixtures.provider_groups.find((g) => g.id === row.group_id) ?? null,
    facility: fixtures.facilities.find((f) => f.id === row.facility_id) ?? null,
    credentialing_status: null,
    tasks: fixtures.tasks.filter((t) => t.case_id === row.id),
    touches: fixtures.touches.filter((t) => t.case_id === row.id),
    status_history: fixtures.status_history.filter((h) => h.case_id === row.id),
    payer_pipeline_history: fixtures.payer_pipeline_history.filter((h) => h.case_id === row.id),
    case_status_history: fixtures.case_status_history.filter((h) => h.case_id === row.id),
  });

  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());

    if (url.pathname.includes("/auth/v1/")) return route.fulfill(json(SESSION));
    if (url.pathname.endsWith("/rpc/set_case_status") && req.method() === "POST") {
      const body = req.postDataJSON() as Record<string, unknown>;
      writes.push({ table: "rpc/set_case_status", method: "POST", body });
      const row = fixtures.credential_cases.find((c) => c.id === body.p_case_id);
      if (!row) return route.fulfill(json({ message: "case_status_case_not_found" }, 400));
      row.case_status = body.p_to_status as string;
      fixtures.case_status_history.push({
        id: `csh-${(seq += 1)}`,
        org_id: ORG_ID,
        case_id: row.id,
        from_status: "in_review",
        to_status: body.p_to_status as string,
        actor_kind: "user",
        reason_code_id: null,
        evidence_touch_id: null,
        is_correction: false,
        note: (body.p_note as string) ?? null,
        changed_by: USER_ID,
        changed_at: "2026-07-25T00:00:00Z",
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
          const row = { id: `touch-${(seq += 1)}`, created_at: "2026-07-25T00:00:00Z", ...body };
          (fixtures.touches as Record<string, unknown>[]).push(row);
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

test("Slice E: the case screen is header + two columns — identity, the ONE status control with hinted moves, tasks with steps, touchlog, details, timeline", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures();
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/cases/case-1046");

  // HEADER: provider identity (links to the record), payer (links to its
  // catalog detail) · state · specialty · owning group, tracking ID, and the
  // ONE status pill with its attribution sentence. The first assertion carries
  // the repo's 30s first-load timeout (a fresh dev server pays Vite's
  // on-demand compile of the route graph on the first hit).
  await expect(page.getByRole("link", { name: "Jim Apple, PT" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("link", { name: "Jim Apple, PT" })).toHaveAttribute(
    "href",
    "/providers/pr-jim",
  );
  await expect(page.getByRole("link", { name: "Banner Health Plans" })).toHaveAttribute(
    "href",
    "/admin/payer-admin/catalog/pay-banner",
  );
  await expect(page.getByText("under YC PT")).toBeVisible();
  await expect(page.getByText("Tracking ID")).toBeVisible();
  await expect(page.getByText("BH-20441")).toBeVisible();
  await expect(page.getByText("In Review").first()).toBeVisible();
  // "In Review · <when> by Sowmya Seed — evidence: Portal touch"
  await expect(page.getByText(/In Review · .* by Sowmya Seed — evidence: .*touch/)).toBeVisible();

  // UPDATE STATUS: forward moves with their hints, then the three close-as
  // entries (screen 5's dialogs), then the admin correction.
  await page.getByRole("button", { name: "Update status" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: /Action Required/ })).toBeVisible();
  await expect(menu.getByText("Effective date + the IDs this payer issues")).toBeVisible();
  await expect(menu.getByText("Reason from the governed list")).toBeVisible();
  await expect(menu.getByText("Deliberate opt-out — note required")).toBeVisible();
  await expect(
    menu.getByText("Admin · any direction, note required, kept in history"),
  ).toBeVisible();
  // The close-as entry opens Slice D's dialog (screen 5) unchanged.
  await menu.getByRole("menuitem", { name: /^Approved…/ }).click();
  const approveDialog = page.getByRole("dialog");
  await expect(approveDialog.getByRole("heading", { name: "Approve case" })).toBeVisible();
  await expect(approveDialog).toContainText("IDs Banner Health Plans issues");
  await approveDialog.getByRole("button", { name: "Cancel" }).click();

  // TASKS: one list — execution type per task, ordered steps beneath, and the
  // CURRENT step (first incomplete step of the first unfinished task) carrying
  // "Open step", which opens the drawer where the step bodies live.
  await expect(page.getByText("1 of 2 completed", { exact: false })).toBeVisible();
  // The label comes from the shared EXECUTION_TYPE_LABELS map — since Slice F
  // swept extension naming out of user copy, `extension_fill` reads Auto-fill.
  await expect(page.getByText("Auto-fill")).toBeVisible();
  await expect(page.getByText("Complete Banner PNM enrollment")).toBeVisible();
  await expect(page.getByText("Capture the confirmation number")).toBeVisible();
  const openStep = page.getByRole("button", { name: "Open step" });
  await expect(openStep).toHaveCount(1);
  await openStep.click();
  const drawer = page.getByRole("dialog");
  await expect(
    drawer.getByText("Complete the enrollment form in the portal").first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // TOUCHLOG: full metadata on the entry — type, disposition, recipient,
  // context, follow-up — plus the composer.
  await expect(page.getByText("Touchlog")).toBeVisible();
  await expect(
    page.getByText("Resubmitted the PNM application with the corrected TIN."),
  ).toBeVisible();
  await expect(page.getByText(/Recipient:.*Banner PNM portal/)).toBeVisible();
  await expect(page.getByText(/Next follow-up|Follow-up overdue/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add touch" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add note" })).toBeVisible();

  // DETAILS: one card, three groups — case facts (facility WITH its full
  // address), identifiers, provenance.
  const details = page.getByRole("region", { name: "Details" });
  await expect(details.getByText("Boulder Main St Clinic")).toBeVisible();
  await expect(details.getByText("1200 Main St, Suite 4 · Boulder, CO 80301")).toBeVisible();
  await expect(details.getByText("Days open")).toBeVisible();
  await expect(details.getByText("Identifiers")).toBeVisible();
  await expect(details.getByText("1234567890")).toBeVisible();
  await expect(details.getByText("1770001112")).toBeVisible();
  await expect(details.getByText("Provenance")).toBeVisible();
  await expect(
    details.getByText("Created manually by Sowmya Seed", { exact: false }),
  ).toBeVisible();
  // Payer-issued IDs are an approval outcome — this open case says so.
  await expect(details.getByText("Payer-issued IDs appear here after approval.")).toBeVisible();

  // STATUS TIMELINE: the unified history, each entry linking to its evidence.
  await expect(page.getByText("Status history", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /touch$/ })).toHaveAttribute(
    "href",
    "#touch-t-portal",
  );

  // §2.7 REMOVALS — none of these render on the case screen anymore.
  await expect(page.getByText("Required documents")).toHaveCount(0);
  await expect(page.getByText("Work in portal")).toHaveCount(0);
  await expect(page.getByText("Payer pipeline history")).toHaveCount(0);
  await expect(page.getByText("Legacy status history")).toHaveCount(0);
});

test("Slice E: an approved case shows the payer-issued IDs under the payer's own wording — a captured value and the Slice D Awaiting-ID wait", async ({
  context,
  page,
}) => {
  const fixtures = makeFixtures({ caseStatus: "approved", approved: true });
  const { handler } = makeHandler(fixtures);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/cases/case-1046");
  const details = page.getByRole("region", { name: "Details" });
  await expect(details.getByText("Provider Number")).toBeVisible({ timeout: 30000 });
  await expect(details.getByText("A1234567")).toBeVisible();
  // The expected group ID was acked missing at approval: derived, never stored.
  await expect(details.getByText("Group PIN")).toBeVisible();
  await expect(details.getByText("Awaiting ID")).toBeVisible();
  await expect(details.getByText("Payer-issued IDs appear here after approval.")).toHaveCount(0);
  // The confirmed effective date the approval captured rides the case facts.
  await expect(details.getByText("Confirmed effective")).toBeVisible();
});
