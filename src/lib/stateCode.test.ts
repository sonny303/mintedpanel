import { describe, expect, it } from "vitest";
import { normalizeStateCode, normalizeOptionalStateCode } from "./stateCode";

describe("normalizeStateCode", () => {
  it("uppercases a lowercase code", () => {
    expect(normalizeStateCode("tx")).toBe("TX");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeStateCode("  ks ")).toBe("KS");
  });

  it("passes an already-normal code through", () => {
    expect(normalizeStateCode("CO")).toBe("CO");
  });

  it("keeps a blank string blank (presence is validated upstream)", () => {
    expect(normalizeStateCode("")).toBe("");
    expect(normalizeStateCode("   ")).toBe("");
  });

  it("does not correct an invalid value — the DB check owns rejection", () => {
    expect(normalizeStateCode("Texas")).toBe("TEXAS");
  });
});

describe("normalizeOptionalStateCode", () => {
  it("uppercases and trims a present value", () => {
    expect(normalizeOptionalStateCode(" nc ")).toBe("NC");
  });

  it("folds blank to null so nullable columns store NULL", () => {
    expect(normalizeOptionalStateCode("")).toBeNull();
    expect(normalizeOptionalStateCode("   ")).toBeNull();
  });

  it("passes null and undefined through as null", () => {
    expect(normalizeOptionalStateCode(null)).toBeNull();
    expect(normalizeOptionalStateCode(undefined)).toBeNull();
  });
});
