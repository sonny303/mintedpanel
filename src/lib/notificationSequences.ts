// MINT-107 — organization notification sequences: the pure rules.
//
// A sequence is one organization's settings for one purpose: whether it is
// on, its ordered steps (offset in days, channel, template, ordered cc list),
// and, for intake reminders only, the stop conditions, the target days from
// invite to ready, and whether the schedule tightens as a known start date
// approaches; for the digest, the local hour and time zone it goes out in.
// Cadence is configuration, never a constant.
//
// Two layers. Minted's platform default (one per purpose, no org, no cc,
// no on/off) and the org's own row, which overrides it field by field: a
// null setting uses the default, and an org with no steps of its own uses
// the default steps. `enabled` is never inherited, so a default can never
// switch an org on. `resolveNotificationSequence` turns the two into the
// effective sequence; every consumer calls it rather than re-deriving it.
// Compression and the digest's send hour and time zone are platform-managed:
// only Minted sets them, on the default or as an org override, never an org
// admin.
//
// Nothing here sends anything. The consumers (the daily follow-up digest, and
// intake reminders once the intake back end lands) resolve the effective
// sequence and call `scheduleSequenceSends` and `bounceEscalationRecipients`
// below, so the rules they apply are pinned by tests now.
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
// step and no cc, cc lists of at most 20 users or roles, target 1 to 90 days,
// send hour 0 to 23 in an IANA zone. Rules that
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
  NotificationSequenceDefault,
  NotificationSequenceDefaultStep,
  NotificationSequenceStep,
  NotificationStopCondition,
} from "@/types";
import {
  getNotificationTemplate,
  purposeHasCcList,
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

/**
 * Mirrors the CHECK constraints in migration 20261031051500. Default values
 * (14 days, the default steps, the send time) are not here: they are Minted's
 * platform default rows, read through the service.
 */
export const NOTIFICATION_LIMITS = {
  maxOffsetDays: 90,
  maxSteps: 10,
  maxCcRecipients: 20,
  minTargetDays: 1,
  maxTargetDays: 90,
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
  /** Steps carry an ordered cc list. False for the digest (coordinators only). */
  hasCcList: boolean;
  /** Admins can replace Minted's default steps with their own on the card. */
  stepsEditable: boolean;
  /** A platform-managed local send hour and time zone. */
  hasSendTime: boolean;
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
    hasCcList: purposeHasCcList("intake_reminder"),
    stepsEditable: true,
    hasSendTime: false,
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
    // Coordinators only (answer 2).
    hasCcList: purposeHasCcList("followup_digest"),
    // One email, one message, no cc: nothing for an org to change but on/off.
    stepsEditable: false,
    // Minted sets when it goes out (answer 5).
    hasSendTime: true,
  },
};

/** How the card names the platform layer. */
export const PLATFORM_DEFAULT_LABEL = "Minted's default";

/* ---------------------------------- Drafts --------------------------------- */

/** One step while it is being edited. `offsetDays` is null while the input is blank. */
export interface StepDraft {
  offsetDays: number | null;
  channel: NotificationChannel;
  templateKey: string;
  ccRecipients: NotificationCcRecipient[];
}

/**
 * What an org admin edits: the org-owned settings only. A null field uses
 * Minted's default; `steps: null` uses Minted's default steps. The
 * platform-managed settings (compression, the digest's send time) are not
 * here at all: the card cannot set them.
 */
export interface SequenceDraft {
  enabled: boolean;
  /** Intake only. null: Minted's default. [] is a real choice: never stop early. */
  stopConditions: NotificationStopCondition[] | null;
  /** Intake only. null: Minted's default (the input is blank). */
  targetDaysToReady: number | null;
  /** null: Minted's default steps. Otherwise the org's own, never empty. */
  steps: StepDraft[] | null;
}

/** A saved org sequence with its own ordered steps (none: it uses the default steps). */
export interface NotificationSequenceConfig extends NotificationSequence {
  steps: NotificationSequenceStep[];
}

