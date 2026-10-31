import { describe, expect, it } from "vitest";
import type { NotificationCcRecipient } from "@/types";
import {
  MAX_DIGEST_SECTION_ROWS,
  caseAtRisk,
  dueFollowUps,
  memberDisplayName,
  planFollowUpDigests,
  resolveDigestCc,
  type DigestCase,
  type DigestMember,
  type DigestTouchpoint,
  type FollowUpDigestPlanInput,
} from "./followUpDigest";

// MINT-108 digest rules. "Today" is the UTC day 2026-10-31 throughout.
const TODAY = "2026-10-31";
const BASE = "https://app.example.test";

const JANE = "11111111-1111-4111-8111-111111111111";
const OMAR = "22222222-2222-4222-8222-222222222222";
const ADA = "33333333-3333-4333-8333-333333333333";
const FORMER = "99999999-9999-4999-8999-999999999999";

function member(userId: string, role: string, first: string, last: string): DigestMember {
  return {
    userId,
    role,
    firstName: first,
    lastName: last,
    fullName: `${first} ${last}`,
    email: `${first.toLowerCase()}@example.test`,
  };
}

const MEMBERS: DigestMember[] = [
  member(JANE, "specialist", "Jane", "Doe"),
  member(OMAR, "specialist", "Omar", "Ali"),
  member(ADA, "admin", "Ada", "Admin"),
];

let caseSeq = 0;
function kase(overrides: Partial<DigestCase> = {}): DigestCase {
  caseSeq += 1;
  return {
    id: `case-${caseSeq}`,
    caseNumber: 1000 + caseSeq,
    assignedTo: JANE,
    caseStatus: "in_progress",
    submittedDate: null,
    providerName: `Provider ${caseSeq}`,
    payerName: "Aetna",
    avgDecisionDays: null,
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
    ccRecipients: [],
    ...overrides,
  });
}

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

describe("caseAtRisk", () => {
  const submitted = (
    submittedDate: string | null,
    avgDecisionDays: number | null,
    caseStatus = "submitted",
  ) => caseAtRisk({ caseStatus, submittedDate, avgDecisionDays }, TODAY);

  it("flags a case past the payer's usual decision time, with its days", () => {
    // Aug 30 to Oct 31 is 62 days.
    expect(submitted("2026-08-30", 45)).toEqual({ daysSinceSubmission: 62, avgDecisionDays: 45 });
    expect(submitted("2026-08-30", 45, "in_review")).toEqual({
      daysSinceSubmission: 62,
      avgDecisionDays: 45,
    });
  });

  it("does not flag a case inside or exactly at the usual decision time", () => {
    expect(submitted("2026-10-01", 45)).toBeNull();
    // Sep 16 to Oct 31 is exactly 45 days: not yet past it.
    expect(submitted("2026-09-16", 45)).toBeNull();
    expect(submitted("2026-09-15", 45)).toEqual({ daysSinceSubmission: 46, avgDecisionDays: 45 });
  });

  it("has no flag when the payer has no avg_decision_days, or a meaningless one", () => {
    expect(submitted("2026-01-01", null)).toBeNull();
    expect(submitted("2026-01-01", 0)).toBeNull();
    expect(submitted("2026-01-01", -5)).toBeNull();
    expect(submitted("2026-01-01", 2.5)).toBeNull();
  });

  it("has no flag without a usable submission date, or before the case waits on the payer", () => {
    expect(submitted(null, 45)).toBeNull();
    expect(submitted("2026-13-01", 45)).toBeNull();
    expect(submitted("2026-11-05", 45)).toBeNull();
    for (const status of ["not_started", "in_progress", "action_required", "approved", "denied"]) {
      expect(submitted("2026-01-01", 45, status)).toBeNull();
    }
  });
});

describe("resolveDigestCc", () => {
  it("resolves users and roles in order, once each, and drops former members", () => {
    const cc: NotificationCcRecipient[] = [
      { kind: "user", userId: OMAR },
      { kind: "user", userId: FORMER },
      { kind: "role", role: "specialist" },
      { kind: "role", role: "billing" },
      { kind: "role", role: "admin" },
    ];
    expect(resolveDigestCc(cc, MEMBERS)).toEqual({
      userIds: [OMAR, JANE, ADA],
      droppedFormerMembers: 1,
    });
  });
});

