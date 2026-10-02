import { describe, expect, it } from "vitest";
import { resolveActiveGroupIds } from "./groupContractsMatrixSelection";

const groups = [{ id: "first" }, { id: "second" }, { id: "third" }];

describe("resolveActiveGroupIds", () => {
  it("uses the deep-link group when the operator has not changed the picker", () => {
    expect(
      resolveActiveGroupIds({
        groups,
        selectedGroupIds: null,
        contextGroupId: "second",
      }),
    ).toEqual(["second"]);
  });

  it("falls back to the first group when the deep-link group is unknown", () => {
    expect(
      resolveActiveGroupIds({
        groups,
        selectedGroupIds: null,
        contextGroupId: "missing",
      }),
    ).toEqual(["first"]);
  });

  it("keeps an explicit multi-select even when a deep-link group is present", () => {
    expect(
      resolveActiveGroupIds({
        groups,
        selectedGroupIds: ["third", "missing", "first"],
        contextGroupId: "second",
      }),
    ).toEqual(["third", "first"]);
  });
});
