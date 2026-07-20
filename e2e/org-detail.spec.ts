// E6.1 F6.1.4/F6.1.5 / TS-107 — the slim Org Detail container over the mock
// harness: exactly the container content (org summary, contacts, People
// Enroll, relocated member management — the capture-link card is gone) plus
// Finish-setup banner while the one-time wizard is incomplete — and never
// after it completes. The Organization-data summaries render on the Groups
// shell instead. No Onboarding nav entry exists; the wizard is entered via
// the org switcher's Add organization (and the banner).
import { test, expect, type Route } from "@playwright/test";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "66666666-6666-4666-8666-666666666666";

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

const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const party = (over: Record<string, unknown>) => ({
  id: "p",
  party_type: "person",
  name: "",
  email: null,
  phone_office: null,
  phone_mobile: null,
  address_line1: null,
  address_line2: null,
  city: null,
  state: null,
  postal_code: null,
  country: null,
  created_by: USER_ID,
  created_at: "2026-07-09T00:00:00Z",
  ...over,
});

// Complete org-details inputs: owner (name + valid email) and a customer
// contact satisfying every required contact field.
const PARTY_ASSIGNMENTS = [
  {
    org_id: ORG_ID,
    role_key: "owner",
    parties: party({ id: "p-owner", name: "Julie Point", email: "julie@pointplace.example.test" }),
  },
  {
    org_id: ORG_ID,
    role_key: "customer_escalation_contact",
    parties: party({
      id: "p-cust",
      name: "Coach Eric Taylor",
      email: "contact.pointplace@example.test",
      phone_office: "432-555-0118",
      address_line1: "500 Panther Field Rd",
      city: "Dillon",
      state: "TX",
      postal_code: "79714",
    }),
  },
];

