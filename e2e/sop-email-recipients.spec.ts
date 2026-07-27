import { test, expect, type Route } from "@playwright/test";

// E1.7b F1.7b.5 — structured draft-email recipients over the mock harness
// (TS-46 recipient slice):
//   Template Wizard — a draft-email step authors a literal To (worked example
//     1's Optum inbox) plus a provider.email token Cc; the Review step chips
//     both; Publish sends them through the publish RPC's task_definitions
//     (recipient source + value version with the SOP content).
//   Case Wizard — a resolved task renders To/CC with provenance, the Gmail
//     hand-off URL carries to/cc, and an unresolved provider.email recipient
//     renders as a visible fill-before-send gap (generation is never blocked).
// Selection/validation are pinned by unit tests (sopResolver / sopPublishLint /
// gmailCompose / editableTemplate).

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const TEMPLATE_ID = "33333333-3333-4333-8333-333333333333";
const PAYER_ID = "55555555-5555-4555-8555-555555555555";
const CASE_ID = "66666666-6666-4666-8666-666666666666";
const PROVIDER_ID = "77777777-7777-4777-8777-777777777777";
const OPTUM = "network_PhysicalHealth@optum.com";
const PROVIDER_EMAIL = "jordan.rivera@example.com";

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

// The template head carries a draft-email step whose To is empty (the author
// fills it) and whose Cc is the provider.email token — so the token path
// round-trips through authoring and publish untouched.
const HEAD_DEFS = [
  {
    title: "Apply to Optum",
    description: "",
    sortOrder: 0,
    dueOffsetDays: 0,
    steps: [
      {
        label: "Draft the Optum application email",
        detail: "",
        stepType: "draft_email",
        emailTemplate: {
          subject: "Application for {{provider.firstName}}",
          body: "Please enroll {{provider.firstName}}.",
          cc: [{ source: "token", token: "provider.email" }],
        },
        dataFields: [],
      },
    ],
  },
];

// A resolved task for the Case Wizard: To has a literal + a resolved token,
// Cc has an UNRESOLVED provider.email token (address null) → a fill-before-send
// gap. sop_content keys are camelCase (the resolver's stored shape).
const RESOLVED_EMAIL_TASK = {
  id: "task-email",
  org_id: ORG_ID,
  case_id: CASE_ID,
  provider_id: PROVIDER_ID,
  title: "Apply to Optum",
  description: "",
  sop_content: [
    {
      id: "step-0",
      order: 0,
      label: "Draft the Optum application email",
      stepType: "draft_email",
      emailTemplate: {
        subject: "Application for Jordan",
        body: "Please enroll Jordan Rivera.",
        to: [
          { source: "literal", address: OPTUM },
          { source: "token", token: "provider.email", address: PROVIDER_EMAIL },
        ],
        cc: [{ source: "token", token: "provider.email", address: null }],
      },
      isCompleted: false,
      completedAt: null,
      completedBy: null,
      dataFields: [],
    },
  ],
  status: "pending",
  sort_order: 0,
  due_date: null,
  completed_date: null,
  is_auto_generated: true,
  sop_template_id: null,
  sop_version: null,
  sop_resolution_tier: null,
  created_at: "2026-07-14T00:00:00Z",
  updated_at: "2026-07-14T00:00:00Z",
};

const PROVIDER_ROW = {
  id: PROVIDER_ID,
  org_id: ORG_ID,
  first_name: "Jordan",
  last_name: "Rivera",
  npi: "1003456701",
  status: "active",
  email: PROVIDER_EMAIL,
  caqh_id: null,
  taxonomy_code: null,
  home_state: "KS",
  reference_only: false,
  terminated_date: null,
};

const CASE_ROW = {
  id: CASE_ID,
  org_id: ORG_ID,
  provider_id: PROVIDER_ID,
  payer_id: null,
  group_id: null,
  facility_id: null,
  state: "KS",
  specialty: null,
  mso_id: null,
  assigned_to: null,
  credentialing_status_id: null,
  payer_pipeline_state: "not_started",
  payer_reference_id: null,
  payer_individual_provider_id: null,
  payer_group_provider_id: null,
  generation_run_id: null,
  created_by: null,
  submitted_date: null,
  expected_effective_date: null,
  confirmed_effective_date: null,
  case_email_token: null,
  created_at: "2026-07-14T00:00:00Z",
  updated_at: "2026-07-14T00:00:00Z",
};

