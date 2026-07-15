import { describe, expect, it } from "vitest";
import { excludeTestProviders, isTestProvider } from "./testProvider";

describe("testProvider", () => {
  it("identifies the designated test provider", () => {
    expect(isTestProvider({ isTestProvider: true })).toBe(true);
    expect(isTestProvider({ isTestProvider: false })).toBe(false);
    expect(isTestProvider({ isTestProvider: null })).toBe(false);
    expect(isTestProvider({})).toBe(false);
  });

  it("excludes test providers from a work list, preserving the rest", () => {
    const list = [
      { id: "a", isTestProvider: false },
      { id: "b", isTestProvider: true },
      { id: "c" },
    ];
    expect(excludeTestProviders(list).map((p) => p.id)).toEqual(["a", "c"]);
  });
});
