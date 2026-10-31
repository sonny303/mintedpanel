// E6.6 F6.6.2 — Launches report derivation tests (TS-135 shapes): the
// date-only universe, the case_facilities open-case attribution, the
// staffing rule, the at-risk rule (upcoming + overdue), the group ordering,
// and the No go-live date section.
import { describe, expect, it } from "vitest";
import {
  buildLaunchReportRows,
  buildNoGoLiveDateRows,
  daysUntil,
  groupLaunchRows,
  launchRiskLabel,
  openCasesByFacility,
  providerCountsByFacility,
  type LaunchFacilityInput,
} from "./launchReport";

const TODAY = "2026-07-19";

const facility = (over: Partial<LaunchFacilityInput> & { id: string }): LaunchFacilityInput => ({
  name: over.id,
  groupId: "g1",
  effectiveDate: "2026-08-01",
  isActive: true,
  referenceOnly: false,
  ...over,
});

describe("daysUntil", () => {
  it("is date-only and sign-correct", () => {
    expect(daysUntil("2026-07-20", TODAY)).toBe(1);
    expect(daysUntil("2026-07-19", TODAY)).toBe(0);
    expect(daysUntil("2026-07-01", TODAY)).toBe(-18);
    expect(daysUntil("not-a-date", TODAY)).toBeNull();
  });
});

describe("openCasesByFacility", () => {
  const providers = [
    { id: "pr1", status: "active" },
    { id: "pr2", status: "active" },
    { id: "test", status: "active", isTestProvider: true },
  ];

  it("attributes a case to its case_facilities locations only — never via the provider's assignments", () => {
    // pr1 is assigned to f1 AND f2, but the case holds only f1: it is pending
    // for f1's go-live, not f2's.
    const counts = openCasesByFacility(
      [{ id: "c1", providerId: "pr1", facilityId: "f1", status: "in_progress" }],
      [{ caseId: "c1", facilityId: "f1" }],
      providers,
    );
    expect(counts.get("f1")).toBe(1);
    expect(counts.has("f2")).toBe(false);
  });

  it("a multi-location case counts once at each location it holds", () => {
    const counts = openCasesByFacility(
      [{ id: "c1", providerId: "pr1", facilityId: "f1", status: "submitted" }],
      [
        { caseId: "c1", facilityId: "f1" },
        { caseId: "c1", facilityId: "f2" },
        { caseId: "c1", facilityId: "f2" },
      ],
      providers,
    );
    expect(counts.get("f1")).toBe(1);
    expect(counts.get("f2")).toBe(1);
  });

  it("the primary mirror never adds a location the case's links leave out", () => {
    const counts = openCasesByFacility(
      [{ id: "c1", providerId: "pr1", facilityId: "f9", status: "submitted" }],
      [{ caseId: "c1", facilityId: "f1" }],
      providers,
    );
    expect(Array.from(counts.keys())).toEqual(["f1"]);
  });

  it("a case with no case_facilities rows falls back to its facility_id mirror", () => {
    // Creation stamps facility_id without writing the child row.
    const counts = openCasesByFacility(
      [
        { id: "c1", providerId: "pr2", facilityId: "f3", status: "not_started" },
        { id: "c2", providerId: "pr2", facilityId: null, status: "not_started" },
      ],
      [],
      providers,
    );
    expect(counts.get("f3")).toBe(1);
    expect(counts.size).toBe(1);
  });

  it("closed cases and the test provider's cases never count", () => {
    const counts = openCasesByFacility(
      [
        { id: "c1", providerId: "pr1", facilityId: "f1", status: "approved" },
        { id: "c2", providerId: "pr2", facilityId: "f1", status: "denied" },
        { id: "c3", providerId: "test", facilityId: "f1", status: "in_progress" },
      ],
      [
        { caseId: "c1", facilityId: "f1" },
        { caseId: "c2", facilityId: "f1" },
        { caseId: "c3", facilityId: "f1" },
      ],
      providers,
    );
    expect(counts.size).toBe(0);
  });
});

describe("providerCountsByFacility", () => {
  it("counts distinct providers", () => {
    const counts = providerCountsByFacility(
      [
        { providerId: "pr1", facilityId: "f1" },
        { providerId: "pr1", facilityId: "f1" },
        { providerId: "pr2", facilityId: "f1" },
      ],
      [
        { id: "pr1", status: "active" },
        { id: "pr2", status: "onboarding" },
      ],
      TODAY,
    );
    expect(counts.get("f1")).toBe(2);
  });

  it("ignores terminated, test, and not-yet-started providers", () => {
    const counts = providerCountsByFacility(
      [
        { providerId: "gone", facilityId: "f1", startDate: "2025-01-01" },
        { providerId: "test", facilityId: "f1", startDate: "2025-01-01" },
        { providerId: "future", facilityId: "f1", startDate: "2026-07-20" },
        { providerId: "today", facilityId: "f2", startDate: TODAY },
        { providerId: "legacy", facilityId: "f2", startDate: null },
      ],
      [
        { id: "gone", status: "terminated" },
        { id: "test", status: "active", isTestProvider: true },
        { id: "future", status: "onboarding" },
        { id: "today", status: "active" },
        { id: "legacy", status: "active" },
      ],
      TODAY,
    );
    expect(counts.has("f1")).toBe(false);
    expect(counts.get("f2")).toBe(2);
  });

  it("a provider the list does not carry still counts", () => {
    const counts = providerCountsByFacility([{ providerId: "pr9", facilityId: "f1" }], [], TODAY);
    expect(counts.get("f1")).toBe(1);
  });
});

