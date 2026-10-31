// MINT-107 — organization notification sequences (migration 20261031130000).
//
// Reads go straight to the two tables under RLS (any member of the org).
// Saves go through save_notification_sequence, a SECURITY INVOKER RPC that
// replaces the sequence and its steps in one transaction, checks the caller
// is an admin of the org, enforces the revision for concurrent editors, and
// writes its own audit row, so this service does not call writeAudit.
//
// Browser-only for now. A server consumer (the digest job) will read with the
// service-role client through the same `listNotificationSequences(ctx)`, but
// must never call the save RPC on ctx.db: under the service key auth.uid()
// and user_role() are null and the RPC refuses.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/externalClient";
import type { Database } from "@/integrations/supabase/types";
import { requireActiveOrg } from "@/lib/audit";
import { pgWireText } from "@/lib/dbErrors";
import {
  NOTIFICATION_PURPOSES,
  STOP_CONDITIONS,
  parseCcRecipients,
  saveErrorMessage,
  type NotificationSequenceConfig,
  type SaveSequencePayload,
} from "@/lib/notificationSequences";
import type {
  NotificationChannel,
  NotificationPurpose,
  NotificationSequenceStep,
  NotificationStopCondition,
} from "@/types";

export interface NotificationSequenceServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
}

function browserCtx(): NotificationSequenceServiceCtx {
  return { db: supabase, orgId: requireActiveOrg() };
}

const SEQUENCE_COLUMNS =
  "id, org_id, purpose, enabled, stop_conditions, target_days_to_ready, compress_toward_start_date, revision, created_at, updated_at, updated_by";
const STEP_COLUMNS =
  "id, sequence_id, org_id, position, offset_days, channel, template_key, cc_recipients, created_at, updated_at";

type SequenceRow = Pick<
  Database["public"]["Tables"]["notification_sequences"]["Row"],
  | "id"
  | "org_id"
  | "purpose"
  | "enabled"
  | "stop_conditions"
  | "target_days_to_ready"
  | "compress_toward_start_date"
  | "revision"
  | "created_at"
  | "updated_at"
  | "updated_by"
>;
type StepRow = Pick<
  Database["public"]["Tables"]["notification_sequence_steps"]["Row"],
  | "id"
  | "sequence_id"
  | "org_id"
  | "position"
  | "offset_days"
  | "channel"
  | "template_key"
  | "cc_recipients"
  | "created_at"
  | "updated_at"
>;

function isPurpose(value: string): value is NotificationPurpose {
  return (NOTIFICATION_PURPOSES as readonly string[]).includes(value);
}

function toStep(row: StepRow): NotificationSequenceStep {
  return {
    id: row.id,
    sequenceId: row.sequence_id,
    orgId: row.org_id,
    position: row.position,
    offsetDays: row.offset_days,
    channel: (row.channel === "sms" ? "sms" : "email") satisfies NotificationChannel,
    templateKey: row.template_key,
    ccRecipients: parseCcRecipients(row.cc_recipients),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toConfig(row: SequenceRow, steps: StepRow[]): NotificationSequenceConfig | null {
  if (!isPurpose(row.purpose)) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    purpose: row.purpose,
    enabled: row.enabled,
    stopConditions: (row.stop_conditions ?? []).filter((c): c is NotificationStopCondition =>
      (STOP_CONDITIONS as readonly string[]).includes(c),
    ),
    targetDaysToReady: row.target_days_to_ready,
    compressTowardStartDate: row.compress_toward_start_date,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    steps: steps
      .filter((step) => step.sequence_id === row.id)
      .sort((a, b) => a.position - b.position)
      .map(toStep),
  };
}

/** The org's saved sequences, keyed by purpose. A purpose with no row is absent (off). */
export async function listNotificationSequences(
  ctx: NotificationSequenceServiceCtx = browserCtx(),
): Promise<Partial<Record<NotificationPurpose, NotificationSequenceConfig>>> {
  const [sequences, steps] = await Promise.all([
    ctx.db.from("notification_sequences").select(SEQUENCE_COLUMNS).eq("org_id", ctx.orgId),
    ctx.db
      .from("notification_sequence_steps")
      .select(STEP_COLUMNS)
      .eq("org_id", ctx.orgId)
      .order("position", { ascending: true }),
  ]);
  if (sequences.error) throw sequences.error;
  if (steps.error) throw steps.error;
  const out: Partial<Record<NotificationPurpose, NotificationSequenceConfig>> = {};
  for (const row of (sequences.data ?? []) as SequenceRow[]) {
    const config = toConfig(row, (steps.data ?? []) as StepRow[]);
    if (config) out[config.purpose] = config;
  }
  return out;
}

export interface SaveNotificationSequenceInput {
  purpose: NotificationPurpose;
  payload: SaveSequencePayload;
}

function snapshotObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The notification settings response was invalid");
  }
  return value as Record<string, unknown>;
}

/** Save one purpose's sequence and steps atomically. Returns the saved config. */
export async function saveNotificationSequence(
  input: SaveNotificationSequenceInput,
  ctx: NotificationSequenceServiceCtx = browserCtx(),
): Promise<NotificationSequenceConfig> {
  const { data, error } = await ctx.db.rpc("save_notification_sequence", {
    p_org_id: ctx.orgId,
    p_purpose: input.purpose,
    p_payload:
      input.payload as unknown as Database["public"]["Functions"]["save_notification_sequence"]["Args"]["p_payload"],
  });
  if (error) throw new Error(saveErrorMessage(pgWireText(error)));
  const snapshot = snapshotObject(data);
  const row = snapshotObject(snapshot.sequence) as unknown as SequenceRow;
  const steps = Array.isArray(snapshot.steps) ? (snapshot.steps as StepRow[]) : [];
  const config = toConfig(row, steps);
  if (!config) throw new Error("The notification settings response was invalid");
  return config;
}
