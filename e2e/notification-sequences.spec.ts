// MINT-107 — the Org Detail Notifications card over the mock harness. An
// admin sets up intake reminders from the starter, edits an offset, fills
// and orders step 1's cc list, switches it on and saves; the spec asserts the
// exact save_notification_sequence payload, not just the UI. A specialist
// sees the saved schedule read-only.
import { test, expect, type Route } from "./fixtures/legacy-access-context";

const AUTH_KEY = "sb-example-auth-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const JANE_ID = "22222222-2222-4222-8222-222222222222";
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

const ORG = {
  name: "Point Place Physical Therapy",
  lifecycle_state: "active",
  created_at: "2026-07-01T00:00:00Z",
};

type Rows = Record<string, Record<string, unknown>[]>;

function fixtures(role: "admin" | "specialist"): Rows {
  return {
    organizations: [{ id: ORG_ID, ...ORG }],
    memberships: [
      {
        id: "m-1",
        org_id: ORG_ID,
        user_id: USER_ID,
        role,
        created_at: "2026-07-01T00:00:00Z",
        organizations: ORG,
        profiles: { full_name: "Sowmya Seed", email: "sowmya.seed@example.test" },
      },
      {
        id: "m-2",
        org_id: ORG_ID,
        user_id: JANE_ID,
        role: "specialist",
        created_at: "2026-07-02T00:00:00Z",
        organizations: ORG,
        profiles: { full_name: "Jane Doe", email: "jane@example.test" },
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
    notification_sequences: [],
    notification_sequence_steps: [],
    party_role_assignments: [],
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

function savedIntake(rows: Rows) {
  rows.notification_sequences = [
    {
      id: "seq-intake",
      org_id: ORG_ID,
      purpose: "intake_reminder",
      enabled: true,
      stop_conditions: ["submitted", "withdrawn"],
      target_days_to_ready: 14,
      compress_toward_start_date: true,
      revision: 4,
      created_at: "2026-10-30T00:00:00Z",
      updated_at: "2026-10-30T00:00:00Z",
      updated_by: USER_ID,
    },
  ];
  rows.notification_sequence_steps = [2, 4, 7].map((offset, i) => ({
    id: `step-${i + 1}`,
    sequence_id: "seq-intake",
    org_id: ORG_ID,
    position: i + 1,
    offset_days: offset,
    channel: "email",
    template_key: ["intake_reminder_first", "intake_reminder_second", "intake_reminder_final"][i],
    cc_recipients: i === 2 ? [{ kind: "user", user_id: JANE_ID }] : [],
    created_at: "2026-10-30T00:00:00Z",
    updated_at: "2026-10-30T00:00:00Z",
  }));
}

interface SaveCall {
  p_org_id: string;
  p_purpose: string;
  p_payload: {
    enabled: boolean;
    expected_revision: number | null;
    stop_conditions: string[];
    target_days_to_ready: number | null;
    compress_toward_start_date: boolean;
    steps: Array<{
      offset_days: number;
      channel: string;
      template_key: string;
      cc_recipients: unknown[];
    }>;
  };
}

function makeHandler(rows: Rows) {
  const saves: SaveCall[] = [];
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.includes("/auth/v1/")) return json(SESSION);

    if (url.pathname.endsWith("/rest/v1/rpc/save_notification_sequence")) {
      const call = req.postDataJSON() as SaveCall;
      saves.push(call);
      // Write through, as the RPC does: replace the row and its steps.
      const existing = rows.notification_sequences.find((r) => r.purpose === call.p_purpose);
      const id = (existing?.id as string | undefined) ?? `seq-${call.p_purpose}`;
      const sequence = {
        id,
        org_id: call.p_org_id,
        purpose: call.p_purpose,
        enabled: call.p_payload.enabled,
        stop_conditions: call.p_payload.stop_conditions,
        target_days_to_ready:
          call.p_purpose === "intake_reminder" ? (call.p_payload.target_days_to_ready ?? 14) : null,
        compress_toward_start_date: call.p_payload.compress_toward_start_date,
        revision: existing ? (existing.revision as number) + 1 : 1,
        created_at: "2026-10-31T00:00:00Z",
        updated_at: "2026-10-31T00:00:00Z",
        updated_by: USER_ID,
      };
      rows.notification_sequences = [
        ...rows.notification_sequences.filter((r) => r.purpose !== call.p_purpose),
        sequence,
      ];
      const steps = call.p_payload.steps.map((step, i) => ({
        id: `${id}-step-${i + 1}`,
        sequence_id: id,
        org_id: call.p_org_id,
        position: i + 1,
        ...step,
        created_at: "2026-10-31T00:00:00Z",
        updated_at: "2026-10-31T00:00:00Z",
      }));
      rows.notification_sequence_steps = [
        ...rows.notification_sequence_steps.filter((r) => r.sequence_id !== id),
        ...steps,
      ];
      return json({ sequence, steps });
    }
    if (url.pathname.includes("/rest/v1/rpc/")) return json(0);

    const table = url.pathname.split("/rest/v1/")[1] ?? "";
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (req.method() !== "GET") return json(wantsObject ? {} : [], 201);

    const matches = (row: Record<string, unknown>): boolean => {
      for (const [key, raw] of url.searchParams.entries()) {
        if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(key)) continue;
        if (!(key in row)) continue;
        if (raw.startsWith("eq.") && String(row[key]) !== raw.slice(3)) return false;
        if (raw.startsWith("neq.") && String(row[key]) === raw.slice(4)) return false;
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
    const found = (rows[table] ?? []).filter(matches);
    if (wantsObject) {
      if (found.length === 0) return json({ code: "PGRST116", message: "no rows" }, 406);
      return json(found[0]);
    }
    return json(found);
  };
  return { handler, saves };
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

test("MINT-107: an admin sets up intake reminders from the starter, fills the cc list in order and saves", async ({
  context,
  page,
}) => {
  const rows = fixtures("admin");
  const { handler, saves } = makeHandler(rows);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/org-detail");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible({
    timeout: 30000,
  });
  const intake = page.getByRole("region", { name: "Provider intake reminders" });
  await expect(intake.getByText("Not set up")).toBeVisible();
  await expect(
    intake.getByText(/3 emails, on day 2, day 4 and day 7 after the invite/),
  ).toBeVisible();

  await intake.getByRole("button", { name: "Set up provider intake reminders" }).click();
  await expect(intake.getByLabel("Step 1 days after invite")).toHaveValue("2");
  await expect(intake.getByLabel("Step 3 days after invite")).toHaveValue("7");
  await expect(intake.getByText("No one is cc'd on this step.")).toHaveCount(3);

  // Edit an offset.
  await intake.getByLabel("Step 2 days after invite").fill("5");

  // Fill step 1's empty cc list: a member, then a role, then put the role first.
  await intake.getByRole("combobox", { name: "Add someone to cc on step 1" }).click();
  await page.getByRole("option", { name: "Jane Doe" }).click();
  await intake.getByRole("combobox", { name: "Add someone to cc on step 1" }).click();
  await page.getByRole("option", { name: "All admins" }).click();
  await intake.getByRole("button", { name: "Move All admins up on step 1" }).click();
  const cc = intake.getByRole("list", { name: "People cc'd on step 1, in order" });
  await expect(cc.getByRole("listitem").first()).toContainText("All admins");
  await expect(cc.getByRole("listitem").nth(1)).toContainText("Jane Doe");

  // Keyboard-operable step reorder: step 3's message moves up, offsets stay.
  await intake.getByRole("button", { name: "Move step 3 up" }).click();

  await intake.getByRole("switch", { name: "Send intake reminders" }).click();
  await intake.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Provider intake reminders saved")).toBeVisible();

  expect(saves).toHaveLength(1);
  expect(saves[0]).toEqual({
    p_org_id: ORG_ID,
    p_purpose: "intake_reminder",
    p_payload: {
      enabled: true,
      stop_conditions: ["submitted", "paused", "withdrawn", "provider_replied"],
      target_days_to_ready: 14,
      compress_toward_start_date: true,
      expected_revision: null,
      steps: [
        {
          offset_days: 2,
          channel: "email",
          template_key: "intake_reminder_first",
          cc_recipients: [
            { kind: "role", role: "admin" },
            { kind: "user", user_id: JANE_ID },
          ],
        },
        {
          offset_days: 5,
          channel: "email",
          template_key: "intake_reminder_final",
          cc_recipients: [],
        },
        {
          offset_days: 7,
          channel: "email",
          template_key: "intake_reminder_second",
          cc_recipients: [],
        },
      ],
    },
  });

  // The refetch shows the saved row: on, nothing left to save.
  await expect(intake.getByText("On", { exact: true })).toBeVisible();
  await expect(intake.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expect(intake.getByRole("button", { name: "Discard changes" })).toBeDisabled();
  // The digest was never touched.
  const digest = page.getByRole("region", { name: "Daily follow-up digest" });
  await expect(digest.getByText("Not set up")).toBeVisible();
});

test("MINT-107: a specialist sees the saved schedule read-only", async ({ context, page }) => {
  const rows = fixtures("specialist");
  savedIntake(rows);
  const { handler, saves } = makeHandler(rows);
  await context.route(/\/(rest|auth)\/v1\//, handler);
  await seedAuth(context);

  await page.goto("/org-detail");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible({
    timeout: 30000,
  });
  const intake = page.getByRole("region", { name: "Provider intake reminders" });
  await expect(
    intake.getByText("Step 1 · day 2 after the invite · Email · First reminder"),
  ).toBeVisible();
  await expect(intake.getByText("Cc: Jane Doe")).toBeVisible();
  await expect(intake.getByRole("textbox")).toHaveCount(0);
  await expect(intake.getByRole("spinbutton")).toHaveCount(0);
  await expect(intake.getByRole("button")).toHaveCount(0);
  const digest = page.getByRole("region", { name: "Daily follow-up digest" });
  await expect(digest.getByText("Not set up. An admin can set this up.")).toBeVisible();
  await expect(digest.getByRole("button")).toHaveCount(0);
  await expect(page.getByText("Only admins can change notifications.")).toBeVisible();
  expect(saves).toHaveLength(0);
});
