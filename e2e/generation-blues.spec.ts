// PM brief 2026-10-27 — two Blues for one provider, and a Generate page that
// names every missing link. One group in CO + KS; BCBS Kansas and Blue KC
// both target KS; Taylor works at a CO clinic (primary) AND a KS clinic,
// Casey at the CO clinic only.
//   • Both Blues show for Taylor in KS. Blue KC's two global SOPs tie, so it
//     waits in the tied-SOP banner until a template is chosen.
//   • Casey's KS targets read "no clinic or license in KS", never nothing.
//   • Aetna (worked in CO, covers KS) has no KS target: a setup line names it.
//   • The lookup explains one exact pair with its fix.
//   • Confirm creates every row; the KS cases carry the KS clinic, never the
//     CO primary, and Blue KC stamps the chosen SOP.
import { test, expect, type Route } from "./fixtures/legacy-access-context";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "88888888-8888-4888-8888-888888888888";
const GROUP_ID = "g-shelby";

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

const payerRow = (id: string, name: string, states: string[]) => ({
  id,
  org_id: null,
  name,
  payer_kind: "commercial",
  states,
  aliases: [],
  status: "active",
  archived_at: null,
  payer_slug: id,
  avg_decision_days: null,
  created_at: "2026-06-01T00:00:00Z",
});

const providerRow = (id: string, first: string, last: string) => ({
  id,
  org_id: ORG_ID,
  first_name: first,
  last_name: last,
  credentials: "PT",
  npi: "1093817465",
  status: "onboarding",
  verification_state: "verified",
  reference_only: false,
  home_state: "CO",
  specialty: "Physical Therapy",
  taxonomy_code: null,
  email: null,
  group_id: null,
  start_date: "2026-06-01",
  caqh_id: "16224897",
  caqh_last_attested_date: "2026-07-01",
  date_of_birth: "1990-01-01",
  ssn_last4: "1234",
  home_street: "1 Main St",
  home_city: "Denver",
  home_zip: "80202",
  malpractice_coverage_end: "2028-12-31",
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
});

const facilityRow = (id: string, name: string, state: string) => ({
  id,
  org_id: ORG_ID,
  group_id: GROUP_ID,
  name,
  street: "100 Clinic Way",
  city: state === "KS" ? "Overland Park" : "Denver",
  state,
  zip: state === "KS" ? "66210" : "80202",
  is_active: true,
  status_id: null,
  effective_date: null,
  reference_only: false,
  hours: {},
  created_at: "2026-06-01T00:00:00Z",
});

const target = (payerId: string, state: string) => ({
  id: `t-${payerId}-${state}`,
  org_id: ORG_ID,
  payer_id: payerId,
  group_id: GROUP_ID,
  state,
  status: "active",
  created_at: "2026-06-15T00:00:00Z",
});

const groupAssignment = (providerId: string) => ({
  id: `ga-${providerId}`,
  org_id: ORG_ID,
  provider_id: providerId,
  group_id: GROUP_ID,
  is_primary: true,
  start_date: "2026-06-01",
  end_date: null,
  created_at: "2026-06-01T00:00:00Z",
});

const facilityAssignment = (providerId: string, facilityId: string, isPrimary: boolean) => ({
  id: `fa-${providerId}-${facilityId}`,
  org_id: ORG_ID,
  provider_id: providerId,
  facility_id: facilityId,
  is_primary: isPrimary,
  start_date: "2026-06-01",
  created_at: "2026-06-01T00:00:00Z",
});

const sop = (id: string, name: string, payerId: string | null, states: string[] | null) => ({
  id,
  org_id: null,
  payer_id: payerId,
  state: states?.[0] ?? null,
  states,
  specialty: null,
  group_id: null,
  name,
  case_type: "enrollment",
  archived: false,
  current_version: 1,
  required_profile_attributes: [],
  task_definitions: [
    {
      title: `${name} packet`,
      dueOffsetDays: 7,
      steps: [{ label: "Complete the application", stepType: "online_form", dataFields: [] }],
    },
  ],
  created_at: id === "sop-kc-b" ? "2026-06-02T00:00:00Z" : "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
});

const SOPS = [
  sop("sop-fallback", "Generic credentialing checklist", null, null),
  sop("sop-kc-a", "Blue KC enrollment", "blue-kc", ["KS"]),
  sop("sop-kc-b", "Blue KC enrollment (2026)", "blue-kc", ["KS"]),
];

