import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildSavePayload, starterDraft, type SequenceDraft } from "@/lib/notificationSequences";
import {
  listNotificationSequences,
  saveNotificationSequence,
  type NotificationSequenceServiceCtx,
} from "./notificationSequences";

// Every call here goes through the injected ctx.db. The mock only keeps the
// module-level browser client from being built, which throws in CI's build
// job where VITE_SUPABASE_* is unset.
vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));

const ORG = "66666666-6666-4666-8666-666666666666";
const USER = "11111111-1111-4111-8111-111111111111";

const SEQUENCE_ROW = {
  id: "seq-1",
  org_id: ORG,
  purpose: "intake_reminder",
  enabled: true,
  stop_conditions: ["submitted", "withdrawn"],
  target_days_to_ready: 14,
  compress_toward_start_date: null,
  send_hour: null,
  send_time_zone: null,
  revision: 3,
  created_at: "2026-10-30T00:00:00Z",
  updated_at: "2026-10-30T01:00:00Z",
  updated_by: USER,
};

// Minted's seeded defaults, as PostgREST returns them.
const DEFAULT_ROWS = [
  {
    purpose: "intake_reminder",
    stop_conditions: ["submitted", "paused", "withdrawn", "provider_replied"],
    target_days_to_ready: 14,
    compress_toward_start_date: false,
    send_hour: null,
    send_time_zone: null,
    created_at: "2026-10-31T00:00:00Z",
    updated_at: "2026-10-31T00:00:00Z",
  },
  {
    purpose: "followup_digest",
    stop_conditions: null,
    target_days_to_ready: null,
    compress_toward_start_date: null,
    send_hour: 8,
    send_time_zone: "America/Chicago",
    created_at: "2026-10-31T00:00:00Z",
    updated_at: "2026-10-31T00:00:00Z",
  },
];
const defaultStep = (purpose: string, position: number, offset: number, key: string) => ({
  id: `${purpose}-${position}`,
  purpose,
  position,
  offset_days: offset,
  channel: "email",
  template_key: key,
  created_at: "2026-10-31T00:00:00Z",
  updated_at: "2026-10-31T00:00:00Z",
});
const DEFAULT_STEP_ROWS = [
  defaultStep("intake_reminder", 3, 7, "intake_reminder_final"),
  defaultStep("intake_reminder", 1, 2, "intake_reminder_first"),
  defaultStep("intake_reminder", 2, 4, "intake_reminder_second"),
  defaultStep("followup_digest", 1, 0, "followup_digest_daily"),
];
const WITH_DEFAULTS = {
  notification_sequence_defaults: DEFAULT_ROWS,
  notification_sequence_default_steps: DEFAULT_STEP_ROWS,
};

/** An intake draft with its own steps, from the seeded default. */
const OWN_INTAKE: SequenceDraft = {
  ...starterDraft(),
  steps: [2, 4, 7].map((offsetDays, i) => ({
    offsetDays,
    channel: "email",
    templateKey: ["intake_reminder_first", "intake_reminder_second", "intake_reminder_final"][i],
    ccRecipients: [],
  })),
};

const stepRow = (position: number, offset: number, cc: unknown = []) => ({
  id: `step-${position}`,
  sequence_id: "seq-1",
  org_id: ORG,
  position,
  offset_days: offset,
  channel: "email",
  template_key: "intake_reminder_first",
  cc_recipients: cc,
  created_at: "2026-10-30T00:00:00Z",
  updated_at: "2026-10-30T00:00:00Z",
});

function ctxFor(db: unknown): NotificationSequenceServiceCtx {
  return { db: db as SupabaseClient<Database>, orgId: ORG };
}

type FakeError = { code: string; message: string };

function fakeReads(tables: Record<string, unknown[]>, errors: Record<string, FakeError> = {}) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]>; order?: string }> = [];
  const from = vi.fn((table: string) => {
    const call: { table: string; filters: Array<[string, unknown]>; order?: string } = {
      table,
      filters: [],
    };
    calls.push(call);
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return builder;
      },
      order: (column: string) => {
        call.order = column;
        return builder;
      },
      then: (resolve: (value: { data: unknown[] | null; error: FakeError | null }) => void) =>
        resolve(
          errors[table]
            ? { data: null, error: errors[table] }
            : { data: tables[table] ?? [], error: null },
        ),
    };
    return builder;
  });
  return { from, calls };
}

