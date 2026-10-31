// MINT-107 — organization notification sequences: the pure rules.
//
// A sequence is one organization's settings for one purpose: whether it is
// on, its ordered steps (offset in days, channel, template, ordered cc list),
// and, for intake reminders only, the stop conditions, the target days from
// invite to ready, and whether the schedule tightens as a known start date
// approaches. Cadence is configuration, never a constant: how many messages,
// how often, what each says and who is cc'd all come from the saved rows.
//
// Nothing here sends anything. The consumers (the daily follow-up digest, and
// intake reminders once the intake back end lands) read the saved config and
// call `scheduleSequenceSends` and `bounceEscalationRecipients` below, so the
// rules they apply are pinned by tests now.
//
// Consumer contract for template keys: before rendering a step, the sender
// must look its `template_key` up in NOTIFICATION_TEMPLATES
// (src/lib/notificationTemplates.ts) and require the entry to exist, match the
// sequence's purpose, be `selectable`, and support the step's channel; a
// step that fails is skipped and recorded, never sent. The database checks
// only the key's format and its purpose prefix, so a row written directly
// can name a key the catalog does not have.
//
// The database enforces the same bounds (migration 20261031051500): offsets 0
// to 90, at most 10 steps, offsets strictly increasing, the digest at most one
// step, cc lists of at most 20 users or roles, target 1 to 90 days. Rules that
// a later PR may relax without a migration (the digest offset fixed at 0,
// intake offsets from day 1) are enforced here and in the card only.
//
// All date math is date-only (YYYY-MM-DD, UTC) against passed-in dates. No
// clock read.
import type {
  AppRole,
  NotificationCcRecipient,
  NotificationChannel,
  NotificationPurpose,
  NotificationSequence,
  NotificationSequenceStep,
  NotificationStopCondition,
} from "@/types";
import {
  getNotificationTemplate,
  selectableTemplates,
  templateSupportsChannel,
} from "./notificationTemplates";

/* -------------------------------- Vocabulary ------------------------------- */

export const NOTIFICATION_PURPOSES: readonly NotificationPurpose[] = [
  "intake_reminder",
  "followup_digest",
];

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ["email", "sms"];

export const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  email: "Email",
  sms: "Text message (SMS)",
};

export const STOP_CONDITIONS: readonly NotificationStopCondition[] = [
  "submitted",
  "paused",
  "withdrawn",
  "provider_replied",
];

export const STOP_CONDITION_LABELS: Record<NotificationStopCondition, string> = {
  submitted: "The provider submits the intake form",
  paused: "Onboarding is paused",
  withdrawn: "The provider withdraws",
  provider_replied: "The provider replies",
};

/** The org roles a step may cc. Same set as memberships_role_check / user_role(). */
export const CC_ROLES: readonly AppRole[] = ["admin", "specialist", "billing"];

export const CC_ROLE_LABELS: Record<AppRole, string> = {
  admin: "All admins",
  specialist: "All specialists",
  billing: "All billing members",
};

/** An org member the cc picker can offer. */
export interface CcMemberOption {
  userId: string;
  name: string;
}

/**
 * How a cc recipient reads in the card. A user missing from a LOADED member
 * list reads as "Former member"; while the list is loading, or after it
 * failed, the card cannot tell, so the user reads as a neutral "Member".
 */
export function ccRecipientLabel(
  recipient: NotificationCcRecipient,
  members: ReadonlyMap<string, CcMemberOption>,
  membersLoaded = true,
): string {
  if (recipient.kind === "role") return CC_ROLE_LABELS[recipient.role];
  return members.get(recipient.userId)?.name ?? (membersLoaded ? "Former member" : "Member");
}

/** "Jane Doe, then All admins" for the read-only summary. */
export function describeCcList(
  recipients: readonly NotificationCcRecipient[],
  members: ReadonlyMap<string, CcMemberOption>,
  membersLoaded = true,
): string {
  if (recipients.length === 0) return "no one";
  return recipients.map((r) => ccRecipientLabel(r, members, membersLoaded)).join(", then ");
}

