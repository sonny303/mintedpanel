import { describe, expect, it } from "vitest";
import { resolveActiveFollowUp } from "./followUps";
import * as digest from "./followUpDigest";
import {
  MAX_DIGEST_SECTION_ROWS,
  digestSlot,
  dueFollowUps,
  planFollowUpDigests,
  touchCanResolveFollowUp,
  zonedDateHour,
  type DigestCase,
  type DigestMember,
  type DigestTouchpoint,
  type FollowUpDigestPlanInput,
} from "./followUpDigest";

// MINT-108 digest rules. "Today" is the org's local date 2026-10-31 unless a
// test says otherwise.
const TODAY = "2026-10-31";
const BASE = "https://app.example.test";

const JANE = "11111111-1111-4111-8111-111111111111";
const OMAR = "22222222-2222-4222-8222-222222222222";
const ADA = "33333333-3333-4333-8333-333333333333";
const FORMER = "99999999-9999-4999-8999-999999999999";

function member(userId: string, first: string): DigestMember {
  return { userId, firstName: first, email: `${first.toLowerCase()}@example.test` };
}

const MEMBERS: DigestMember[] = [member(JANE, "Jane"), member(OMAR, "Omar"), member(ADA, "Ada")];

let caseSeq = 0;
function kase(overrides: Partial<DigestCase> = {}): DigestCase {
  caseSeq += 1;
  return {
    id: `case-${caseSeq}`,
    caseNumber: 1000 + caseSeq,
    assignedTo: JANE,
    caseStatus: "in_progress",
    providerName: `Provider ${caseSeq}`,
    payerName: "Aetna",
    ...overrides,
  };
}

let touchSeq = 0;
function touch(
  caseId: string,
  touchDate: string,
  nextFollowUpDate: string | null,
  clearsFollowUp = false,
): DigestTouchpoint {
  touchSeq += 1;
  return {
    id: `t-${String(touchSeq).padStart(4, "0")}`,
    caseId,
    touchDate,
    createdAt: `${touchDate}T12:00:00Z`,
    nextFollowUpDate,
    clearsFollowUp,
  };
}

function plan(overrides: Partial<FollowUpDigestPlanInput>) {
  return planFollowUpDigests({
    practiceName: "Shelby Rehab",
    today: TODAY,
    appBaseUrl: BASE,
    cases: [],
    touchpoints: [],
    members: MEMBERS,
    ...overrides,
  });
}

const CHICAGO = { sendHour: 8, sendTimeZone: "America/Chicago" };
const at = (iso: string) => new Date(iso);

describe("zonedDateHour: the org's wall clock", () => {
  it("reads the local date and hour in the zone, not the server's or UTC's", () => {
    // 04:30 UTC on Nov 1 is still Oct 31 in Chicago (CDT, UTC-5) and already
    // Nov 1 in Tokyo.
    expect(zonedDateHour(at("2026-11-01T04:30:00Z"), "America/Chicago")).toEqual({
      date: "2026-10-31",
      hour: 23,
    });
    expect(zonedDateHour(at("2026-10-31T23:30:00Z"), "Asia/Tokyo")).toEqual({
      date: "2026-11-01",
      hour: 8,
    });
    expect(zonedDateHour(at("2026-10-31T00:00:00Z"), "UTC")).toEqual({
      date: "2026-10-31",
      hour: 0,
    });
  });

  it("repeats the 1 am hour on the same date when DST ends (Chicago, Nov 1 2026)", () => {
    expect(zonedDateHour(at("2026-11-01T05:59:00Z"), "America/Chicago")).toEqual({
      date: "2026-11-01",
      hour: 0,
    });
    // 1:00 CDT, then 1:00 CST an hour later.
    expect(zonedDateHour(at("2026-11-01T06:00:00Z"), "America/Chicago").hour).toBe(1);
    expect(zonedDateHour(at("2026-11-01T07:00:00Z"), "America/Chicago")).toEqual({
      date: "2026-11-01",
      hour: 1,
    });
    expect(zonedDateHour(at("2026-11-01T08:00:00Z"), "America/Chicago").hour).toBe(2);
  });

  it("skips the 2 am hour when DST starts (Chicago, Mar 14 2027)", () => {
    expect(zonedDateHour(at("2027-03-14T07:00:00Z"), "America/Chicago").hour).toBe(1);
    expect(zonedDateHour(at("2027-03-14T08:00:00Z"), "America/Chicago")).toEqual({
      date: "2027-03-14",
      hour: 3,
    });
  });

  it("refuses a zone that is not an IANA name this runtime knows", () => {
    expect(() => zonedDateHour(at("2026-10-31T12:00:00Z"), "Mars/Olympus")).toThrow(RangeError);
    expect(() => zonedDateHour(at("2026-10-31T12:00:00Z"), "CST")).toThrow(RangeError);
  });
});

