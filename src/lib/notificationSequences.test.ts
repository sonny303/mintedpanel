import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  IANA_TIME_ZONE_PATTERN,
  NOTIFICATION_LIMITS,
  PURPOSE_RULES,
  addCcRecipient,
  addStep,
  bounceEscalationRecipients,
  buildSavePayload,
  ccRecipientLabel,
  describeCcList,
  describeOffsets,
  describeSendTime,
  describeStep,
  draftFromSequence,
  draftsEqual,
  isIanaTimeZone,
  moveCcRecipient,
  moveStep,
  parseCcRecipients,
  parseRecipientKey,
  reconcileWithServer,
  removeCcRecipient,
  removeStep,
  resolveNotificationSequence,
  saveErrorMessage,
  scheduleSequenceSends,
  starterDraft,
  stepMoveFocusTarget,
  stepsFromDefault,
  toggleStopCondition,
  updateStep,
  validateDraft,
  type NotificationSequenceConfig,
  type NotificationSequenceDefaultConfig,
  type SequenceDraft,
  type StepDraft,
} from "./notificationSequences";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const STRANGER = "99999999-9999-4999-8999-999999999999";
const ALL_STOPS = ["submitted", "paused", "withdrawn", "provider_replied"] as const;

/** Minted's seeded intake default (migration 20261031051500). */
const INTAKE_DEFAULT: NotificationSequenceDefaultConfig = {
  purpose: "intake_reminder",
  stopConditions: [...ALL_STOPS],
  targetDaysToReady: 14,
  compressTowardStartDate: false,
  sendHour: null,
  sendTimeZone: null,
  createdAt: "",
  updatedAt: "",
  steps: [
    ["intake_reminder_final", 7, 3],
    ["intake_reminder_first", 2, 1],
    ["intake_reminder_second", 4, 2],
  ].map(([templateKey, offsetDays, position]) => ({
    id: `d${position}`,
    purpose: "intake_reminder" as const,
    position: position as number,
    offsetDays: offsetDays as number,
    channel: "email" as const,
    templateKey: templateKey as string,
    createdAt: "",
    updatedAt: "",
  })),
};

/** Minted's seeded digest default. */
const DIGEST_DEFAULT: NotificationSequenceDefaultConfig = {
  purpose: "followup_digest",
  stopConditions: null,
  targetDaysToReady: null,
  compressTowardStartDate: null,
  sendHour: 8,
  sendTimeZone: "America/Chicago",
  createdAt: "",
  updatedAt: "",
  steps: [
    {
      id: "dd1",
      purpose: "followup_digest",
      position: 1,
      offsetDays: 0,
      channel: "email",
      templateKey: "followup_digest_daily",
      createdAt: "",
      updatedAt: "",
    },
  ],
};

type OwnStepsDraft = SequenceDraft & { steps: StepDraft[] };

/** An intake draft with its own steps (Minted's, customized) and its own settings. */
function intake(): OwnStepsDraft {
  return {
    enabled: false,
    stopConditions: [...ALL_STOPS],
    targetDaysToReady: 14,
    steps: stepsFromDefault(INTAKE_DEFAULT),
  };
}

/** A digest draft with its own single step. */
function digest(): OwnStepsDraft {
  return {
    enabled: false,
    stopConditions: null,
    targetDaysToReady: null,
    steps: stepsFromDefault(DIGEST_DEFAULT),
  };
}

/** The steps of a draft that has its own. */
function own(draft: SequenceDraft): StepDraft[] {
  if (!draft.steps) throw new Error("expected the draft's own steps");
  return draft.steps;
}

function messages(issues: ReturnType<typeof validateDraft>): string[] {
  return issues.map((issue) => issue.message);
}

function orgRow(over: Partial<NotificationSequenceConfig> = {}): NotificationSequenceConfig {
  return {
    id: "seq-1",
    orgId: "org-1",
    purpose: "intake_reminder",
    enabled: true,
    stopConditions: null,
    targetDaysToReady: null,
    compressTowardStartDate: null,
    sendHour: null,
    sendTimeZone: null,
    revision: 1,
    createdAt: "",
    updatedAt: "",
    updatedBy: null,
    steps: [],
    ...over,
  };
}