/** Mirrors the CHECK constraints in migration 20261031051500. */
export const NOTIFICATION_LIMITS = {
  maxOffsetDays: 90,
  maxSteps: 10,
  maxCcRecipients: 20,
  minTargetDays: 1,
  maxTargetDays: 90,
  defaultTargetDays: 14,
} as const;

export interface PurposeRules {
  label: string;
  description: string;
  enabledLabel: string;
  maxSteps: number;
  /** Earliest offset a step may use. */
  minOffsetDays: number;
  /** When set, every step uses this offset and the card shows no input. */
  fixedOffsetDays: number | null;
  /** Stop conditions, target days and start-date compression. */
  hasIntakeSettings: boolean;
}

export const PURPOSE_RULES: Record<NotificationPurpose, PurposeRules> = {
  intake_reminder: {
    label: "Provider intake reminders",
    description:
      "Reminders to a provider who has an onboarding invite but has not finished the intake form.",
    enabledLabel: "Send intake reminders",
    maxSteps: NOTIFICATION_LIMITS.maxSteps,
    // Day 0 is the invite itself; a reminder that day says nothing new.
    minOffsetDays: 1,
    fixedOffsetDays: null,
    hasIntakeSettings: true,
  },
  followup_digest: {
    label: "Daily follow-up digest",
    description: "One email a day to each coordinator listing their follow-ups that are due.",
    enabledLabel: "Send the daily digest",
    // The digest is one message a day.
    maxSteps: 1,
    minOffsetDays: 0,
    // An offset has no meaning for a daily digest until the digest PR gives
    // it one; 0 keeps the shared step shape. Relaxing this needs no migration.
    fixedOffsetDays: 0,
    hasIntakeSettings: false,
  },
};

/* ---------------------------------- Drafts --------------------------------- */

/** One step while it is being edited. `offsetDays` is null while the input is blank. */
export interface StepDraft {
  offsetDays: number | null;
  channel: NotificationChannel;
  templateKey: string;
  ccRecipients: NotificationCcRecipient[];
}

export interface SequenceDraft {
  enabled: boolean;
  stopConditions: NotificationStopCondition[];
  targetDaysToReady: number | null;
  compressTowardStartDate: boolean;
  steps: StepDraft[];
}

/** A saved sequence with its ordered steps, as the service returns it. */
export interface NotificationSequenceConfig extends NotificationSequence {
  steps: NotificationSequenceStep[];
}

/**
 * The suggested starting point behind "Set up". It is OFF: saving a starter
 * never emails anyone until an admin switches the sequence on. Every value is
 * an editable suggestion.
 */
export function starterDraft(purpose: NotificationPurpose): SequenceDraft {
  if (purpose === "followup_digest") {
    return {
      enabled: false,
      stopConditions: [],
      targetDaysToReady: null,
      compressTowardStartDate: false,
      steps: [
        { offsetDays: 0, channel: "email", templateKey: "followup_digest_daily", ccRecipients: [] },
      ],
    };
  }
  return {
    enabled: false,
    stopConditions: [...STOP_CONDITIONS],
    targetDaysToReady: NOTIFICATION_LIMITS.defaultTargetDays,
    compressTowardStartDate: true,
    steps: [
      { offsetDays: 2, channel: "email", templateKey: "intake_reminder_first", ccRecipients: [] },
      { offsetDays: 4, channel: "email", templateKey: "intake_reminder_second", ccRecipients: [] },
      { offsetDays: 7, channel: "email", templateKey: "intake_reminder_final", ccRecipients: [] },
    ],
  };
}

export function draftFromSequence(config: NotificationSequenceConfig): SequenceDraft {
  return {
    enabled: config.enabled,
    stopConditions: [...config.stopConditions],
    targetDaysToReady: config.targetDaysToReady,
    compressTowardStartDate: config.compressTowardStartDate,
    steps: [...config.steps]
      .sort((a, b) => a.position - b.position)
      .map((step) => ({
        offsetDays: step.offsetDays,
        channel: step.channel,
        templateKey: step.templateKey,
        ccRecipients: step.ccRecipients.map((r) => ({ ...r })),
      })),
  };
}