describe("buildLaunchReportRows", () => {
  it("includes future and recently-launched dates, excludes old/dateless/inactive/reference", () => {
    const rows = buildLaunchReportRows(
      [
        facility({ id: "future", effectiveDate: "2026-09-01" }),
        facility({ id: "recent", effectiveDate: "2026-07-01" }), // 18 days ago
        facility({ id: "old", effectiveDate: "2026-05-01" }),
        facility({ id: "dateless", effectiveDate: null }),
        facility({ id: "inactive", isActive: false }),
        facility({ id: "reference", referenceOnly: true }),
      ],
      new Map(),
      new Map(),
      TODAY,
    );
    expect(rows.map((r) => r.facilityId)).toEqual(["recent", "future"]);
  });

  it("sorts date ascending with name tiebreak", () => {
    const rows = buildLaunchReportRows(
      [
        facility({ id: "b", name: "Bravo", effectiveDate: "2026-08-01" }),
        facility({ id: "a", name: "Alpha", effectiveDate: "2026-08-01" }),
        facility({ id: "c", name: "Charlie", effectiveDate: "2026-07-25" }),
      ],
      new Map(),
      new Map(),
      TODAY,
    );
    expect(rows.map((r) => r.name)).toEqual(["Charlie", "Alpha", "Bravo"]);
  });

  it("flags at-risk inside the upcoming window or once passed: open cases or zero providers", () => {
    const rows = buildLaunchReportRows(
      [
        facility({ id: "soon-open-cases", effectiveDate: "2026-08-01" }),
        facility({ id: "soon-no-providers", effectiveDate: "2026-08-01" }),
        facility({ id: "soon-fine", effectiveDate: "2026-08-01" }),
        facility({ id: "far-no-providers", effectiveDate: "2026-12-01" }),
        facility({ id: "launched-open-cases", effectiveDate: "2026-07-10" }),
      ],
      new Map([
        ["soon-open-cases", 2],
        ["soon-fine", 1],
        ["launched-open-cases", 1],
      ]),
      new Map([
        ["soon-open-cases", 3],
        ["launched-open-cases", 1],
      ]),
      TODAY,
    );
    const byId = new Map(rows.map((r) => [r.facilityId, r]));
    expect(byId.get("soon-open-cases")).toMatchObject({
      atRisk: true,
      atRiskReasons: ["open cases still pending"],
    });
    expect(byId.get("soon-no-providers")).toMatchObject({
      atRisk: true,
      atRiskReasons: ["no providers assigned"],
    });
    expect(byId.get("soon-fine")?.atRisk).toBe(false);
    // Outside the 30-day window: not "approaching", never at risk.
    expect(byId.get("far-no-providers")?.atRisk).toBe(false);
    // Already launched with a case still open: overdue, not history.
    expect(byId.get("launched-open-cases")).toMatchObject({ atRisk: true, riskKind: "overdue" });
  });

  it("MINT-100: a go-live 19 days past with open cases is Overdue, with the same reasons", () => {
    const rows = buildLaunchReportRows(
      [
        facility({ id: "overdue", effectiveDate: "2026-06-30" }),
        facility({ id: "overdue-1", effectiveDate: "2026-07-18" }),
      ],
      new Map([["overdue", 2]]),
      new Map([["overdue", 1]]),
      TODAY,
    );
    const byId = new Map(rows.map((r) => [r.facilityId, r]));
    const overdue = byId.get("overdue");
    expect(overdue).toMatchObject({
      daysUntil: -19,
      atRisk: true,
      riskKind: "overdue",
      atRiskReasons: ["open cases still pending"],
    });
    expect(overdue && launchRiskLabel(overdue)).toBe(
      "Overdue by 19 days — open cases still pending",
    );
    const oneDay = byId.get("overdue-1");
    expect(oneDay && launchRiskLabel(oneDay)).toBe("Overdue by 1 day — no providers assigned");
  });

  it("MINT-100: a past go-live with nothing outstanding stays unflagged", () => {
    const rows = buildLaunchReportRows(
      [facility({ id: "opened-clean", effectiveDate: "2026-06-30" })],
      new Map([["opened-clean", 3]]),
      new Map(),
      TODAY,
    );
    expect(rows[0]).toMatchObject({ atRisk: false, riskKind: null, atRiskReasons: [] });
    expect(launchRiskLabel(rows[0])).toBeNull();
  });

  it("MINT-100: the 0- and 30-day upcoming boundaries are unchanged", () => {
    const rows = buildLaunchReportRows(
      [
        facility({ id: "day-0", effectiveDate: TODAY }),
        facility({ id: "day-30", effectiveDate: "2026-08-18" }),
        facility({ id: "day-31", effectiveDate: "2026-08-19" }),
      ],
      new Map(),
      new Map(),
      TODAY,
    );
    const byId = new Map(rows.map((r) => [r.facilityId, r]));
    expect(byId.get("day-0")).toMatchObject({ daysUntil: 0, riskKind: "upcoming" });
    expect(byId.get("day-30")).toMatchObject({ daysUntil: 30, riskKind: "upcoming" });
    expect(byId.get("day-31")).toMatchObject({ daysUntil: 31, atRisk: false, riskKind: null });
    const day0 = byId.get("day-0");
    expect(day0 && launchRiskLabel(day0)).toBe("At risk — no providers assigned");
  });

  it("a same-day launch (daysUntil 0) is inside the approaching window", () => {
    const rows = buildLaunchReportRows(
      [facility({ id: "today", effectiveDate: TODAY })],
      new Map(),
      new Map(),
      TODAY,
    );
    expect(rows[0]).toMatchObject({ daysUntil: 0, atRisk: true });
  });

  it("both reasons combine", () => {
    const rows = buildLaunchReportRows(
      [facility({ id: "f1", effectiveDate: "2026-07-25" })],
      new Map(),
      new Map([["f1", 1]]),
      TODAY,
    );
    expect(rows[0].atRiskReasons).toEqual(["open cases still pending", "no providers assigned"]);
  });
});

