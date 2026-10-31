// MINT-7 / CRUD-01 — the shared provider identity rules: NPI check digit, DEA
// checksum, strict ISO calendar dates, and the existing-data change rule.
import { describe, expect, it } from "vitest";
import {
  deaProblem,
  identityFieldChanged,
  isIsoDate,
  isValidDea,
  isValidNpi,
  npiCheckDigit,
  stripNpiSeparators,
} from "./providerIdentity";

describe("isValidNpi", () => {
  it("accepts a 10-digit NPI whose last digit is the CMS 80840 Luhn check digit", () => {
    expect(isValidNpi("1234567893")).toBe(true);
    expect(isValidNpi(" 1234567893 ")).toBe(true);
    expect(isValidNpi(1234567893)).toBe(true);
    expect(isValidNpi("1902833742")).toBe(true);
    expect(isValidNpi("1093817462")).toBe(true);
  });

  it("rejects a format-valid NPI with a wrong check digit", () => {
    for (const value of ["1234567890", "1234567894", "1093817465", "1111111111"]) {
      expect(isValidNpi(value)).toBe(false);
    }
  });

  it("rejects anything that is not exactly 10 digits", () => {
    for (const value of [
      "",
      "123456789",
      "12345678934",
      "123-456-7893",
      "abcdefghij",
      null,
      undefined,
    ]) {
      expect(isValidNpi(value)).toBe(false);
    }
  });

  it("computes the check digit from the first nine digits", () => {
    expect(npiCheckDigit("123456789")).toBe(3);
    expect(npiCheckDigit("109381746")).toBe(2);
    expect(npiCheckDigit("12345678")).toBeNull();
    for (let i = 0; i < 25; i += 1) {
      const first9 = String(100000000 + i * 7919);
      expect(isValidNpi(`${first9}${npiCheckDigit(first9)}`)).toBe(true);
    }
  });
});

describe("stripNpiSeparators (MINT-110)", () => {
  it("strips dashes and spaces so a typed NPI validates", () => {
    expect(stripNpiSeparators("123-456-7893")).toBe("1234567893");
    expect(stripNpiSeparators("123 456 7893")).toBe("1234567893");
    expect(stripNpiSeparators(" 123 - 456 - 7893 ")).toBe("1234567893");
    expect(isValidNpi(stripNpiSeparators("123-456-7893"))).toBe(true);
  });

  it("strips pasted Unicode dashes, the minus sign and non-breaking spaces", () => {
    expect(stripNpiSeparators("123\u2013456\u20147893")).toBe("1234567893");
    expect(stripNpiSeparators("123\u2212456\u00a07893")).toBe("1234567893");
  });

  it("strips invisible zero-width characters and the fullwidth hyphen", () => {
    expect(stripNpiSeparators("\ufeff123\u200b456\u200c789\u200d3")).toBe("1234567893");
    expect(stripNpiSeparators("123\uff0d456\uff0d7893")).toBe("1234567893");
    expect(isValidNpi(stripNpiSeparators("1234567893\u200b"))).toBe(true);
  });

  it("keeps other junk so the NPI rule still fails it", () => {
    for (const value of ["123.456.7893", "(123)4567893", "NPI 1234567893", "12345678x3"]) {
      expect(isValidNpi(stripNpiSeparators(value))).toBe(false);
    }
    expect(stripNpiSeparators("123.456.7893")).toBe("123.456.7893");
  });
});

describe("isValidDea", () => {
  it("accepts 2 letters + 7 digits with the standard checksum, any letter case", () => {
    // 1+3+5 + 2×(2+4+6) = 33 → check digit 3
    expect(isValidDea("AB1234563")).toBe(true);
    expect(isValidDea("bj1234563")).toBe(true);
    expect(isValidDea(" FN5623740 ")).toBe(true);
  });

  it("does not tie the second letter to the registrant's last name", () => {
    expect(isValidDea("AZ1234563")).toBe(true);
    expect(isValidDea("MQ1234563")).toBe(true);
  });

  it("accepts 9 as the second character (business and mid-level registrants)", () => {
    expect(isValidDea("A91234563")).toBe(true);
    expect(isValidDea("m91234563")).toBe(true);
    expect(deaProblem("A91234564")).toBe("check_digit");
    expect(deaProblem("9A1234563")).toBe("format");
    expect(deaProblem("A81234563")).toBe("format");
  });

  it("reports a wrong check digit separately from a bad shape", () => {
    expect(deaProblem("AB1234564")).toBe("check_digit");
    expect(deaProblem("AB123456")).toBe("format");
    expect(deaProblem("A11234563")).toBe("format");
    expect(deaProblem("AB12345630")).toBe("format");
    expect(deaProblem("")).toBe("format");
    expect(deaProblem(null)).toBe("format");
    expect(isValidDea("AB1234564")).toBe(false);
  });
});

describe("isIsoDate", () => {
  it("accepts strict YYYY-MM-DD real calendar dates", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-12-31")).toBe(true);
  });

  it("rejects malformed and impossible dates", () => {
    for (const value of [
      "2023-02-29",
      "2026-02-30",
      "2026-13-01",
      "2026-00-10",
      "2026-1-5",
      "01/05/2026",
      "2026-01-05T00:00:00Z",
      " 2026-01-05",
      "",
      null,
    ]) {
      expect(isIsoDate(value)).toBe(false);
    }
  });
});

describe("identityFieldChanged", () => {
  it("always validates on create", () => {
    expect(identityFieldChanged("1234567890", undefined)).toBe(true);
  });

  it("skips an unchanged stored value and validates an edited or newly entered one", () => {
    const digits = (v: string) => v.replace(/\D/g, "");
    expect(identityFieldChanged("1234567890", "1234567890")).toBe(false);
    expect(identityFieldChanged("123-456-7890", "1234567890", digits)).toBe(false);
    expect(identityFieldChanged("1234567891", "1234567890")).toBe(true);
    expect(identityFieldChanged("1234567893", null)).toBe(true);
  });
});