export function draftsEqual(a: SequenceDraft, b: SequenceDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ------------------------------ Draft editing ------------------------------ */

function swap<T>(items: readonly T[], index: number, other: number): T[] {
  const next = [...items];
  const held = next[index];
  next[index] = next[other];
  next[other] = held;
  return next;
}

/**
 * Move a step's MESSAGE up or down. Offsets belong to the slot, not the
 * message, because they must increase with position: moving step 3 up to
 * step 2 sends its template, channel and cc list on step 2's day. Out of
 * range is a no-op.
 */
export function moveStep(draft: SequenceDraft, index: number, direction: -1 | 1): SequenceDraft {
  const other = index + direction;
  if (index < 0 || other < 0 || index >= draft.steps.length || other >= draft.steps.length) {
    return draft;
  }
  const steps = draft.steps.map((step) => ({ ...step }));
  const a = steps[index];
  const b = steps[other];
  steps[index] = { ...b, offsetDays: a.offsetDays };
  steps[other] = { ...a, offsetDays: b.offsetDays };
  return { ...draft, steps };
}

/** Append a step a few days after the last one, using the next unused message. */
export function addStep(purpose: NotificationPurpose, draft: SequenceDraft): SequenceDraft {
  const rules = PURPOSE_RULES[purpose];
  if (draft.steps.length >= rules.maxSteps) return draft;
  const last = draft.steps.at(-1);
  const templates = selectableTemplates(purpose);
  const used = new Set(draft.steps.map((s) => s.templateKey));
  const template = templates.find((t) => !used.has(t.key)) ?? templates.at(-1);
  const offsetDays =
    rules.fixedOffsetDays ??
    Math.min(
      NOTIFICATION_LIMITS.maxOffsetDays,
      last?.offsetDays == null ? rules.minOffsetDays : last.offsetDays + 3,
    );
  return {
    ...draft,
    steps: [
      ...draft.steps,
      {
        offsetDays,
        channel: "email",
        templateKey: template?.key ?? "",
        ccRecipients: [],
      },
    ],
  };
}

export function removeStep(draft: SequenceDraft, index: number): SequenceDraft {
  if (index < 0 || index >= draft.steps.length) return draft;
  return { ...draft, steps: draft.steps.filter((_, i) => i !== index) };
}

export function updateStep(
  draft: SequenceDraft,
  index: number,
  patch: Partial<StepDraft>,
): SequenceDraft {
  if (index < 0 || index >= draft.steps.length) return draft;
  return {
    ...draft,
    steps: draft.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
  };
}

export function recipientKey(recipient: NotificationCcRecipient): string {
  return recipient.kind === "user" ? `user:${recipient.userId}` : `role:${recipient.role}`;
}

/** Append a cc recipient; a duplicate is ignored. */
export function addCcRecipient(step: StepDraft, recipient: NotificationCcRecipient): StepDraft {
  const key = recipientKey(recipient);
  if (step.ccRecipients.some((r) => recipientKey(r) === key)) return step;
  return { ...step, ccRecipients: [...step.ccRecipients, recipient] };
}

export function removeCcRecipient(step: StepDraft, index: number): StepDraft {
  if (index < 0 || index >= step.ccRecipients.length) return step;
  return { ...step, ccRecipients: step.ccRecipients.filter((_, i) => i !== index) };
}

export function moveCcRecipient(step: StepDraft, index: number, direction: -1 | 1): StepDraft {
  const other = index + direction;
  if (index < 0 || other < 0 || index >= step.ccRecipients.length) return step;
  if (other >= step.ccRecipients.length) return step;
  return { ...step, ccRecipients: swap(step.ccRecipients, index, other) };
}

/** Encode a cc picker choice ("role:admin", "user:<uuid>") back to a recipient. */
export function parseRecipientKey(key: string): NotificationCcRecipient | null {
  const [kind, value] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "role" && (CC_ROLES as readonly string[]).includes(value)) {
    return { kind: "role", role: value as AppRole };
  }
  if (kind === "user" && UUID_PATTERN.test(value)) return { kind: "user", userId: value };
  return null;
}

/* -------------------------------- Validation ------------------------------- */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type SequenceIssueField =
  | "steps"
  | "offsetDays"
  | "channel"
  | "templateKey"
  | "ccRecipients"
  | "stopConditions"
  | "targetDaysToReady"
  | "compressTowardStartDate";

