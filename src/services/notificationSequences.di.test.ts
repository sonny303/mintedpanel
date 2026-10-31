import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildSavePayload, starterDraft } from "@/lib/notificationSequences";
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
  compress_toward_start_date: true,
  revision: 3,
  created_at: "2026-10-30T00:00:00Z",
  updated_at: "2026-10-30T01:00:00Z",
  updated_by: USER,
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
  it("reads both tables scoped to the org and assembles steps in position order", async () => {
    const { from, calls } = fakeReads({
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
    ]);
    for (const call of calls) expect(call.filters).toContainEqual(["org_id", ORG]);
    expect(result.followup_digest).toBeUndefined();
    expect(result.intake_reminder).toMatchObject({
      id: "seq-1",
      enabled: true,
      revision: 3,
      stopConditions: ["submitted", "withdrawn"],
      targetDaysToReady: 14,
      compressTowardStartDate: true,
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

  it("returns no entry for a purpose with no row (off)", async () => {
    const { from } = fakeReads({ notification_sequences: [], notification_sequence_steps: [] });
    expect(await listNotificationSequences(ctxFor({ from }))).toEqual({
      status: "available",
      sequences: {},
    });
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
    const payload = buildSavePayload("intake_reminder", starterDraft("intake_reminder"), null);
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
    const payload = buildSavePayload("intake_reminder", starterDraft("intake_reminder"), 2);
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
  });
});
