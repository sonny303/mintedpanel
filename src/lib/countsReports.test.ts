// E6.6 F6.6.4 — counts-reports derivation tests.
import { describe, expect, it } from "vitest";
import {
  facilitiesWithoutProviders,
  locationsPerGroup,
  type CountsFacilityInput,
} from "./countsReports";

const facility = (over: Partial<CountsFacilityInput> & { id: string }): CountsFacilityInput => ({
  name: over.id,
  groupId: "g1",
  isActive: true,
  referenceOnly: false,
  ...over,
});

describe("facilitiesWithoutProviders", () => {
  it("returns active non-reference facilities with zero providers, A→Z", () => {
    const rows = facilitiesWithoutProviders(
      [
        facility({ id: "f1", name: "Zulu Clinic" }),
        facility({ id: "f2", name: "Alpha Clinic" }),
        facility({ id: "f3", name: "Staffed Clinic" }),
        facility({ id: "f4", name: "Inactive Clinic", isActive: false }),
        facility({ id: "f5", name: "Reference Clinic", referenceOnly: true }),
      ],
      new Map([["f3", 2]]),
    );
    expect(rows.map((r) => r.name)).toEqual(["Alpha Clinic", "Zulu Clinic"]);
  });

  it("a zero count in the map is still without providers", () => {
    const rows = facilitiesWithoutProviders([facility({ id: "f1" })], new Map([["f1", 0]]));
    expect(rows).toHaveLength(1);
  });
});

describe("locationsPerGroup", () => {
  const groups = [
    { id: "gb", name: "Bravo Group" },
    { id: "ga", name: "Alpha Group" },
  ];

  it("counts active non-reference locations per group, groups A→Z, zeros included", () => {
    const rows = locationsPerGroup(groups, [
      facility({ id: "f1", groupId: "gb" }),
      facility({ id: "f2", groupId: "gb" }),
      facility({ id: "f3", groupId: "gb", isActive: false }),
      facility({ id: "f4", groupId: "gb", referenceOnly: true }),
    ]);
    expect(rows).toEqual([
      { groupId: "ga", groupName: "Alpha Group", activeLocationCount: 0 },
      { groupId: "gb", groupName: "Bravo Group", activeLocationCount: 2 },
    ]);
  });

  it("ungrouped (or unknown-group) locations trail as No group only when present", () => {
    const withUngrouped = locationsPerGroup(groups, [
      facility({ id: "f1", groupId: null }),
      facility({ id: "f2", groupId: "gone" }),
    ]);
    expect(withUngrouped.at(-1)).toEqual({
      groupId: null,
      groupName: "No group",
      activeLocationCount: 2,
    });
    const without = locationsPerGroup(groups, [facility({ id: "f1", groupId: "ga" })]);
    expect(without.some((r) => r.groupId === null)).toBe(false);
  });
});