function baseFixtures(): Record<string, Record<string, unknown>[]> {
  return {
    organizations: [
      {
        id: ORG_ID,
        name: "Point Place Physical Therapy",
        lifecycle_state: "active",
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    memberships: [
      {
        id: "m-1",
        org_id: ORG_ID,
        user_id: USER_ID,
        role: "admin",
        created_at: "2026-07-01T00:00:00Z",
        organizations: {
          name: "Point Place Physical Therapy",
          lifecycle_state: "active",
          created_at: "2026-07-01T00:00:00Z",
        },
        profiles: { full_name: "Sowmya Seed", email: "sowmya.seed@example.test" },
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
    party_role_assignments: PARTY_ASSIGNMENTS,
    party_role_types: [],
    parties: [],
    party_capture_links: [],
    pending_invites: [],
    inbound_leads: [],
    notes: [],
    user_table_prefs: [],
    audit_log: [],
    touches: [],
    provider_groups: [],
    facilities: [],
    providers: [],
    provider_group_assignments: [],
    provider_facility_assignments: [],
    state_licenses: [],
    payers: [],
    org_payer_assignments: [],
    payer_network_targets: [],
    provider_documents: [],
    group_insurance_policies: [],
    status_configs: [],
    sop_templates: [],
    credential_cases: [],
    tasks: [],
    contracts: [],
  };
}

// The wizard-complete org: ≥1 active group + facility, a provider with an
// assignment, an active payer target, and a fully green readiness row (the
// next-best-action-queue.spec.ts green fixture shape) — every section
// resolves complete, so the banner must be gone.
function completeFixtures(): Record<string, Record<string, unknown>[]> {
  const f = baseFixtures();
  f.provider_groups = [
    {
      id: "g-1",
      org_id: ORG_ID,
      name: "Point Place Group",
      tin: "123456789",
      states: ["NC"],
      is_active: true,
      created_at: "2026-07-10T00:00:00Z",
    },
  ];
  f.facilities = [
    {
      id: "f-1",
      org_id: ORG_ID,
      group_id: "g-1",
      name: "Point Place Clinic",
      street: "1 Main St",
      city: "Charlotte",
      state: "NC",
      zip: "28280",
      is_active: true,
      status_id: null,
      effective_date: null,
      reference_only: false,
      created_at: "2026-07-10T00:00:00Z",
    },
  ];
  f.providers = [
    {
      id: "pr-1",
      org_id: ORG_ID,
      first_name: "Jane",
      last_name: "Whitaker",
      credentials: "PT",
      npi: "1093817465",
      status: "onboarding",
      reference_only: false,
      home_state: "NC",
      specialty: "Physical Therapy",
      taxonomy_code: null,
      email: null,
      group_id: null,
      start_date: "2026-01-01",
      caqh_id: "16224897",
      caqh_last_attested_date: daysFromNow(-10),
      date_of_birth: "1990-01-01",
      ssn_last4: "1234",
      home_street: "4104 S Croatan Hwy",
      home_city: "Nags Head",
      home_zip: "27959",
      malpractice_coverage_end: "2028-12-31",
      created_at: "2026-07-10T00:00:00Z",
      updated_at: "2026-07-10T00:00:00Z",
    },
  ];
  f.provider_group_assignments = [
    {
      id: "ga-1",
      org_id: ORG_ID,
      provider_id: "pr-1",
      group_id: "g-1",
      is_primary: true,
      start_date: "2026-01-01",
      end_date: null,
      created_at: "2026-07-10T00:00:00Z",
    },
  ];
  f.provider_facility_assignments = [
    {
      id: "fa-1",
      org_id: ORG_ID,
      provider_id: "pr-1",
      facility_id: "f-1",
      is_primary: true,
      start_date: "2026-01-01",
      created_at: "2026-07-10T00:00:00Z",
    },
  ];
  f.state_licenses = [
    {
      id: "l-1",
      org_id: ORG_ID,
      provider_id: "pr-1",
      state: "NC",
      license_number: "PT-1",
      expiration_date: "2028-12-31",
      verified_status: "verified",
      status: "active",
    },
  ];
  f.payers = [
    {
      id: "pay-1",
      org_id: null,
      name: "BCBS-NC",
      payer_kind: "commercial",
      states: ["NC"],
      aliases: [],
      status: "active",
      payer_slug: "bcbs-nc",
      is_active: true,
      created_at: "2026-07-10T00:00:00Z",
    },
  ];
  f.payer_network_targets = [
    {
      id: "t-1",
      org_id: ORG_ID,
      payer_id: "pay-1",
      group_id: "g-1",
      state: "NC",
      status: "active",
      created_at: "2026-07-12T00:00:00Z",
    },
  ];
  f.provider_documents = ["w9", "coi", "voided_check"].map((docType) => ({
    id: `g-1-${docType}`,
    org_id: ORG_ID,
    group_id: "g-1",
    doc_type: docType,
    expiration_date: null,
  }));
  return f;
}

interface RecordedWrite {
  table: string;
  body: Record<string, unknown> | null;
}

function makeHandler(fixtures: Record<string, Record<string, unknown>[]>) {
  const writes: RecordedWrite[] = [];
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");

    if (req.method() !== "GET") {
      let body: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = req.postDataJSON();
        body = Array.isArray(parsed)
          ? ((parsed[0] ?? null) as Record<string, unknown> | null)
          : (parsed as Record<string, unknown> | null);
      } catch {
        body = null;
      }
      writes.push({ table, body });
      const row = { id: `new-${writes.length}`, ...(body ?? {}) };
      return json(wantsObject ? row : [row], 201);
    }

    const matchFilters = (row: Record<string, unknown>): boolean => {
      for (const [key, raw] of url.searchParams.entries()) {
        if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(key)) continue;
        if (!(key in row)) continue;
        if (raw.startsWith("eq.")) {
          if (String(row[key]) !== raw.slice(3)) return false;
        } else if (raw.startsWith("in.(")) {
          const ids = raw
            .slice(4, -1)
            .split(",")
            .map((s) => s.replace(/^"|"$/g, ""));
          if (!ids.includes(String(row[key]))) return false;
        } else if (raw.startsWith("neq.")) {
          if (String(row[key]) === raw.slice(4)) return false;
        }
      }
      return true;
    };

    const rows = (fixtures[table] ?? []).filter((r) => matchFilters(r));
    if (wantsObject) {
      if (rows.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(rows[0]);
    }
    return json(rows);
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

test("TS-107: Org Detail carries only the container content, members render without invite capability, and the Finish-setup banner shows while the wizard is incomplete", async ({
  context,
  page,
}) => {
  const { handler } = makeHandler(baseFixtures());
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/org-detail");
  await expect(page.getByRole("heading", { name: "Org Detail" })).toBeVisible({ timeout: 30000 });

  // The container content (F6.1.4): summary + contacts, People Enroll, and
  // the relocated member management. The capture-link re-issue card was
  // removed from MVP by user request (2026-07-19) — /onboarding's share
  // journey is the remaining operator surface.
  await expect(page.getByRole("heading", { name: "Organization summary" })).toBeVisible();
  await expect(page.getByText("Coach Eric Taylor").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "People Enroll" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data capture link" })).toHaveCount(0);

  // Invite capability removed from MVP (user request 2026-07-19, UI only —
  // the backend invite model stays): no button, no dialog, and the Pending
  // invites table is hidden when no legacy rows exist. The members table
  // itself still renders (read + role management).
  await expect(page.getByText("Manage who has access to this organization.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Sowmya Seed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite member" })).toHaveCount(0);
  await expect(page.getByText("Pending invites")).toHaveCount(0);

  // The Organization-data freight is gone (it lives on the Groups shell).
  await expect(page.getByRole("heading", { name: "Provider groups" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Provider roster" })).toHaveCount(0);

  // 2026-07-20 re-scope: the Resolution identifiers table is GONE from Org
  // Detail — a payer-issued enrollment ID is not an org-wide value. The
  // issued VALUE is captured on the provider's enrollment fact / the group's
  // Payer Network entry; the LABEL is a Minted-curated payer fact.
  await expect(page.getByRole("heading", { name: "Resolution identifiers" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Configure ID" })).toHaveCount(0);

  // The Finish-setup banner: shown while the wizard is incomplete, entering
  // the wizard flow (F6.1.5 re-entry).
  await expect(page.getByText(/Finish setting up/)).toBeVisible();
  await page.getByRole("link", { name: "Finish setup" }).click();
  await expect(page).toHaveURL(/\/onboarding\/wizard\/?$/, { timeout: 15000 });

  // No Onboarding nav entry exists (the wizard is one-time, F6.1.5).
  await expect(page.locator("aside").getByRole("link", { name: /Onboarding/ })).toHaveCount(0);
});

test("TS-107: the banner never renders once every wizard section is complete; the Groups shell carries the relocated summaries", async ({
  context,
  page,
}) => {
  const { handler } = makeHandler(completeFixtures());
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/org-detail");
  await expect(page.getByRole("heading", { name: "Org Detail" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("heading", { name: "Organization summary" })).toBeVisible();
  // Every section resolves complete → the banner is gone for good.
  await expect(page.getByText(/Finish setting up/)).toHaveCount(0);

  // The organization data lives under Groups (E6.2): a single-group org
  // auto-lands on its group hub with the facts card + the two area doors.
  await page.goto("/groups");
  await expect(page.getByRole("heading", { name: "Point Place Group" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page).toHaveURL(/\/groups\/g-1\/?$/);
  await expect(page.getByRole("heading", { name: "Group facts" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Payer Network/ })).toBeVisible();
});
