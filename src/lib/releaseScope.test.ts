import { describe, expect, it } from "vitest";
import { applyReleaseScope, describeReleaseScope, releaseScopeRecord } from "./releaseScope";

const rows = [
  { providerId: "p1" },
  { providerId: "p2" },
  { providerId: "p3" },
  { providerId: "p4" },
];

describe("applyReleaseScope", () => {
  it("all / none", () => {
    expect(applyReleaseScope(rows, { kind: "all" })).toHaveLength(4);
    expect(applyReleaseScope(rows, { kind: "none" })).toEqual([]);
  });

  it("explicit provider subset", () => {
    expect(
      applyReleaseScope(rows, { kind: "providers", providerIds: ["p2", "p4"] }).map(
        (r) => r.providerId,
      ),
    ).toEqual(["p2", "p4"]);
  });

  it("count cap releases the first N deterministically", () => {
    expect(applyReleaseScope(rows, { kind: "count", limit: 2 }).map((r) => r.providerId)).toEqual([
      "p1",
      "p2",
    ]);
    expect(applyReleaseScope(rows, { kind: "count", limit: 0 })).toEqual([]);
    expect(applyReleaseScope(rows, { kind: "count", limit: 99 })).toHaveLength(4);
  });

  it("location scope filters by facility assignment", () => {
    const providerFacilities = new Map([
      ["p1", new Set(["fac-a"])],
      ["p2", new Set(["fac-b"])],
      ["p3", new Set(["fac-a", "fac-b"])],
    ]);
    expect(
      applyReleaseScope(
        rows,
        { kind: "location", facilityId: "fac-a" },
        { providerFacilities },
      ).map((r) => r.providerId),
    ).toEqual(["p1", "p3"]);
    // missing map → nothing released (never a silent full release)
    expect(applyReleaseScope(rows, { kind: "location", facilityId: "fac-a" })).toEqual([]);
  });

  it("records + describes the scope for the run history", () => {
    const rec = releaseScopeRecord({ kind: "count", limit: 2 }, 2, 4);
    expect(rec).toMatchObject({ kind: "count", releasedCount: 2, candidateCount: 4, limit: 2 });
    expect(describeReleaseScope(rec)).toMatch(/Released 2 of 4/);
    expect(describeReleaseScope(releaseScopeRecord({ kind: "all" }, 4, 4))).toMatch(/all 4/);
  });
});