describe("digestSlot: the hour gate", () => {
  it("is not due before the send hour, and due at it and every hour after, the same local date", () => {
    // Oct 31 is CDT (UTC-5): 8 am Central is 13:00 UTC.
    expect(digestSlot(CHICAGO, at("2026-10-31T12:59:59Z"))).toEqual({
      due: false,
      localDate: "2026-10-31",
      localHour: 7,
    });
    expect(digestSlot(CHICAGO, at("2026-10-31T13:00:00Z"))).toEqual({
      due: true,
      localDate: "2026-10-31",
      localHour: 8,
    });
    // A run missed at 8 catches up at 9, and as late as 11 pm, same date.
    expect(digestSlot(CHICAGO, at("2026-10-31T14:00:00Z"))).toMatchObject({
      due: true,
      localDate: "2026-10-31",
    });
    expect(digestSlot(CHICAGO, at("2026-11-01T04:59:00Z"))).toEqual({
      due: true,
      localDate: "2026-10-31",
      localHour: 23,
    });
    // Local midnight starts the next date, not yet due.
    expect(digestSlot(CHICAGO, at("2026-11-01T05:00:00Z"))).toEqual({
      due: false,
      localDate: "2026-11-01",
      localHour: 0,
    });
  });

  it("follows the zone across DST ending: 8 am Central is 13:00 UTC on Oct 31, 14:00 UTC on Nov 1", () => {
    expect(digestSlot(CHICAGO, at("2026-11-01T13:00:00Z"))).toEqual({
      due: false,
      localDate: "2026-11-01",
      localHour: 7,
    });
    expect(digestSlot(CHICAGO, at("2026-11-01T14:00:00Z"))).toEqual({
      due: true,
      localDate: "2026-11-01",
      localHour: 8,
    });
    // A 1 am send hour is due in both 1 am hours, for the same local date.
    const oneAm = { sendHour: 1, sendTimeZone: "America/Chicago" };
    expect(digestSlot(oneAm, at("2026-11-01T06:00:00Z"))).toMatchObject({
      due: true,
      localDate: "2026-11-01",
    });
    expect(digestSlot(oneAm, at("2026-11-01T07:00:00Z"))).toMatchObject({
      due: true,
      localDate: "2026-11-01",
    });
  });

  it("follows the zone across DST starting, and a send hour that does not exist that day goes at the next hour", () => {
    expect(digestSlot(CHICAGO, at("2027-03-13T13:00:00Z"))).toMatchObject({ due: false });
    expect(digestSlot(CHICAGO, at("2027-03-13T14:00:00Z"))).toMatchObject({ due: true });
    expect(digestSlot(CHICAGO, at("2027-03-14T13:00:00Z"))).toMatchObject({
      due: true,
      localHour: 8,
    });
    const twoAm = { sendHour: 2, sendTimeZone: "America/Chicago" };
    expect(digestSlot(twoAm, at("2027-03-14T07:00:00Z"))).toMatchObject({
      due: false,
      localHour: 1,
    });
    expect(digestSlot(twoAm, at("2027-03-14T08:00:00Z"))).toEqual({
      due: true,
      localDate: "2027-03-14",
      localHour: 3,
    });
  });

  it("uses whichever hour and zone it is given (an org override or Minted's default)", () => {
    const now = at("2026-10-31T15:30:00Z");
    expect(digestSlot({ sendHour: 8, sendTimeZone: "America/Los_Angeles" }, now)).toEqual({
      due: true,
      localDate: "2026-10-31",
      localHour: 8,
    });
    expect(digestSlot({ sendHour: 11, sendTimeZone: "America/New_York" }, now)).toEqual({
      due: true,
      localDate: "2026-10-31",
      localHour: 11,
    });
    expect(digestSlot({ sendHour: 12, sendTimeZone: "America/New_York" }, now)).toMatchObject({
      due: false,
    });
    expect(digestSlot({ sendHour: 0, sendTimeZone: "UTC" }, now)).toMatchObject({ due: true });
  });

  it("is null for a send time it cannot use", () => {
    const now = at("2026-10-31T13:00:00Z");
    expect(digestSlot({ sendHour: null, sendTimeZone: "America/Chicago" }, now)).toBeNull();
    expect(digestSlot({ sendHour: 8, sendTimeZone: null }, now)).toBeNull();
    expect(digestSlot({ sendHour: 24, sendTimeZone: "America/Chicago" }, now)).toBeNull();
    expect(digestSlot({ sendHour: -1, sendTimeZone: "America/Chicago" }, now)).toBeNull();
    expect(digestSlot({ sendHour: 7.5, sendTimeZone: "America/Chicago" }, now)).toBeNull();
    expect(digestSlot({ sendHour: 8, sendTimeZone: "Mars/Olympus" }, now)).toBeNull();
  });
});