const FIXTURES: Record<string, Record<string, unknown>[]> = {
  organizations: [{ id: ORG_ID, name: "Kansas Fitness Physio", lifecycle_state: "active" }],
  memberships: [
    {
      org_id: ORG_ID,
      user_id: USER_ID,
      role: "admin",
      organizations: { name: "Kansas Fitness Physio", lifecycle_state: "active" },
    },
  ],
  profiles: [{ id: USER_ID, full_name: "Sowmya Seed", email: "sowmya.seed@example.test" }],
  payers: [{ id: PAYER_ID, org_id: null, name: "UnitedHealthCare", status: "active" }],
  provider_groups: [],
  portals: [],
  providers: [PROVIDER_ROW],
  status_configs: [],
  contracts: [],
  mso_routing_rules: [],
  denial_reason_codes: [],
  notes: [],
  user_table_prefs: [],
  credential_cases: [CASE_ROW],
  tasks: [RESOLVED_EMAIL_TASK],
  sop_templates: [
    {
      id: TEMPLATE_ID,
      org_id: ORG_ID,
      name: "UnitedHealthCare KS",
      group_id: null,
      state: "KS",
      specialty: null,
      payer_id: PAYER_ID,
      task_definitions: HEAD_DEFS,
      required_profile_attributes: [],
      archived: false,
      current_version: 1,
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-12T00:00:00Z",
    },
  ],
  sop_template_versions: [
    {
      id: "44444444-4444-4444-8444-444444444441",
      template_id: TEMPLATE_ID,
      version: 1,
      name: "UnitedHealthCare KS",
      task_definitions: HEAD_DEFS,
      change_note: null,
      published_at: "2026-07-01T00:00:00Z",
      published_by: null,
    },
  ],
};

interface Captured {
  publish: Record<string, unknown> | null;
}

// Enrich a credential_cases row with the embeds getCase's nested select expects.
function enrichCase(row: Record<string, unknown>) {
  return {
    ...row,
    provider: FIXTURES.providers.find((p) => p.id === row.provider_id) ?? null,
    payer: null,
    mso: null,
    group: null,
    facility: null,
    credentialing_status: null,
    tasks: FIXTURES.tasks.filter((t) => t.case_id === row.id),
    touches: [],
    status_history: [],
    payer_pipeline_history: [],
  };
}

function makeFulfill(captured: Captured) {
  return async function fulfillSupabase(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.endsWith("/rpc/get_sop_field_tokens")) {
      return json([
        { token: "provider.firstName", table: "providers", column: "first_name" },
        { token: "provider.email", table: "providers", column: "email" },
        { token: "provider.npi", table: "providers", column: "npi" },
      ]);
    }
    if (url.pathname.endsWith("/rpc/publish_sop_template_version")) {
      captured.publish = req.postDataJSON() as Record<string, unknown>;
      return json({ template_id: TEMPLATE_ID, version: 2 });
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    if (req.method() === "PATCH" || req.method() === "POST") return json(null, 201);

    let rows = FIXTURES[table] ?? [];
    for (const [key, value] of url.searchParams.entries()) {
      if (["select", "order", "limit", "offset", "or", "and"].includes(key)) continue;
      if (value.startsWith("eq.")) {
        const want = value.slice(3);
        rows = rows.filter((r) => String((r as Record<string, unknown>)[key]) === want);
      } else if (value.startsWith("in.")) {
        const set = value
          .slice(3)
          .replace(/^\(|\)$/g, "")
          .split(",")
          .map((s) => s.replace(/^"|"$/g, ""));
        rows = rows.filter((r) => set.includes(String((r as Record<string, unknown>)[key])));
      } else if (value === "is.null") {
        rows = rows.filter((r) => (r as Record<string, unknown>)[key] == null);
      }
    }
    const order = url.searchParams.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      rows = [...rows].sort((a, b) => {
        const av = (a as Record<string, unknown>)[col] as number | string;
        const bv = (b as Record<string, unknown>)[col] as number | string;
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return dir === "desc" ? -cmp : cmp;
      });
    }
    const out = table === "credential_cases" ? rows.map(enrichCase) : rows;
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (wantsObject) {
      if (out.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(out[0]);
    }
    return json(out);
  };
}

function seedAuth(context: {
  addInitScript: (fn: (args: unknown[]) => void, args: unknown[]) => Promise<void>;
}) {
  return context.addInitScript(
    ([authKey, session, orgId]) => {
      localStorage.setItem(authKey as string, JSON.stringify(session));
      localStorage.setItem(
        "minted-panel-active-org",
        JSON.stringify({ state: { activeOrgId: orgId }, version: 0 }),
      );
      // Record Gmail compose hand-offs instead of opening a real tab.
      (window as unknown as { __opened: string[] }).__opened = [];
      window.open = ((u?: string | URL) => {
        (window as unknown as { __opened: string[] }).__opened.push(String(u));
        return null;
      }) as typeof window.open;
    },
    [AUTH_KEY, SESSION, ORG_ID] as const,
  );
}