/** Minted's platform default for one purpose with its ordered steps. */
export interface NotificationSequenceDefaultConfig extends NotificationSequenceDefault {
  steps: NotificationSequenceDefaultStep[];
}

/**
 * The starting point behind "Set up": switched OFF, with every setting left
 * to Minted's default. Saving it never emails anyone until an admin switches
 * the sequence on, and any setting can be changed before saving.
 */
export function starterDraft(): SequenceDraft {
  return { enabled: false, stopConditions: null, targetDaysToReady: null, steps: null };
}

export function draftFromSequence(config: NotificationSequenceConfig): SequenceDraft {
  return {
    enabled: config.enabled,
    stopConditions: config.stopConditions ? [...config.stopConditions] : null,
    targetDaysToReady: config.targetDaysToReady,
    steps:
      config.steps.length === 0
        ? null
        : [...config.steps]
            .sort((a, b) => a.position - b.position)
            .map((step) => ({
              offsetDays: step.offsetDays,
              channel: step.channel,
              templateKey: step.templateKey,
              ccRecipients: step.ccRecipients.map((r) => ({ ...r })),
            })),
  };
}

/** Minted's default steps as the org's own, to edit: "Customize steps". A default cc's no one. */
export function stepsFromDefault(platformDefault: NotificationSequenceDefaultConfig): StepDraft[] {
  return [...platformDefault.steps]
    .sort((a, b) => a.position - b.position)
    .map((step) => ({
      offsetDays: step.offsetDays,
      channel: step.channel,
      templateKey: step.templateKey,
      ccRecipients: [],
    }));
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
  if (!draft.steps) return draft;
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
  if (!draft.steps || draft.steps.length >= rules.maxSteps) return draft;
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

/** Removes a step. The last one stays: use Minted's default steps instead. */
export function removeStep(draft: SequenceDraft, index: number): SequenceDraft {
  if (!draft.steps || draft.steps.length <= 1) return draft;
  if (index < 0 || index >= draft.steps.length) return draft;
  return { ...draft, steps: draft.steps.filter((_, i) => i !== index) };
}

export function updateStep(
  draft: SequenceDraft,
  index: number,
  patch: Partial<StepDraft>,
): SequenceDraft {
  if (!draft.steps || index < 0 || index >= draft.steps.length) return draft;
  return {
    ...draft,
    steps: draft.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
  };
}

/** Toggle one stop condition, starting from Minted's default when the draft inherits. */
export function toggleStopCondition(
  draft: SequenceDraft,
  platformDefault: NotificationSequenceDefaultConfig,
  condition: NotificationStopCondition,
  checked: boolean,
): SequenceDraft {
  const current = draft.stopConditions ?? platformDefault.stopConditions ?? [];
  return {
    ...draft,
    stopConditions: checked
      ? STOP_CONDITIONS.filter((c) => c === condition || current.includes(c))
      : current.filter((c) => c !== condition),
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
  | "targetDaysToReady";

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

  // null: Minted's default steps, nothing to check here.
  const steps = draft.steps ?? [];
  if (draft.steps && draft.steps.length === 0) {
    add("steps", null, "Add at least one step, or use Minted's default steps.");
  }
  if (purpose === "followup_digest" && steps.length > 1) {
    add("steps", null, "The daily digest has exactly one step.");
  } else if (steps.length > rules.maxSteps) {
    add("steps", null, `A sequence can have at most ${rules.maxSteps} steps.`);
  }

  let previous: number | null = null;
  steps.forEach((step, index) => {
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

    if (!rules.hasCcList && step.ccRecipients.length > 0) {
      add(
        "ccRecipients",
        index,
        "The daily digest goes to coordinators only, so it has no cc list.",
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
    // null on either: Minted's default.
    const conditions = draft.stopConditions;
    if (
      conditions &&
      (conditions.some((c) => !STOP_CONDITIONS.includes(c)) ||
        new Set(conditions).size !== conditions.length)
    ) {
      add("stopConditions", null, "Choose stop conditions from the list.");
    }
    const target = draft.targetDaysToReady;
    if (
      target != null &&
      (!isWholeNumber(target) ||
        target < NOTIFICATION_LIMITS.minTargetDays ||
        target > NOTIFICATION_LIMITS.maxTargetDays)
    ) {
      add(
        "targetDaysToReady",
        null,
        `Enter a target between ${NOTIFICATION_LIMITS.minTargetDays} and ${NOTIFICATION_LIMITS.maxTargetDays} days, or leave it blank for Minted's default.`,
      );
    }
  } else {
    if (draft.stopConditions != null) {
      add("stopConditions", null, "The daily digest has no stop conditions.");
    }
    if (draft.targetDaysToReady != null) {
      add("targetDaysToReady", null, "The daily digest has no target.");
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

/**
 * The `p_payload` of save_notification_sequence(p_org_id, p_purpose, p_payload).
 * A null setting uses Minted's default. There is no key for compression or the
 * send time: the RPC refuses them (notification_platform_setting).
 */
export interface SaveSequencePayload {
  enabled: boolean;
  /** Intake only; null for Minted's default and always null for the digest. */
  stop_conditions: NotificationStopCondition[] | null;
  /** Intake only; null for Minted's default and always null for the digest. */
  target_days_to_ready: number | null;
  /** The revision the editor loaded; null when no row existed yet. */
  expected_revision: number | null;
  /** null: Minted's default steps. */
  steps: SequenceStepPayload[] | null;
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
  const rules = PURPOSE_RULES[purpose];
  const stops = draft.stopConditions;
  return {
    enabled: draft.enabled,
    stop_conditions:
      rules.hasIntakeSettings && stops ? STOP_CONDITIONS.filter((c) => stops.includes(c)) : null,
    target_days_to_ready: rules.hasIntakeSettings ? draft.targetDaysToReady : null,
    expected_revision: expectedRevision,
    steps:
      draft.steps?.map((step) => ({
        offset_days: step.offsetDays as number,
        channel: step.channel,
        template_key: step.templateKey,
        cc_recipients: rules.hasCcList ? step.ccRecipients.map(ccRecipientToPayload) : [],
      })) ?? null,
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
  [
    "notification_digest_has_no_cc",
    "The daily digest goes to coordinators only, so it can't cc anyone.",
  ],
  ["notification_platform_setting", "Minted sets that setting, so it can't be changed here."],
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
 *   keep_draft    someone else saved while this draft has unsaved edits.
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

/* ---------------------- Resolution (org row + default) --------------------- */

/** A step as it will actually go out. */
export interface EffectiveStep {
  position: number;
  offsetDays: number;
  channel: NotificationChannel;
  templateKey: string;
  /** Always empty for the digest, and for Minted's default steps. */
  ccRecipients: NotificationCcRecipient[];
}

/** The settings an org can leave to Minted's default. */
export type InheritableSetting =
  | "steps"
  | "stopConditions"
  | "targetDaysToReady"
  | "compressTowardStartDate"
  | "sendHour"
  | "sendTimeZone";

/**
 * One purpose as it applies to one org: its own values where it set them,
 * Minted's default everywhere else. A setting that does not apply to the
 * purpose is empty ([] / null / false) and never inherited.
 */
export interface EffectiveNotificationSequence {
  purpose: NotificationPurpose;
  /** The org's own switch: false with no row. Never inherited. */
  enabled: boolean;
  steps: EffectiveStep[];
  /** Intake; [] for the digest. */
  stopConditions: NotificationStopCondition[];
  /** Intake; null for the digest. */
  targetDaysToReady: number | null;
  /** Intake; false for the digest. */
  compressTowardStartDate: boolean;
  /** Digest: the local hour (0 to 23); null for intake. */
  sendHour: number | null;
  /** Digest: the IANA zone of sendHour, always one this runtime can use; null for intake. */
  sendTimeZone: string | null;
  /** True where the value is Minted's default rather than the org's own. */
  inherited: Record<InheritableSetting, boolean>;
}

function sortedByPosition<T extends { position: number }>(steps: readonly T[]): T[] {
  return [...steps].sort((a, b) => a.position - b.position);
}

/** The org's value when it set one, else the default's, and whether it was inherited. */
function inherit<T>(own: T | null | undefined, fallback: T | null): [T | null, boolean] {
  return own != null ? [own, false] : [fallback, true];
}

/**
 * The digest's zone, always one this runtime can format in. The database
 * checks a zone against its own tz database when it is written, but that can
 * change under a stored row, and JavaScript's Intl may not match it. So an
 * org zone that fails isIanaTimeZone gives way to Minted's default zone
 * (marked inherited), and an unusable default gives way to
 * LAST_RESORT_TIME_ZONE. It never throws and never returns an unusable zone.
 */
function resolveTimeZone(
  own: string | null | undefined,
  fallback: string | null,
): [string, boolean] {
  if (own != null && isIanaTimeZone(own)) return [own, false];
  if (fallback != null && isIanaTimeZone(fallback)) return [fallback, true];
  return [LAST_RESORT_TIME_ZONE, true];
}

/**
 * The effective sequence for one purpose: the org's row (or none) over
 * Minted's default. Field by field, a null org value takes the default's; an
 * org with no steps of its own takes the default steps, which cc no one.
 * `enabled` comes from the org's row alone, so a default cannot switch an
 * org on. The digest's zone is always usable (see resolveTimeZone): an org
 * zone this runtime cannot use reads as inherited. Throws when the rows are
 * for a different purpose.
 */
export function resolveNotificationSequence(
  purpose: NotificationPurpose,
  org: NotificationSequenceConfig | undefined,
  platformDefault: NotificationSequenceDefaultConfig,
): EffectiveNotificationSequence {
  if (platformDefault.purpose !== purpose || (org && org.purpose !== purpose)) {
    throw new RangeError(`Notification settings are not for ${purpose}`);
  }
  const rules = PURPOSE_RULES[purpose];
  const ownSteps = org != null && org.steps.length > 0;
  const steps: EffectiveStep[] = (ownSteps ? sortedByPosition(org.steps) : []).map((step) => ({
    position: step.position,
    offsetDays: step.offsetDays,
    channel: step.channel,
    templateKey: step.templateKey,
    // The database refuses a digest cc; never pass one on regardless.
    ccRecipients: rules.hasCcList ? step.ccRecipients.map((r) => ({ ...r })) : [],
  }));
  if (!ownSteps) {
    for (const step of sortedByPosition(platformDefault.steps)) {
      steps.push({
        position: step.position,
        offsetDays: step.offsetDays,
        channel: step.channel,
        templateKey: step.templateKey,
        ccRecipients: [],
      });
    }
  }

  const none: [null, false] = [null, false];
  const intake = rules.hasIntakeSettings;
  const [stopConditions, stopsInherited] = intake
    ? inherit(org?.stopConditions, platformDefault.stopConditions)
    : none;
  const [targetDaysToReady, targetInherited] = intake
    ? inherit(org?.targetDaysToReady, platformDefault.targetDaysToReady)
    : none;
  const [compress, compressInherited] = intake
    ? inherit(org?.compressTowardStartDate, platformDefault.compressTowardStartDate)
    : none;
  const timed = rules.hasSendTime;
  const [sendHour, hourInherited] = timed ? inherit(org?.sendHour, platformDefault.sendHour) : none;
  const [sendTimeZone, zoneInherited] = timed
    ? resolveTimeZone(org?.sendTimeZone, platformDefault.sendTimeZone)
    : none;

  return {
    purpose,
    enabled: org?.enabled ?? false,
    steps,
    stopConditions: stopConditions ? STOP_CONDITIONS.filter((c) => stopConditions.includes(c)) : [],
    targetDaysToReady,
    compressTowardStartDate: compress ?? false,
    sendHour,
    sendTimeZone,
    inherited: {
      steps: !ownSteps,
      stopConditions: stopsInherited,
      targetDaysToReady: targetInherited,
      compressTowardStartDate: compressInherited,
      sendHour: hourInherited,
      sendTimeZone: zoneInherited,
    },
  };
}

/** "Step 1 · day 2 after the invite · Email · First reminder" for the read-only views. */
export function describeStep(
  purpose: NotificationPurpose,
  step: Pick<EffectiveStep, "position" | "offsetDays" | "channel" | "templateKey">,
): string {
  const when =
    PURPOSE_RULES[purpose].fixedOffsetDays == null
      ? `day ${step.offsetDays} after the invite`
      : "once a day";
  const label = getNotificationTemplate(step.templateKey)?.label ?? step.templateKey;
  return `Step ${step.position} · ${when} · ${CHANNEL_LABELS[step.channel]} · ${label}`;
}

/* ------------------------------- Send time --------------------------------- */

/** Same pattern as private.notification_time_zone_valid in migration 20261031051500. */
export const IANA_TIME_ZONE_PATTERN = /^(UTC|[A-Z][A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2})$/;

/**
 * The digest's zone when even Minted's default zone cannot be used by this
 * runtime: the zone that default is seeded with (8 am Central, the old 13:00
 * UTC cron in CDT). Reached only through a tz-data gap between the database
 * and this runtime, never through bad data (the database checks the default
 * when it is written). Falling back beats throwing: a throw would stop every
 * org's digest and break the card for everyone; this keeps the digest at
 * the hour Minted chose, in the zone it ships with.
 */
export const LAST_RESORT_TIME_ZONE = "America/Chicago";

/** True for an IANA zone name ("America/Chicago") that this runtime can format in. */
export function isIanaTimeZone(zone: string): boolean {
  if (!IANA_TIME_ZONE_PATTERN.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Plain names for the US zones Minted's customers work in. */
const US_ZONE_NAMES: Readonly<Record<string, string>> = {
  "America/New_York": "Eastern",
  "America/Detroit": "Eastern",
  "America/Indiana/Indianapolis": "Eastern",
  "America/Chicago": "Central",
  "America/Denver": "Mountain",
  "America/Boise": "Mountain",
  "America/Phoenix": "Arizona",
  "America/Los_Angeles": "Pacific",
  "America/Anchorage": "Alaska",
  "Pacific/Honolulu": "Hawaii",
};

function timeZoneName(zone: string): string {
  const known = US_ZONE_NAMES[zone];
  if (known) return `${known} time`;
  if (isIanaTimeZone(zone)) {
    // A fixed instant: the generic name ("Central European Time") does not
    // depend on the date, and a pure lib never reads the clock.
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longGeneric" })
      .formatToParts(new Date(Date.UTC(2026, 0, 1)))
      .find((p) => p.type === "timeZoneName")?.value;
    if (part) return part.replace(/ Time$/, " time");
  }
  return `${zone} time`;
}

function hourLabel(hour: number): string {
  if (hour === 0) return "12 am";
  if (hour === 12) return "12 pm";
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

/**
 * "8 am Central time" for the digest's read-only send time. Null when the
 * hour or zone is missing, the hour is out of range, or the zone is not one
 * this runtime can use: the card never shows an unusable zone name. (The
 * resolver never returns one; this guards direct callers.)
 */
export function describeSendTime(hour: number | null, zone: string | null): string | null {
  if (hour == null || zone == null || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    return null;
  }
  if (!isIanaTimeZone(zone)) return null;
  return `${hourLabel(hour)} ${timeZoneName(zone)}`;
}

/* ------------------------------ Bounce rule -------------------------------- */

/**
 * Decision 4: when step 1 of an intake reminder bounces, the people cc'd on
 * step 1 are told (with the bounce notice template), in their saved order. No
 * other bounce escalates, and the digest has no bounce rule. An empty cc list
 * means a bounce reaches no one, which the card warns about. Pass the
 * effective steps (resolveNotificationSequence): Minted's default steps cc no
 * one.
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
