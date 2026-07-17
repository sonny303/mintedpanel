import { describe, expect, it } from "vitest";
import {
  followUpStatus,
  isFollowUpOverdue,
  resolveActiveFollowUp,
  type FollowUpTouch,
} from "./followUps";

// Terse builder — only the fields the reducer reads.
function tp(p: Partial<FollowUpTouch> & { id: string }): FollowUpTouch {
  return {
    touchDate: "2026-07-01",
    createdAt: "2026-07-01T00:00:00Z",
    nextFollowUpDate: null,
    clearsFollowUp: false,
    ...p,
  };
}

describe("resolveActiveFollowUp (F4.1.2 carry-forward)", () => {
  it("returns null when no touch ever set or cleared a follow-up", () => {
    expect(resolveActiveFollowUp([])).toBeNull();
    expect(
      resolveActiveFollowUp([tp({ id: "a" }), tp({ id: "b", touchDate: "2026-07-02" })]),
    ).toBeNull();
  });

  it("carries a date-less touch's follow-up FORWARD instead of clearing it", () => {
    // Older touch set a follow-up; a newer date-less touch must NOT clear it.
    const active = resolveActiveFollowUp([
      tp({ id: "set", touchDate: "2026-07-01", nextFollowUpDate: "2026-07-20" }),
      tp({ id: "dateless", touchDate: "2026-07-05" }),
    ]);
    expect(active).toEqual({ date: "2026-07-20", sourceTouchId: "set" });
  });

  it("takes the most recent touch that set a date", () => {
    const active = resolveActiveFollowUp([
      tp({ id: "old", touchDate: "2026-07-01", nextFollowUpDate: "2026-07-10" }),
      tp({ id: "new", touchDate: "2026-07-08", nextFollowUpDate: "2026-07-25" }),
      tp({ id: "dateless", touchDate: "2026-07-09" }),
    ]);
    expect(active).toEqual({ date: "2026-07-25", sourceTouchId: "new" });
  });

  it("clears ONLY via the explicit clears_follow_up flag", () => {
    const active = resolveActiveFollowUp([
      tp({ id: "set", touchDate: "2026-07-01", nextFollowUpDate: "2026-07-20" }),
      tp({ id: "clear", touchDate: "2026-07-06", clearsFollowUp: true }),
    ]);
    expect(active).toBeNull();
  });

  it("re-arms a follow-up set after a clear", () => {
    const active = resolveActiveFollowUp([
      tp({ id: "set1", touchDate: "2026-07-01", nextFollowUpDate: "2026-07-20" }),
      tp({ id: "clear", touchDate: "2026-07-06", clearsFollowUp: true }),
      tp({ id: "set2", touchDate: "2026-07-10", nextFollowUpDate: "2026-07-30" }),
    ]);
    expect(active).toEqual({ date: "2026-07-30", sourceTouchId: "set2" });
  });

  it("breaks same-day ties by created_at DESC then id DESC", () => {
    // All same touch_date; the latest created_at wins.
    const byCreatedAt = resolveActiveFollowUp([
      tp({
        id: "early",
        touchDate: "2026-07-01",
        createdAt: "2026-07-01T09:00:00Z",
        nextFollowUpDate: "2026-07-10",
      }),
      tp({
        id: "late",
        touchDate: "2026-07-01",
        createdAt: "2026-07-01T17:00:00Z",
        clearsFollowUp: true,
      }),
    ]);
    expect(byCreatedAt).toBeNull(); // the later clear wins over the earlier set

    // Same touch_date AND created_at → id DESC decides.
    const byId = resolveActiveFollowUp([
      tp({
        id: "aaa",
        touchDate: "2026-07-01",
        createdAt: "2026-07-01T09:00:00Z",
        nextFollowUpDate: "2026-07-10",
      }),
      tp({
        id: "zzz",
        touchDate: "2026-07-01",
        createdAt: "2026-07-01T09:00:00Z",
        nextFollowUpDate: "2026-07-15",
      }),
    ]);
    expect(byId).toEqual({ date: "2026-07-15", sourceTouchId: "zzz" });
  });

  it("treats a row that both clears and carries a date as a clear", () => {
    const active = resolveActiveFollowUp([
      tp({
        id: "both",
        touchDate: "2026-07-05",
        nextFollowUpDate: "2026-07-20",
        clearsFollowUp: true,
      }),
    ]);
    expect(active).toBeNull();
  });

  it("is order-independent of the input array", () => {
    const rows = [
      tp({ id: "dateless", touchDate: "2026-07-09" }),
      tp({ id: "new", touchDate: "2026-07-08", nextFollowUpDate: "2026-07-25" }),
      tp({ id: "old", touchDate: "2026-07-01", nextFollowUpDate: "2026-07-10" }),
    ];
    const a = resolveActiveFollowUp(rows);
    const b = resolveActiveFollowUp([...rows].reverse());
    expect(a).toEqual(b);
    expect(a?.date).toBe("2026-07-25");
  });
});

describe("followUpStatus (F4.1.3 overdue detection)", () => {
  it("classifies overdue / due today / upcoming / none", () => {
    const today = "2026-07-15";
    expect(followUpStatus("2026-07-10", today)).toBe("overdue");
    expect(followUpStatus("2026-07-15", today)).toBe("due_today");
    expect(followUpStatus("2026-07-20", today)).toBe("upcoming");
    expect(followUpStatus(null, today)).toBe("none");
    expect(isFollowUpOverdue("2026-07-10", today)).toBe(true);
    expect(isFollowUpOverdue("2026-07-15", today)).toBe(false);
  });
});