test.describe("E1.7b draft-email recipients (TS-46)", () => {
  const captured: Captured = { publish: null };

  test.beforeEach(async ({ context }) => {
    captured.publish = null;
    await context.route(/\/(rest|auth)\/v1\//, makeFulfill(captured));
    await seedAuth(context);
  });

  test("Template Wizard: authors a literal To + token Cc, chips them on Review, and publishes them", async ({
    page,
  }) => {
    await page.goto(`/admin/templates/${TEMPLATE_ID}`);
    // Step 2 — Tasks & steps (slice F merged the old Tasks and "Steps &
    // fields" steps) — holds the recipient editor.
    await expect(page.getByRole("button", { name: "Tasks & steps" })).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Tasks & steps" }).click();

    // The draft-email step's To editor starts empty; author the Optum inbox.
    await page.getByRole("button", { name: "Add to" }).click();
    await page.getByLabel("To email address").fill(OPTUM);

    // Turnaround + follow-up cadence are authored on the SAME draft-email step
    // and version with it (E1.7b step-shape extension).
    await page.getByLabel("Expected turnaround (days)").fill("45");
    await page.getByLabel("Follow up every (days)").fill("14");

    // Review chips both recipients (To literal + Cc provider.email token).
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByText(OPTUM)).toBeVisible();
    await expect(page.getByText("{{provider.email}}")).toBeVisible();

    // Publish threads the recipients through the publish RPC's task_definitions.
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Publish version 2")).toBeVisible();
    await page.getByPlaceholder("What changed and why").fill("Add Optum recipient");
    await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Published version 2")).toBeVisible({ timeout: 15000 });

    const defs = (captured.publish?.p_task_definitions ?? []) as Array<{
      steps: Array<{
        stepType?: string;
        emailTemplate?: Record<string, unknown>;
        expectedTurnaroundDays?: number;
        followUpEveryDays?: number;
      }>;
    }>;
    const emailStep = defs.flatMap((t) => t.steps).find((s) => s.stepType === "draft_email");
    expect(emailStep?.emailTemplate?.to).toEqual([{ source: "literal", address: OPTUM }]);
    expect(emailStep?.emailTemplate?.cc).toEqual([{ source: "token", token: "provider.email" }]);
    // The cadence versions with the step (subject/body already ride emailTemplate).
    expect(emailStep?.expectedTurnaroundDays).toBe(45);
    expect(emailStep?.followUpEveryDays).toBe(14);
  });

  test("TaskDrawer step body: renders resolved To/CC, threads them into the Gmail hand-off, and shows the unresolved gap", async ({
    page,
  }) => {
    // 2026-07-20: the step-at-a-time Wizard tab is retired — the List
    // checklist is the ONE task view, and the draft-email step body (this
    // locked F1.7b.5 feature) renders in the TaskDrawer a row click opens.
    await page.goto(`/cases/${CASE_ID}`);
    await expect(page.getByText("Apply to Optum").first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("tab", { name: "Wizard" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "List" })).toHaveCount(0);
    await page.getByText("Apply to Optum").first().click();

    // Resolved To recipients render with provenance; the unresolved Cc token is
    // a visible fill-before-send gap (never silently dropped).
    await expect(page.getByText(OPTUM)).toBeVisible();
    await expect(page.getByText(PROVIDER_EMAIL)).toBeVisible();
    await expect(page.getByText("Email address").first()).toBeVisible();
    await expect(page.getByText("fill before sending")).toBeVisible();
    await expect(page.getByText(/A recipient could not be resolved/)).toBeVisible();

    // The Gmail hand-off carries the resolved To addresses; nothing is sent.
    await page.getByRole("button", { name: "Open in Gmail" }).click();
    const opened = await page.evaluate(
      () => (window as unknown as { __opened: string[] }).__opened,
    );
    expect(opened).toHaveLength(1);
    const composeUrl = opened[0];
    expect(composeUrl).toContain("view=cm");
    expect(composeUrl).toContain(`to=${encodeURIComponent(`${OPTUM},${PROVIDER_EMAIL}`)}`);
    expect(composeUrl).not.toContain("bcc=");
  });
});
