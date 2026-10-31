// MINT-107 — the closed catalog of notification templates a sequence step may
// name. It lives in src/lib because the Settings card (a browser bundle) picks
// from it and the browser cannot import src/server. No template BODY exists
// yet: the server PRs that send these messages add each key to
// src/server/email/templates.ts (and an SMS text registry) and assert there
// that every catalog key below is registered.
//
// THE CC RULE (MINT-107 decision 4). A copy sent to a step's cc list is an
// escalation to staff, so it must never carry a provider's SSN, date of birth
// or document contents. We encode that here, before any template exists:
//
//   1. `NotificationTemplateField` is a closed list of the data a notification
//      may render. SSN, DOB and document contents are not in it, so a template
//      cannot declare them without widening this type in review.
//   2. No template may render them at all, recipient copy included: a
//      reminder never needs them.
//   3. A cc'd copy renders only `ccFields`, which also may not include the
//      provider's personal intake link (`CC_PERSONAL_FIELDS`).
//   4. `catalogViolations` checks all of the above at runtime, so a cast or a
//      hand-built entry still fails the unit test.
//
// cc'd copies are always emailed, whatever the step's channel: staff have not
// consented to texts, and the SMS consent table covers providers only.
//
// THE DIGEST HAS NO CC LIST (MINT-107 answer, Oct 30). The follow-up digest
// goes to coordinators only; nobody cc'd gets anything from it. Its templates
// therefore render no cc copy (`ccFields` empty), `catalogViolations` checks
// that, and the database refuses a digest step with a cc list.
import type { NotificationChannel, NotificationPurpose } from "@/types";

/** The purposes whose steps carry a cc list. The digest has none. */
export const PURPOSES_WITH_CC: readonly NotificationPurpose[] = ["intake_reminder"];

export function purposeHasCcList(purpose: NotificationPurpose): boolean {
  return PURPOSES_WITH_CC.includes(purpose);
}

/** The data a notification message may render. Closed on purpose. */
export type NotificationTemplateField =
  | "practiceName"
  | "recipientFirstName"
  | "providerFirstName"
  | "providerFullName"
  | "stepNumber"
  | "inviteSentOn"
  | "targetReadyDate"
  | "startDate"
  | "intakeLink"
  | "followUpCount"
  | "overdueFollowUpCount"
  | "workQueueLink";

export interface NotificationTemplateEntry {
  /** Registered later under the same key in src/server/email/templates.ts. */
  key: string;
  purpose: NotificationPurpose;
  /** Admin-facing name in the step's message picker. */
  label: string;
  /** One line on what the message says, shown under the picker. */
  description: string;
  /** Channels the template will have a body for. */
  channels: readonly NotificationChannel[];
  /** Data the message to the step's own recipient may render. */
  recipientFields: readonly NotificationTemplateField[];
  /** Data a cc'd copy may render. See the cc rule above. Empty for a purpose with no cc list. */
  ccFields: readonly NotificationTemplateField[];
  /** False for a system message a step cannot pick (the bounce notice). */
  selectable: boolean;
}

/** Never rendered by any notification, recipient or cc. Matched loosely. */
export const FORBIDDEN_NOTIFICATION_DATA = [
  "ssn",
  "socialsecurity",
  "dob",
  "dateofbirth",
  "birthdate",
  "document",
] as const;

/** Rendered for the step's own recipient only, never in a cc'd copy. */
export const CC_PERSONAL_FIELDS: readonly NotificationTemplateField[] = ["intakeLink"];

/** Same pattern as the notification_sequence_steps_template_key_check CHECK. */
export const TEMPLATE_KEY_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

const INTAKE_CC_FIELDS: readonly NotificationTemplateField[] = [
  "practiceName",
  "recipientFirstName",
  "providerFullName",
  "stepNumber",
  "inviteSentOn",
  "targetReadyDate",
  "startDate",
];