function fixtures(): Record<string, Record<string, unknown>[]> {
  return {
    organizations: [
      {
        id: ORG_ID,
        name: "Shelby Rehab",
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
          name: "Shelby Rehab",
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
        id: GROUP_ID,
        org_id: ORG_ID,
        name: "Shelby PT",
        tin: "123456789",
        npi_type2: null,
        states: ["CO", "KS"],
        is_active: true,
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
    facilities: [
      facilityRow("f-co", "Denver Clinic", "CO"),
      facilityRow("f-ks", "Overland Park Clinic", "KS"),
    ],
    providers: [
      providerRow("pr-taylor", "Taylor", "Example"),
      providerRow("pr-casey", "Casey", "Example"),
    ],
    provider_group_assignments: [groupAssignment("pr-taylor"), groupAssignment("pr-casey")],
    provider_facility_assignments: [
      facilityAssignment("pr-taylor", "f-co", true),
      facilityAssignment("pr-taylor", "f-ks", false),
      facilityAssignment("pr-casey", "f-co", true),
    ],
    state_licenses: [],
    payers: [
      payerRow("bcbs-ks", "BCBS Kansas", ["KS"]),
      payerRow("blue-kc", "Blue KC", ["KS", "MO"]),
      payerRow("aetna", "Aetna", ["CO", "KS"]),
    ],
    org_payer_assignments: [],
    payer_network_targets: [
      target("bcbs-ks", "KS"),
      target("blue-kc", "KS"),
      target("aetna", "CO"),
    ],
    case_generation_exclusions: [],
    enrollment_facts: [],
    credential_cases: [],
    case_generation_runs: [],
    case_generation_run_rows: [],
    case_status_history: [],
    status_history: [],
    denial_reason_codes: [],
    contracts: [],
    tasks: [],
    status_configs: [],
    sop_templates: SOPS,
    sop_template_versions: SOPS.map((t) => ({
      id: `ver-${t.id}`,
      template_id: t.id,
      version: 1,
      case_type: "enrollment",
      name: t.name,
      task_definitions: t.task_definitions,
      published_at: "2026-06-01T00:00:00Z",
    })),
    sop_template_drafts: [],
    next_best_action_configs: [],
    provider_documents: [],
    group_insurance_policies: [],
    import_runs: [],
    import_rows: [],
    notes: [],
    user_table_prefs: [],
    audit_log: [],
    touches: [],
    payer_forms: [],
  };
}

interface RecordedRpc {
  p_input: Record<string, unknown>;
  p_tasks: Array<Record<string, unknown>>;
}

function makeHandler(db: Record<string, Record<string, unknown>[]>) {
  const created: RecordedRpc[] = [];
  let seq = 0;

  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);

    if (url.pathname.endsWith("/rpc/create_case_with_tasks") && req.method() === "POST") {
      const body = req.postDataJSON() as RecordedRpc;
      created.push(body);
      const input = body.p_input;
      const row = {
        id: `case-${(seq += 1)}`,
        org_id: ORG_ID,
        provider_id: input.provider_id,
        payer_id: input.payer_id,
        state: input.state,
        group_id: input.group_id ?? null,
        facility_id: input.facility_id ?? null,
        case_status: "not_started",
        credentialing_status_id: null,
        generation_run_id: input.generation_run_id ?? null,
        created_at: "2026-10-27T00:00:00Z",
        updated_at: "2026-10-27T00:00:00Z",
      };
      db.credential_cases.push(row);
      return json(row);
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json([]);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    const matches = (row: Record<string, unknown>): boolean => {
      for (const [key, raw] of url.searchParams.entries()) {
        if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(key)) continue;
        if (!(key in row)) continue;
        if (raw.startsWith("eq.") && String(row[key]) !== raw.slice(3)) return false;
        if (raw.startsWith("neq.") && String(row[key]) === raw.slice(4)) return false;
        if (raw.startsWith("is.null") && row[key] !== null) return false;
        if (raw.startsWith("in.(")) {
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
      const n = (db[table] ?? []).filter(matches).length;
      return route.fulfill({ status: 200, headers: { "content-range": `*/${n}` }, body: "" });
    }
    if (req.method() === "POST") {
      let parsed: unknown = null;
      try {
        parsed = req.postDataJSON();
      } catch {
        parsed = null;
      }
      const bodies = Array.isArray(parsed)
        ? (parsed as Record<string, unknown>[])
        : [(parsed ?? {}) as Record<string, unknown>];
      const inserted = bodies.map((b) => ({
        id: `new-${(seq += 1)}`,
        created_at: "2026-10-27T00:00:00Z",
        ...b,
      }));
      if (db[table]) db[table].push(...inserted);
      return json(wantsObject ? inserted[0] : inserted, 201);
    }
    if (req.method() !== "GET") return json([]);

    const rows = (db[table] ?? []).filter(matches);
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
  };
  return { handler, created };
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

test("two Blues for one provider: every missing link is named, ties are chosen, KS cases get the KS clinic", async ({
  context,
  page,
}) => {
  const { handler, created } = makeHandler(fixtures());
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/generation");
  await expect(page.getByRole("heading", { name: "Generate cases" })).toBeVisible({
    timeout: 30000,
  });

  // Blue KC's two SOPs tie: the row waits in the banner, named, with a chooser.
  const tied = page.getByTestId("generation-tied-sops");
  await expect(tied).toBeVisible({ timeout: 30000 });
  await expect(tied).toContainText("Taylor Example · Shelby PT · Blue KC KS");
  const bar = page.getByTestId("grid-reconciliation");
  await expect(bar).toHaveText("Create 3 — 3 of 3 accounted for");

  // Missing setup: Aetna is worked in CO, covers KS, the group has a KS clinic.
  const blockers = page.getByTestId("generation-blockers");
  await expect(blockers).toContainText("Aetna KS");
  await expect(blockers).toContainText(
    "Shelby PT isn't set up with Aetna in KS. Affects Taylor Example.",
  );
  await expect(blockers.getByRole("link", { name: "Attach payer" })).toHaveAttribute(
    "href",
    `/groups/${GROUP_ID}/payer-network`,
  );

  // Casey's KS targets are named, folded into one line, never silent.
  await blockers.getByText(/Targets in states the provider doesn't work in/).click();
  await expect(blockers).toContainText(
    "Shelby PT · No clinic or license in KS · BCBS Kansas, Blue KC",
  );

  // The lookup explains one exact pair and offers the fix.
  await page.getByText("Why isn't a pair here?").click();
  await page.locator("#lookup-provider").click();
  await page.getByRole("option", { name: "Casey Example" }).click();
  await page.locator("#lookup-payer").click();
  await page.getByRole("option", { name: "BCBS Kansas" }).click();
  await page.locator("#lookup-state").click();
  await page.getByRole("option", { name: "KS", exact: true }).click();
  const result = page.getByTestId("pair-lookup-result");
  await expect(result).toContainText("Casey Example has no clinic or license in KS.");
  await expect(result.getByRole("link", { name: "Add a clinic or license" })).toHaveAttribute(
    "href",
    "/providers/pr-casey",
  );

  // Choose Blue KC's SOP: the row joins the run.
  await tied.getByRole("combobox").click();
  await page.getByRole("option", { name: /Blue KC enrollment \(2026\)/ }).click();
  await expect(bar).toHaveText("Create 4 — 4 of 4 accounted for");

  await page.getByRole("button", { name: "Confirm & create 4 cases" }).click();
  await expect.poll(() => created.length, { timeout: 30000 }).toBe(4);

  const byKey = new Map(
    created.map((c) => [`${c.p_input.provider_id}|${c.p_input.payer_id}|${c.p_input.state}`, c]),
  );
  // Both Blues for Taylor in KS, at the KS clinic — not the CO primary.
  expect(byKey.get("pr-taylor|bcbs-ks|KS")?.p_input.facility_id).toBe("f-ks");
  expect(byKey.get("pr-taylor|blue-kc|KS")?.p_input.facility_id).toBe("f-ks");
  // CO cases stay at the CO clinic.
  expect(byKey.get("pr-taylor|aetna|CO")?.p_input.facility_id).toBe("f-co");
  expect(byKey.get("pr-casey|aetna|CO")?.p_input.facility_id).toBe("f-co");
  // The tie resolved to the chosen SOP, stamped on its tasks.
  expect(byKey.get("pr-taylor|blue-kc|KS")?.p_tasks[0]?.sop_template_id).toBe("sop-kc-b");
});
