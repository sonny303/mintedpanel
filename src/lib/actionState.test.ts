// Every priority-engine rule and the severity order, per the M2 build spec.
import { describe, expect, it } from "vitest";
import {
  ACTION_STATE_SEVERITY,
  STALLED_AFTER_DAYS,
  daysSilent,
  getActionState,
  worstActionState,
  type ActionStateInput,
} from "./actionState";

const NOW = new Date("2026-07-03T12:00:00Z");

function input(overrides: Partial<ActionStateInput> = {}): ActionStateInput {
  return {
    statusLabel: "In Progress",
    actionBucket: "waiting_payer",
    openTaskDueDates: [],
    lastTouchDate: "2026-07-01",
    createdAt: "2026-06-01",
    confirmedEffectiveDate: null,
    expectedEffectiveDate: null,
    now: NOW,
    ...overrides,
  };
}

describe("needs_action (rule 1)", () => {
  it("fires when the bucket is ours", () => {
    expect(getActionState(input({ actionBucket: "ours" }))).toBe("needs_action");
  });

  it("fires on an open task due today, regardless of bucket", () => {
    expect(getActionState(input({ openTaskDueDates: ["2026-07-03"] }))).toBe("needs_action");
  });

  it("fires on an overdue open task, regardless of bucket", () => {
    expect(
      getActionState(input({ actionBucket: "complete", openTaskDueDates: ["2026-06-20"] })),
    ).toBe("needs_action");
  });

  it("ignores open tasks due in the future and tasks with no due date", () => {
    expect(getActionState(input({ openTaskDueDates: ["2026-07-04", null] }))).toBe("on_track");
  });
});

describe("blocked (rule 2)", () => {
  it("fires for waiting_provider", () => {
    expect(getActionState(input({ actionBucket: "waiting_provider" }))).toBe("blocked");
  });

  it("loses to needs_action when an open task is overdue", () => {
    expect(
      getActionState(input({ actionBucket: "waiting_provider", openTaskDueDates: ["2026-07-01"] })),
    ).toBe("needs_action");
  });
});

describe("awaiting_effective (rule 3)", () => {
  it("fires for Approved with a future confirmed effective date", () => {
    expect(
      getActionState(
        input({
          statusLabel: "Approved",
          confirmedEffectiveDate: "2026-08-01",
        }),
      ),
    ).toBe("awaiting_effective");
  });

  it("falls back to the expected effective date when no confirmed date exists", () => {
    expect(
      getActionState(
        input({
          statusLabel: "Approved",
          expectedEffectiveDate: "2026-07-15",
        }),
      ),
    ).toBe("awaiting_effective");
  });

  it("prefers the confirmed date: past confirmed beats future expected", () => {
    expect(
      getActionState(
        input({
          statusLabel: "Approved",
          confirmedEffectiveDate: "2026-06-01",
          expectedEffectiveDate: "2026-08-01",
          lastTouchDate: "2026-07-02",
        }),
      ),
    ).toBe("on_track");
  });

  it("does not fire when the effective date is past, or the status is not Approved", () => {
    expect(
      getActionState(
        input({
          statusLabel: "Approved",
          confirmedEffectiveDate: "2026-06-01",
          lastTouchDate: "2026-07-02",
        }),
      ),
    ).toBe("on_track");
    expect(
      getActionState(input({ statusLabel: "Submitted", confirmedEffectiveDate: "2026-08-01" })),
    ).toBe("on_track");
  });

  it("fires for Approved with NO effective date (must never read as complete)", () => {
    expect(
      getActionState(
        input({
          statusLabel: "Approved",
          actionBucket: "complete",
          confirmedEffectiveDate: null,
          expectedEffectiveDate: null,
        }),
      ),
    ).toBe("awaiting_effective");
  });

  it("Approved with no effective date still loses to an overdue task (rule 1 wins)", () => {
    expect(
      getActionState(
        input({
          statusLabel: "Approved",
          actionBucket: "complete",
          confirmedEffectiveDate: null,
          expectedEffectiveDate: null,
          openTaskDueDates: ["2026-06-20"],
        }),
      ),
    ).toBe("needs_action");
  });

  it("does NOT fire for a pre-cred Approved case — pre-cred has no effective date", () => {
    expect(
      getActionState(
        input({
          statusLabel: "Approved",
          actionBucket: "complete",
          isPreCred: true,
          confirmedEffectiveDate: null,
          expectedEffectiveDate: null,
        }),
      ),
    ).toBe("complete");
  });
});

describe("stalled vs on_track (rules 4-5)", () => {
  it("stalls a waiting_payer case with no touch inside the threshold", () => {
    expect(getActionState(input({ lastTouchDate: "2026-06-01" }))).toBe("stalled");
  });

  it("stalls exactly at the threshold boundary", () => {
    const boundary = new Date(NOW);
    boundary.setDate(boundary.getDate() - STALLED_AFTER_DAYS);
    expect(getActionState(input({ lastTouchDate: boundary.toISOString().slice(0, 10) }))).toBe(
      "stalled",
    );
  });

  it("stays on_track one day inside the threshold", () => {
    const inside = new Date(NOW);
    inside.setDate(inside.getDate() - (STALLED_AFTER_DAYS - 1));
    expect(getActionState(input({ lastTouchDate: inside.toISOString().slice(0, 10) }))).toBe(
      "on_track",
    );
  });

  it("anchors on created_at when the case has never been touched", () => {
    expect(getActionState(input({ lastTouchDate: null, createdAt: "2026-06-01" }))).toBe("stalled");
    expect(getActionState(input({ lastTouchDate: null, createdAt: "2026-07-01" }))).toBe(
      "on_track",
    );
  });
});

describe("complete (rule 6)", () => {
  it("fires for the complete bucket with no overdue tasks", () => {
    expect(getActionState(input({ actionBucket: "complete" }))).toBe("complete");
  });
});

describe("unclassified statuses", () => {
  it("routes null/unknown buckets to needs_action so misconfiguration surfaces", () => {
    expect(getActionState(input({ actionBucket: null, statusLabel: null }))).toBe("needs_action");
    expect(getActionState(input({ actionBucket: "garbage" }))).toBe("needs_action");
  });
});

describe("severity order", () => {
  it("matches the spec: needs_action > blocked > stalled > awaiting_effective > on_track > complete", () => {
    expect(ACTION_STATE_SEVERITY).toEqual([
      "needs_action",
      "blocked",
      "stalled",
      "awaiting_effective",
      "on_track",
      "complete",
    ]);
  });

  it("worstActionState picks by severity and returns null for empty input", () => {
    expect(worstActionState(["complete", "on_track"])).toBe("on_track");
    expect(worstActionState(["on_track", "stalled", "awaiting_effective"])).toBe("stalled");
    expect(worstActionState(["stalled", "needs_action", "blocked"])).toBe("needs_action");
    expect(worstActionState([])).toBeNull();
  });
});

describe("daysSilent", () => {
  it("measures from the last touch, falling back to created_at", () => {
    expect(daysSilent({ lastTouchDate: "2026-06-18", createdAt: "2026-01-01" }, NOW)).toBe(15);
    expect(daysSilent({ lastTouchDate: null, createdAt: "2026-07-01" }, NOW)).toBe(2);
  });
});