describe("dueFollowUps: what is listed", () => {
  it("lists overdue and due-today follow-ups, and leaves out upcoming and none", () => {
    const overdue = kase();
    const dueToday = kase();
    const upcoming = kase();
    const none = kase();
    const due = dueFollowUps(
      [overdue, dueToday, upcoming, none],
      [
        touch(overdue.id, "2026-10-20", "2026-10-28"),
        touch(dueToday.id, "2026-10-20", TODAY),
        touch(upcoming.id, "2026-10-20", "2026-11-01"),
        touch(none.id, "2026-10-20", null),
      ],
      TODAY,
    );
    expect(Object.fromEntries(due)).toEqual({
      [overdue.id]: { dueDate: "2026-10-28", status: "overdue" },
      [dueToday.id]: { dueDate: TODAY, status: "due_today" },
    });
  });

  it("measures overdue and due today against the local date it is given", () => {
    const c = kase();
    const touches = [touch(c.id, "2026-10-20", "2026-10-31")];
    expect(dueFollowUps([c], touches, "2026-10-31").get(c.id)?.status).toBe("due_today");
    expect(dueFollowUps([c], touches, "2026-11-01").get(c.id)?.status).toBe("overdue");
    expect(dueFollowUps([c], touches, "2026-10-30").has(c.id)).toBe(false);
  });

  it("uses the carry-forward reducer: a date-less touch keeps the follow-up, a clear ends it", () => {
    const carried = kase();
    const cleared = kase();
    const rescheduled = kase();
    const due = dueFollowUps(
      [carried, cleared, rescheduled],
      [
        touch(carried.id, "2026-10-20", "2026-10-25"),
        touch(carried.id, "2026-10-29", null),
        touch(cleared.id, "2026-10-20", "2026-10-25"),
        touch(cleared.id, "2026-10-29", null, true),
        touch(rescheduled.id, "2026-10-20", "2026-10-25"),
        touch(rescheduled.id, "2026-10-29", "2026-11-05"),
      ],
      TODAY,
    );
    expect([...due.keys()]).toEqual([carried.id]);
    expect(due.get(carried.id)).toEqual({ dueDate: "2026-10-25", status: "overdue" });
  });

  it("considers open cases only", () => {
    const approved = kase({ caseStatus: "approved" });
    const denied = kase({ caseStatus: "denied" });
    const stopped = kase({ caseStatus: "not_pursuing" });
    const legacy = kase({ caseStatus: "in_network" });
    const due = dueFollowUps(
      [approved, denied, stopped, legacy],
      [approved, denied, stopped, legacy].map((c) => touch(c.id, "2026-10-20", "2026-10-25")),
      TODAY,
    );
    expect(due.size).toBe(0);
  });

  it("refuses a today that is not a calendar date", () => {
    expect(() => dueFollowUps([], [], "2026-02-30")).toThrow(RangeError);
    expect(() => dueFollowUps([], [], "2026-10-31T00:00:00Z")).toThrow(RangeError);
  });
});

