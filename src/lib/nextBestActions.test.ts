// E2.3 TE-12 — the pure-module suite is the queue's primary coverage:
// ordering permutations across every TE-1 deadline source, documented
// tie-breakers, cadence boundaries (13/14/15 days since last touchpoint),
// the no-touch fallback to created_at, past start dates never ranking,
// no-signal entries ranking last, notes/system events not resetting the
// cadence clock, and the batch filter split.
import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  buildNextBestActions,
  filterQueueToRun,
  type NextBestActionsInput,
  type QueueCaseInput,
  type QueueTaskInput,
} from "@/lib/nextBestActions";

const TODAY = "2026-07-13";

const caseRow = (id: string, over: Partial<QueueCaseInput> = {}): QueueCaseInput => ({
  id,
  providerId: "pr-1",
  groupId: "g-1",
  payerId: "pay-1",
  state: "NC",
  credentialingStatusId: "st-open",
  facilityId: null,
  generationRunId: null,
  createdAt: "2026-07-01T00:00:00Z",
  ...over,
});

const taskRow = (caseId: string, over: Partial<QueueTaskInput> = {}): QueueTaskInput => ({
  caseId,
  title: "Submit application",
  status: "not_started",
  sortOrder: 0,
  dueDate: null,
  cadenceDays: null,
  ...over,
});

function baseInput(over: Partial<NextBestActionsInput> = {}): NextBestActionsInput {
  return {
    today: TODAY,
    cases: [],
    statusConfigs: [
      { id: "st-open", actionBucket: "ours" },
      { id: "st-done", actionBucket: "complete" },
    ],
    tasks: [],
    touches: [],
    providers: [
      { id: "pr-1", name: "Jane Whitaker", startDate: null },
      { id: "pr-2", name: "Marco Reyes", startDate: null },
    ],
    facilityAssignments: [],
    facilities: [],
    groups: [{ id: "g-1", name: "Group 1" }],
    payers: [{ id: "pay-1", name: "BCBS-NC" }],
    readiness: [],
    ...over,
  };
}