describe("notification sequences service", () => {
  it("reads the org's tables scoped to the org and assembles steps in position order", async () => {
    const { from, calls } = fakeReads({
      ...WITH_DEFAULTS,
      notification_sequences: [SEQUENCE_ROW],
      notification_sequence_steps: [
        stepRow(2, 6, [{ kind: "role", role: "admin" }]),
        stepRow(1, 2, [{ kind: "user", user_id: USER }]),
      ],
    });
    const listed = await listNotificationSequences(ctxFor({ from }));
    expect(listed.status).toBe("available");
    const result = listed.status === "available" ? listed.sequences : {};

    expect(calls.map((c) => c.table)).toEqual([
      "notification_sequences",
      "notification_sequence_steps",
      "notification_sequence_defaults",
      "notification_sequence_default_steps",
    ]);
    // The org's rows are filtered to the org; Minted's defaults have no org.
    expect(calls[0].filters).toContainEqual(["org_id", ORG]);
    expect(calls[1].filters).toContainEqual(["org_id", ORG]);
    expect(calls[2].filters).toEqual([]);
    expect(calls[3].filters).toEqual([]);
    expect(result.followup_digest).toBeUndefined();
    expect(result.intake_reminder).toMatchObject({
      id: "seq-1",
      enabled: true,
      revision: 3,
      stopConditions: ["submitted", "withdrawn"],
      targetDaysToReady: 14,
      compressTowardStartDate: null,
      sendHour: null,
      sendTimeZone: null,
    });
    expect(result.intake_reminder?.steps.map((s) => [s.position, s.offsetDays])).toEqual([
      [1, 2],
      [2, 6],
    ]);
    expect(result.intake_reminder?.steps[0].ccRecipients).toEqual([{ kind: "user", userId: USER }]);
    expect(result.intake_reminder?.steps[1].ccRecipients).toEqual([
      { kind: "role", role: "admin" },
    ]);
  });

  it("returns no entry for a purpose with no row (off), and Minted's defaults (answer 3)", async () => {
    const { from } = fakeReads({
      ...WITH_DEFAULTS,
      notification_sequences: [],
      notification_sequence_steps: [],
    });
    const listed = await listNotificationSequences(ctxFor({ from }));
    if (listed.status !== "available") throw new Error("expected available");
    expect(listed.sequences).toEqual({});
    expect(listed.defaults.intake_reminder).toMatchObject({
      purpose: "intake_reminder",
      stopConditions: ["submitted", "paused", "withdrawn", "provider_replied"],
      targetDaysToReady: 14,
      compressTowardStartDate: false,
      sendHour: null,
      sendTimeZone: null,
    });
    expect(listed.defaults.intake_reminder.steps.map((s) => [s.position, s.offsetDays])).toEqual([
      [1, 2],
      [2, 4],
      [3, 7],
    ]);
    expect(listed.defaults.followup_digest).toMatchObject({
      sendHour: 8,
      sendTimeZone: "America/Chicago",
      stopConditions: null,
      compressTowardStartDate: null,
    });
    expect(listed.defaults.followup_digest.steps.map((s) => s.templateKey)).toEqual([
      "followup_digest_daily",
    ]);
  });

  it("keeps an org's unset settings as null, so they inherit, and reads Minted's overrides", async () => {
    const { from } = fakeReads({
      ...WITH_DEFAULTS,
      notification_sequences: [
        { ...SEQUENCE_ROW, stop_conditions: null, target_days_to_ready: null },
        {
          ...SEQUENCE_ROW,
          id: "seq-2",
          purpose: "followup_digest",
          stop_conditions: null,
          target_days_to_ready: null,
          send_hour: 6,
          send_time_zone: "America/New_York",
        },
      ],
      notification_sequence_steps: [],
    });
    const listed = await listNotificationSequences(ctxFor({ from }));
    if (listed.status !== "available") throw new Error("expected available");
    expect(listed.sequences.intake_reminder).toMatchObject({
      stopConditions: null,
      targetDaysToReady: null,
      steps: [],
    });
    expect(listed.sequences.followup_digest).toMatchObject({
      sendHour: 6,
      sendTimeZone: "America/New_York",
    });
  });

  it("fails loudly when a default has no steps, or the digest more than one", async () => {
    const empty = fakeReads({
      notification_sequence_defaults: DEFAULT_ROWS,
      notification_sequence_default_steps: DEFAULT_STEP_ROWS.filter(
        (row) => row.purpose !== "intake_reminder",
      ),
    });
    await expect(listNotificationSequences(ctxFor({ from: empty.from }))).rejects.toThrow(
      /default notification steps are incomplete \(intake_reminder\)/,
    );
    const twoDigest = fakeReads({
      notification_sequence_defaults: DEFAULT_ROWS,
      notification_sequence_default_steps: [
        ...DEFAULT_STEP_ROWS,
        defaultStep("followup_digest", 2, 1, "followup_digest_daily"),
      ],
    });
    await expect(listNotificationSequences(ctxFor({ from: twoDigest.from }))).rejects.toThrow(
      /default notification steps are incomplete \(followup_digest\)/,
    );
  });

  it("fails loudly when a default is missing rather than calling the purpose off", async () => {
    const { from } = fakeReads({
      notification_sequence_defaults: [DEFAULT_ROWS[0]],
      notification_sequence_default_steps: DEFAULT_STEP_ROWS,
    });
    await expect(listNotificationSequences(ctxFor({ from }))).rejects.toThrow(
      /default notification settings are missing \(followup_digest\)/,
    );
  });

  it("reports the feature unavailable, without throwing, before the migration is applied", async () => {
    const missingSequences = fakeReads(
      {},
      {
        notification_sequences: {
          code: "PGRST205",
          message: "Could not find the table 'public.notification_sequences' in the schema cache",
        },
        notification_sequence_steps: {
          code: "PGRST205",
          message:
            "Could not find the table 'public.notification_sequence_steps' in the schema cache",
        },
      },
    );
    await expect(
      listNotificationSequences(ctxFor({ from: missingSequences.from })),
    ).resolves.toEqual({ status: "unavailable" });
    const missingSteps = fakeReads(
      { notification_sequences: [] },
      {
        notification_sequence_steps: {
          code: "42P01",
          message: 'relation "public.notification_sequence_steps" does not exist',
        },
      },
    );
    await expect(listNotificationSequences(ctxFor({ from: missingSteps.from }))).resolves.toEqual({
      status: "unavailable",
    });
    // Only the defaults table missing is the same: not switched on yet.
    const missingDefaults = fakeReads(
      { notification_sequences: [], notification_sequence_steps: [] },
      {
        notification_sequence_defaults: {
          code: "PGRST205",
          message:
            "Could not find the table 'public.notification_sequence_defaults' in the schema cache",
        },
      },
    );
    await expect(
      listNotificationSequences(ctxFor({ from: missingDefaults.from })),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("still throws real read failures", async () => {
    const denied = fakeReads(
      {},
      {
        notification_sequences: {
          code: "42501",
          message: "permission denied for table notification_sequences",
        },
      },
    );
    await expect(listNotificationSequences(ctxFor({ from: denied.from }))).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("saves through the atomic RPC with the org, purpose and built payload", async () => {
    const payload = buildSavePayload("intake_reminder", OWN_INTAKE, null);
    const rpc = vi.fn().mockResolvedValue({
      data: { sequence: { ...SEQUENCE_ROW, revision: 1 }, steps: [stepRow(1, 2)] },
      error: null,
    });
    const saved = await saveNotificationSequence(
      { purpose: "intake_reminder", payload },
      ctxFor({ rpc }),
    );
    expect(rpc).toHaveBeenCalledWith("save_notification_sequence", {
      p_org_id: ORG,
      p_purpose: "intake_reminder",
      p_payload: payload,
    });
    expect(saved.revision).toBe(1);
    expect(saved.steps).toHaveLength(1);
  });

  it("turns the RPC's conflict and permission codes into plain messages", async () => {
    const payload = buildSavePayload("intake_reminder", OWN_INTAKE, 2);
    const conflict = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PT409", message: "notification_sequence_conflict" },
    });
    await expect(
      saveNotificationSequence({ purpose: "intake_reminder", payload }, ctxFor({ rpc: conflict })),
    ).rejects.toThrow(/Someone else saved these settings/);

    // PT409 alone (PostgREST's HTTP 409) is the conflict, whatever the text.
    const bareConflict = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PT409", message: "" },
    });
    await expect(
      saveNotificationSequence(
        { purpose: "intake_reminder", payload },
        ctxFor({ rpc: bareConflict }),
      ),
    ).rejects.toThrow(/Someone else saved these settings/);

    const denied = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "42501", message: "notification_sequence_not_authorized" },
    });
    await expect(
      saveNotificationSequence({ purpose: "intake_reminder", payload }, ctxFor({ rpc: denied })),
    ).rejects.toThrow("Only admins can change notifications.");

    const platform = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "42501", message: "notification_platform_setting: send_hour" },
    });
    await expect(
      saveNotificationSequence({ purpose: "followup_digest", payload }, ctxFor({ rpc: platform })),
    ).rejects.toThrow("Minted sets that setting, so it can't be changed here.");
  });

  it("saves 'use Minted's default' as nulls, with no platform-managed key", async () => {
    const payload = buildSavePayload("intake_reminder", { ...starterDraft(), enabled: true }, 3);
    const rpc = vi.fn().mockResolvedValue({
      data: {
        sequence: {
          ...SEQUENCE_ROW,
          stop_conditions: null,
          target_days_to_ready: null,
          revision: 4,
        },
        steps: [],
      },
      error: null,
    });
    const saved = await saveNotificationSequence(
      { purpose: "intake_reminder", payload },
      ctxFor({ rpc }),
    );
    expect(rpc.mock.calls[0][1].p_payload).toEqual({
      enabled: true,
      stop_conditions: null,
      target_days_to_ready: null,
      expected_revision: 3,
      steps: null,
    });
    expect(saved).toMatchObject({ stopConditions: null, targetDaysToReady: null, steps: [] });
  });
});
