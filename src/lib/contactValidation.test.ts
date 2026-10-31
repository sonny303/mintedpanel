import { describe, expect, it } from "vitest";
import { isValidEmail, commonEmailDomainTypo, contactErrors } from "./contactValidation";
import { EMPTY_CONTACT } from "./contacts";
import type { ContactInput } from "@/types";
import { US_PHONE_MESSAGE } from "@/lib/phone";

// A fully-populated contact. Was the shared DEFAULT_SALES_REP fixture until org
// intake stopped auto-creating a placeholder sales rep and that constant was
// deleted; this is a local fixture with the same shape.
const FULL_CONTACT: ContactInput = {
  firstName: "Dana",
  lastName: "Reyes",
  title: "",
  email: "dana.reyes@example.test",
  phoneOffice: "704-555-0100",
  phoneExtension: "",
  phoneMobile: "",
  fax: "",
  addressLine1: "101 S Tryon St",
  addressLine2: "Suite 400",
  city: "Charlotte",
  state: "NC",
  postalCode: "28280",
  country: "US",
};

describe("isValidEmail", () => {
  it("accepts well-formed addresses", () => {
    expect(isValidEmail("johnb@outerbanks.example.test")).toBe(true);
    expect(isValidEmail("  owner.dillon@example.test  ")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@c.com")).toBe(false);
    expect(isValidEmail("two@@at.com")).toBe(false);
  });
});

describe("commonEmailDomainTypo", () => {
  it("suggests a correction for common domain typos", () => {
    expect(commonEmailDomainTypo("owner@gmial.com")).toBe("owner@gmail.com");
    expect(commonEmailDomainTypo("a.b@HOTMAL.COM")).toBe("a.b@hotmail.com");
  });

  it("returns null for good or unknown domains", () => {
    expect(commonEmailDomainTypo("owner@gmail.com")).toBeNull();
    expect(commonEmailDomainTypo("owner@outerbanks.example.test")).toBeNull();
    expect(commonEmailDomainTypo("no-at-sign")).toBeNull();
    expect(commonEmailDomainTypo("trailing@")).toBeNull();
  });
});

describe("contactErrors", () => {
  it("flags every required field on an empty contact (E0.2 FR-2)", () => {
    const e = contactErrors(EMPTY_CONTACT);
    expect(Object.keys(e).sort()).toEqual(
      [
        "addressLine1",
        "city",
        "email",
        "firstName",
        "lastName",
        "phoneOffice",
        "postalCode",
        "state",
      ].sort(),
    );
  });

  it("passes a fully-populated contact (line2/country optional)", () => {
    expect(contactErrors(FULL_CONTACT)).toEqual({});
  });

  it("flags a malformed email but accepts a valid one", () => {
    expect(contactErrors({ ...FULL_CONTACT, email: "nope" }).email).toBeTruthy();
    expect(contactErrors({ ...FULL_CONTACT, email: "a@b.co" }).email).toBeUndefined();
  });
});

describe("contactErrors — office phone format (MINT-91)", () => {
  it("rejects an entered phone with letters on create and keeps the required message for blank", () => {
    expect(contactErrors({ ...FULL_CONTACT, phoneOffice: "abc-def-ghij" }).phoneOffice).toBe(
      US_PHONE_MESSAGE,
    );
    expect(contactErrors({ ...FULL_CONTACT, phoneOffice: "  " }).phoneOffice).toBe(
      "Phone is required",
    );
    expect(contactErrors({ ...FULL_CONTACT, phoneOffice: "(704) 555-0100 ext. 12" })).toEqual({});
  });

  it("on an edit, an untouched stored phone never blocks; a changed one is checked", () => {
    const legacy = { ...FULL_CONTACT, phoneOffice: "abc-def-ghij" };
    expect(contactErrors(legacy, "abc-def-ghij")).toEqual({});
    expect(contactErrors({ ...legacy, phoneOffice: "555-0100" }, "abc-def-ghij").phoneOffice).toBe(
      US_PHONE_MESSAGE,
    );
    expect(contactErrors({ ...legacy, phoneOffice: "704-555-0199" }, "abc-def-ghij")).toEqual({});
  });
});