export interface SequenceIssue {
  field: SequenceIssueField;
  /** The 0-based step index for step-level issues. */
  stepIndex: number | null;
  message: string;
}

export interface ValidateOptions {
  /** The org's member user ids; when given, a cc'd user outside it is an issue. */
  memberUserIds?: ReadonlySet<string>;
}

function isWholeNumber(value: number | null): value is number {
  return value != null && Number.isInteger(value);
}

/** Every reason this draft cannot be saved. Empty means it can. */
export function validateDraft(
  purpose: NotificationPurpose,
  draft: SequenceDraft,
  options: ValidateOptions = {},
): SequenceIssue[] {
  const rules = PURPOSE_RULES[purpose];
  const issues: SequenceIssue[] = [];
  const add = (field: SequenceIssueField, stepIndex: number | null, message: string) =>
    issues.push({ field, stepIndex, message });

  if (draft.steps.length === 0) add("steps", null, "Add at least one step.");
  if (purpose === "followup_digest" && draft.steps.length > 1) {
    add("steps", null, "The daily digest has exactly one step.");
  } else if (draft.steps.length > rules.maxSteps) {
    add("steps", null, `A sequence can have at most ${rules.maxSteps} steps.`);
  }

  let previous: number | null = null;
  draft.steps.forEach((step, index) => {
    const n = index + 1;
    const offset = step.offsetDays;
    if (!isWholeNumber(offset)) {
      add("offsetDays", index, `Enter a whole number of days for step ${n}.`);
    } else if (rules.fixedOffsetDays != null && offset !== rules.fixedOffsetDays) {
      add("offsetDays", index, `The daily digest is sent on day ${rules.fixedOffsetDays}.`);
    } else if (offset < rules.minOffsetDays || offset > NOTIFICATION_LIMITS.maxOffsetDays) {
      add(
        "offsetDays",
        index,
        `Step ${n} must be between day ${rules.minOffsetDays} and day ${NOTIFICATION_LIMITS.maxOffsetDays}.`,
      );
    } else if (previous != null && offset <= previous) {
      add(
        "offsetDays",
        index,
        `Step ${n} must go out after step ${index} (later than day ${previous}).`,
      );
    }
    if (isWholeNumber(offset)) previous = offset;

    if (!NOTIFICATION_CHANNELS.includes(step.channel)) {
      add("channel", index, `Choose a channel for step ${n}.`);
    }
    const template = getNotificationTemplate(step.templateKey);
    if (!template || template.purpose !== purpose || !template.selectable) {
      add("templateKey", index, `Choose a message for step ${n}.`);
    } else if (!templateSupportsChannel(step.templateKey, step.channel)) {
      add(
        "channel",
        index,
        `"${template.label}" has no ${step.channel === "sms" ? "text message" : "email"} version.`,
      );
    }

    if (step.ccRecipients.length > NOTIFICATION_LIMITS.maxCcRecipients) {
      add(
        "ccRecipients",
        index,
        `Step ${n} can cc at most ${NOTIFICATION_LIMITS.maxCcRecipients} members or roles.`,
      );
    }
    const keys = step.ccRecipients.map(recipientKey);
    if (new Set(keys).size !== keys.length) {
      add("ccRecipients", index, `Step ${n} lists the same member or role twice.`);
    }
    for (const recipient of step.ccRecipients) {
      if (recipient.kind === "role" && !CC_ROLES.includes(recipient.role)) {
        add("ccRecipients", index, `Step ${n} names a role that does not exist.`);
      }
      if (recipient.kind === "user") {
        if (!UUID_PATTERN.test(recipient.userId)) {
          add("ccRecipients", index, `Step ${n} names a member that does not exist.`);
        } else if (options.memberUserIds && !options.memberUserIds.has(recipient.userId)) {
          add(
            "ccRecipients",
            index,
            `Step ${n} cc's someone who is no longer a member. Remove them to save.`,
          );
        }
      }
    }
  });

  if (rules.hasIntakeSettings) {
    const conditions = draft.stopConditions;
    if (
      conditions.some((c) => !STOP_CONDITIONS.includes(c)) ||
      new Set(conditions).size !== conditions.length
    ) {
      add("stopConditions", null, "Choose stop conditions from the list.");
    }
    const target = draft.targetDaysToReady;
    if (
      !isWholeNumber(target) ||
      target < NOTIFICATION_LIMITS.minTargetDays ||
      target > NOTIFICATION_LIMITS.maxTargetDays
    ) {
      add(
        "targetDaysToReady",
        null,
        `Enter a target between ${NOTIFICATION_LIMITS.minTargetDays} and ${NOTIFICATION_LIMITS.maxTargetDays} days.`,
      );
    }
  } else {
    if (draft.stopConditions.length > 0) {
      add("stopConditions", null, "The daily digest has no stop conditions.");
    }
    if (draft.targetDaysToReady != null) {
      add("targetDaysToReady", null, "The daily digest has no target.");
    }
    if (draft.compressTowardStartDate) {
      add("compressTowardStartDate", null, "The daily digest has no start-date schedule.");
    }
  }

  return issues;
}

