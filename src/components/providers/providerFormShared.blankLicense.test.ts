// MINT-96 — the one blank-license predicate shared by Add Provider's submit
// filter and its Review step: the default row is blank, any entered field is not.
import { describe, expect, it } from "vitest";
import { emptyLicenseRow, emptyProviderFormState, isBlankLicenseRow } from "./providerFormShared";

describe("isBlankLicenseRow", () => {
  it("treats the stepper's default row as blank", () => {
    expect(emptyProviderFormState.licenses).toHaveLength(1);
    expect(isBlankLicenseRow(emptyProviderFormState.licenses[0])).toBe(true);
    expect(isBlankLicenseRow(emptyLicenseRow())).toBe(true);
  });

  it("treats a whitespace-only license number as blank", () => {
    expect(isBlankLicenseRow({ ...emptyLicenseRow(), number: "   " })).toBe(true);
  });

  it.each([
    ["state", { state: "NC" }],
    ["number", { number: "PT-1234" }],
    ["type", { type: "full" as const }],
    ["issue date", { issueDate: "2026-01-15" }],
    ["expiration date", { expirationDate: "2028-01-31" }],
  ])("keeps a row with only its %s entered", (_label, over) => {
    expect(isBlankLicenseRow({ ...emptyLicenseRow(), ...over })).toBe(false);
  });
});
