import { describe, expect, it } from "vitest";
import type { RosterSourceField } from "@/types";
import {
  getRosterSourceValue,
  getRosterSourceFieldsForTarget,
  isSsnLast4,
  isValidNpi,
  formatRosterDate,
  transformRosterValue,
} from "./rosterTransforms";

describe("roster transforms", () => {
  it("checks the full ten digit NPI and CMS Luhn check digit", () => {
    expect(isValidNpi("1234567893")).toBe(true);
    expect(isValidNpi(" 1234567893 ")).toBe(true);
    for (const value of [
      "1234567890",
      "123456789",
      "12345678934",
      "123-456-7893",
      "abcdefghij",
      null,
    ]) {
      expect(isValidNpi(value)).toBe(false);
    }
  });

  it("formats real calendar dates and rejects invalid or overflow dates", () => {
    expect(formatRosterDate("2024-02-29", "date_mm_dd_yyyy")).toBe("02/29/2024");
    expect(formatRosterDate("02/29/2024", "date_yyyy_mm_dd")).toBe("2024-02-29");
    expect(formatRosterDate("2023-02-29", "date_mm_dd_yyyy")).toBeNull();
    expect(formatRosterDate("2024-13-01", "date_yyyy_mm_dd")).toBeNull();
    expect(formatRosterDate("2/30/2024", "date_yyyy_mm_dd")).toBeNull();
    expect(formatRosterDate("not a date", "date_mm_dd_yyyy")).toBeNull();
  });

  it("applies deterministic text and phone transforms without changing other identifiers", () => {
    expect(transformRosterValue("  clinic north ", "uppercase")).toBe("  CLINIC NORTH ");
    expect(transformRosterValue("(913) 555-0100 ext 4", "phone_strip")).toBe("91355501004");
    expect(transformRosterValue(" 001234567 ", null)).toBe(" 001234567 ");
  });

  it("limits source fields to target-compatible types", () => {
    expect(getRosterSourceFieldsForTarget("date")).toEqual([
      "provider.date_of_birth",
      "license.issue_date",
      "license.expiration_date",
    ]);
    expect(getRosterSourceFieldsForTarget("phone")).toEqual(["facility.phone"]);
    expect(getRosterSourceFieldsForTarget("npi")).toEqual(["provider.npi", "group.npi_type2"]);
    expect(getRosterSourceFieldsForTarget("zip_plus_4")).toEqual(["facility.zip"]);
    expect(getRosterSourceFieldsForTarget("text")).not.toContain("provider.npi");
  });

  it("fails closed when last-four SSN is missing and never falls back to full SSN", () => {
    const row = {
      provider: { ssn: "123-45-6789", ssn_last4: null },
    };
    expect(getRosterSourceValue(row, "provider.ssn_last4" as RosterSourceField)).toBeNull();
    expect(
      getRosterSourceValue(
        { provider: { ssn_last4: "678" } },
        "provider.ssn_last4" as RosterSourceField,
      ),
    ).toBeNull();
    expect(
      getRosterSourceValue(
        { provider: { ssn_last4: "6789" } },
        "provider.ssn_last4" as RosterSourceField,
      ),
    ).toBe("6789");
    expect(getRosterSourceFieldsForTarget("text")).toContain("provider.ssn_last4");
    expect(isSsnLast4("6789")).toBe(true);
    expect(isSsnLast4("678")).toBe(false);
    expect(isSsnLast4("678a")).toBe(false);
  });
});
