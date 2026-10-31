import { describe, expect, it } from "vitest";
import { US_PHONE_MESSAGE, isValidUsPhone, usPhoneError } from "./phone";

describe("isValidUsPhone (MINT-91)", () => {
  it("accepts 10 digits with or without the usual separators", () => {
    for (const value of [
      "2525550100",
      "252-555-0100",
      "252.555.0100",
      "(252) 555-0100",
      "252 555 0100",
      "  252-555-0100  ",
    ]) {
      expect(isValidUsPhone(value), value).toBe(true);
    }
  });

  it("accepts 11 digits only when the first is 1", () => {
    expect(isValidUsPhone("12525550100")).toBe(true);
    expect(isValidUsPhone("1-252-555-0100")).toBe(true);
    expect(isValidUsPhone("1 (252) 555-0100")).toBe(true);
    expect(isValidUsPhone("22525550100")).toBe(false);
  });

  it("treats a leading + as a country code: only +1 then 10 digits passes", () => {
    expect(isValidUsPhone("+65 6123 4567")).toBe(false);
    expect(isValidUsPhone("+82 2 123 4567")).toBe(false);
    expect(isValidUsPhone("+2525550100")).toBe(false);
    expect(isValidUsPhone("+44 20 7946 0958")).toBe(false);
    expect(isValidUsPhone("+1 252 555 0100 x12")).toBe(true);
  });

  it("accepts a leading +1, and a leading + only once", () => {
    expect(isValidUsPhone("+1 252 555 0100")).toBe(true);
    expect(isValidUsPhone("+1 (252) 555-0100")).toBe(true);
    expect(isValidUsPhone("+12525550100")).toBe(true);
    expect(isValidUsPhone("++12525550100")).toBe(false);
    expect(isValidUsPhone("+1")).toBe(false);
    expect(isValidUsPhone("252-555-0100+")).toBe(false);
  });

  it("accepts a trailing extension in each listed form", () => {
    for (const value of [
      "252-555-0100 x123",
      "252-555-0100x123",
      "252-555-0100 X 7",
      "252-555-0100 ext 123",
      "252-555-0100 ext. 123",
      "252-555-0100 Ext.123",
      "252-555-0100 #123",
      "+1 (252) 555-0100 ext. 45",
    ]) {
      expect(isValidUsPhone(value), value).toBe(true);
    }
  });

  it("rejects an extension marker with no digits, or one that is not at the end", () => {
    expect(isValidUsPhone("252-555-0100 x")).toBe(false);
    expect(isValidUsPhone("252-555-0100 ext")).toBe(false);
    expect(isValidUsPhone("252-555-0100 #")).toBe(false);
    expect(isValidUsPhone("252 x123 555-0100")).toBe(false);
  });

  it("rejects letters anywhere else", () => {
    expect(isValidUsPhone("abc-def-ghij")).toBe(false);
    expect(isValidUsPhone("1-800-FLOWERS")).toBe(false);
    expect(isValidUsPhone("252-555-010O")).toBe(false);
    expect(isValidUsPhone("252-555-0100 extension 12")).toBe(false);
    expect(isValidUsPhone("call 252-555-0100")).toBe(false);
  });

  it("rejects too few or too many digits", () => {
    expect(isValidUsPhone("")).toBe(false);
    expect(isValidUsPhone("555-0100")).toBe(false);
    expect(isValidUsPhone("252-555-010")).toBe(false);
    expect(isValidUsPhone("252-555-01000")).toBe(false);
    expect(isValidUsPhone("1-252-555-01000")).toBe(false);
  });

  it("stays linear on a long run of spaces", () => {
    const started = performance.now();
    expect(isValidUsPhone(`1${" ".repeat(30_000)}a`)).toBe(false);
    expect(isValidUsPhone(`x${" ".repeat(30_000)}a`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("rejects separators outside the listed set", () => {
    expect(isValidUsPhone("252/555/0100")).toBe(false);
    expect(isValidUsPhone("252_555_0100")).toBe(false);
  });
});

describe("usPhoneError — blank and existing-data rules", () => {
  it("lets blank through; each form keeps its own required rule", () => {
    expect(usPhoneError("")).toBeNull();
    expect(usPhoneError("   ")).toBeNull();
    expect(usPhoneError("", "abc-def-ghij")).toBeNull();
  });

  it("checks an entered phone on create", () => {
    expect(usPhoneError("abc-def-ghij")).toBe(US_PHONE_MESSAGE);
    expect(usPhoneError("252-555-0100")).toBeNull();
  });

  it("never re-checks an untouched stored phone, even an invalid one", () => {
    expect(usPhoneError("abc-def-ghij", "abc-def-ghij")).toBeNull();
    expect(usPhoneError(" 555-0100 ", "555-0100")).toBeNull();
  });

  it("checks a changed phone on edit, including one filled where none was stored", () => {
    expect(usPhoneError("abc-def-ghij", "252-555-0100")).toBe(US_PHONE_MESSAGE);
    expect(usPhoneError("abc-def-ghij", null)).toBe(US_PHONE_MESSAGE);
    expect(usPhoneError("555-0101", "555-0100")).toBe(US_PHONE_MESSAGE);
    expect(usPhoneError("252-555-0199", "abc-def-ghij")).toBeNull();
  });
});
