// E4.1 F4.1.3 additions to the E2.3 queue: follow-up carry-forward feeding
// the ranking and the overdue-follow-up reason + precedence. The old org
// ranking-config seam is GONE (E6.6 F6.6.6) — the shipped default order is
// the only order, pinned below.
import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  buildNextBestActions,
  type NextBestActionsInput,
  type QueueTouchInput,
} from "./nextBestActions";

const TODAY = "2026-07-15";

function input(partial: Partial<NextBestActionsInput>): NextBestActionsInput {
  return {
    today: TODAY,
    cases: [],
    statusConfigs: [],
    tasks: [],
    touches: [],
    providers: [],
    facilityAssignments: [],
    facilities: [],
    groups: [],
    payers: [],
    readiness: [],
    ...partial,
  };
}

function openCase(id: string, createdAt: string) {
  return {
    id,
    providerId: `pr-${id}`,
    groupId: null,
    payerId: `pay-${id}`,
    state: "NC",
    credentialingStatusId: null,
    facilityId: null,
    generationRunId: null,
    createdAt,
  };
}

describe("follow-up carry-forward into the queue (F4.1.2/TE-2)", () => {
  it("a date-less latest touch carries the prior follow-up forward", () => {
    const touches: QueueTouchInput[] = [
      {
        caseId: "c-1",
        entryType: "touchpoint",
        id: "t-set",
        touchDate: "2026-07-01",
        createdAt: "2026-07-01T09:00:00Z",
        nextFollowUpDate: addDaysIso(TODAY, -1), // overdue follow-up
        clearsFollowUp: false,
      },
      {
        caseId: "c-1",
        entryType: "touchpoint",
        id: "t-quick",
        touchDate: "2026-07-10",
        createdAt: "2026-07-10T09:00:00Z",
        nextFollowUpDate: null, // a quick "payer emailed" log — must NOT clear
        clearsFollowUp: false,
      },
    ];
    const entries = buildNextBestActions(
      input({ cases: [openCase("c-1", "2026-06-01")], touches }),
    );
    expect(entries[0].deadline?.source).toBe("follow_up");
    expect(entries[0].deadline?.overdue).toBe(true);
    expect(entries[0].reason).toContain("Follow-up overdue");
  });

  it("an explicit clears_follow_up ends the follow-up (no follow_up signal)", () => {
    const touches: QueueTouchInput[] = [
      {
        caseId: "c-1",
        entryType: "touchpoint",
        id: "t-set",
        touchDate: "2026-07-01",
        createdAt: "2026-07-01T09:00:00Z",
        nextFollowUpDate: addDaysIso(TODAY, -1),
        clearsFollowUp: false,
      },
      {
        caseId: "c-1",
        entryType: "touchpoint",
        id: "t-clear",
        touchDate: "2026-07-10",
        createdAt: "2026-07-10T09:00:00Z",
        nextFollowUpDate: null,
        clearsFollowUp: true,
      },
    ];
    const entries = buildNextBestActions(
      input({ cases: [openCase("c-1", "2026-06-01")], touches }),
    );
    expect(entries[0].deadline).toBeNull();
  });
});

describe("overdue-follow-up precedence — the fixed shipped ranking (F6.6.6)", () => {
  // c-task: an overdue task due yesterday. c-fu: an overdue follow-up yesterday.
  const overdueTask = {
    cases: [openCase("c-task", "2026-06-01"), openCase("c-fu", "2026-06-02")],
    tasks: [
      {
        caseId: "c-task",
        title: "File form",
        status: "not_started",
        sortOrder: 0,
        dueDate: addDaysIso(TODAY, -2),
        cadenceDays: null,
      },
    ],
    touches: [
      {
        caseId: "c-fu",
        entryType: "touchpoint",
        id: "t",
        touchDate: "2026-07-01",
        createdAt: "2026-07-01T00:00:00Z",
        nextFollowUpDate: addDaysIso(TODAY, -1),
        clearsFollowUp: false,
      } as QueueTouchInput,
    ],
  };

  it("the overdue follow-up outranks an even-earlier overdue task deadline", () => {
    const entries = buildNextBestActions(input(overdueTask));
    // c-fu's follow-up (day -1) is later-dated than c-task's due (day -2), yet
    // the arrived follow-up jumps the queue — the fixed shipped tier order.
    expect(entries.map((e) => e.caseId)).toEqual(["c-fu", "c-task"]);
  });
});