export const NOTIFICATION_TEMPLATES: readonly NotificationTemplateEntry[] = [
  {
    key: "intake_reminder_first",
    purpose: "intake_reminder",
    label: "First reminder",
    description: "A friendly note that the credentialing form is waiting, with the link.",
    channels: ["email", "sms"],
    recipientFields: ["practiceName", "providerFirstName", "intakeLink", "targetReadyDate"],
    ccFields: INTAKE_CC_FIELDS,
    selectable: true,
  },
  {
    key: "intake_reminder_second",
    purpose: "intake_reminder",
    label: "Second reminder",
    description: "Says the form is still open and gives the target date.",
    channels: ["email", "sms"],
    recipientFields: [
      "practiceName",
      "providerFirstName",
      "intakeLink",
      "targetReadyDate",
      "startDate",
    ],
    ccFields: INTAKE_CC_FIELDS,
    selectable: true,
  },
  {
    key: "intake_reminder_final",
    purpose: "intake_reminder",
    label: "Final reminder",
    description: "Says the target date is close and that the practice will follow up.",
    channels: ["email", "sms"],
    recipientFields: [
      "practiceName",
      "providerFirstName",
      "intakeLink",
      "targetReadyDate",
      "startDate",
    ],
    ccFields: INTAKE_CC_FIELDS,
    selectable: true,
  },
  {
    // Decision 4: a bounce on step 1 escalates to step 1's cc list. This is
    // the message those people get. It is never a step's own message.
    key: "intake_reminder_bounce_notice",
    purpose: "intake_reminder",
    label: "Bounce notice",
    description: "Tells the people cc'd on step 1 that the first reminder could not be delivered.",
    channels: ["email"],
    recipientFields: INTAKE_CC_FIELDS,
    ccFields: INTAKE_CC_FIELDS,
    selectable: false,
  },
  {
    key: "followup_digest_daily",
    purpose: "followup_digest",
    label: "Daily follow-up digest",
    description: "Lists the follow-ups due today and the overdue ones, with a link to Work.",
    // A list of follow-ups does not fit in a text, so the digest has no SMS
    // body. Adding one is a catalog change, not a migration.
    channels: ["email"],
    recipientFields: [
      "practiceName",
      "recipientFirstName",
      "followUpCount",
      "overdueFollowUpCount",
      "workQueueLink",
    ],
    // Coordinators only: the digest has no cc list, so no cc copy.
    ccFields: [],
    selectable: true,
  },
];

/** The key of the bounce notice sent to step 1's cc list. */
export const INTAKE_BOUNCE_NOTICE_TEMPLATE = "intake_reminder_bounce_notice";

export function getNotificationTemplate(key: string): NotificationTemplateEntry | null {
  return NOTIFICATION_TEMPLATES.find((entry) => entry.key === key) ?? null;
}

/** The templates a step of this purpose may pick, in catalog order. */
export function selectableTemplates(purpose: NotificationPurpose): NotificationTemplateEntry[] {
  return NOTIFICATION_TEMPLATES.filter((entry) => entry.purpose === purpose && entry.selectable);
}

export function templateSupportsChannel(key: string, channel: NotificationChannel): boolean {
  return getNotificationTemplate(key)?.channels.includes(channel) ?? false;
}

/** The fields a cc'd copy of this template may render. */
export function ccCopyFields(entry: NotificationTemplateEntry): NotificationTemplateField[] {
  return entry.ccFields.filter((field) => !CC_PERSONAL_FIELDS.includes(field));
}

function isForbiddenField(field: string): boolean {
  const normalized = field.toLowerCase().replace(/[^a-z]/g, "");
  return FORBIDDEN_NOTIFICATION_DATA.some((term) => normalized.includes(term));
}

/**
 * Every rule a catalog must satisfy, as human-readable problems. Empty means
 * the catalog is sound. Exported so the test can also prove it catches a bad
 * entry, not just that today's catalog passes.
 */
export function catalogViolations(catalog: readonly NotificationTemplateEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of catalog) {
    if (seen.has(entry.key)) problems.push(`${entry.key}: duplicate key`);
    seen.add(entry.key);
    if (!TEMPLATE_KEY_PATTERN.test(entry.key)) problems.push(`${entry.key}: bad key format`);
    if (!entry.key.startsWith(`${entry.purpose}_`)) {
      problems.push(`${entry.key}: key must start with ${entry.purpose}_`);
    }
    if (entry.channels.length === 0) problems.push(`${entry.key}: no channel`);
    for (const field of [...entry.recipientFields, ...entry.ccFields]) {
      if (isForbiddenField(field)) problems.push(`${entry.key}: renders forbidden data ${field}`);
    }
    for (const field of entry.ccFields) {
      if (CC_PERSONAL_FIELDS.includes(field)) {
        problems.push(`${entry.key}: cc copy renders personal field ${field}`);
      }
    }
    if (!purposeHasCcList(entry.purpose) && entry.ccFields.length > 0) {
      problems.push(`${entry.key}: ${entry.purpose} has no cc list, so it renders no cc copy`);
    }
  }
  return problems;
}
