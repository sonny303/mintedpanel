import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_LIMITS,
  addCcRecipient,
  addStep,
  bounceEscalationRecipients,
  buildSavePayload,
  describeOffsets,
  draftFromSequence,
  draftsEqual,
  moveCcRecipient,
  moveStep,
  parseCcRecipients,
  parseRecipientKey,
  removeCcRecipient,
  removeStep,
  saveErrorMessage,
  scheduleSequenceSends,
  starterDraft,
  updateStep,
  validateDraft,
  type NotificationSequenceConfig,
  type SequenceDraft,
  type StepDraft,
} from "./notificationSequences";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const STRANGER = "99999999-9999-4999-8999-999999999999";

function intake(): SequenceDraft {
  return starterDraft("intake_reminder");
}

function messages(issues: ReturnType<typeof validateDraft>): string[] {
  return issues.map((issue) => issue.message);
}

describe("starters", () => {
  it("suggests three emails on days 2, 4 and 7 for intake, off, cc empty, target 14", () => {
    const draft = intake();
    expect(draft.enabled).toBe(false);
    expect(draft.steps.map((s) => s.offsetDays)).toEqual([2, 4, 7]);
    expect(draft.steps.every((s) => s.channel === "email")).toBe(true);
    expect(draft.steps.every((s) => s.ccRecipients.length === 0)).toBe(true);
    expect(draft.targetDaysToReady).toBe(14);
    expect(draft.stopConditions).toEqual(["submitted", "paused", "withdrawn", "provider_replied"]);
    expect(validateDraft("intake_reminder", draft)).toEqual([]);
  });

  it("suggests one email at offset 0 for the digest, off, cc empty, no intake settings", () => {
    const draft = starterDraft("followup_digest");
    expect(draft.enabled).toBe(false);
    expect(draft.steps).toEqual([
      { offsetDays: 0, channel: "email", templateKey: "followup_digest_daily", ccRecipients: [] },
    ]);
    expect(draft.stopConditions).toEqual([]);
    expect(draft.targetDaysToReady).toBeNull();
    expect(draft.compressTowardStartDate).toBe(false);
    expect(validateDraft("followup_digest", draft)).toEqual([]);
  });

  it("returns a fresh copy each time, so editing one draft never edits the starter", () => {
    const a = intake();
    a.steps[0].ccRecipients.push({ kind: "role", role: "admin" });
    expect(intake().steps[0].ccRecipients).toEqual([]);
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
    const draft = updateStep(starterDraft("followup_digest"), 0, { offsetDays: 1 });
    expect(messages(validateDraft("followup_digest", draft))).toEqual([
      "The daily digest is sent on day 0.",
    ]);
  });
});

