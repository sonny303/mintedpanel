import { describe, expect, it } from "vitest";
import { caseDaysOpen } from "./caseAge";

// Offset-less timestamps parse as local time, so these hold in any CI timezone.
const now = new Date(2026, 9, 19, 23, 25); // Oct 19, 2026, 11:25 PM local

describe("caseDaysOpen", () => {
  it("is 0 on the day the case was created", () => {
    expect(caseDaysOpen("2026-10-19T08:00:00", now)).toBe(0);
  });

  it("counts calendar days since creation", () => {
    expect(caseDaysOpen("2026-09-27T12:00:00", now)).toBe(22);
  });

  it("counts calendar days, not 24-hour periods", () => {
    const nextMorning = new Date(2026, 9, 20, 1, 0);
    expect(caseDaysOpen("2026-10-19T23:00:00", nextMorning)).toBe(1);
  });

  it("reads offset timestamps (as the database returns them) on the local calendar", () => {
    const createdLateEvening = new Date(2026, 9, 19, 23, 0).toISOString();
    const nextMorning = new Date(2026, 9, 20, 1, 0);
    expect(caseDaysOpen(createdLateEvening, nextMorning)).toBe(1);
  });

  it("never goes negative when the creation time is ahead of the clock", () => {
    expect(caseDaysOpen("2026-10-21T09:00:00", now)).toBe(0);
  });
});
