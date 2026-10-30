import { describe, expect, it } from "vitest";
import { resolveActiveGroupIds } from "./groupContractsMatrixSelection";

const groups = [
  { id: "first", isActive: true },
  { id: "dormant", isActive: false },
  { id: "second", isActive: true },
  { id: "third", isActive: true },
];

describe("resolveActiveGroupIds", () => {
  it("shows every active group until the operator changes the picker", () => {
    expect(resolveActiveGroupIds({ groups, selectedGroupIds: null })).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("does not narrow to the deep-link group: a case link opens the full view", () => {
    expect(
      resolveActiveGroupIds({ groups, selectedGroupIds: null, includeGroupId: "second" }),
    ).toEqual(["first", "second", "third"]);
  });

  it("adds an inactive deep-link group to the untouched default", () => {
    expect(
      resolveActiveGroupIds({ groups, selectedGroupIds: null, includeGroupId: "dormant" }),
    ).toEqual(["first", "dormant", "second", "third"]);
  });

  it("ignores an unknown or empty deep-link group", () => {
    const defaults = ["first", "second", "third"];
    expect(
      resolveActiveGroupIds({ groups, selectedGroupIds: null, includeGroupId: "missing" }),
    ).toEqual(defaults);
    expect(resolveActiveGroupIds({ groups, selectedGroupIds: null, includeGroupId: null })).toEqual(
      defaults,
    );
  });

  it("shows an inactive group only when it is picked", () => {
    expect(resolveActiveGroupIds({ groups, selectedGroupIds: ["dormant", "first"] })).toEqual([
      "dormant",
      "first",
    ]);
  });

  it("keeps an explicit selection, dropping unknown and repeated ids, whatever the link says", () => {
    expect(
      resolveActiveGroupIds({
        groups,
        selectedGroupIds: ["third", "missing", "first", "third"],
        includeGroupId: "dormant",
      }),
    ).toEqual(["third", "first"]);
  });

  it("returns nothing when the operator turns every group off", () => {
    expect(
      resolveActiveGroupIds({ groups, selectedGroupIds: [], includeGroupId: "second" }),
    ).toEqual([]);
  });

  it("returns nothing when no group is active and none is picked", () => {
    expect(
      resolveActiveGroupIds({ groups: [{ id: "x", isActive: false }], selectedGroupIds: null }),
    ).toEqual([]);
  });
});
