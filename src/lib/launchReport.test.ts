// E6.6 F6.6.2 — Launches report derivation tests (TS-135 shapes): the
// date-only universe, the assignment-union open-case counts, the at-risk
// rule, and the group ordering.
import { describe, expect, it } from "vitest";
import {
  buildLaunchReportRows,
  daysUntil,
  groupLaunchRows,
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
  const assignments = [
    { providerId: "pr1", facilityId: "f1" },
    { providerId: "pr1", facilityId: "f2" },
    { providerId: "pr2", facilityId: "f2" },
  ];

  it("reaches a facility via the provider's assignment (generation cases carry no facility_id)", () => {
    const counts = openCasesByFacility(
      [{ id: "c1", providerId: "pr1", facilityId: null, status: "in_progress" }],
      assignments,
    );
    expect(counts.get("f1")).toBe(1);
    expect(counts.get("f2")).toBe(1);
  });

  it("an explicit facility_id counts once even when the provider is also assigned there", () => {
    const counts = openCasesByFacility(
      [{ id: "c1", providerId: "pr1", facilityId: "f1", status: "submitted" }],
      assignments,
    );
    expect(counts.get("f1")).toBe(1);
  });

  it("a facility-linked case counts even without an assignment", () => {
    const counts = openCasesByFacility(
      [{ id: "c1", providerId: "pr9", facilityId: "f3", status: "not_started" }],
      assignments,
    );
    expect(counts.get("f3")).toBe(1);
  });

  it("closed cases never count", () => {
    const counts = openCasesByFacility(
      [
        { id: "c1", providerId: "pr1", facilityId: null, status: "approved" },
        { id: "c2", providerId: "pr2", facilityId: null, status: "denied" },
      ],
      assignments,
    );
    expect(counts.size).toBe(0);
  });
});

describe("providerCountsByFacility", () => {
  it("counts distinct providers", () => {
    const counts = providerCountsByFacility([
      { providerId: "pr1", facilityId: "f1" },
      { providerId: "pr1", facilityId: "f1" },
      { providerId: "pr2", facilityId: "f1" },
    ]);
    expect(counts.get("f1")).toBe(2);
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

  it("flags at-risk ONLY inside the upcoming window: open cases or zero providers", () => {
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
    // Already launched: history, never at risk.
    expect(byId.get("launched-open-cases")?.atRisk).toBe(false);
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
