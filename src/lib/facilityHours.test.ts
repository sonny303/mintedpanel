// E1.2 TE-11 — exhaustive coverage of the locked hours contract: round-trip
// encode/decode, the weekday quick-fill, close>open rejection, the
// no-split-shift invariant (one range per day by construction), and display
// formatting.
import { describe, expect, it } from "vitest";
import {
  DAY_KEYS,
  applyWeekdayDefault,
  decodeHours,
  emptyHoursDraft,
  encodeHours,
  formatTime12h,
  hoursSummary,
  isValidTime,
  validateHoursDraft,
} from "./facilityHours";

describe("encode/decode round-trip", () => {
  it("encodes the locked shape: open days carry open/close, closed days only status", () => {
    const draft = emptyHoursDraft();
    draft.mon = { open: true, openTime: "07:00", closeTime: "19:00" };
    const stored = encodeHours(draft);
    expect(stored.mon).toEqual({ status: "open", open: "07:00", close: "19:00" });
    expect(stored.tue).toEqual({ status: "closed" });
    expect(stored.sun).toEqual({ status: "closed" });
    // No split shifts by construction: exactly one range per open day.
    expect(Object.keys(stored.mon!)).toEqual(["status", "open", "close"]);
  });

  it("round-trips through decode", () => {
    const draft = applyWeekdayDefault("07:00", "19:00");
    expect(decodeHours(encodeHours(draft))).toEqual(draft);
  });

  it("decodes empty/malformed jsonb to a fully closed draft", () => {
    expect(decodeHours({})).toEqual(emptyHoursDraft());
    expect(decodeHours(null)).toEqual(emptyHoursDraft());
    expect(decodeHours("nonsense")).toEqual(emptyHoursDraft());
    // status open but missing times → treated as closed, not a crash.
    expect(decodeHours({ mon: { status: "open" } }).mon.open).toBe(false);
    expect(decodeHours({ mon: { status: "weird" } }).mon.open).toBe(false);
  });
});

describe("applyWeekdayDefault (quick-fill)", () => {
  it("opens Mon–Fri with the range and closes Sat/Sun", () => {
    const draft = applyWeekdayDefault("07:00", "19:00");
    for (const day of ["mon", "tue", "wed", "thu", "fri"] as const) {
      expect(draft[day]).toEqual({ open: true, openTime: "07:00", closeTime: "19:00" });
    }
    expect(draft.sat.open).toBe(false);
    expect(draft.sun.open).toBe(false);
  });

  it("leaves individual days editable afterward (pure value, no linkage)", () => {
    const draft = applyWeekdayDefault("07:00", "19:00");
    draft.thu = { open: true, openTime: "09:00", closeTime: "13:00" };
    expect(draft.wed.openTime).toBe("07:00");
    const stored = encodeHours(draft);
    expect(stored.thu).toEqual({ status: "open", open: "09:00", close: "13:00" });
    expect(stored.fri).toEqual({ status: "open", open: "07:00", close: "19:00" });
  });
});

describe("validation", () => {
  it("accepts valid 24h times and rejects malformed ones", () => {
    expect(isValidTime("07:00")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("7:00")).toBe(false);
    expect(isValidTime("07:60")).toBe(false);
    expect(isValidTime("")).toBe(false);
  });

  it("blocks close <= open", () => {
    const draft = emptyHoursDraft();
    draft.mon = { open: true, openTime: "09:00", closeTime: "09:00" };
    draft.tue = { open: true, openTime: "17:00", closeTime: "09:00" };
    const errors = validateHoursDraft(draft);
    expect(errors.mon).toMatch(/after opening/);
    expect(errors.tue).toMatch(/after opening/);
  });

  it("requires both times on an open day and ignores closed days", () => {
    const draft = emptyHoursDraft();
    draft.mon = { open: true, openTime: "", closeTime: "19:00" };
    draft.tue = { open: false, openTime: "bad", closeTime: "worse" };
    const errors = validateHoursDraft(draft);
    expect(errors.mon).toBeTruthy();
    expect(errors.tue).toBeUndefined();
    expect(Object.keys(errors)).toEqual(["mon"]);
  });

  it("passes a clean quick-filled draft", () => {
    expect(validateHoursDraft(applyWeekdayDefault("07:00", "19:00"))).toEqual({});
  });
});

describe("display formatting", () => {
  it("formats 24h storage as 12h display", () => {
    expect(formatTime12h("07:00")).toBe("7:00 AM");
    expect(formatTime12h("19:00")).toBe("7:00 PM");
    expect(formatTime12h("00:15")).toBe("12:15 AM");
    expect(formatTime12h("12:00")).toBe("12:00 PM");
  });

  it("summarizes the standard week compactly and counts irregular weeks", () => {
    expect(hoursSummary(encodeHours(applyWeekdayDefault("07:00", "19:00")))).toBe(
      "Mon–Fri 7:00 AM–7:00 PM",
    );
    const irregular = applyWeekdayDefault("07:00", "19:00");
    irregular.thu = { open: true, openTime: "09:00", closeTime: "13:00" };
    expect(hoursSummary(encodeHours(irregular))).toBe("Open 5 days/week");
    expect(hoursSummary({})).toBeNull();
    expect(hoursSummary(undefined)).toBeNull();
  });

  it("covers every day key exactly once", () => {
    expect(DAY_KEYS).toHaveLength(7);
    expect(new Set(DAY_KEYS).size).toBe(7);
  });
});