/* --------------------------------- Payload --------------------------------- */

export type CcRecipientPayload =
  { kind: "user"; user_id: string } | { kind: "role"; role: AppRole };

export interface SequenceStepPayload {
  offset_days: number;
  channel: NotificationChannel;
  template_key: string;
  cc_recipients: CcRecipientPayload[];
}

/** The `p_payload` of save_notification_sequence(p_org_id, p_purpose, p_payload). */
export interface SaveSequencePayload {
  enabled: boolean;
  stop_conditions: NotificationStopCondition[];
  target_days_to_ready: number | null;
  compress_toward_start_date: boolean;
  /** The revision the editor loaded; null when no row existed yet. */
  expected_revision: number | null;
  steps: SequenceStepPayload[];
}

export function ccRecipientToPayload(recipient: NotificationCcRecipient): CcRecipientPayload {
  return recipient.kind === "user"
    ? { kind: "user", user_id: recipient.userId }
    : { kind: "role", role: recipient.role };
}

/**
 * Build the RPC payload from a draft. Throws on an invalid draft: the card
 * validates first, so a throw here is a programming error, not user input.
 * Intake-only settings are normalized away for the digest.
 */
export function buildSavePayload(
  purpose: NotificationPurpose,
  draft: SequenceDraft,
  expectedRevision: number | null,
  options: ValidateOptions = {},
): SaveSequencePayload {
  const issues = validateDraft(purpose, draft, options);
  if (issues.length > 0) {
    throw new Error(`Invalid notification sequence: ${issues[0].message}`);
  }
  const intake = PURPOSE_RULES[purpose].hasIntakeSettings;
  return {
    enabled: draft.enabled,
    stop_conditions: intake ? STOP_CONDITIONS.filter((c) => draft.stopConditions.includes(c)) : [],
    target_days_to_ready: intake ? draft.targetDaysToReady : null,
    compress_toward_start_date: intake ? draft.compressTowardStartDate : false,
    expected_revision: expectedRevision,
    steps: draft.steps.map((step) => ({
      offset_days: step.offsetDays as number,
      channel: step.channel,
      template_key: step.templateKey,
      cc_recipients: step.ccRecipients.map(ccRecipientToPayload),
    })),
  };
}

/** Narrow a cc_recipients jsonb value from the database. Malformed entries are dropped. */
export function parseCcRecipients(value: unknown): NotificationCcRecipient[] {
  if (!Array.isArray(value)) return [];
  const out: NotificationCcRecipient[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (record.kind === "user" && typeof record.user_id === "string") {
      out.push({ kind: "user", userId: record.user_id });
    } else if (
      record.kind === "role" &&
      typeof record.role === "string" &&
      (CC_ROLES as readonly string[]).includes(record.role)
    ) {
      out.push({ kind: "role", role: record.role as AppRole });
    }
  }
  return out;
}

/* ------------------------------ Save failures ------------------------------ */