describe("groupLaunchRows", () => {
  it("groups A→Z by group name, ungrouped last, row order preserved", () => {
    const rows = buildLaunchReportRows(
      [
        facility({ id: "z1", groupId: "gz", effectiveDate: "2026-07-25" }),
        facility({ id: "a1", groupId: "ga", effectiveDate: "2026-08-05" }),
        facility({ id: "none", groupId: null, effectiveDate: "2026-08-01" }),
        facility({ id: "a2", groupId: "ga", effectiveDate: "2026-07-30" }),
      ],
      new Map(),
      new Map(),
      TODAY,
    );
    const groups = groupLaunchRows(
      rows,
      new Map([
        ["ga", "Alpha Group"],
        ["gz", "Zulu Group"],
      ]),
    );
    expect(groups.map((g) => g.groupName)).toEqual(["Alpha Group", "Zulu Group", "No group"]);
    expect(groups[0].rows.map((r) => r.facilityId)).toEqual(["a2", "a1"]);
  });

  it("a groupId missing from the name map folds into No group (deleted group tolerance)", () => {
    const rows = buildLaunchReportRows(
      [facility({ id: "f1", groupId: "gone" })],
      new Map(),
      new Map(),
      TODAY,
    );
    const groups = groupLaunchRows(rows, new Map());
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ groupId: null, groupName: "No group" });
  });
});

describe("buildNoGoLiveDateRows", () => {
  it("MINT-100: dateless locations land in the No go-live date group, unflagged, group A→Z then name", () => {
    const facilities = [
      facility({ id: "z-b", name: "Bravo", groupId: "gz", effectiveDate: null }),
      facility({ id: "none", name: "Alpha", groupId: null, effectiveDate: null }),
      facility({ id: "a-c", name: "Charlie", groupId: "ga", effectiveDate: null }),
      facility({ id: "a-a", name: "Alpha", groupId: "ga", effectiveDate: null }),
      facility({ id: "gone", name: "Delta", groupId: "deleted", effectiveDate: null }),
      facility({ id: "dated", effectiveDate: "2026-08-01" }),
      facility({ id: "inactive", isActive: false, effectiveDate: null }),
      facility({ id: "reference", referenceOnly: true, effectiveDate: null }),
    ];
    const noDate = buildNoGoLiveDateRows(
      facilities,
      new Map([["a-a", 2]]),
      new Map([["a-a", 1]]),
      new Map([
        ["ga", "Alpha Group"],
        ["gz", "Zulu Group"],
      ]),
    );
    expect(noDate.map((r) => r.facilityId)).toEqual(["a-a", "a-c", "z-b", "none", "gone"]);
    expect(noDate[0]).toEqual({
      facilityId: "a-a",
      name: "Alpha",
      groupId: "ga",
      groupName: "Alpha Group",
      city: null,
      state: null,
      providerCount: 2,
      openCaseCount: 1,
    });
    expect(noDate.at(-1)?.groupName).toBe("No group");
    // The dated report still leaves them out: one list, never both.
    const dated = buildLaunchReportRows(facilities, new Map(), new Map(), TODAY);
    expect(dated.map((r) => r.facilityId)).toEqual(["dated"]);
  });
});
