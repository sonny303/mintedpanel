// MINT-107 — organization notification sequences (migration 20261031051500).
//
// Reads go straight to the tables under RLS: the org's own rows (any member
// of the org) and Minted's platform defaults (any member of any org). The
// card gets both, because an org row only overrides the default field by
// field; resolveNotificationSequence() in src/lib/notificationSequences.ts
// turns them into the effective sequence.
// Saves go through save_notification_sequence, a SECURITY INVOKER RPC that
// replaces the sequence and its steps in one transaction, checks the caller
// is an admin of the org, enforces the revision for concurrent editors, and
// writes its own audit row, so this service does not call writeAudit.
//
// Deploy order: until migration 20261031051500 is applied, PostgREST reports
// the tables missing (PGRST205 / 42P01). The read returns
// `{ status: "unavailable" }` rather than throwing, so the card says the
// feature is not switched on yet and the query never retries an error.
//
// The follow-up digest job (MINT-108) reads with the service-role client
// through `listEnabledNotificationSequences`, the one cross-org read, but must
// never call the save RPC on ctx.db: under the service key auth.uid() and
// user_role() are null and the RPC refuses.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/externalClient";
import type { Database } from "@/integrations/supabase/types";
import { requireActiveOrg } from "@/lib/audit";
import { readCompletePages } from "@/lib/completePages";
import { isMissingNotificationSequenceTablesError, pgWireText } from "@/lib/dbErrors";
import {
  NOTIFICATION_PURPOSES,
  PURPOSE_RULES,
  STOP_CONDITIONS,
  parseCcRecipients,
  saveErrorMessage,
  type NotificationSequenceConfig,
  type NotificationSequenceDefaultConfig,
  type SaveSequencePayload,
} from "@/lib/notificationSequences";
import type {
  NotificationChannel,
  NotificationPurpose,
  NotificationSequenceDefaultStep,
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
  "id, org_id, purpose, enabled, stop_conditions, target_days_to_ready, compress_toward_start_date, send_hour, send_time_zone, revision, created_at, updated_at, updated_by";
const STEP_COLUMNS =
  "id, sequence_id, org_id, position, offset_days, channel, template_key, cc_recipients, created_at, updated_at";
const DEFAULT_COLUMNS =
  "purpose, stop_conditions, target_days_to_ready, compress_toward_start_date, send_hour, send_time_zone, created_at, updated_at";
const DEFAULT_STEP_COLUMNS =
  "id, purpose, position, offset_days, channel, template_key, created_at, updated_at";

type SequenceRow = Pick<
  Database["public"]["Tables"]["notification_sequences"]["Row"],
  | "id"
  | "org_id"
  | "purpose"
  | "enabled"
  | "stop_conditions"
  | "target_days_to_ready"
  | "compress_toward_start_date"
  | "send_hour"
  | "send_time_zone"
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
type DefaultRow = Database["public"]["Tables"]["notification_sequence_defaults"]["Row"];
type DefaultStepRow = Database["public"]["Tables"]["notification_sequence_default_steps"]["Row"];

function isPurpose(value: string): value is NotificationPurpose {
  return (NOTIFICATION_PURPOSES as readonly string[]).includes(value);
}

function toChannel(value: string): NotificationChannel {
  return value === "sms" ? "sms" : "email";
}

/** Unknown values are dropped; null stays null (Minted's default). */
function toStopConditions(value: string[] | null): NotificationStopCondition[] | null {
  if (value == null) return null;
  return value.filter((c): c is NotificationStopCondition =>
    (STOP_CONDITIONS as readonly string[]).includes(c),
  );
}

function toStep(row: StepRow): NotificationSequenceStep {
  return {
    id: row.id,
    sequenceId: row.sequence_id,
    orgId: row.org_id,
    position: row.position,
    offsetDays: row.offset_days,
    channel: toChannel(row.channel),
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
    stopConditions: toStopConditions(row.stop_conditions),
    targetDaysToReady: row.target_days_to_ready,
    compressTowardStartDate: row.compress_toward_start_date,
    sendHour: row.send_hour,
    sendTimeZone: row.send_time_zone,
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

export type NotificationSequencesByPurpose = Partial<
  Record<NotificationPurpose, NotificationSequenceConfig>
>;

/** Minted's platform default for every purpose. */
export type NotificationSequenceDefaults = Record<
  NotificationPurpose,
  NotificationSequenceDefaultConfig
>;

/**
 * `available`: the org's saved sequences keyed by purpose (a purpose with no
 * row is absent, which means off) and Minted's default for every purpose.
 * `unavailable`: this database does not have the notification tables yet
 * (the migration is not applied).
 */
export type NotificationSequencesResult =
  | {
      status: "available";
      sequences: NotificationSequencesByPurpose;
      defaults: NotificationSequenceDefaults;
    }
  | { status: "unavailable" };

function toDefaultStep(row: DefaultStepRow, purpose: NotificationPurpose) {
  return {
    id: row.id,
    purpose,
    position: row.position,
    offsetDays: row.offset_days,
    channel: toChannel(row.channel),
    templateKey: row.template_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } satisfies NotificationSequenceDefaultStep;
}

/** Every purpose's default; a missing one is a broken database, not "off". */
function toDefaults(rows: DefaultRow[], steps: DefaultStepRow[]): NotificationSequenceDefaults {
  const byPurpose: Partial<NotificationSequenceDefaults> = {};
  for (const row of rows) {
    const purpose = row.purpose;
    if (!isPurpose(purpose)) continue;
    byPurpose[purpose] = {
      purpose,
      stopConditions: toStopConditions(row.stop_conditions),
      targetDaysToReady: row.target_days_to_ready,
      compressTowardStartDate: row.compress_toward_start_date,
      sendHour: row.send_hour,
      sendTimeZone: row.send_time_zone,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      steps: steps
        .filter((step) => step.purpose === purpose)
        .sort((a, b) => a.position - b.position)
        .map((step) => toDefaultStep(step, purpose)),
    };
  }
  const missing = NOTIFICATION_PURPOSES.filter((purpose) => !byPurpose[purpose]);
  if (missing.length > 0) {
    throw new Error(`Minted's default notification settings are missing (${missing.join(", ")})`);
  }
  // The database keeps every default complete (at least one step, exactly one
  // for the digest); a read that says otherwise is broken, not "no steps".
  for (const purpose of NOTIFICATION_PURPOSES) {
    const count = byPurpose[purpose]?.steps.length ?? 0;
    if (count === 0 || count > PURPOSE_RULES[purpose].maxSteps) {
      throw new Error(`Minted's default notification steps are incomplete (${purpose})`);
    }
  }
  return byPurpose as NotificationSequenceDefaults;
}

// Platform rows: no org_id to filter on. RLS lets any member read them; the
// service role reads them under its grant. Two purposes, a few steps each.
function readDefaultRows(db: SupabaseClient<Database>) {
  return [
    db.from("notification_sequence_defaults").select(DEFAULT_COLUMNS),
    db
      .from("notification_sequence_default_steps")
      .select(DEFAULT_STEP_COLUMNS)
      .order("position", { ascending: true }),
  ] as const;
}

export async function listNotificationSequences(
  ctx: NotificationSequenceServiceCtx = browserCtx(),
): Promise<NotificationSequencesResult> {
  const [sequences, steps, defaults, defaultSteps] = await Promise.all([
    ctx.db.from("notification_sequences").select(SEQUENCE_COLUMNS).eq("org_id", ctx.orgId),
    ctx.db
      .from("notification_sequence_steps")
      .select(STEP_COLUMNS)
      .eq("org_id", ctx.orgId)
      .order("position", { ascending: true }),
    ...readDefaultRows(ctx.db),
  ]);
  for (const result of [sequences, steps, defaults, defaultSteps]) {
    if (result.error && isMissingNotificationSequenceTablesError(result.error)) {
      return { status: "unavailable" };
    }
  }
  for (const result of [sequences, steps, defaults, defaultSteps]) {
    if (result.error) throw result.error;
  }
  const out: NotificationSequencesByPurpose = {};
  for (const row of (sequences.data ?? []) as SequenceRow[]) {
    const config = toConfig(row, (steps.data ?? []) as StepRow[]);
    if (config) out[config.purpose] = config;
  }
  return {
    status: "available",
    sequences: out,
    defaults: toDefaults(
      (defaults.data ?? []) as DefaultRow[],
      (defaultSteps.data ?? []) as DefaultStepRow[],
    ),
  };
}

/** Sequence ids per steps read in the cross-org read: keeps each URL short. */
export const ENABLED_SEQUENCE_STEP_CHUNK = 100;

/**
 * `available`: every org's enabled sequence for the purpose, each with its own
 * steps (none: it uses Minted's default steps), and Minted's default for the
 * purpose. `unavailable`: the notification tables are missing.
 */
export type EnabledNotificationSequencesResult =
  | {
      status: "available";
      sequences: NotificationSequenceConfig[];
      platformDefault: NotificationSequenceDefaultConfig;
    }
  | { status: "unavailable" };

/**
 * Every org's switched-on sequence for one purpose, plus Minted's default:
 * the follow-up digest job's discovery read (MINT-108). Server-only and
 * cross-org: pass the service-role client, which bypasses RLS. Nothing here
 * is one org's, so a caller scopes every later read to the org it serves.
 * Settings rows only (no PHI). Both lists page to completion: hosted
 * PostgREST caps a response at 1,000 rows and says nothing.
 */
export async function listEnabledNotificationSequences(
  ctx: { db: SupabaseClient<Database> },
  purpose: NotificationPurpose,
): Promise<EnabledNotificationSequencesResult> {
  try {
    const sequenceQuery = ctx.db
      .from("notification_sequences")
      .select(SEQUENCE_COLUMNS, { count: "exact" })
      .eq("purpose", purpose)
      .eq("enabled", true)
      .order("org_id", { ascending: true })
      .order("id", { ascending: true });
    const sequences = await readCompletePages<SequenceRow>(
      async (from, to) => await sequenceQuery.range(from, to),
      { label: "Enabled notification sequences" },
    );
    const ids = sequences.map((row) => row.id);
    const steps: StepRow[] = [];
    for (let start = 0; start < ids.length; start += ENABLED_SEQUENCE_STEP_CHUNK) {
      const stepQuery = ctx.db
        .from("notification_sequence_steps")
        .select(STEP_COLUMNS, { count: "exact" })
        .in("sequence_id", ids.slice(start, start + ENABLED_SEQUENCE_STEP_CHUNK))
        .order("sequence_id", { ascending: true })
        .order("position", { ascending: true })
        .order("id", { ascending: true });
      steps.push(
        ...(await readCompletePages<StepRow>(async (from, to) => await stepQuery.range(from, to), {
          label: "Enabled notification sequence steps",
        })),
      );
    }
    const [defaults, defaultSteps] = await Promise.all(readDefaultRows(ctx.db));
    for (const result of [defaults, defaultSteps]) if (result.error) throw result.error;

    const stepsBySequence = new Map<string, StepRow[]>();
    for (const step of steps) {
      const list = stepsBySequence.get(step.sequence_id) ?? [];
      list.push(step);
      stepsBySequence.set(step.sequence_id, list);
    }
    const configs = sequences.flatMap((row) => {
      // The filters are the read's; re-checked so a stray row cannot pass.
      if (row.purpose !== purpose || row.enabled !== true) return [];
      const config = toConfig(row, stepsBySequence.get(row.id) ?? []);
      return config ? [config] : [];
    });
    return {
      status: "available",
      sequences: configs,
      platformDefault: toDefaults(
        (defaults.data ?? []) as DefaultRow[],
        (defaultSteps.data ?? []) as DefaultStepRow[],
      )[purpose],
    };
  } catch (error) {
    if (isMissingNotificationSequenceTablesError(error)) return { status: "unavailable" };
    throw error;
  }
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
  if (error) throw new Error(saveErrorMessage(pgWireText(error), error.code));
  const snapshot = snapshotObject(data);
  const row = snapshotObject(snapshot.sequence) as unknown as SequenceRow;
  const steps = Array.isArray(snapshot.steps) ? (snapshot.steps as StepRow[]) : [];
  const config = toConfig(row, steps);
  if (!config) throw new Error("The notification settings response was invalid");
  return config;
}