const SAVE_ERROR_MESSAGES: ReadonlyArray<[string, string]> = [
  [
    "notification_sequence_conflict",
    "Someone else saved these settings while you were editing. Reload the page to see their changes.",
  ],
  ["notification_sequence_not_authorized", "Only admins can change notifications."],
  [
    "notification_cc_user_not_member",
    "Someone cc'd on a step is no longer a member of this organization. Remove them and save again.",
  ],
  ["notification_digest_single_step", "The daily digest has exactly one step."],
  ["notification_step_offsets_not_increasing", "Each step must go out after the one before it."],
];

/**
 * A user-facing message for a failed save. Matches the RPC's RAISE codes;
 * SQLSTATE PT409 (PostgREST answers HTTP 409) is the revision conflict
 * whatever its text.
 */
export function saveErrorMessage(text: string, sqlstate?: string): string {
  const haystack = sqlstate === "PT409" ? `notification_sequence_conflict ${text}` : text;
  for (const [code, message] of SAVE_ERROR_MESSAGES) {
    if (haystack.includes(code)) return message;
  }
  return "Couldn't save the notification settings. Check the fields and try again.";
}

/* --------------------------- Concurrent editors ---------------------------- */

export interface ReconcileInput {
  /** The saved config the open draft started from; undefined for a starter. */
  base: NotificationSequenceConfig | undefined;
  /** What the server has now. */
  saved: NotificationSequenceConfig | undefined;
  /** The open draft; null when the editor shows "Set up". */
  draft: SequenceDraft | null;
  /** The revision this editor's own last save produced, if any. */
  ownSavedRevision: number | null;
}

/**
 * What the editor does when the server's copy moves under it:
 *
 *   in_sync       the server still has what the draft started from.
 *   adopt_server  reload the draft from the server: nothing unsaved would be
 *                 lost (the draft is untouched, already equals the server's
 *                 copy, or the change is this editor's own save).
 *   keep_draft    another admin saved while this draft has unsaved edits.
 *                 Keep the edits and say so; saving then sends the old
 *                 revision and gets the conflict, as designed.
 */
export function reconcileWithServer(
  input: ReconcileInput,
): "in_sync" | "adopt_server" | "keep_draft" {
  const { base, saved, draft, ownSavedRevision } = input;
  if (base?.revision === saved?.revision) return "in_sync";
  if (draft == null) return "adopt_server";
  if (base && draftsEqual(draft, draftFromSequence(base))) return "adopt_server";
  if (saved && draftsEqual(draft, draftFromSequence(saved))) return "adopt_server";
  if (saved && ownSavedRevision != null && saved.revision === ownSavedRevision) {
    return "adopt_server";
  }
  return "keep_draft";
}

/**
 * Which arrow to focus after a step's message moves to `destIndex`: the same
 * direction, so a second press keeps moving it, unless that arrow is disabled
 * at the top or bottom, then the other one.
 */
export function stepMoveFocusTarget(
  destIndex: number,
  direction: -1 | 1,
  stepCount: number,
): "up" | "down" {
  if (direction === -1) return destIndex === 0 ? "down" : "up";
  return destIndex === stepCount - 1 ? "up" : "down";
}

/* ------------------------------ Bounce rule -------------------------------- */

/**
 * Decision 4: when step 1 of an intake reminder bounces, the people cc'd on
 * step 1 are told (with the bounce notice template), in their saved order. No
 * other bounce escalates, and the digest has no bounce rule. An empty cc list
 * means a bounce reaches no one, which the card warns about.
 */
export function bounceEscalationRecipients(
  purpose: NotificationPurpose,
  steps: ReadonlyArray<{ position: number; ccRecipients: readonly NotificationCcRecipient[] }>,
  bouncedPosition: number,
): NotificationCcRecipient[] {
  if (purpose !== "intake_reminder" || bouncedPosition !== 1) return [];
  const first = steps.find((step) => step.position === 1);
  return first ? [...first.ccRecipients] : [];
}