function orgStep(
  position: number,
  offsetDays: number,
  over: Partial<NotificationSequenceConfig["steps"][number]> = {},
) {
  return {
    id: `s${position}`,
    sequenceId: "seq-1",
    orgId: "org-1",
    position,
    offsetDays,
    channel: "email" as const,
    templateKey: "intake_reminder_first",
    ccRecipients: [],
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("starter and Minted's default steps", () => {
  it("starts switched off with every setting left to Minted's default", () => {
    expect(starterDraft()).toEqual({
      enabled: false,
      stopConditions: null,
      targetDaysToReady: null,
      steps: null,
    });
    expect(validateDraft("intake_reminder", starterDraft())).toEqual([]);
    expect(validateDraft("followup_digest", starterDraft())).toEqual([]);
  });

  it("customizes from Minted's default steps in position order, cc'ing no one", () => {
    const steps = stepsFromDefault(INTAKE_DEFAULT);
    expect(steps.map((s) => [s.offsetDays, s.templateKey])).toEqual([
      [2, "intake_reminder_first"],
      [4, "intake_reminder_second"],
      [7, "intake_reminder_final"],
    ]);
    expect(steps.every((s) => s.channel === "email" && s.ccRecipients.length === 0)).toBe(true);
    expect(validateDraft("intake_reminder", intake())).toEqual([]);
    expect(validateDraft("followup_digest", digest())).toEqual([]);
  });

  it("returns a fresh copy each time, so editing one draft never edits the default", () => {
    const a = intake();
    a.steps[0].ccRecipients.push({ kind: "role", role: "admin" });
    expect(intake().steps[0].ccRecipients).toEqual([]);
    expect(stepsFromDefault(INTAKE_DEFAULT)[0].ccRecipients).toEqual([]);
  });
});

describe("validateDraft: offsets", () => {
  it("requires offsets to strictly increase with position", () => {
    const draft = updateStep(intake(), 1, { offsetDays: 2 });
    expect(messages(validateDraft("intake_reminder", draft))).toEqual([
      "Step 2 must go out after step 1 (later than day 2).",
    ]);
  });

  it("rejects a blank, fractional, too-early or too-late offset", () => {
    expect(
      messages(validateDraft("intake_reminder", updateStep(intake(), 0, { offsetDays: null }))),
    ).toEqual(["Enter a whole number of days for step 1."]);
    expect(
      messages(validateDraft("intake_reminder", updateStep(intake(), 0, { offsetDays: 1.5 }))),
    ).toEqual(["Enter a whole number of days for step 1."]);
    expect(
      messages(validateDraft("intake_reminder", updateStep(intake(), 0, { offsetDays: 0 }))),
    ).toEqual(["Step 1 must be between day 1 and day 90."]);
    expect(
      messages(validateDraft("intake_reminder", updateStep(intake(), 2, { offsetDays: 91 }))),
    ).toEqual(["Step 3 must be between day 1 and day 90."]);
  });

  it("fixes the digest offset at 0", () => {
    const draft = updateStep(digest(), 0, { offsetDays: 1 });
    expect(messages(validateDraft("followup_digest", draft))).toEqual([
      "The daily digest is sent on day 0.",
    ]);
  });
});

describe("validateDraft: steps", () => {
  it("allows the digest exactly one step, and own steps are never empty", () => {
    const two: SequenceDraft = { ...digest(), steps: [...digest().steps, digest().steps[0]] };
    expect(messages(validateDraft("followup_digest", two))).toContain(
      "The daily digest has exactly one step.",
    );
    const none: SequenceDraft = { ...digest(), steps: [] };
    expect(messages(validateDraft("followup_digest", none))).toEqual([
      "Add at least one step, or use Minted's default steps.",
    ]);
  });

  it("caps intake at 10 steps", () => {
    const steps: StepDraft[] = Array.from({ length: 11 }, (_, i) => ({
      offsetDays: i + 1,
      channel: "email",
      templateKey: "intake_reminder_first",
      ccRecipients: [],
    }));
    expect(messages(validateDraft("intake_reminder", { ...intake(), steps }))).toEqual([
      "A sequence can have at most 10 steps.",
    ]);
  });

  it("requires a message from this purpose's selectable catalog", () => {
    expect(
      messages(
        validateDraft(
          "intake_reminder",
          updateStep(intake(), 0, { templateKey: "followup_digest_daily" }),
        ),
      ),
    ).toEqual(["Choose a message for step 1."]);
    // The bounce notice is a system message, never a step's own.
    expect(
      messages(
        validateDraft(
          "intake_reminder",
          updateStep(intake(), 0, { templateKey: "intake_reminder_bounce_notice" }),
        ),
      ),
    ).toEqual(["Choose a message for step 1."]);
  });

  it("checks the channel exists and the message has a body for it", () => {
    expect(
      messages(validateDraft("intake_reminder", updateStep(intake(), 0, { channel: "sms" }))),
    ).toEqual([]);
    expect(
      messages(
        validateDraft(
          "intake_reminder",
          updateStep(intake(), 0, { channel: "fax" as unknown as StepDraft["channel"] }),
        ),
      ),
    ).toContain("Choose a channel for step 1.");
    expect(
      messages(validateDraft("followup_digest", updateStep(digest(), 0, { channel: "sms" }))),
    ).toEqual(['"Daily follow-up digest" has no text message version.']);
  });
});

describe("validateDraft: cc recipients", () => {
  const withCc = (ccRecipients: StepDraft["ccRecipients"]) =>
    updateStep(intake(), 0, { ccRecipients });

  it("accepts an ordered mix of members and roles", () => {
    const draft = withCc([
      { kind: "user", userId: USER_A },
      { kind: "role", role: "admin" },
    ]);
    expect(validateDraft("intake_reminder", draft, { memberUserIds: new Set([USER_A]) })).toEqual(
      [],
    );
  });

  it("rejects duplicates, unknown roles, bad ids, non-members and more than 20", () => {
    expect(
      messages(
        validateDraft(
          "intake_reminder",
          withCc([
            { kind: "role", role: "admin" },
            { kind: "role", role: "admin" },
          ]),
        ),
      ),
    ).toEqual(["Step 1 lists the same member or role twice."]);
    expect(
      messages(
        validateDraft(
          "intake_reminder",
          withCc([{ kind: "role", role: "owner" as unknown as "admin" }]),
        ),
      ),
    ).toEqual(["Step 1 names a role that does not exist."]);
    expect(
      messages(validateDraft("intake_reminder", withCc([{ kind: "user", userId: "nope" }]))),
    ).toEqual(["Step 1 names a member that does not exist."]);
    expect(
      messages(
        validateDraft("intake_reminder", withCc([{ kind: "user", userId: STRANGER }]), {
          memberUserIds: new Set([USER_A]),
        }),
      ),
    ).toEqual(["Step 1 cc's someone who is no longer a member. Remove them to save."]);
    const many = Array.from({ length: 21 }, (_, i) => ({
      kind: "user" as const,
      userId: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
    }));
    expect(messages(validateDraft("intake_reminder", withCc(many)))).toEqual([
      "Step 1 can cc at most 20 members or roles.",
    ]);
  });

  it("refuses any cc on the digest, which goes to coordinators only (answer 2)", () => {
    const draft = updateStep(digest(), 0, { ccRecipients: [{ kind: "role", role: "admin" }] });
    expect(messages(validateDraft("followup_digest", draft))).toEqual([
      "The daily digest goes to coordinators only, so it has no cc list.",
    ]);
    expect(() => buildSavePayload("followup_digest", draft, null)).toThrow(/coordinators only/);
  });
});

describe("validateDraft: intake settings", () => {
  it("bounds an overridden target and validates overridden stop conditions", () => {
    expect(
      messages(validateDraft("intake_reminder", { ...intake(), targetDaysToReady: 0 })),
    ).toEqual(["Enter a target between 1 and 90 days, or leave it blank for Minted's default."]);
    expect(
      messages(validateDraft("intake_reminder", { ...intake(), targetDaysToReady: 2.5 })),
    ).toEqual(["Enter a target between 1 and 90 days, or leave it blank for Minted's default."]);
    expect(
      messages(
        validateDraft("intake_reminder", {
          ...intake(),
          stopConditions: ["submitted", "submitted"],
        }),
      ),
    ).toEqual(["Choose stop conditions from the list."]);
    expect(
      messages(
        validateDraft("intake_reminder", {
          ...intake(),
          stopConditions: ["bounced" as unknown as "submitted"],
        }),
      ),
    ).toEqual(["Choose stop conditions from the list."]);
    // Every condition is optional, "submitted" included (answer 1).
    expect(validateDraft("intake_reminder", { ...intake(), stopConditions: [] })).toEqual([]);
    expect(
      validateDraft("intake_reminder", {
        ...intake(),
        stopConditions: ["paused", "withdrawn", "provider_replied"],
      }),
    ).toEqual([]);
  });

  it("accepts leaving the target and stop conditions to Minted's default", () => {
    expect(
      validateDraft("intake_reminder", {
        ...intake(),
        targetDaysToReady: null,
        stopConditions: null,
      }),
    ).toEqual([]);
  });

  it("refuses intake-only settings on the digest", () => {
    expect(
      messages(
        validateDraft("followup_digest", {
          ...digest(),
          stopConditions: [],
          targetDaysToReady: 14,
        }),
      ),
    ).toEqual(["The daily digest has no stop conditions.", "The daily digest has no target."]);
  });
});

describe("reorder", () => {
  it("moves a step's message and keeps the offsets in place", () => {
    const draft = updateStep(intake(), 2, {
      channel: "sms",
      ccRecipients: [{ kind: "role", role: "admin" }],
    });
    const moved = own(moveStep(draft, 2, -1));
    expect(moved.map((s) => s.offsetDays)).toEqual([2, 4, 7]);
    expect(moved.map((s) => s.templateKey)).toEqual([
      "intake_reminder_first",
      "intake_reminder_final",
      "intake_reminder_second",
    ]);
    expect(moved[1]).toMatchObject({
      channel: "sms",
      ccRecipients: [{ kind: "role", role: "admin" }],
    });
    expect(validateDraft("intake_reminder", { ...intake(), steps: moved })).toEqual([]);
  });

  it("is a no-op past either end, on inherited steps, and never mutates its input", () => {
    const draft = intake();
    const snapshot = JSON.stringify(draft);
    expect(moveStep(draft, 0, -1)).toBe(draft);
    expect(moveStep(draft, 2, 1)).toBe(draft);
    moveStep(draft, 0, 1);
    expect(JSON.stringify(draft)).toBe(snapshot);
    const inherited = starterDraft();
    expect(moveStep(inherited, 0, 1)).toBe(inherited);
    expect(updateStep(inherited, 0, { offsetDays: 3 })).toBe(inherited);
    expect(addStep("intake_reminder", inherited)).toBe(inherited);
  });

  it("orders cc recipients: add appends, duplicates are ignored, move swaps, remove drops", () => {
    let step = intake().steps[0];
    step = addCcRecipient(step, { kind: "user", userId: USER_A });
    step = addCcRecipient(step, { kind: "role", role: "specialist" });
    step = addCcRecipient(step, { kind: "user", userId: USER_A });
    expect(step.ccRecipients).toEqual([
      { kind: "user", userId: USER_A },
      { kind: "role", role: "specialist" },
    ]);
    step = moveCcRecipient(step, 1, -1);
    expect(step.ccRecipients[0]).toEqual({ kind: "role", role: "specialist" });
    expect(moveCcRecipient(step, 1, 1)).toBe(step);
    step = removeCcRecipient(step, 0);
    expect(step.ccRecipients).toEqual([{ kind: "user", userId: USER_A }]);
  });

  it("adds a step three days after the last with the next unused message, up to the cap", () => {
    const removed = removeStep(intake(), 2);
    const added = own(addStep("intake_reminder", removed));
    expect(added.at(-1)).toEqual({
      offsetDays: 7,
      channel: "email",
      templateKey: "intake_reminder_final",
      ccRecipients: [],
    });
    const single = digest();
    expect(addStep("followup_digest", single)).toBe(single);
  });

  it("keeps the last own step: going back to Minted's steps is the way to drop them", () => {
    const one: SequenceDraft = { ...intake(), steps: [intake().steps[0]] };
    expect(removeStep(one, 0)).toBe(one);
  });
});

describe("stop conditions over Minted's default", () => {
  it("starts an override from the default set when the draft inherits", () => {
    const off = toggleStopCondition(starterDraft(), INTAKE_DEFAULT, "submitted", false);
    expect(off.stopConditions).toEqual(["paused", "withdrawn", "provider_replied"]);
    const back = toggleStopCondition(off, INTAKE_DEFAULT, "submitted", true);
    expect(back.stopConditions).toEqual([...ALL_STOPS]);
    // Equal to the default is still the org's own choice until it goes back.
    expect(back.stopConditions).not.toBeNull();
  });
});

describe("payload building", () => {
  it("builds the RPC payload in snake_case, in position order, cc order kept", () => {
    const draft = updateStep({ ...intake(), enabled: true }, 2, {
      ccRecipients: [
        { kind: "user", userId: USER_B },
        { kind: "role", role: "admin" },
      ],
    });
    expect(
      buildSavePayload("intake_reminder", draft, 3, { memberUserIds: new Set([USER_B]) }),
    ).toEqual({
      enabled: true,
      stop_conditions: [...ALL_STOPS],
      target_days_to_ready: 14,
      expected_revision: 3,
      steps: [
        {
          offset_days: 2,
          channel: "email",
          template_key: "intake_reminder_first",
          cc_recipients: [],
        },
        {
          offset_days: 4,
          channel: "email",
          template_key: "intake_reminder_second",
          cc_recipients: [],
        },
        {
          offset_days: 7,
          channel: "email",
          template_key: "intake_reminder_final",
          cc_recipients: [
            { kind: "user", user_id: USER_B },
            { kind: "role", role: "admin" },
          ],
        },
      ],
    });
  });

  it("sends null for every setting left to Minted's default, steps included", () => {
    expect(buildSavePayload("intake_reminder", { ...starterDraft(), enabled: true }, 4)).toEqual({
      enabled: true,
      stop_conditions: null,
      target_days_to_ready: null,
      expected_revision: 4,
      steps: null,
    });
  });

  it("never carries a platform-managed setting (answers 4 and 5)", () => {
    for (const payload of [
      buildSavePayload("intake_reminder", intake(), null),
      buildSavePayload("intake_reminder", starterDraft(), null),
      buildSavePayload("followup_digest", digest(), null),
    ]) {
      expect(Object.keys(payload).sort()).toEqual([
        "enabled",
        "expected_revision",
        "steps",
        "stop_conditions",
        "target_days_to_ready",
      ]);
    }
  });

  it("orders stop conditions canonically and sends null revision for a new row", () => {
    const draft = {
      ...intake(),
      stopConditions: ["provider_replied" as const, "submitted" as const],
    };
    const payload = buildSavePayload("intake_reminder", draft, null);
    expect(payload.stop_conditions).toEqual(["submitted", "provider_replied"]);
    expect(payload.expected_revision).toBeNull();
    // [] is a real choice (never stop early), not "use the default".
    expect(
      buildSavePayload("intake_reminder", { ...intake(), stopConditions: [] }, null),
    ).toMatchObject({ stop_conditions: [] });
  });

  it("sends no intake settings and no cc for the digest", () => {
    expect(buildSavePayload("followup_digest", digest(), null)).toEqual({
      enabled: false,
      stop_conditions: null,
      target_days_to_ready: null,
      expected_revision: null,
      steps: [
        {
          offset_days: 0,
          channel: "email",
          template_key: "followup_digest_daily",
          cc_recipients: [],
        },
      ],
    });
    expect(buildSavePayload("followup_digest", starterDraft(), 2)).toEqual({
      enabled: false,
      stop_conditions: null,
      target_days_to_ready: null,
      expected_revision: 2,
      steps: null,
    });
  });

  it("refuses to build a payload from an invalid draft", () => {
    expect(() =>
      buildSavePayload("intake_reminder", updateStep(intake(), 1, { offsetDays: 1 }), null),
    ).toThrow(/Invalid notification sequence/);
  });
});

describe("round trip", () => {
  it("drafts a saved config in position order and parses cc jsonb defensively", () => {
    const config = orgRow({
      stopConditions: ["submitted"],
      targetDaysToReady: 10,
      compressTowardStartDate: true,
      revision: 2,
      updatedBy: USER_A,
      steps: [
        orgStep(2, 5, {
          channel: "sms",
          templateKey: "intake_reminder_second",
          ccRecipients: [{ kind: "role", role: "billing" }],
        }),
        orgStep(1, 1),
      ],
    });
    const draft = draftFromSequence(config);
    expect(own(draft).map((s) => s.offsetDays)).toEqual([1, 5]);
    expect(draft.stopConditions).toEqual(["submitted"]);
    expect(draft.targetDaysToReady).toBe(10);
    // The platform-managed override is not in the draft: the card cannot send it.
    expect(Object.keys(draft).sort()).toEqual([
      "enabled",
      "steps",
      "stopConditions",
      "targetDaysToReady",
    ]);
    expect(draftsEqual(draft, draftFromSequence(config))).toBe(true);
    expect(draftsEqual(draft, updateStep(draft, 0, { offsetDays: 2 }))).toBe(false);

    expect(
      parseCcRecipients([
        { kind: "user", user_id: USER_A },
        { kind: "role", role: "admin" },
        { kind: "role", role: "owner" },
        { kind: "team", id: 1 },
        "admin",
      ]),
    ).toEqual([
      { kind: "user", userId: USER_A },
      { kind: "role", role: "admin" },
    ]);
    expect(parseCcRecipients(null)).toEqual([]);
  });

  it("drafts an org row with no own steps or settings as inheriting them", () => {
    const draft = draftFromSequence(orgRow());
    expect(draft).toEqual({ ...starterDraft(), enabled: true });
    expect(draftsEqual(draftFromSequence(orgRow({ enabled: false })), starterDraft())).toBe(true);
  });

  it("parses the cc picker's encoded choices", () => {
    expect(parseRecipientKey("role:billing")).toEqual({ kind: "role", role: "billing" });
    expect(parseRecipientKey(`user:${USER_A}`)).toEqual({ kind: "user", userId: USER_A });
    expect(parseRecipientKey("role:owner")).toBeNull();
    expect(parseRecipientKey("user:not-a-uuid")).toBeNull();
    expect(parseRecipientKey("nonsense")).toBeNull();
  });
});

describe("resolveNotificationSequence (answer 3: org row over Minted's default)", () => {
  it("gives an org with no row Minted's default, switched off", () => {
    const effective = resolveNotificationSequence("intake_reminder", undefined, INTAKE_DEFAULT);
    expect(effective).toEqual({
      purpose: "intake_reminder",
      enabled: false,
      steps: [
        {
          position: 1,
          offsetDays: 2,
          channel: "email",
          templateKey: "intake_reminder_first",
          ccRecipients: [],
        },
        {
          position: 2,
          offsetDays: 4,
          channel: "email",
          templateKey: "intake_reminder_second",
          ccRecipients: [],
        },
        {
          position: 3,
          offsetDays: 7,
          channel: "email",
          templateKey: "intake_reminder_final",
          ccRecipients: [],
        },
      ],
      stopConditions: [...ALL_STOPS],
      targetDaysToReady: 14,
      compressTowardStartDate: false,
      sendHour: null,
      sendTimeZone: null,
      inherited: {
        steps: true,
        stopConditions: true,
        targetDaysToReady: true,
        compressTowardStartDate: true,
        sendHour: false,
        sendTimeZone: false,
      },
    });
  });

  it("never inherits enabled: a default cannot switch an org on", () => {
    // Even a default carrying a stray enabled flag (it has no such column).
    const loud = { ...INTAKE_DEFAULT, enabled: true } as NotificationSequenceDefaultConfig;
    expect(resolveNotificationSequence("intake_reminder", undefined, loud).enabled).toBe(false);
    expect(
      resolveNotificationSequence("intake_reminder", orgRow({ enabled: false }), loud).enabled,
    ).toBe(false);
    expect(resolveNotificationSequence("intake_reminder", orgRow(), INTAKE_DEFAULT).enabled).toBe(
      true,
    );
  });

  it("inherits field by field: only what the org set is its own", () => {
    const effective = resolveNotificationSequence(
      "intake_reminder",
      orgRow({ targetDaysToReady: 21 }),
      INTAKE_DEFAULT,
    );
    expect(effective.targetDaysToReady).toBe(21);
    expect(effective.inherited.targetDaysToReady).toBe(false);
    expect(effective.stopConditions).toEqual([...ALL_STOPS]);
    expect(effective.inherited.stopConditions).toBe(true);
    expect(effective.steps.map((s) => s.offsetDays)).toEqual([2, 4, 7]);
    expect(effective.inherited.steps).toBe(true);
  });

  it("treats an empty stop list as the org's own choice, not as unset", () => {
    const effective = resolveNotificationSequence(
      "intake_reminder",
      orgRow({ stopConditions: [] }),
      INTAKE_DEFAULT,
    );
    expect(effective.stopConditions).toEqual([]);
    expect(effective.inherited.stopConditions).toBe(false);
  });

  it("uses the org's own steps, cc lists and order, when it has any", () => {
    const effective = resolveNotificationSequence(
      "intake_reminder",
      orgRow({
        steps: [
          orgStep(2, 9, { templateKey: "intake_reminder_final" }),
          orgStep(1, 3, { ccRecipients: [{ kind: "user", userId: USER_A }] }),
        ],
      }),
      INTAKE_DEFAULT,
    );
    expect(effective.inherited.steps).toBe(false);
    expect(effective.steps.map((s) => [s.position, s.offsetDays, s.templateKey])).toEqual([
      [1, 3, "intake_reminder_first"],
      [2, 9, "intake_reminder_final"],
    ]);
    expect(effective.steps[0].ccRecipients).toEqual([{ kind: "user", userId: USER_A }]);
  });

  it("keeps compression off unless Minted sets it (answer 4)", () => {
    expect(
      resolveNotificationSequence("intake_reminder", orgRow(), INTAKE_DEFAULT)
        .compressTowardStartDate,
    ).toBe(false);
    // A Mission Control override, written with the service key.
    const overridden = resolveNotificationSequence(
      "intake_reminder",
      orgRow({ compressTowardStartDate: true }),
      INTAKE_DEFAULT,
    );
    expect(overridden.compressTowardStartDate).toBe(true);
    expect(overridden.inherited.compressTowardStartDate).toBe(false);
  });

  it("gives the digest 8 am Central from Minted, an org override field by field, and no cc (answers 2 and 5)", () => {
    const inherited = resolveNotificationSequence("followup_digest", undefined, DIGEST_DEFAULT);
    expect(inherited).toMatchObject({
      sendHour: 8,
      sendTimeZone: "America/Chicago",
      stopConditions: [],
      targetDaysToReady: null,
      compressTowardStartDate: false,
      inherited: { sendHour: true, sendTimeZone: true, stopConditions: false },
    });
    const zoneOnly = resolveNotificationSequence(
      "followup_digest",
      orgRow({ purpose: "followup_digest", sendTimeZone: "America/New_York" }),
      DIGEST_DEFAULT,
    );
    expect([zoneOnly.sendHour, zoneOnly.sendTimeZone]).toEqual([8, "America/New_York"]);
    expect(zoneOnly.inherited).toMatchObject({ sendHour: true, sendTimeZone: false });
    // A digest step is never passed on with a cc, whatever the row says.
    const leaky = resolveNotificationSequence(
      "followup_digest",
      orgRow({
        purpose: "followup_digest",
        steps: [
          orgStep(1, 0, {
            templateKey: "followup_digest_daily",
            ccRecipients: [{ kind: "role", role: "admin" }],
          }),
        ],
      }),
      DIGEST_DEFAULT,
    );
    expect(leaky.steps[0].ccRecipients).toEqual([]);
  });

  it("gives intake no send time", () => {
    const effective = resolveNotificationSequence(
      "intake_reminder",
      orgRow({ sendHour: 6, sendTimeZone: "America/New_York" }),
      INTAKE_DEFAULT,
    );
    expect([effective.sendHour, effective.sendTimeZone]).toEqual([null, null]);
  });

  it("refuses rows for another purpose", () => {
    expect(() => resolveNotificationSequence("followup_digest", undefined, INTAKE_DEFAULT)).toThrow(
      RangeError,
    );
    expect(() =>
      resolveNotificationSequence(
        "intake_reminder",
        orgRow({ purpose: "followup_digest" }),
        INTAKE_DEFAULT,
      ),
    ).toThrow(RangeError);
  });

  it("feeds the schedule: Minted's default ignores a near start date while compression is off", () => {
    const effective = resolveNotificationSequence("intake_reminder", orgRow(), INTAKE_DEFAULT);
    const result = scheduleSequenceSends({
      offsets: effective.steps.map((s) => s.offsetDays),
      inviteDate: "2026-11-02",
      startDate: "2026-11-10",
      targetDaysToReady: effective.targetDaysToReady ?? 0,
      compressTowardStartDate: effective.compressTowardStartDate,
    });
    expect(result.compressed).toBe(false);
    expect(result.sends.map((s) => s.offsetDays)).toEqual([2, 4, 7]);
  });

  it("feeds the bounce rule: Minted's default steps escalate to no one", () => {
    const effective = resolveNotificationSequence("intake_reminder", undefined, INTAKE_DEFAULT);
    expect(bounceEscalationRecipients("intake_reminder", effective.steps, 1)).toEqual([]);
  });
});

describe("purpose rules", () => {
  it("gives the digest no cc list, no editable steps and a send time; intake the opposite", () => {
    expect(PURPOSE_RULES.followup_digest).toMatchObject({
      hasCcList: false,
      stepsEditable: false,
      hasSendTime: true,
      hasIntakeSettings: false,
    });
    expect(PURPOSE_RULES.intake_reminder).toMatchObject({
      hasCcList: true,
      stepsEditable: true,
      hasSendTime: false,
      hasIntakeSettings: true,
    });
  });
});

describe("send time (answer 5)", () => {
  it("reads 8 in America/Chicago as 8 am Central time", () => {
    expect(describeSendTime(8, "America/Chicago")).toBe("8 am Central time");
    expect(describeSendTime(0, "America/New_York")).toBe("12 am Eastern time");
    expect(describeSendTime(12, "America/Denver")).toBe("12 pm Mountain time");
    expect(describeSendTime(17, "America/Los_Angeles")).toBe("5 pm Pacific time");
  });

  it("names other zones from Intl, and an unknown one by its id", () => {
    expect(describeSendTime(9, "Europe/Paris")).toMatch(/^9 am .*European time$/);
    expect(describeSendTime(9, "Mars/Olympus_Mons")).toBe("9 am Mars/Olympus_Mons time");
  });

  it("says nothing when the hour or zone is missing or out of range", () => {
    expect(describeSendTime(null, "America/Chicago")).toBeNull();
    expect(describeSendTime(8, null)).toBeNull();
    expect(describeSendTime(24, "America/Chicago")).toBeNull();
    expect(describeSendTime(7.5, "America/Chicago")).toBeNull();
  });

  it("accepts IANA zone names only, with the database's pattern", () => {
    for (const zone of ["America/Chicago", "America/Argentina/Buenos_Aires", "Etc/UTC", "UTC"]) {
      expect(isIanaTimeZone(zone)).toBe(true);
    }
    for (const zone of ["CST", "EST5EDT", "+05:00", "america/chicago", "Mars/Olympus_Mons", ""]) {
      expect(isIanaTimeZone(zone)).toBe(false);
    }
    const migration = readFileSync(
      "supabase/migrations/20261031051500_notification_sequences.sql",
      "utf8",
    );
    expect(migration).toContain(`p_zone ~ '${IANA_TIME_ZONE_PATTERN.source.replace("\\/", "/")}'`);
  });
});

describe("read-only step lines", () => {
  it("describes intake steps by day and the digest as daily", () => {
    expect(
      describeStep("intake_reminder", {
        position: 1,
        offsetDays: 2,
        channel: "email",
        templateKey: "intake_reminder_first",
      }),
    ).toBe("Step 1 · day 2 after the invite · Email · First reminder");
    expect(
      describeStep("followup_digest", {
        position: 1,
        offsetDays: 0,
        channel: "email",
        templateKey: "followup_digest_daily",
      }),
    ).toBe("Step 1 · once a day · Email · Daily follow-up digest");
  });
});

describe("bounce rule (decision 4)", () => {
  const steps = [
    { position: 1, ccRecipients: [{ kind: "user" as const, userId: USER_A }] },
    { position: 2, ccRecipients: [{ kind: "role" as const, role: "admin" as const }] },
  ];

  it("escalates a step-1 intake bounce to step 1's cc list, in order", () => {
    expect(bounceEscalationRecipients("intake_reminder", steps, 1)).toEqual([
      { kind: "user", userId: USER_A },
    ]);
  });

  it("does not escalate a later bounce, or any digest bounce", () => {
    expect(bounceEscalationRecipients("intake_reminder", steps, 2)).toEqual([]);
    expect(bounceEscalationRecipients("followup_digest", steps, 1)).toEqual([]);
  });

  it("reaches no one when step 1 cc's no one", () => {
    expect(
      bounceEscalationRecipients("intake_reminder", [{ position: 1, ccRecipients: [] }], 1),
    ).toEqual([]);
  });
});

describe("scheduleSequenceSends (start-date compression)", () => {
  const base = {
    offsets: [2, 4, 7],
    inviteDate: "2026-11-02",
    targetDaysToReady: 14,
    compressTowardStartDate: true,
  };
  const days = (result: ReturnType<typeof scheduleSequenceSends>) =>
    result.sends.map((send) => send.sendOn);

  it("sends on the configured offsets when there is no start date", () => {
    const result = scheduleSequenceSends({ ...base, startDate: null });
    expect(result.compressed).toBe(false);
    expect(days(result)).toEqual(["2026-11-04", "2026-11-06", "2026-11-09"]);
    expect(result.readyBy).toBe("2026-11-16");
    expect(result.skipped).toEqual([]);
  });

  it("ignores the start date when compression is off", () => {
    const result = scheduleSequenceSends({
      ...base,
      compressTowardStartDate: false,
      startDate: "2026-11-05",
    });
    expect(result.compressed).toBe(false);
    expect(days(result)).toEqual(["2026-11-04", "2026-11-06", "2026-11-09"]);
    expect(result.readyBy).toBe("2026-11-16");
  });

  it("leaves the schedule alone when the start date is past the schedule's span", () => {
    // Start on day 20: the last useful day (19) is beyond the 14-day span.
    const result = scheduleSequenceSends({ ...base, startDate: "2026-11-22" });
    expect(result.compressed).toBe(false);
    expect(days(result)).toEqual(["2026-11-04", "2026-11-06", "2026-11-09"]);
    expect(result.readyBy).toBe("2026-11-16");
  });

  it("scales the offsets into the days before a near start date", () => {
    // Start on day 8 → last useful day 7 → scale by 7/14.
    const result = scheduleSequenceSends({ ...base, startDate: "2026-11-10" });
    expect(result.compressed).toBe(true);
    expect(result.sends.map((s) => s.offsetDays)).toEqual([1, 2, 3]);
    expect(days(result)).toEqual(["2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(result.readyBy).toBe("2026-11-09");
    expect(result.sends.map((s) => s.configuredOffsetDays)).toEqual([2, 4, 7]);
  });

  it("keeps each step at least a day after the previous one, skipping what no longer fits", () => {
    // Start on day 3 → last useful day 2: steps land on days 1 and 2; step 3 is skipped.
    const result = scheduleSequenceSends({ ...base, startDate: "2026-11-05" });
    expect(result.sends.map((s) => s.offsetDays)).toEqual([1, 2]);
    expect(result.skipped).toEqual([
      { position: 3, configuredOffsetDays: 7, reason: "start_date_reached" },
    ]);
    expect(result.readyBy).toBe("2026-11-04");
  });

  it("skips everything when the start date is tomorrow, today or already past", () => {
    for (const startDate of ["2026-11-03", "2026-11-02", "2026-10-30"]) {
      const result = scheduleSequenceSends({ ...base, startDate });
      expect(result.sends).toEqual([]);
      expect(result.skipped.map((s) => s.position)).toEqual([1, 2, 3]);
      expect(result.readyBy).toBe("2026-11-02");
    }
  });

  it("scales by the last offset when the schedule runs past the target", () => {
    // Offsets 3/10/20 with a 14-day target: span 20. Start on day 11 → D = 10.
    const result = scheduleSequenceSends({
      ...base,
      offsets: [3, 10, 20],
      startDate: "2026-11-13",
    });
    expect(result.sends.map((s) => s.offsetDays)).toEqual([1, 5, 10]);
    expect(result.readyBy).toBe("2026-11-12");
  });

  it("works across a month boundary and a DST change in date-only UTC math", () => {
    const result = scheduleSequenceSends({
      ...base,
      inviteDate: "2026-10-30",
      startDate: null,
    });
    expect(days(result)).toEqual(["2026-11-01", "2026-11-03", "2026-11-06"]);
  });

  it("rejects bad input instead of guessing", () => {
    expect(() => scheduleSequenceSends({ ...base, offsets: [4, 2] })).toThrow(RangeError);
    expect(() => scheduleSequenceSends({ ...base, inviteDate: "2026-02-30" })).toThrow(RangeError);
    expect(() => scheduleSequenceSends({ ...base, inviteDate: "11/02/2026" })).toThrow(RangeError);
    expect(() => scheduleSequenceSends({ ...base, targetDaysToReady: 0 })).toThrow(RangeError);
  });
});

describe("copy helpers", () => {
  it("describes offsets for the card's summary line", () => {
    expect(describeOffsets([2, 4, 7])).toBe("day 2, day 4 and day 7");
    expect(describeOffsets([0])).toBe("day 0");
    expect(describeOffsets([])).toBe("");
  });

  it("maps the RPC's RAISE codes to plain messages", () => {
    expect(saveErrorMessage("notification_sequence_conflict")).toMatch(/Someone else saved/);
    expect(saveErrorMessage("x notification_sequence_not_authorized y")).toBe(
      "Only admins can change notifications.",
    );
    expect(saveErrorMessage("notification_digest_has_no_cc")).toBe(
      "The daily digest goes to coordinators only, so it can't cc anyone.",
    );
    expect(saveErrorMessage("notification_platform_setting: send_hour")).toBe(
      "Minted sets that setting, so it can't be changed here.",
    );
    expect(saveErrorMessage("something else")).toMatch(/Couldn't save/);
  });

  it("mirrors the database bounds, and keeps no copy of Minted's default values", () => {
    expect(NOTIFICATION_LIMITS).toEqual({
      maxOffsetDays: 90,
      maxSteps: 10,
      maxCcRecipients: 20,
      minTargetDays: 1,
      maxTargetDays: 90,
    });
  });
});

describe("concurrent editors (reconcileWithServer)", () => {
  const config = (revision: number, offsets: number[]): NotificationSequenceConfig =>
    orgRow({
      enabled: false,
      stopConditions: ["submitted"],
      targetDaysToReady: 14,
      revision,
      steps: offsets.map((offsetDays, i) => orgStep(i + 1, offsetDays)),
    });
  const v1 = config(1, [2, 4]);
  const v2 = config(2, [3, 6]);

  it("is in sync while the server has the revision the draft started from", () => {
    expect(
      reconcileWithServer({
        base: v1,
        saved: v1,
        draft: draftFromSequence(v1),
        ownSavedRevision: null,
      }),
    ).toBe("in_sync");
    expect(
      reconcileWithServer({
        base: undefined,
        saved: undefined,
        draft: null,
        ownSavedRevision: null,
      }),
    ).toBe("in_sync");
  });

  it("follows the server when nothing unsaved would be lost", () => {
    // An untouched draft.
    expect(
      reconcileWithServer({
        base: v1,
        saved: v2,
        draft: draftFromSequence(v1),
        ownSavedRevision: null,
      }),
    ).toBe("adopt_server");
    // No draft open (the Set up button).
    expect(
      reconcileWithServer({ base: undefined, saved: v2, draft: null, ownSavedRevision: null }),
    ).toBe("adopt_server");
    // The edits already equal what the server now has.
    expect(
      reconcileWithServer({
        base: v1,
        saved: v2,
        draft: draftFromSequence(v2),
        ownSavedRevision: null,
      }),
    ).toBe("adopt_server");
    // This editor's own save.
    const edited = updateStep(draftFromSequence(v1), 0, { offsetDays: 1 });
    expect(reconcileWithServer({ base: v1, saved: v2, draft: edited, ownSavedRevision: 2 })).toBe(
      "adopt_server",
    );
  });

  it("keeps unsaved edits when another admin saved, including over a starter", () => {
    const edited = updateStep(draftFromSequence(v1), 0, { offsetDays: 1 });
    expect(
      reconcileWithServer({ base: v1, saved: v2, draft: edited, ownSavedRevision: null }),
    ).toBe("keep_draft");
    expect(reconcileWithServer({ base: v1, saved: v2, draft: edited, ownSavedRevision: 1 })).toBe(
      "keep_draft",
    );
    expect(
      reconcileWithServer({
        base: undefined,
        saved: v2,
        draft: { ...starterDraft(), enabled: true },
        ownSavedRevision: null,
      }),
    ).toBe("keep_draft");
  });
});

describe("step move focus", () => {
  it("keeps the same arrow so a second press continues the move", () => {
    expect(stepMoveFocusTarget(1, -1, 3)).toBe("up");
    expect(stepMoveFocusTarget(1, 1, 3)).toBe("down");
  });

  it("switches to the other arrow at the top or bottom, where the same one is disabled", () => {
    expect(stepMoveFocusTarget(0, -1, 3)).toBe("down");
    expect(stepMoveFocusTarget(2, 1, 3)).toBe("up");
  });
});

describe("cc labels while the member list loads", () => {
  const members = new Map([[USER_A, { userId: USER_A, name: "Jane Doe" }]]);

  it("says Former member only when the list has loaded", () => {
    expect(ccRecipientLabel({ kind: "user", userId: STRANGER }, members)).toBe("Former member");
    expect(ccRecipientLabel({ kind: "user", userId: STRANGER }, members, false)).toBe("Member");
    expect(ccRecipientLabel({ kind: "user", userId: USER_A }, members, false)).toBe("Jane Doe");
    expect(ccRecipientLabel({ kind: "role", role: "billing" }, members, false)).toBe(
      "All billing members",
    );
    expect(
      describeCcList(
        [
          { kind: "user", userId: STRANGER },
          { kind: "role", role: "admin" },
        ],
        members,
        false,
      ),
    ).toBe("Member, then All admins");
  });

  it("does not block a save on membership until the list has loaded", () => {
    const draft = updateStep(intake(), 0, {
      ccRecipients: [{ kind: "user", userId: STRANGER }],
    });
    expect(validateDraft("intake_reminder", draft)).toEqual([]);
    expect(
      validateDraft("intake_reminder", draft, { memberUserIds: new Set([USER_A]) }).map(
        (issue) => issue.field,
      ),
    ).toEqual(["ccRecipients"]);
  });
});

describe("conflict status", () => {
  it("treats SQLSTATE PT409 as the revision conflict whatever its text", () => {
    expect(saveErrorMessage("", "PT409")).toMatch(/Someone else saved/);
    expect(saveErrorMessage("anything", "PT409")).toMatch(/Someone else saved/);
    expect(saveErrorMessage("anything", "23514")).toMatch(/Couldn't save/);
  });
});
