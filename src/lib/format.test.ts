// MINT-75 — dates are the browser's local calendar day. Each block pins a zone
// (the runtime re-reads TZ when it changes), proves the zone took, then checks
// todayLocal (the default an activity is logged under) and fmtDate /
// fmtDateTime (the display) at instants whose UTC and local days differ.
// Calendar-only values must come out as the same day in every zone.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fmtDate, fmtDateTime, todayLocal } from "./format";

const priorTz = process.env.TZ;

function pinZone(zone: string) {
  beforeAll(() => {
    process.env.TZ = zone;
  });
}

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  if (priorTz === undefined) delete process.env.TZ;
  else process.env.TZ = priorTz;
});

const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);

describe("America/Denver", () => {
  pinZone("America/Denver");

  it("runs the zone the test pins", () => {
    // MDT is UTC-6 in October; if the runtime ignored TZ the rest is moot.
    expect(new Date("2026-10-19T12:00:00Z").getTimezoneOffset()).toBe(360);
  });

  it("11:25 PM on Oct 19 is still Oct 19, though UTC has rolled over", () => {
    const at = "2026-10-20T05:25:00Z";
    expect(utcDay(at)).toBe("2026-10-20");
    expect(todayLocal(new Date(at))).toBe("2026-10-19");
    expect(todayLocal(new Date("2026-10-20T06:00:00Z"))).toBe("2026-10-20");
  });

  it("todayLocal defaults to the clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T05:25:00Z"));
    expect(todayLocal()).toBe("2026-10-19");
  });

  it("renders a stored timestamp on the local day it happened", () => {
    // PostgREST's timestamptz shape, microseconds and all.
    expect(fmtDate("2026-10-20T05:25:00.123456+00:00")).toBe("Oct 19, 2026");
    expect(fmtDateTime("2026-10-20T05:25:00.123456+00:00")).toBe("Oct 19, 2026 · 11:25 PM");
  });

  it("leaves a calendar-only date on its own day", () => {
    expect(fmtDate("2026-10-19")).toBe("Oct 19, 2026");
  });

  it("spring forward (2026-03-08): the 23-hour day keeps both its edges", () => {
    expect(todayLocal(new Date("2026-03-08T06:59:00Z"))).toBe("2026-03-07");
    expect(todayLocal(new Date("2026-03-08T07:00:00Z"))).toBe("2026-03-08");
    expect(todayLocal(new Date("2026-03-09T05:59:00Z"))).toBe("2026-03-08");
    expect(todayLocal(new Date("2026-03-09T06:00:00Z"))).toBe("2026-03-09");
    expect(fmtDateTime("2026-03-08T09:30:00Z")).toBe("Mar 8, 2026 · 3:30 AM");
  });

  it("fall back (2026-11-01): the 25-hour day keeps both its edges", () => {
    expect(todayLocal(new Date("2026-11-01T05:59:00Z"))).toBe("2026-10-31");
    expect(todayLocal(new Date("2026-11-01T06:00:00Z"))).toBe("2026-11-01");
    expect(todayLocal(new Date("2026-11-02T06:59:00Z"))).toBe("2026-11-01");
    expect(todayLocal(new Date("2026-11-02T07:00:00Z"))).toBe("2026-11-02");
    // 1:30 AM happens twice: once in MDT, once in MST.
    expect(fmtDateTime("2026-11-01T07:30:00Z")).toBe("Nov 1, 2026 · 1:30 AM");
    expect(fmtDateTime("2026-11-01T08:30:00Z")).toBe("Nov 1, 2026 · 1:30 AM");
  });
});

describe("Pacific/Auckland", () => {
  pinZone("Pacific/Auckland");

  it("runs the zone the test pins", () => {
    // NZDT is UTC+13 in October.
    expect(new Date("2026-10-19T12:00:00Z").getTimezoneOffset()).toBe(-780);
  });

  it("is already Oct 20 while UTC is still Oct 19", () => {
    const at = "2026-10-19T11:30:00Z";
    expect(utcDay(at)).toBe("2026-10-19");
    expect(todayLocal(new Date(at))).toBe("2026-10-20");
    expect(todayLocal(new Date("2026-10-19T10:59:00Z"))).toBe("2026-10-19");
    expect(fmtDate(at)).toBe("Oct 20, 2026");
  });

  it("leaves a calendar-only date on its own day", () => {
    expect(fmtDate("2026-10-19")).toBe("Oct 19, 2026");
  });
});

describe("UTC", () => {
  pinZone("UTC");

  it("runs the zone the test pins", () => {
    expect(new Date("2026-10-19T12:00:00Z").getTimezoneOffset()).toBe(0);
  });

  it("local and UTC days are the same day", () => {
    const at = "2026-10-20T05:25:00Z";
    expect(todayLocal(new Date(at))).toBe(utcDay(at));
    expect(todayLocal(new Date("2026-10-19T23:59:59Z"))).toBe("2026-10-19");
    expect(fmtDate(at)).toBe("Oct 20, 2026");
  });

  it("leaves a calendar-only date on its own day", () => {
    expect(fmtDate("2026-10-19")).toBe("Oct 19, 2026");
  });
});
