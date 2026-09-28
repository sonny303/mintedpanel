import { describe, expect, it } from "vitest";
import {
  PROVIDER_GENDER_OPTIONS,
  providerGenderLabel,
  providerGenderOptionsForValue,
} from "@/lib/providerGender";

describe("provider gender vocabulary", () => {
  it("labels the optional values and unset state", () => {
    expect(PROVIDER_GENDER_OPTIONS.map(({ label }) => label)).toEqual([
      "Female",
      "Male",
      "Nonbinary",
      "Prefer not to say",
    ]);
    expect(providerGenderLabel(null)).toBe("Not set");
    expect(providerGenderLabel(undefined)).toBe("Not set");
    expect(providerGenderLabel("female")).toBe("Female");
  });

  it("retains legacy strings as display and edit values", () => {
    const legacyValue = "F";
    expect(providerGenderLabel(legacyValue)).toBe(legacyValue);
    expect(providerGenderOptionsForValue(legacyValue)).toContainEqual({
      value: legacyValue,
      label: legacyValue,
    });
    expect(providerGenderOptionsForValue("male")).toEqual(PROVIDER_GENDER_OPTIONS);
  });
});
