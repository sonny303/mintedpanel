import { describe, expect, it } from "vitest";
import {
  hardcodedValueMissingFromOptions,
  isAuthorableTransform,
  optionSample,
  parseControlOptions,
  validateControlOptionsInput,
} from "./controlOptions";

describe("parseControlOptions", () => {
  it("returns null for missing or malformed input", () => {
    expect(parseControlOptions(null)).toBeNull();
    expect(parseControlOptions({ value: "KS" })).toBeNull();
    expect(parseControlOptions([{ value: "KS" }])).toBeNull();
  });

  it("parses { value, label } pairs", () => {
    expect(parseControlOptions([{ value: "KS", label: "Kansas" }])).toEqual([
      { value: "KS", label: "Kansas" },
    ]);
  });
});

describe("validateControlOptionsInput", () => {
  it("accepts null as no list", () => {
    expect(validateControlOptionsInput(null)).toEqual({ kind: "ok", options: null });
  });

  it("rejects a non-array", () => {
    expect(validateControlOptionsInput("KS").kind).toBe("rejected");
  });

  it("accepts an empty array so the caller can ignore it on re-capture", () => {
    expect(validateControlOptionsInput([])).toEqual({ kind: "ok", options: [] });
  });
});

describe("hardcodedValueMissingFromOptions", () => {
  const opts = [
    { value: "KS", label: "Kansas" },
    { value: "MO", label: "Missouri" },
  ];
  it("is false when there is no vocabulary or no literal", () => {
    expect(hardcodedValueMissingFromOptions("KS", null)).toBe(false);
    expect(hardcodedValueMissingFromOptions(null, opts)).toBe(false);
  });
  it("is true when the stored value is gone from the list", () => {
    expect(hardcodedValueMissingFromOptions("NE", opts)).toBe(true);
    expect(hardcodedValueMissingFromOptions("KS", opts)).toBe(false);
  });
});

describe("optionSample", () => {
  it("caps at three plus a remainder count", () => {
    const opts = [
      { value: "KS", label: "Kansas" },
      { value: "MO", label: "Missouri" },
      { value: "NE", label: "Nebraska" },
      { value: "IA", label: "Iowa" },
    ];
    expect(optionSample(opts)).toBe("KS, MO, NE; 1 more");
  });
});

describe("isAuthorableTransform", () => {
  it("allows only the two applyTransform cases", () => {
    expect(isAuthorableTransform("state_abbrev")).toBe(true);
    expect(isAuthorableTransform("date_mmddyyyy")).toBe(true);
    expect(isAuthorableTransform("phone_digits")).toBe(false);
    expect(isAuthorableTransform("uppercase")).toBe(false);
  });
});
