// MINT-7 — Add Provider's NPI rule: blank stays saveable (incomplete
// onboarding); an entered NPI needs the shape AND the CMS check digit.
import { describe, expect, it } from "vitest";
import { NPI_CHECK_DIGIT_MESSAGE } from "@/lib/providerIdentity";
import { emptyProviderFormState, validateAll, validateCredentials } from "./providerFormShared";

const base = { ...emptyProviderFormState, firstName: "Taylor", lastName: "Provider" };

describe("Add Provider NPI validation", () => {
  it("keeps a blank NPI saveable", () => {
    expect(validateAll(base)).toEqual({});
  });

  it("rejects a format-valid NPI with a wrong check digit inline", () => {
    expect(validateCredentials({ ...base, npi: "1234567890" }).npi).toBe(NPI_CHECK_DIGIT_MESSAGE);
    expect(validateAll({ ...base, npi: "1234567890" }).npi).toBe(NPI_CHECK_DIGIT_MESSAGE);
  });

  it("keeps the shape message for a malformed NPI and accepts a valid one", () => {
    expect(validateCredentials({ ...base, npi: "0234567893" }).npi).toBe(
      "NPI must be 10 digits and start with 1",
    );
    expect(validateCredentials({ ...base, npi: "1234567893" }).npi).toBeUndefined();
  });
});
