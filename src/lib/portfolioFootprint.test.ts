import { describe, expect, it } from "vitest";
import {
  buildPortfolioFootprint,
  portfolioTotals,
  sortStates,
  type FootprintInput,
} from "@/lib/portfolioFootprint";

const TODAY = "2026-10-20";

function input(): FootprintInput {
  return {
    orgs: [
      { id: "fp", name: "Kansas Fitness Physio", lifecycleState: "prospect" },
      { id: "luna", name: "Luna", lifecycleState: "active" },
    ],
    groups: [
      { id: "ks", orgId: "fp", name: "Kansas Fitness Physio P.A.", isActive: true },
      { id: "mo", orgId: "fp", name: "Missouri Fitness Physio, LLC", isActive: true },
      { id: "nat", orgId: "luna", name: "Luna PT", isActive: true },
    ],
    facilities: [
      { id: "ks1", orgId: "fp", groupId: "ks", state: "KS", isActive: true, referenceOnly: false },
      { id: "ks2", orgId: "fp", groupId: "ks", state: "ks", isActive: true, referenceOnly: false },
      { id: "ks3", orgId: "fp", groupId: "ks", state: "KS", isActive: false, referenceOnly: false },
      { id: "mo1", orgId: "fp", groupId: "mo", state: "MO", isActive: true, referenceOnly: true },
      {
        id: "loose",
        orgId: "fp",
        groupId: null,
        state: null,
        isActive: true,
        referenceOnly: false,
      },
      {
        id: "tx",
        orgId: "luna",
        groupId: "nat",
        state: "TX",
        isActive: true,
        referenceOnly: false,
      },
      {
        id: "nc",
        orgId: "luna",
        groupId: "nat",
        state: "NC",
        isActive: true,
        referenceOnly: false,
      },
    ],
    providers: [
      { id: "a", orgId: "fp", status: "active", isTestProvider: false, referenceOnly: false },
      { id: "b", orgId: "fp", status: "onboarding", isTestProvider: false, referenceOnly: false },
      {
        id: "gone",
        orgId: "fp",
        status: "terminated",
        isTestProvider: false,
        referenceOnly: false,
      },
      { id: "test", orgId: "fp", status: "active", isTestProvider: true, referenceOnly: false },
      { id: "c", orgId: "fp", status: "active", isTestProvider: false, referenceOnly: false },
      { id: "l1", orgId: "luna", status: "active", isTestProvider: false, referenceOnly: false },
      { id: "l2", orgId: "luna", status: "active", isTestProvider: false, referenceOnly: false },
      { id: "l3", orgId: "luna", status: "active", isTestProvider: false, referenceOnly: false },
    ],
    groupMemberships: [
      { providerId: "a", groupId: "ks", endDate: null },
      { providerId: "b", groupId: "ks", endDate: null },
      { providerId: "a", groupId: "mo", endDate: null },
      { providerId: "c", groupId: "mo", endDate: "2026-01-01" },
      { providerId: "gone", groupId: "ks", endDate: null },
      { providerId: "test", groupId: "ks", endDate: null },
      { providerId: "l1", groupId: "nat", endDate: null },
      { providerId: "l2", groupId: "nat", endDate: null },
      { providerId: "l3", groupId: "nat", endDate: null },
    ],
    facilityAssignments: [
      { providerId: "a", facilityId: "ks1" },
      { providerId: "a", facilityId: "ks2" },
      { providerId: "b", facilityId: "ks3" },
      { providerId: "gone", facilityId: "ks1" },
      { providerId: "test", facilityId: "ks1" },
      { providerId: "l1", facilityId: "tx" },
      { providerId: "l2", facilityId: "tx" },
      { providerId: "l3", facilityId: "nc" },
    ],
  };
}

describe("portfolio footprint", () => {
  it("nests a multi-LLC org's groups and counts distinct providers and active locations", () => {
    const [fp] = buildPortfolioFootprint(input(), TODAY);
    expect(fp).toMatchObject({ name: "Kansas Fitness Physio", providers: 2, locations: 3 });
    expect(fp.stateCount).toBe(1);
    expect(fp.groups.map((g) => [g.name, g.providers, g.locations, g.noLocationProviders])).toEqual(
      [
        // b is placed only at an inactive location, so counts as no location.
        ["Kansas Fitness Physio P.A.", 2, 2, 1],
        // The only MO location is reference data; c's membership ended.
        ["Missouri Fitness Physio, LLC", 1, 0, 1],
        ["No group", 0, 1, 0],
      ],
    );
    expect(fp.groups[0].states).toEqual([{ state: "KS", providers: 1, locations: 2 }]);
    expect(fp.groups[2].states).toEqual([{ state: "Unknown", providers: 0, locations: 1 }]);
  });

  it("reads a single national group as a flat state list", () => {
    const luna = buildPortfolioFootprint(input(), TODAY)[1];
    expect(luna.groups).toHaveLength(1);
    expect(luna.groups[0].states).toEqual([
      { state: "NC", providers: 1, locations: 1 },
      { state: "TX", providers: 2, locations: 1 },
    ]);
    expect(luna).toMatchObject({ providers: 3, locations: 2, stateCount: 2 });
  });

  it("totals across orgs and sorts state rows by any column", () => {
    const orgs = buildPortfolioFootprint(input(), TODAY);
    expect(portfolioTotals(orgs)).toEqual({
      orgs: 2,
      groups: 3,
      states: 3,
      providers: 5,
      locations: 5,
    });
    const states = orgs[1].groups[0].states;
    expect(sortStates(states, "providers", "desc").map((s) => s.state)).toEqual(["TX", "NC"]);
    expect(sortStates(states, "locations", "asc").map((s) => s.state)).toEqual(["NC", "TX"]);
    expect(sortStates(states, "state", "desc").map((s) => s.state)).toEqual(["TX", "NC"]);
  });
});