describe("validateDraft: steps", () => {
  it("allows the digest exactly one step", () => {
    const two: SequenceDraft = {
      ...starterDraft("followup_digest"),
      steps: [...starterDraft("followup_digest").steps, starterDraft("followup_digest").steps[0]],
    };
    expect(messages(validateDraft("followup_digest", two))).toContain(
      "The daily digest has exactly one step.",
    );
    const none: SequenceDraft = { ...starterDraft("followup_digest"), steps: [] };
    expect(messages(validateDraft("followup_digest", none))).toEqual(["Add at least one step."]);
  });

  it("caps intake at 10 steps", () => {
    let draft: SequenceDraft = { ...intake(), steps: [] };
    for (let i = 0; i < 11; i += 1) {
      draft = {
        ...draft,
        steps: [
          ...draft.steps,
          {
            offsetDays: i + 1,
            channel: "email",
            templateKey: "intake_reminder_first",
            ccRecipients: [],
          },
        ],
      };
    }
    expect(messages(validateDraft("intake_reminder", draft))).toEqual([
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
      messages(
        validateDraft(
          "followup_digest",
          updateStep(starterDraft("followup_digest"), 0, { channel: "sms" }),
        ),
      ),
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
});

describe("validateDraft: intake settings", () => {
  it("bounds the target and validates stop conditions", () => {
    expect(
      messages(validateDraft("intake_reminder", { ...intake(), targetDaysToReady: 0 })),
    ).toEqual(["Enter a target between 1 and 90 days."]);
    expect(
      messages(validateDraft("intake_reminder", { ...intake(), targetDaysToReady: null })),
    ).toEqual(["Enter a target between 1 and 90 days."]);
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
    // Every condition is optional (decision 4: configurable).
    expect(validateDraft("intake_reminder", { ...intake(), stopConditions: [] })).toEqual([]);
  });

  it("refuses intake-only settings on the digest", () => {
    const digest = starterDraft("followup_digest");
    expect(
      messages(
        validateDraft("followup_digest", {
          ...digest,
          stopConditions: ["submitted"],
          targetDaysToReady: 14,
          compressTowardStartDate: true,
        }),
      ),
    ).toEqual([
      "The daily digest has no stop conditions.",
      "The daily digest has no target.",
      "The daily digest has no start-date schedule.",
    ]);
  });
});

describe("reorder", () => {
  it("moves a step's message and keeps the offsets in place", () => {
    const draft = updateStep(intake(), 2, {
      channel: "sms",
      ccRecipients: [{ kind: "role", role: "admin" }],
    });
    const moved = moveStep(draft, 2, -1);
    expect(moved.steps.map((s) => s.offsetDays)).toEqual([2, 4, 7]);
    expect(moved.steps.map((s) => s.templateKey)).toEqual([
      "intake_reminder_first",
      "intake_reminder_final",
      "intake_reminder_second",
    ]);
    expect(moved.steps[1]).toMatchObject({
      channel: "sms",
      ccRecipients: [{ kind: "role", role: "admin" }],
    });
    expect(validateDraft("intake_reminder", moved)).toEqual([]);
  });

  it("is a no-op past either end and never mutates its input", () => {
    const draft = intake();
    const snapshot = JSON.stringify(draft);
    expect(moveStep(draft, 0, -1)).toBe(draft);
    expect(moveStep(draft, 2, 1)).toBe(draft);
    moveStep(draft, 0, 1);
    expect(JSON.stringify(draft)).toBe(snapshot);
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
    const added = addStep("intake_reminder", removed);
    expect(added.steps.at(-1)).toEqual({
      offsetDays: 7,
      channel: "email",
      templateKey: "intake_reminder_final",
      ccRecipients: [],
    });
    const digest = starterDraft("followup_digest");
    expect(addStep("followup_digest", digest)).toBe(digest);
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
      stop_conditions: ["submitted", "paused", "withdrawn", "provider_replied"],
      target_days_to_ready: 14,
      compress_toward_start_date: true,
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

  it("orders stop conditions canonically and sends null revision for a new row", () => {
    const draft = {
      ...intake(),
      stopConditions: ["provider_replied" as const, "submitted" as const],
    };
    const payload = buildSavePayload("intake_reminder", draft, null);
    expect(payload.stop_conditions).toEqual(["submitted", "provider_replied"]);
    expect(payload.expected_revision).toBeNull();
  });

  it("sends no intake settings for the digest", () => {
    expect(buildSavePayload("followup_digest", starterDraft("followup_digest"), null)).toEqual({
      enabled: false,
      stop_conditions: [],
      target_days_to_ready: null,
      compress_toward_start_date: false,
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
  });

  it("refuses to build a payload from an invalid draft", () => {
    expect(() =>
      buildSavePayload("intake_reminder", updateStep(intake(), 1, { offsetDays: 1 }), null),
    ).toThrow(/Invalid notification sequence/);
  });
});

describe("round trip", () => {
  it("drafts a saved config in position order and parses cc jsonb defensively", () => {
    const config: NotificationSequenceConfig = {
      id: "seq-1",
      orgId: "org-1",
      purpose: "intake_reminder",
      enabled: true,
      stopConditions: ["submitted"],
      targetDaysToReady: 10,
      compressTowardStartDate: false,
      revision: 2,
      createdAt: "2026-10-30T00:00:00Z",
      updatedAt: "2026-10-30T00:00:00Z",
      updatedBy: USER_A,
      steps: [
        {
          id: "s2",
          sequenceId: "seq-1",
          orgId: "org-1",
          position: 2,
          offsetDays: 5,
          channel: "sms",
          templateKey: "intake_reminder_second",
          ccRecipients: [{ kind: "role", role: "billing" }],
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "s1",
          sequenceId: "seq-1",
          orgId: "org-1",
          position: 1,
          offsetDays: 1,
          channel: "email",
          templateKey: "intake_reminder_first",
          ccRecipients: [],
          createdAt: "",
          updatedAt: "",
        },
      ],
    };
    const draft = draftFromSequence(config);
    expect(draft.steps.map((s) => s.offsetDays)).toEqual([1, 5]);
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

  it("parses the cc picker's encoded choices", () => {
    expect(parseRecipientKey("role:billing")).toEqual({ kind: "role", role: "billing" });
    expect(parseRecipientKey(`user:${USER_A}`)).toEqual({ kind: "user", userId: USER_A });
    expect(parseRecipientKey("role:owner")).toBeNull();
    expect(parseRecipientKey("user:not-a-uuid")).toBeNull();
    expect(parseRecipientKey("nonsense")).toBeNull();
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
    expect(saveErrorMessage("something else")).toMatch(/Couldn't save/);
  });

  it("mirrors the database bounds", () => {
    expect(NOTIFICATION_LIMITS).toEqual({
      maxOffsetDays: 90,
      maxSteps: 10,
      maxCcRecipients: 20,
      minTargetDays: 1,
      maxTargetDays: 90,
      defaultTargetDays: 14,
    });
  });
});