describe("memberDisplayName", () => {
  it("prefers first and last, then the stored full name, then the email", () => {
    expect(memberDisplayName(member(JANE, "admin", " Jane ", "Doe"))).toBe("Jane Doe");
    expect(memberDisplayName({ ...member(JANE, "admin", "", ""), fullName: "J. Doe" })).toBe(
      "J. Doe",
    );
    expect(
      memberDisplayName({
        ...member(JANE, "admin", "", ""),
        fullName: null,
        email: "jane@example.test",
      }),
    ).toBe("jane@example.test");
    expect(
      memberDisplayName({
        userId: JANE,
        role: "admin",
        firstName: null,
        lastName: null,
        fullName: null,
        email: null,
      }),
    ).toBe("Unnamed member");
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
    const [digest] = result.digests;
    expect(digest.recipientUserId).toBe(JANE);
    expect(digest.email).toBe("jane@example.test");
    expect(digest.data.own.rows.map((r) => [r.caseNumber, r.status])).toEqual([
      [2003, "overdue"],
      [2001, "overdue"],
      [2002, "due_today"],
    ]);
    expect(digest.data.own).toMatchObject({ overdue: 2, dueToday: 1, atRisk: 0, more: 0 });
    expect(digest.data.own.rows[0]).toEqual({
      caseNumber: 2003,
      caseLink: `${BASE}/cases/${c.id}`,
      providerName: c.providerName,
      payerName: "Aetna",
      dueDate: "2026-10-20",
      status: "overdue",
      atRisk: null,
    });
    expect(digest.data).toMatchObject({
      practiceName: "Shelby Rehab",
      recipientFirstName: "Jane",
      digestDate: TODAY,
      workQueueLink: `${BASE}/work`,
      team: [],
    });
    expect(digest.data.unassigned.rows).toEqual([]);
  });

  it("flags at-risk rows on and off, and never for a payer without avg_decision_days", () => {
    const late = kase({
      caseStatus: "submitted",
      submittedDate: "2026-08-30",
      avgDecisionDays: 45,
    });
    const fresh = kase({
      caseStatus: "submitted",
      submittedDate: "2026-10-20",
      avgDecisionDays: 45,
    });
    const unknown = kase({
      caseStatus: "submitted",
      submittedDate: "2026-01-01",
      avgDecisionDays: null,
    });
    const result = plan({
      cases: [late, fresh, unknown],
      touchpoints: [late, fresh, unknown].map((c) => touch(c.id, "2026-10-01", "2026-10-30")),
    });
    const rows = result.digests[0].data.own.rows;
    const byNumber = new Map(rows.map((r) => [r.caseNumber, r.atRisk]));
    expect(byNumber.get(late.caseNumber)).toEqual({ daysSinceSubmission: 62, avgDecisionDays: 45 });
    expect(byNumber.get(fresh.caseNumber)).toBeNull();
    expect(byNumber.get(unknown.caseNumber)).toBeNull();
    expect(result.digests[0].data.own.atRisk).toBe(1);
  });

  it("routes unassigned and former-member cases to the cc'd members only, in an Unassigned section", () => {
    const mine = kase({ assignedTo: JANE });
    const nobody = kase({ assignedTo: null });
    const leaver = kase({ assignedTo: FORMER });
    const touches = [mine, nobody, leaver].map((c) => touch(c.id, "2026-10-01", "2026-10-30"));
    const result = plan({
      cases: [mine, nobody, leaver],
      touchpoints: touches,
      ccRecipients: [{ kind: "role", role: "admin" }],
    });
    const byRecipient = new Map(result.digests.map((d) => [d.recipientUserId, d.data]));
    expect([...byRecipient.keys()]).toEqual([JANE, ADA]);
    // Jane is not cc'd: her own row, nothing unassigned, no team table.
    expect(byRecipient.get(JANE)?.own.rows.map((r) => r.caseNumber)).toEqual([mine.caseNumber]);
    expect(byRecipient.get(JANE)?.unassigned.rows).toEqual([]);
    expect(byRecipient.get(JANE)?.team).toEqual([]);
    // Ada (cc'd by role) coordinates nothing: the unassigned rows and the team line.
    const ada = byRecipient.get(ADA);
    expect(ada?.own.rows).toEqual([]);
    expect(ada?.unassigned.rows.map((r) => r.caseNumber)).toEqual([
      nobody.caseNumber,
      leaver.caseNumber,
    ]);
    expect(ada?.team).toEqual([
      { coordinatorName: "Jane Doe", overdue: 1, dueToday: 0, atRisk: 0 },
    ]);
    expect(result.unassignedUnrouted).toBe(0);
  });

  it("counts unassigned follow-ups as unrouted, and sends them nowhere, when no one is cc'd", () => {
    const nobody = kase({ assignedTo: null });
    const leaver = kase({ assignedTo: FORMER });
    const result = plan({
      cases: [nobody, leaver],
      touchpoints: [nobody, leaver].map((c) => touch(c.id, "2026-10-01", "2026-10-30")),
      ccRecipients: [{ kind: "user", userId: FORMER }],
    });
    expect(result.digests).toEqual([]);
    expect(result.unassignedUnrouted).toBe(2);
    expect(result.ccMembersDropped).toBe(1);
  });

  it("suppresses a recipient with nothing due, coordinator or cc'd", () => {
    const upcoming = kase({ assignedTo: JANE });
    const result = plan({
      cases: [upcoming],
      touchpoints: [touch(upcoming.id, "2026-10-01", "2026-11-10")],
      ccRecipients: [{ kind: "user", userId: OMAR }],
    });
    expect(result.digests).toEqual([]);
    // Jane (assigned an open case) and Omar (cc'd) each had an empty digest.
    expect(result.suppressed).toBe(2);
  });

  it("gives a cc'd coordinator one email: their rows, the unassigned rows and the team", () => {
    const janes = kase({ assignedTo: JANE });
    const omars = kase({
      assignedTo: OMAR,
      caseStatus: "in_review",
      submittedDate: "2026-08-01",
      avgDecisionDays: 30,
    });
    const nobody = kase({ assignedTo: null });
    const result = plan({
      cases: [janes, omars, nobody],
      touchpoints: [
        touch(janes.id, "2026-10-01", TODAY),
        touch(omars.id, "2026-10-01", "2026-10-02"),
        touch(nobody.id, "2026-10-01", TODAY),
      ],
      ccRecipients: [
        { kind: "user", userId: OMAR },
        { kind: "role", role: "specialist" },
      ],
    });
    expect(result.digests.map((d) => d.recipientUserId)).toEqual([JANE, OMAR]);
    const omar = result.digests[1].data;
    expect(omar.own.rows.map((r) => r.caseNumber)).toEqual([omars.caseNumber]);
    expect(omar.unassigned.rows.map((r) => r.caseNumber)).toEqual([nobody.caseNumber]);
    expect(omar.team).toEqual([
      { coordinatorName: "Jane Doe", overdue: 0, dueToday: 1, atRisk: 0 },
      { coordinatorName: "Omar Ali", overdue: 1, dueToday: 0, atRisk: 1 },
    ]);
    // Jane is cc'd through her role, so she sees the same unassigned and team.
    expect(result.digests[0].data.unassigned.rows).toHaveLength(1);
    expect(result.digests[0].data.team).toHaveLength(2);
  });

  it("caps a section's rows and counts the rest", () => {
    const cases = Array.from({ length: MAX_DIGEST_SECTION_ROWS + 7 }, () => kase());
    const result = plan({
      cases,
      touchpoints: cases.map((c) => touch(c.id, "2026-10-01", "2026-10-15")),
    });
    const own = result.digests[0].data.own;
    expect(own.rows).toHaveLength(MAX_DIGEST_SECTION_ROWS);
    expect(own.more).toBe(7);
    expect(own.overdue).toBe(MAX_DIGEST_SECTION_ROWS + 7);
  });

  it("carries only the declared fields: no case id, provider id or anything else", () => {
    const c = kase({ caseStatus: "submitted", submittedDate: "2026-08-30", avgDecisionDays: 45 });
    const result = plan({ cases: [c], touchpoints: [touch(c.id, "2026-10-01", TODAY)] });
    const data = result.digests[0].data;
    expect(Object.keys(data).sort()).toEqual([
      "digestDate",
      "own",
      "practiceName",
      "recipientFirstName",
      "team",
      "unassigned",
      "workQueueLink",
    ]);
    expect(Object.keys(data.own.rows[0]).sort()).toEqual([
      "atRisk",
      "caseLink",
      "caseNumber",
      "dueDate",
      "payerName",
      "providerName",
      "status",
    ]);
  });
});
