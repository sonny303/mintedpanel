import { describe, expect, it } from "vitest";
import { isValidEmail, commonEmailDomainTypo } from "./contactValidation";

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