/* ------------------------- Start-date cadence rule ------------------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function toUtcDay(iso: string): number {
  if (!ISO_DATE.test(iso)) throw new RangeError(`Expected a YYYY-MM-DD date, got "${iso}"`);
  const [y, m, d] = iso.split("-").map(Number);
  const time = Date.UTC(y, m - 1, d);
  const check = new Date(time);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`"${iso}" is not a calendar date`);
  }
  return time / DAY_MS;
}

function fromUtcDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export interface ScheduleInput {
  /** Configured offsets in position order; must strictly increase. */
  offsets: readonly number[];
  /** The invite date (YYYY-MM-DD). */
  inviteDate: string;
  /** The provider's known start date, if any (YYYY-MM-DD). */
  startDate?: string | null;
  targetDaysToReady: number;
  compressTowardStartDate: boolean;
}

export interface ScheduledSend {
  position: number;
  configuredOffsetDays: number;
  /** Days after the invite this step actually goes out. */
  offsetDays: number;
  sendOn: string;
}

export interface SkippedSend {
  position: number;
  configuredOffsetDays: number;
  reason: "start_date_reached";
}

export interface ScheduleResult {
  /** True when the start date moved the schedule. */
  compressed: boolean;
  /** When the provider should be ready: invite + target, or the day before the start date if that is sooner and compression is on. */
  readyBy: string;
  sends: ScheduledSend[];
  skipped: SkippedSend[];
}

/**
 * The scheduled send dates for a sequence's steps.
 *
 * Without compression (the flag is off, there is no start date, or the start
 * date is far enough away), step i goes out `offsets[i]` days after the
 * invite.
 *
 * With compression on and a known start date, the last useful day for a
 * reminder is the day before the start date: D = (start - invite) - 1 days.
 * The schedule spans S = max(target, last offset) days. When D < S, every
 * offset is scaled by D / S and rounded down; each step then goes out at
 * least one day after the one before it (the first at least one day after
 * the invite). A step that would land after day D is skipped, as is every
 * step after it. When D < 0 (the start date is on or before the invite),
 * every step is skipped.
 */
export function scheduleSequenceSends(input: ScheduleInput): ScheduleResult {
  const invite = toUtcDay(input.inviteDate);
  const { offsets, targetDaysToReady: target } = input;
  offsets.forEach((offset, i) => {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new RangeError(`Offset ${offset} must be a whole number of days`);
    }
    if (i > 0 && offset <= offsets[i - 1]) throw new RangeError("Offsets must strictly increase");
  });
  if (!Number.isInteger(target) || target < 1) {
    throw new RangeError("Target days must be a whole number of at least 1");
  }

  const span = Math.max(target, offsets.at(-1) ?? 0);
  const start = input.startDate ? toUtcDay(input.startDate) : null;
  const lastUsefulDay = start == null ? null : start - invite - 1;
  const compress = input.compressTowardStartDate && lastUsefulDay != null && lastUsefulDay < span;

  const readyAfterDays =
    input.compressTowardStartDate && lastUsefulDay != null
      ? Math.max(0, Math.min(target, lastUsefulDay))
      : target;

  if (!compress || lastUsefulDay == null) {
    return {
      compressed: false,
      readyBy: fromUtcDay(invite + readyAfterDays),
      sends: offsets.map((offset, i) => ({
        position: i + 1,
        configuredOffsetDays: offset,
        offsetDays: offset,
        sendOn: fromUtcDay(invite + offset),
      })),
      skipped: [],
    };
  }

  const sends: ScheduledSend[] = [];
  const skipped: SkippedSend[] = [];
  let previous: number | null = null;
  for (const [i, offset] of offsets.entries()) {
    const position = i + 1;
    const floor: number = previous == null ? Math.min(1, offset) : previous + 1;
    const scaled = Math.max(floor, Math.floor((offset * lastUsefulDay) / span));
    if (lastUsefulDay < 0 || scaled > lastUsefulDay || skipped.length > 0) {
      skipped.push({ position, configuredOffsetDays: offset, reason: "start_date_reached" });
      continue;
    }
    sends.push({
      position,
      configuredOffsetDays: offset,
      offsetDays: scaled,
      sendOn: fromUtcDay(invite + scaled),
    });
    previous = scaled;
  }
  return { compressed: true, readyBy: fromUtcDay(invite + readyAfterDays), sends, skipped };
}

/** "day 2, day 4 and day 7" for the card's one-line schedule summary. */
export function describeOffsets(offsets: readonly number[]): string {
  const parts = offsets.map((offset) => `day ${offset}`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