describe("touchCanResolveFollowUp: the touches read can skip the rest", () => {
  // Every sequence of up to four touches drawn from: a date, another date, a
  // date-less touch, a clear, with touch dates that tie. Reading only the
  // touches that set or clear a follow-up must give the reducer's same answer.
  const kinds = ["date_a", "date_b", "none", "clear"] as const;
  const sequences: (typeof kinds)[number][][] = [[]];
  for (let length = 1; length <= 4; length += 1) {
    for (const prefix of sequences.filter((seq) => seq.length === length - 1)) {
      for (const kind of kinds) sequences.push([...prefix, kind]);
    }
  }

  it.each([false, true])(
    "matches resolveActiveFollowUp over every touch (tied dates: %s)",
    (tied) => {
      let checked = 0;
      for (const seq of sequences) {
        const touches = seq.map((kind, i) => ({
          id: `t${i}`,
          touchDate: tied ? "2026-10-01" : `2026-10-0${i + 1}`,
          createdAt: `2026-10-01T0${i}:00:00Z`,
          nextFollowUpDate:
            kind === "date_a" ? "2026-10-20" : kind === "date_b" ? "2026-11-20" : null,
          clearsFollowUp: kind === "clear",
        }));
        expect(resolveActiveFollowUp(touches.filter(touchCanResolveFollowUp))).toEqual(
          resolveActiveFollowUp(touches),
        );
        checked += 1;
      }
      expect(checked).toBe(1 + 4 + 16 + 64 + 256);
    },
  );

  it("keeps exactly the touches that set or clear a follow-up", () => {
    const base = { nextFollowUpDate: null, clearsFollowUp: false };
    expect(touchCanResolveFollowUp(base)).toBe(false);
    expect(touchCanResolveFollowUp({ ...base, nextFollowUpDate: "2026-10-20" })).toBe(true);
    expect(touchCanResolveFollowUp({ ...base, clearsFollowUp: true })).toBe(true);
  });
});

