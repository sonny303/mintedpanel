// The shared footprint rule (MP-BUG, 2026-09-02): one definition of "does
// this provider belong in this state?" for BOTH the generation grid and the
// provider Readiness card. The regression these tests exist to prevent is a
// provider licensed in two states being pre-flighted against all eight of
// their group's target states.
import { describe, expect, it } from "vitest";
import {
  buildFootprintIndex,
  footprintStatesForProvider,
  hasStateFootprint,
  providerFootprintFor,
  type FootprintIndexInput,
} from "./providerFootprint";

// Marc's real shape: two groups, one clinic each, in two different states.
const marc = (over: Partial<FootprintIndexInput> = {}): FootprintIndexInput => ({
  facilities: [
    { id: "caldwell", groupId: "gLLC", state: "ID", isActive: true },
    { id: "roseville", groupId: "gWellness", state: "CA", isActive: true },
    // Same group as Caldwell, a state Marc holds no license in.
    { id: "raleigh", groupId: "gLLC", state: "NC", isActive: true },
  ],
  facilityAssignments: [
    { providerId: "marc", facilityId: "caldwell" },
    { providerId: "marc", facilityId: "roseville" },
  ],
  licenses: [
    { providerId: "marc", state: "CA" },
    { providerId: "marc", state: "ID" },
  ],
  ...over,
});

describe("hasStateFootprint", () => {
  it("qualifies a state where the provider has a clinic under THAT group", () => {
    const index = buildFootprintIndex(marc());
    expect(hasStateFootprint(index, "marc", "gLLC", "ID")).toBe(true);
    expect(hasStateFootprint(index, "marc", "gWellness", "CA")).toBe(true);
  });

  it("rejects a target state the group operates in but the provider does not", () => {
    // The bug: gLLC targets NC and has an NC clinic, but Marc is not assigned
    // there and holds no NC license. He is not an NC row.
    const index = buildFootprintIndex(marc());
    expect(hasStateFootprint(index, "marc", "gLLC", "NC")).toBe(false);
  });

  it("does not leak a clinic state across groups", () => {
    // Marc's CA clinic belongs to gWellness; it must not qualify him for a
    // gLLC target in CA on clinic grounds.
    const index = buildFootprintIndex(marc({ licenses: [] }));
    expect(providerFootprintFor(index, "marc", "gLLC", "CA")).toEqual({
      clinic: false,
      licensed: false,
    });
    expect(providerFootprintFor(index, "marc", "gWellness", "CA").clinic).toBe(true);
  });

  it("a license qualifies a state before the group opens a clinic there", () => {
    const index = buildFootprintIndex(marc({ licenses: [{ providerId: "marc", state: "OR" }] }));
    expect(providerFootprintFor(index, "marc", "gLLC", "OR")).toEqual({
      clinic: false,
      licensed: true,
    });
    expect(hasStateFootprint(index, "marc", "gLLC", "OR")).toBe(true);
  });

  it("ignores inactive clinics but keeps facilities with no isActive flag", () => {
    const index = buildFootprintIndex(
      marc({
        facilities: [
          { id: "caldwell", groupId: "gLLC", state: "ID", isActive: false },
          { id: "roseville", groupId: "gWellness", state: "CA" },
        ],
        licenses: [],
      }),
    );
    expect(providerFootprintFor(index, "marc", "gLLC", "ID").clinic).toBe(false);
    expect(providerFootprintFor(index, "marc", "gWellness", "CA").clinic).toBe(true);
  });

  it("skips rows with a null provider, facility, group, or blank state", () => {
    const index = buildFootprintIndex({
      facilities: [
        { id: "f1", groupId: null, state: "ID", isActive: true },
        { id: "f2", groupId: "gLLC", state: "   ", isActive: true },
        { id: "f3", groupId: "gLLC", state: null, isActive: true },
      ],
      facilityAssignments: [
        { providerId: "marc", facilityId: "f1" },
        { providerId: "marc", facilityId: "f2" },
        { providerId: "marc", facilityId: "f3" },
        { providerId: null, facilityId: "f1" },
        { providerId: "marc", facilityId: null },
        { providerId: "marc", facilityId: "missing" },
      ],
      licenses: [
        { providerId: null, state: "TX" },
        { providerId: "marc", state: "  " },
      ],
    });
    expect(hasStateFootprint(index, "marc", "gLLC", "ID")).toBe(false);
    expect(footprintStatesForProvider(index, "marc")).toEqual([]);
  });

  it("treats omitted licenses as no licensed states", () => {
    const index = buildFootprintIndex({
      facilities: [{ id: "caldwell", groupId: "gLLC", state: "ID", isActive: true }],
      facilityAssignments: [{ providerId: "marc", facilityId: "caldwell" }],
    });
    expect(providerFootprintFor(index, "marc", "gLLC", "ID")).toEqual({
      clinic: true,
      licensed: false,
    });
  });
});

describe("footprintStatesForProvider", () => {
  it("unions clinic states across every group with every licensed state", () => {
    const index = buildFootprintIndex(marc({ licenses: [{ providerId: "marc", state: "OR" }] }));
    expect(footprintStatesForProvider(index, "marc")).toEqual(["CA", "ID", "OR"]);
  });

  it("never bleeds another provider's clinic states through the key prefix", () => {
    const index = buildFootprintIndex({
      facilities: [
        { id: "caldwell", groupId: "gLLC", state: "ID", isActive: true },
        { id: "katy", groupId: "gLLC", state: "TX", isActive: true },
      ],
      // "marc2" shares "marc" as a string prefix — the index keys on
      // `${providerId}|${groupId}`, so the separator has to do its job.
      facilityAssignments: [
        { providerId: "marc", facilityId: "caldwell" },
        { providerId: "marc2", facilityId: "katy" },
      ],
      licenses: [],
    });
    expect(footprintStatesForProvider(index, "marc")).toEqual(["ID"]);
    expect(footprintStatesForProvider(index, "marc2")).toEqual(["TX"]);
  });

  it("returns nothing for a provider with no clinic and no license", () => {
    const index = buildFootprintIndex(marc());
    expect(footprintStatesForProvider(index, "someone-else")).toEqual([]);
  });
});

describe("the readiness scope this fixes", () => {
  it("keeps only the states a provider works in out of a wide target set", () => {
    // gLLC targets eight states; Marc belongs in exactly one of them.
    const index = buildFootprintIndex(marc());
    const targetStates = ["CO", "ID", "KS", "NC", "OR", "SC", "TX", "WI"];
    const kept = targetStates.filter((s) => hasStateFootprint(index, "marc", "gLLC", s));
    expect(kept).toEqual(["ID"]);
  });
});
