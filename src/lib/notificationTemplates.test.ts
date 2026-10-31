import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CC_PERSONAL_FIELDS,
  INTAKE_BOUNCE_NOTICE_TEMPLATE,
  NOTIFICATION_TEMPLATES,
  PURPOSES_WITH_CC,
  TEMPLATE_KEY_PATTERN,
  catalogViolations,
  ccCopyFields,
  getNotificationTemplate,
  purposeHasCcList,
  selectableTemplates,
  templateSendProblem,
  templateSupportsChannel,
  type NotificationTemplateEntry,
} from "./notificationTemplates";
import type { NotificationChannel } from "@/types";

const MIGRATION = readFileSync(
  "supabase/migrations/20261031051500_notification_sequences.sql",
  "utf8",
);

describe("notification template catalog", () => {
  it("passes every catalog rule, including the cc rule", () => {
    expect(catalogViolations(NOTIFICATION_TEMPLATES)).toEqual([]);
  });

  it("catches SSN, DOB, document contents and personal links in a bad entry", () => {
    const bad: NotificationTemplateEntry = {
      key: "intake_reminder_leaky",
      purpose: "intake_reminder",
      label: "Leaky",
      description: "",
      channels: ["email"],
      recipientFields: ["practiceName", "providerSsnLast4" as never],
      ccFields: [
        "providerFullName",
        "dateOfBirth" as never,
        "licenseDocumentText" as never,
        "intakeLink",
      ],
      selectable: true,
    };
    expect(catalogViolations([bad])).toEqual([
      "intake_reminder_leaky: renders forbidden data providerSsnLast4",
      "intake_reminder_leaky: renders forbidden data dateOfBirth",
      "intake_reminder_leaky: renders forbidden data licenseDocumentText",
      "intake_reminder_leaky: cc copy renders personal field intakeLink",
    ]);
  });

  it("catches key-format, purpose-prefix, duplicate and channel problems", () => {
    const entry = NOTIFICATION_TEMPLATES[0];
    expect(
      catalogViolations([
        entry,
        entry,
        { ...entry, key: "Bad Key" },
        { ...entry, key: "followup_digest_x" },
        { ...entry, key: "intake_reminder_nochannel", channels: [] },
      ]),
    ).toEqual([
      "intake_reminder_first: duplicate key",
      "Bad Key: bad key format",
      "Bad Key: key must start with intake_reminder_",
      "followup_digest_x: key must start with intake_reminder_",
      "intake_reminder_nochannel: no channel",
    ]);
  });

  it("uses the same key pattern as the database CHECK", () => {
    expect(MIGRATION).toContain(`template_key ~ '${TEMPLATE_KEY_PATTERN.source}'`);
    for (const entry of NOTIFICATION_TEMPLATES) expect(entry.key).toMatch(TEMPLATE_KEY_PATTERN);
  });

  it("never lets a cc'd copy render the provider's intake link", () => {
    expect(CC_PERSONAL_FIELDS).toContain("intakeLink");
    for (const entry of NOTIFICATION_TEMPLATES) {
      expect(ccCopyFields(entry)).not.toContain("intakeLink");
    }
  });

  it("offers selectable messages per purpose and keeps the bounce notice out of the picker", () => {
    expect(selectableTemplates("intake_reminder").map((t) => t.key)).toEqual([
      "intake_reminder_first",
      "intake_reminder_second",
      "intake_reminder_final",
    ]);
    expect(selectableTemplates("followup_digest").map((t) => t.key)).toEqual([
      "followup_digest_daily",
    ]);
    expect(getNotificationTemplate(INTAKE_BOUNCE_NOTICE_TEMPLATE)?.selectable).toBe(false);
    expect(getNotificationTemplate("nope")).toBeNull();
  });

  it("knows which channels each message has a body for", () => {
    expect(templateSupportsChannel("intake_reminder_first", "sms")).toBe(true);
    expect(templateSupportsChannel("followup_digest_daily", "sms")).toBe(false);
    expect(templateSupportsChannel(INTAKE_BOUNCE_NOTICE_TEMPLATE, "sms")).toBe(false);
  });

  it("covers every step of Minted's seeded defaults, on its channel", () => {
    // ('<purpose>', <position>, <offset>, '<channel>', '<template_key>') in the seed.
    const seeded = [
      ...MIGRATION.matchAll(
        /\('(intake_reminder|followup_digest)', (\d+), (\d+), '(email|sms)', '([a-z0-9_]+)'\)/g,
      ),
    ];
    expect(seeded.map((m) => m[5])).toEqual([
      "intake_reminder_first",
      "intake_reminder_second",
      "intake_reminder_final",
      "followup_digest_daily",
    ]);
    for (const [, purpose, , , channel, key] of seeded) {
      const entry = getNotificationTemplate(key);
      expect(entry?.purpose).toBe(purpose);
      expect(entry?.selectable).toBe(true);
      expect(templateSupportsChannel(key, channel as NotificationChannel)).toBe(true);
    }
  });

  it("renders no cc copy for the digest, which goes to coordinators only (answer 2)", () => {
    expect(PURPOSES_WITH_CC).toEqual(["intake_reminder"]);
    expect(purposeHasCcList("followup_digest")).toBe(false);
    for (const entry of NOTIFICATION_TEMPLATES.filter((t) => t.purpose === "followup_digest")) {
      expect(entry.ccFields).toEqual([]);
      expect(ccCopyFields(entry)).toEqual([]);
    }
    const digest = getNotificationTemplate("followup_digest_daily");
    if (!digest) throw new Error("followup_digest_daily is missing");
    expect(catalogViolations([{ ...digest, ccFields: ["practiceName"] }])).toEqual([
      "followup_digest_daily: followup_digest has no cc list, so it renders no cc copy",
    ]);
  });

  it("applies the consumer contract to a saved step: exists, purpose, selectable, channel", () => {
    expect(templateSendProblem("followup_digest", "followup_digest_daily", "email")).toBeNull();
    expect(templateSendProblem("followup_digest", "followup_digest_weekly", "email")).toBe(
      "unknown_template",
    );
    expect(templateSendProblem("followup_digest", "intake_reminder_first", "email")).toBe(
      "wrong_purpose",
    );
    expect(templateSendProblem("intake_reminder", INTAKE_BOUNCE_NOTICE_TEMPLATE, "email")).toBe(
      "not_selectable",
    );
    expect(templateSendProblem("followup_digest", "followup_digest_daily", "sms")).toBe(
      "channel_unsupported",
    );
  });

  it("lets the digest render its rows and team counts, and nothing a cc rule forbids", () => {
    const digest = getNotificationTemplate("followup_digest_daily");
    expect(digest?.recipientFields).toEqual(
      expect.arrayContaining([
        "caseNumber",
        "caseLink",
        "providerFullName",
        "payerName",
        "followUpDueDate",
        "followUpStatus",
        "daysSinceSubmission",
        "payerDecisionDays",
      ]),
    );
    expect(digest?.recipientFields).not.toContain("intakeLink");
  });
});
