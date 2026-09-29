import { describe, expect, it } from "vitest";
import type { EnrollmentReportCsvRecord } from "@/types";
import {
  ENROLLMENT_REPORT_CSV_HEADERS,
  ENROLLMENT_REPORT_CSV_MAX_BYTES,
  ENROLLMENT_REPORT_CSV_MAX_ROWS,
  serializeEnrollmentReportCsv,
} from "./enrollmentReportCsv";

function csvRecord(overrides: Partial<EnrollmentReportCsvRecord> = {}): EnrollmentReportCsvRecord {
  return {
    providerName: "Ada Provider",
    npi: "0012345678",
    discipline: "PT",
    groupLabel: "North Group",
    payerLabel: "Example Payer",
    productLabel: "Commercial",
    state: "CO",
    facilityLabel: "Clinic One",
    status: "submitted",
    publicationState: "published",
    intakeDate: null,
    completeToSubmitDate: null,
    submittedDate: "2026-09-01",
    payerAcknowledgedDate: null,
    approvedDate: null,
    effectiveDate: null,
    terminationDate: null,
    cycleNo: 1,
    payerReference: "000031",
    retroType: "unknown",
    retroValue: null,
    retroBasis: null,
    clientSafeBlocker: null,
    owner: "Payer",
    reviewedAsOf: "2026-09-25T12:00:00Z",
    proofLabel: null,
    proofType: null,
    authenticatedReportUrl: "/reporting/enrollment-explorer",
    ...overrides,
  };
}

describe("serializeEnrollmentReportCsv", () => {
  it("uses the fixed 28-column order and preserves identifier bytes", () => {
    const result = serializeEnrollmentReportCsv([csvRecord()]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [header, row] = result.csv.split("\r\n");
    expect(header.split(",")).toHaveLength(ENROLLMENT_REPORT_CSV_HEADERS.length);
    expect(ENROLLMENT_REPORT_CSV_HEADERS).toHaveLength(28);
    expect(row).toContain('"0012345678"');
    expect(row).toContain('"000031"');
  });

  it("quotes embedded separators/newlines, neutralizes formulas, and removes unsafe controls", () => {
    const result = serializeEnrollmentReportCsv([
      csvRecord({
        providerName: '=HYPERLINK("https://invalid.example")',
        groupLabel: 'North,\nSecond "Clinic"\u0001',
      }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.csv).toContain('"\'=HYPERLINK(""https://invalid.example"")"');
    expect(result.csv).toContain('"North,\nSecond ""Clinic"" "');
  });

  it("returns a zero-artifact row-cap result", () => {
    const records = Array.from({ length: ENROLLMENT_REPORT_CSV_MAX_ROWS + 1 }, () => csvRecord());
    const result = serializeEnrollmentReportCsv(records);
    expect(result).toEqual({
      ok: false,
      reason: "row_limit",
      rowCount: ENROLLMENT_REPORT_CSV_MAX_ROWS + 1,
      byteLength: 0,
    });
    expect("csv" in result).toBe(false);
  });

  it("serializes exactly the maximum number of rows", () => {
    const records = Array.from({ length: ENROLLMENT_REPORT_CSV_MAX_ROWS }, () => csvRecord());
    const result = serializeEnrollmentReportCsv(records);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rowCount).toBe(ENROLLMENT_REPORT_CSV_MAX_ROWS);
  }, 15_000);

  it("accepts exactly 25 MiB of UTF-8 and rejects the next byte", () => {
    const base = serializeEnrollmentReportCsv([csvRecord({ clientSafeBlocker: "" })]);
    expect(base.ok).toBe(true);
    if (!base.ok) return;

    const availableBytes = ENROLLMENT_REPORT_CSV_MAX_BYTES - base.byteLength;
    const multibyteChars = Math.floor(availableBytes / 2);
    const exactPayload = "é".repeat(multibyteChars) + (availableBytes % 2 === 1 ? "x" : "");
    const exact = serializeEnrollmentReportCsv([csvRecord({ clientSafeBlocker: exactPayload })]);
    expect(exact.ok).toBe(true);
    if (exact.ok) expect(exact.byteLength).toBe(ENROLLMENT_REPORT_CSV_MAX_BYTES);

    const over = serializeEnrollmentReportCsv([
      csvRecord({ clientSafeBlocker: `${exactPayload}x` }),
    ]);
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.reason).toBe("byte_limit");
    expect(over.byteLength).toBe(ENROLLMENT_REPORT_CSV_MAX_BYTES + 1);
    expect("csv" in over).toBe(false);
  });
});