describe("planFollowUpDigests", () => {
  it("sends a coordinator their own overdue and due-today rows, oldest overdue first", () => {
    const a = kase({ caseNumber: 2002 });
    const b = kase({ caseNumber: 2001 });
    const c = kase({ caseNumber: 2003 });
    const later = kase({ caseNumber: 2004 });
    const result = plan({
      cases: [a, b, c, later],
      touchpoints: [
        touch(a.id, "2026-10-01", TODAY),
        touch(b.id, "2026-10-01", "2026-10-29"),
        touch(c.id, "2026-10-01", "2026-10-20"),
        touch(later.id, "2026-10-01", "2026-11-02"),
      ],
    });
    expect(result.digests).toHaveLength(1);
    const [only] = result.digests;
    expect(only.recipientUserId).toBe(JANE);
    expect(only.email).toBe("jane@example.test");
    expect(only.data.followUps.rows.map((r) => [r.caseNumber, r.status])).toEqual([
      [2003, "overdue"],
      [2001, "overdue"],
      [2002, "due_today"],
    ]);
    expect(only.data.followUps).toMatchObject({ overdue: 2, dueToday: 1, more: 0 });
    expect(only.data.followUps.rows[0]).toEqual({
      caseNumber: 2003,
      caseLink: `${BASE}/cases/${c.id}`,
      providerName: c.providerName,
      payerName: "Aetna",
      dueDate: "2026-10-20",
      status: "overdue",
    });
    expect(only.data).toMatchObject({
      practiceName: "Shelby Rehab",
      recipientFirstName: "Jane",
      digestDate: TODAY,
      workQueueLink: `${BASE}/work`,
    });
  });

  it("gives each coordinator one email with only their own rows, in member order", () => {
    const janes = kase({ assignedTo: JANE });
    const omars = kase({ assignedTo: OMAR });
    const result = plan({
      cases: [omars, janes],
      touchpoints: [
        touch(janes.id, "2026-10-01", TODAY),
        touch(omars.id, "2026-10-01", "2026-10-02"),
      ],
    });
    expect(result.digests.map((d) => d.recipientUserId)).toEqual([JANE, OMAR]);
    expect(result.digests[0].data.followUps.rows.map((r) => r.caseNumber)).toEqual([
      janes.caseNumber,
    ]);
    expect(result.digests[1].data.followUps.rows.map((r) => r.caseNumber)).toEqual([
      omars.caseNumber,
    ]);
  });

  it("sends unassigned and former-member follow-ups to no one, and counts them", () => {
    const mine = kase({ assignedTo: JANE });
    const nobody = kase({ assignedTo: null });
    const leaver = kase({ assignedTo: FORMER });
    const notDue = kase({ assignedTo: null });
    const result = plan({
      cases: [mine, nobody, leaver, notDue],
      touchpoints: [
        ...[mine, nobody, leaver].map((c) => touch(c.id, "2026-10-01", "2026-10-30")),
        touch(notDue.id, "2026-10-01", "2026-11-30"),
      ],
    });
    // Ada is an admin with no cases: nothing, not even the unassigned rows.
    expect(result.digests.map((d) => d.recipientUserId)).toEqual([JANE]);
    expect(result.digests[0].data.followUps.rows.map((r) => r.caseNumber)).toEqual([
      mine.caseNumber,
    ]);
    expect(result.unassignedFollowUps).toBe(2);
    expect(JSON.stringify(result.digests)).not.toContain(nobody.id);
    expect(JSON.stringify(result.digests)).not.toContain(leaver.id);
  });

  it("suppresses a coordinator with nothing due, and plans nothing for a member with no case", () => {
    const upcoming = kase({ assignedTo: JANE });
    const closed = kase({ assignedTo: OMAR, caseStatus: "approved" });
    const result = plan({
      cases: [upcoming, closed],
      touchpoints: [
        touch(upcoming.id, "2026-10-01", "2026-11-10"),
        touch(closed.id, "2026-10-01", "2026-10-02"),
      ],
    });
    expect(result.digests).toEqual([]);
    // Only Jane coordinates an open case; Omar's is closed, Ada has none.
    expect(result.suppressed).toBe(1);
    expect(result.unassignedFollowUps).toBe(0);
  });

  it("caps the rows and counts the rest", () => {
    const cases = Array.from({ length: MAX_DIGEST_SECTION_ROWS + 7 }, () => kase());
    const result = plan({
      cases,
      touchpoints: cases.map((c) => touch(c.id, "2026-10-01", "2026-10-15")),
    });
    const { followUps } = result.digests[0].data;
    expect(followUps.rows).toHaveLength(MAX_DIGEST_SECTION_ROWS);
    expect(followUps.more).toBe(7);
    expect(followUps.overdue).toBe(MAX_DIGEST_SECTION_ROWS + 7);
  });

  it("carries only the declared fields: no case id, provider id, at-risk or team data", () => {
    const c = kase();
    const result = plan({ cases: [c], touchpoints: [touch(c.id, "2026-10-01", TODAY)] });
    const data = result.digests[0].data;
    expect(Object.keys(data).sort()).toEqual([
      "digestDate",
      "followUps",
      "practiceName",
      "recipientFirstName",
      "workQueueLink",
    ]);
    expect(Object.keys(data.followUps).sort()).toEqual(["dueToday", "more", "overdue", "rows"]);
    expect(Object.keys(data.followUps.rows[0]).sort()).toEqual([
      "caseLink",
      "caseNumber",
      "dueDate",
      "payerName",
      "providerName",
      "status",
    ]);
    expect(Object.keys(result).sort()).toEqual(["digests", "suppressed", "unassignedFollowUps"]);
  });

  it("exports no at-risk or cc routing (Sowmya, Oct 30)", () => {
    for (const gone of [
      "caseAtRisk",
      "AWAITING_DECISION_STATUSES",
      "resolveDigestCc",
      "memberDisplayName",
    ]) {
      expect(Object.hasOwn(digest, gone), gone).toBe(false);
    }
  });
});
