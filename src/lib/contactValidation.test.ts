import { describe, expect, it } from "vitest";
import { isValidEmail, commonEmailDomainTypo, contactErrors } from "./contactValidation";
import { DEFAULT_SALES_REP, EMPTY_CONTACT } from "./contacts";

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
      ["addressLine1", "city", "email", "name", "phoneOffice", "postalCode", "state"].sort(),
    );
  });

  it("passes the fully-populated Zeb default (line2/country optional)", () => {
    expect(contactErrors(DEFAULT_SALES_REP)).toEqual({});
  });

  it("flags a malformed email but accepts a valid one", () => {
    expect(contactErrors({ ...DEFAULT_SALES_REP, email: "nope" }).email).toBeTruthy();
    expect(contactErrors({ ...DEFAULT_SALES_REP, email: "a@b.co" }).email).toBeUndefined();
  });
});