describe("addDaysIso", () => {
  it("adds days across month boundaries via UTC midnights", () => {
    expect(addDaysIso("2026-07-30", 14)).toBe("2026-08-13");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("open-case derivation (TE-3)", () => {
  it("emits one entry per open case; complete-bucket cases are excluded and status-less cases count as open", () => {
    const entries = buildNextBestActions(
      baseInput({
        cases: [
          caseRow("c-open"),
          caseRow("c-done", { credentialingStatusId: "st-done" }),
          caseRow("c-statusless", { credentialingStatusId: null }),
        ],
      }),
    );
    expect(entries.map((e) => e.caseId).sort()).toEqual(["c-open", "c-statusless"]);
  });

  it("a case never appears twice", () => {
    const entries = buildNextBestActions(
      baseInput({
        cases: [caseRow("c-1")],
        tasks: [
          taskRow("c-1", { title: "First", sortOrder: 0, dueDate: "2026-07-20" }),
          taskRow("c-1", { title: "Second", sortOrder: 1, dueDate: "2026-07-15" }),
        ],
      }),
    );
    expect(entries).toHaveLength(1);
  });
});

describe("deadline sources and ordering (TE-1/TE-2)", () => {
  it("TS-55 (default tiers re-stated by E6.1 F6.1.3): a task due date ranks above a provider start date, and the start-date entry's reason names it", () => {
    const entries = buildNextBestActions(
      baseInput({
        providers: [
          { id: "pr-1", name: "Jane Whitaker", startDate: null },
          { id: "pr-2", name: "Marco Reyes", startDate: addDaysIso(TODAY, 4) },
        ],
        cases: [
          caseRow("c-jane", { providerId: "pr-1" }),
          caseRow("c-marco", { providerId: "pr-2" }),
        ],
        tasks: [
          taskRow("c-jane", { dueDate: addDaysIso(TODAY, 10) }),
          taskRow("c-marco", { title: "Submit Marco's application" }),
        ],
      }),
    );
    // E6.1: the shipped default ranks the task_due group above provider_start
    // even when the start date is sooner (grouped tiers, not date-merged).
    expect(entries.map((e) => e.caseId)).toEqual(["c-jane", "c-marco"]);
    expect(entries[0].deadline?.source).toBe("task_due");
    expect(entries[1].deadline?.source).toBe("provider_start");
    expect(entries[1].reason).toContain("provider start date");
    expect(entries[1].action).toBe("Submit Marco's application");
  });

  it("TS-119 (E6.1 F6.1.3): the default order is overdue follow-ups → task due dates → provider start dates → the rest (launch dates)", () => {
    const entries = buildNextBestActions(
      baseInput({
        providers: [
          { id: "pr-1", name: "Jane Whitaker", startDate: null },
          { id: "pr-2", name: "Marco Reyes", startDate: addDaysIso(TODAY, 2) },
        ],
        facilities: [
          // Launches sooner than everything else — still ranks last (the
          // quiet lower-priority signal).
          { id: "f-1", name: "Shelby Central", effectiveDate: addDaysIso(TODAY, 1) },
        ],
        cases: [
          caseRow("c-follow", { providerId: "pr-1" }),
          caseRow("c-task", { providerId: "pr-1" }),
          caseRow("c-start", { providerId: "pr-2" }),
          caseRow("c-launch", { providerId: "pr-1", facilityId: "f-1" }),
        ],
        tasks: [taskRow("c-task", { dueDate: addDaysIso(TODAY, 9) })],
        touches: [
          {
            caseId: "c-follow",
            entryType: "touchpoint",
            touchDate: addDaysIso(TODAY, -3),
            nextFollowUpDate: addDaysIso(TODAY, -1),
          },
        ],
      }),
    );
    expect(entries.map((e) => e.caseId)).toEqual(["c-follow", "c-task", "c-start", "c-launch"]);
    expect(entries[0].deadline?.overdue).toBe(true);
  });

  it("a past provider start date never ranks (history, not a deadline)", () => {
    const entries = buildNextBestActions(
      baseInput({
        providers: [{ id: "pr-1", name: "Jane Whitaker", startDate: addDaysIso(TODAY, -3) }],
        cases: [caseRow("c-1")],
      }),
    );
    expect(entries[0].deadline).toBeNull();
  });

  it("falls back to the earliest FUTURE assignment start date only when the provider-level date is null", () => {
    const withNull = buildNextBestActions(
      baseInput({
        providers: [{ id: "pr-1", name: "Jane Whitaker", startDate: null }],
        facilityAssignments: [
          { providerId: "pr-1", facilityId: "f-1", startDate: addDaysIso(TODAY, -30) },
          { providerId: "pr-1", facilityId: "f-2", startDate: addDaysIso(TODAY, 9) },
          { providerId: "pr-1", facilityId: "f-3", startDate: addDaysIso(TODAY, 5) },
        ],
        cases: [caseRow("c-1")],
      }),
    );
    expect(withNull[0].deadline).toEqual({
      date: addDaysIso(TODAY, 5),
      source: "provider_start",
      overdue: false,
    });

    // A PAST provider-level date does not open the fallback — it is history.
    const withPast = buildNextBestActions(
      baseInput({
        providers: [{ id: "pr-1", name: "Jane Whitaker", startDate: addDaysIso(TODAY, -3) }],
        facilityAssignments: [
          { providerId: "pr-1", facilityId: "f-2", startDate: addDaysIso(TODAY, 9) },
        ],
        cases: [caseRow("c-1")],
      }),
    );
    expect(withPast[0].deadline).toBeNull();
  });

  it("ranks a future location launch date reachable via the case's facility or the provider's assignments", () => {
    const entries = buildNextBestActions(
      baseInput({
        facilities: [
          { id: "f-case", name: "Casa Clinic", effectiveDate: addDaysIso(TODAY, 6) },
          { id: "f-assigned", name: "Shelby Central", effectiveDate: addDaysIso(TODAY, 3) },
          { id: "f-past", name: "Old Site", effectiveDate: addDaysIso(TODAY, -10) },
        ],
        facilityAssignments: [
          { providerId: "pr-1", facilityId: "f-assigned", startDate: null },
          { providerId: "pr-1", facilityId: "f-past", startDate: null },
        ],
        cases: [caseRow("c-1", { facilityId: "f-case" })],
      }),
    );
    expect(entries[0].deadline).toEqual({
      date: addDaysIso(TODAY, 3),
      source: "launch_date",
      overdue: false,
    });
    expect(entries[0].reason).toContain("Shelby Central");
    expect(entries[0].reason).toContain("location launch date");
  });

  it("uses the earliest due date among OPEN tasks; completed tasks contribute no due date, and overdue dues still rank", () => {
    const entries = buildNextBestActions(
      baseInput({
        cases: [caseRow("c-1")],
        tasks: [
          taskRow("c-1", {
            title: "Done early",
            status: "completed",
            dueDate: addDaysIso(TODAY, -20),
          }),
          taskRow("c-1", { title: "Overdue form", sortOrder: 1, dueDate: addDaysIso(TODAY, -2) }),
          taskRow("c-1", { title: "Later form", sortOrder: 2, dueDate: addDaysIso(TODAY, 8) }),
        ],
      }),
    );
    expect(entries[0].deadline).toEqual({
      date: addDaysIso(TODAY, -2),
      source: "task_due",
      overdue: true,
    });
    expect(entries[0].reason).toContain("Overdue form");
  });

  it("ranks the explicit next_follow_up_date from the LATEST touchpoint; an arrived date renders the touch-due action", () => {
    const entries = buildNextBestActions(
      baseInput({
        cases: [caseRow("c-1")],
        touches: [
          {
            caseId: "c-1",
            entryType: "touchpoint",
            touchDate: addDaysIso(TODAY, -20),
            nextFollowUpDate: addDaysIso(TODAY, 30),
          },
          {
            caseId: "c-1",
            entryType: "touchpoint",
            touchDate: addDaysIso(TODAY, -5),
            nextFollowUpDate: addDaysIso(TODAY, -1),
          },
        ],
      }),
    );
    expect(entries[0].deadline).toEqual({
      date: addDaysIso(TODAY, -1),
      source: "follow_up",
      overdue: true,
    });
    expect(entries[0].actionKind).toBe("touch_due");
    expect(entries[0].action).toBe("Touch due — follow up with BCBS-NC");
  });

  it("a FUTURE follow-up date ranks the entry but does not render a touch-due action yet", () => {
    const entries = buildNextBestActions(
      baseInput({
        cases: [caseRow("c-1")],
        tasks: [taskRow("c-1", { title: "Prep the packet" })],
        touches: [
          {
            caseId: "c-1",
            entryType: "touchpoint",
            touchDate: addDaysIso(TODAY, -5),
            nextFollowUpDate: addDaysIso(TODAY, 2),
          },
        ],
      }),
    );
    expect(entries[0].deadline?.source).toBe("follow_up");
    expect(entries[0].actionKind).toBe("task");
    expect(entries[0].action).toBe("Prep the packet");
  });

  it("breaks a same-date tie between sources by the documented source order", () => {
    const date = addDaysIso(TODAY, 4);
    const entries = buildNextBestActions(
      baseInput({
        providers: [{ id: "pr-1", name: "Jane Whitaker", startDate: date }],
        cases: [caseRow("c-1")],
        tasks: [taskRow("c-1", { dueDate: date })],
      }),
    );
    expect(entries[0].deadline?.source).toBe("provider_start");
  });

  it("breaks same-date ties across cases by created_at (oldest first), then case id", () => {
    const due = addDaysIso(TODAY, 5);
    const entries = buildNextBestActions(
      baseInput({
        cases: [
          caseRow("c-b", { createdAt: "2026-07-02T00:00:00Z" }),
          caseRow("c-a", { createdAt: "2026-07-01T00:00:00Z" }),
          caseRow("c-c", { createdAt: "2026-07-02T00:00:00Z" }),
        ],
        tasks: [
          taskRow("c-a", { dueDate: due }),
          taskRow("c-b", { dueDate: due }),
          taskRow("c-c", { dueDate: due }),
        ],
      }),
    );
    expect(entries.map((e) => e.caseId)).toEqual(["c-a", "c-b", "c-c"]);
  });

  it("entries with no signal rank after ALL dated entries — the queue is total", () => {
    const entries = buildNextBestActions(
      baseInput({
        cases: [
          caseRow("c-undated", { createdAt: "2026-06-01T00:00:00Z" }),
          caseRow("c-dated", { createdAt: "2026-07-02T00:00:00Z" }),
        ],
        tasks: [taskRow("c-dated", { dueDate: addDaysIso(TODAY, 60) })],
      }),
    );
    expect(entries.map((e) => e.caseId)).toEqual(["c-dated", "c-undated"]);
    expect(entries[1].deadline).toBeNull();
    expect(entries[1].reason).toContain("No deadline signal");
  });
});

describe("cadence follow-ups (F2.3.3)", () => {
  const cadenceCase = (daysSinceTouch: number | null) =>
    baseInput({
      cases: [caseRow("c-1", { createdAt: "2026-06-13T00:00:00Z" })],
      tasks: [
        taskRow("c-1", {
          title: "Submit application",
          status: "completed",
          cadenceDays: 14,
        }),
      ],
      touches:
        daysSinceTouch === null
          ? []
          : [
              {
                caseId: "c-1",
                entryType: "touchpoint",
                touchDate: addDaysIso(TODAY, -daysSinceTouch),
                nextFollowUpDate: null,
              },
            ],
    });

  it("13/14/15-day boundaries: due tomorrow (not yet a touch-due action), due today, overdue", () => {
    const at13 = buildNextBestActions(cadenceCase(13))[0];
    expect(at13.deadline).toEqual({
      date: addDaysIso(TODAY, 1),
      source: "cadence",
      overdue: false,
    });
    expect(at13.actionKind).not.toBe("touch_due");

    const at14 = buildNextBestActions(cadenceCase(14))[0];
    expect(at14.deadline).toEqual({ date: TODAY, source: "cadence", overdue: false });
    expect(at14.actionKind).toBe("touch_due");

    const at15 = buildNextBestActions(cadenceCase(15))[0];
    expect(at15.deadline).toEqual({
      date: addDaysIso(TODAY, -1),
      source: "cadence",
      overdue: true,
    });
    expect(at15.actionKind).toBe("touch_due");
  });

  it("a case with no touch yet counts its cadence from created_at", () => {
    const entry = buildNextBestActions(cadenceCase(null))[0];
    // created 2026-06-13 + 14 days = 2026-06-27, overdue on 2026-07-13.
    expect(entry.deadline).toEqual({ date: "2026-06-27", source: "cadence", overdue: true });
    expect(entry.reason).toContain("no touch yet");
  });

  it("notes and system events never reset the cadence clock", () => {
    const input = cadenceCase(15);
    const withNote = buildNextBestActions({
      ...input,
      touches: [
        ...input.touches,
        { caseId: "c-1", entryType: "note", touchDate: TODAY, nextFollowUpDate: null },
        { caseId: "c-1", entryType: "system_event", touchDate: TODAY, nextFollowUpDate: null },
      ],
    })[0];
    expect(withNote.deadline).toEqual({
      date: addDaysIso(TODAY, -1),
      source: "cadence",
      overdue: true,
    });
  });

  it("TS-56: recording a touchpoint re-derives the touch-due entry away", () => {
    const overdue = buildNextBestActions(cadenceCase(15))[0];
    expect(overdue.actionKind).toBe("touch_due");
    expect(overdue.deadline?.overdue).toBe(true);

    const touched = buildNextBestActions(cadenceCase(0))[0];
    expect(touched.actionKind).not.toBe("touch_due");
    expect(touched.deadline).toEqual({
      date: addDaysIso(TODAY, 14),
      source: "cadence",
      overdue: false,
    });
  });

  it("cadence on a completed task still drives the rhythm, and the smallest cadence wins", () => {
    const input = cadenceCase(10);
    const entry = buildNextBestActions({
      ...input,
      tasks: [
        ...input.tasks,
        taskRow("c-1", { title: "Weekly check", sortOrder: 1, cadenceDays: 7 }),
      ],
    })[0];
    // last touch 10 days ago + min(14, 7) = 3 days overdue.
    expect(entry.deadline).toEqual({
      date: addDaysIso(TODAY, -3),
      source: "cadence",
      overdue: true,
    });
  });
});

describe("actions (TE-2/TE-5)", () => {
  it("a red-readiness case surfaces its open gap as the action (advisory — the entry still ranks by deadline)", () => {
    const entries = buildNextBestActions(
      baseInput({
        cases: [caseRow("c-1")],
        tasks: [taskRow("c-1", { dueDate: addDaysIso(TODAY, 5) })],
        readiness: [
          {
            providerId: "pr-1",
            groupId: "g-1",
            payerId: "pay-1",
            state: "NC",
            openGapLabels: ["NC license board-verified", "CAQH attested within 120 days"],
          },
        ],
      }),
    );
    expect(entries[0].actionKind).toBe("readiness_gap");
    expect(entries[0].action).toBe("Resolve readiness gap: NC license board-verified (+1 more)");
    expect(entries[0].deadline?.source).toBe("task_due");
  });

  it("a ready key (no open gaps) never renders a readiness action", () => {
    const entries = buildNextBestActions(
      baseInput({
        cases: [caseRow("c-1")],
        tasks: [taskRow("c-1", { title: "Submit the form" })],
        readiness: [
          { providerId: "pr-1", groupId: "g-1", payerId: "pay-1", state: "NC", openGapLabels: [] },
        ],
      }),
    );
    expect(entries[0].actionKind).toBe("task");
    expect(entries[0].action).toBe("Submit the form");
  });

  it("the action is the lowest-sort_order non-completed task; an open-task-less case gets the honest review fallback", () => {
    const entries = buildNextBestActions(
      baseInput({
        cases: [caseRow("c-tasks"), caseRow("c-bare", { createdAt: "2026-07-02T00:00:00Z" })],
        tasks: [
          taskRow("c-tasks", { title: "First step", sortOrder: 0 }),
          taskRow("c-tasks", { title: "Second step", sortOrder: 1 }),
          taskRow("c-bare", { title: "Already done", status: "completed" }),
        ],
      }),
    );
    const byId = new Map(entries.map((e) => [e.caseId, e]));
    expect(byId.get("c-tasks")?.action).toBe("First step");
    expect(byId.get("c-bare")?.actionKind).toBe("review");
    expect(byId.get("c-bare")?.action).toBe("Review case — no open tasks");
  });

  it("legacy NULL-group cases never match a readiness key and keep their task action", () => {
    const entries = buildNextBestActions(
      baseInput({
        cases: [caseRow("c-legacy", { groupId: null })],
        tasks: [taskRow("c-legacy", { title: "Legacy step" })],
        readiness: [
          {
            providerId: "pr-1",
            groupId: "g-1",
            payerId: "pay-1",
            state: "NC",
            openGapLabels: ["Facility in NC"],
          },
        ],
      }),
    );
    expect(entries[0].groupName).toBe("No group");
    expect(entries[0].actionKind).toBe("task");
  });
});

describe("batch filter (F2.3.2)", () => {
  it("filters to the run's entries; no run id returns the full queue", () => {
    const entries = buildNextBestActions(
      baseInput({
        cases: [
          caseRow("c-batch", { generationRunId: "run-1" }),
          caseRow("c-other", { createdAt: "2026-07-02T00:00:00Z" }),
        ],
      }),
    );
    expect(filterQueueToRun(entries, "run-1").map((e) => e.caseId)).toEqual(["c-batch"]);
    expect(filterQueueToRun(entries, undefined)).toHaveLength(2);
  });
});
