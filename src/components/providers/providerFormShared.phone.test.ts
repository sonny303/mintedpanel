// MINT-91 — Add Provider's phone rule: blank stays saveable; an entered phone
// must be a 10-digit US number (optional +1 / leading 1 and extension).
import { describe, expect, it } from "vitest";
import { US_PHONE_MESSAGE } from "@/lib/phone";
import { emptyProviderFormState, validateAll, validatePersonal } from "./providerFormShared";

const named = { ...emptyProviderFormState, firstName: "Brooke", lastName: "Ostrander" };

describe("Add Provider — phone (MINT-91)", () => {
  it("blocks the Personal step and the final save on a phone with letters", () => {
    expect(validatePersonal({ ...named, phone: "abc-def-ghij" })).toEqual({
      phone: US_PHONE_MESSAGE,
    });
    expect(validateAll({ ...named, phone: "abc-def-ghij" }).phone).toBe(US_PHONE_MESSAGE);
  });

  it("blocks too few digits", () => {
    expect(validatePersonal({ ...named, phone: "555-0100" }).phone).toBe(US_PHONE_MESSAGE);
  });

  it("accepts a blank phone and the usual US formats", () => {
    for (const phone of ["", "252-555-0100", "(252) 555-0100 x12", "+1 252 555 0100"]) {
      expect(validatePersonal({ ...named, phone }), phone).toEqual({});
    }
  });
});
