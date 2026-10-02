import { describe, expect, it } from "vitest";
import { CASE_TYPES, isCaseType } from "./caseTypes";

describe("caseTypes", () => {
  it("exposes the closed v1 business-purpose set", () => {
    expect(CASE_TYPES).toEqual(["contract", "enrollment", "recredentialing"]);
  });

  it("accepts only exact members of the closed set", () => {
    for (const value of CASE_TYPES) expect(isCaseType(value)).toBe(true);
    for (const value of [null, undefined, "Contract", "credentialing", "", 1, {}]) {
      expect(isCaseType(value)).toBe(false);
    }
  });
});
