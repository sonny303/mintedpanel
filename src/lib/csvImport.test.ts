import { describe, expect, it } from "vitest";
import {
  coerceBool,
  coerceDate,
  coerceStringArray,
  parseCsv,
  parseCsvRecords,
  parseImportPackage,
} from "./csvImport";

/* ------------------------------ CSV parser ------------------------------ */

describe("parseCsvRecords", () => {
  it("parses a simple header + rows and tracks line numbers", () => {
    const records = parseCsvRecords("a,b\n1,2\n3,4");
    expect(records.map((r) => r.fields)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(records.map((r) => r.line)).toEqual([1, 2, 3]);
  });

  it("handles quoted fields with embedded commas", () => {
    const [row] = parseCsvRecords('"Smith, MD",x');
    expect(row.fields).toEqual(["Smith, MD", "x"]);
  });

  it("handles quoted fields with embedded newlines and keeps the next line number", () => {
    const records = parseCsvRecords('name,note\n"multi\nline",ok\nlast,row');
    expect(records[1].fields).toEqual(["multi\nline", "ok"]);
    // the record after a 2-physical-line quoted field starts on line 4
    expect(records[2].fields).toEqual(["last", "row"]);
    expect(records[2].line).toBe(4);
  });

  it('unescapes "" inside quotes', () => {
    const [row] = parseCsvRecords('"she said ""hi""",b');
    expect(row.fields).toEqual(['she said "hi"', "b"]);
  });

  it("handles CRLF line endings and skips blank lines", () => {
    const records = parseCsvRecords("a,b\r\n1,2\r\n\r\n3,4\r\n");
    expect(records.map((r) => r.fields)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
    // blank line was skipped, so the third record's start line is 4
    expect(records[2].line).toBe(4);
  });

  it("preserves empty trailing/leading fields", () => {
    const [row] = parseCsvRecords(",b,");
    expect(row.fields).toEqual(["", "b", ""]);
  });
});

describe("parseCsv header normalization", () => {
  it("normalizes header casing, spaces, and punctuation", () => {
    const { headers } = parseCsv("First Name, Last-Name ,NPI\nA,B,123");
    expect(headers).toEqual(["first_name", "lastname", "npi"]);
  });
});

/* ----------------------------- Coercion --------------------------------- */

describe("coerceDate", () => {
  it("passes ISO through", () => {
    expect(coerceDate("2026-07-04")).toEqual({ value: "2026-07-04", ok: true });
  });
  it("normalizes US M/D/YYYY", () => {
    expect(coerceDate("7/4/2026")).toEqual({ value: "2026-07-04", ok: true });
  });
  it("normalizes YYYY/M/D", () => {
    expect(coerceDate("2026/7/4")).toEqual({ value: "2026-07-04", ok: true });
  });
  it("treats empty as null + ok", () => {
    expect(coerceDate("  ")).toEqual({ value: null, ok: true });
  });
  it("rejects a non-date", () => {
    expect(coerceDate("July 4th")).toEqual({ value: null, ok: false });
  });
  it("rejects an impossible calendar date", () => {
    expect(coerceDate("2026-02-30")).toEqual({ value: null, ok: false });
  });
});

describe("coerceBool", () => {
  it("recognizes truthy tokens", () => {
    for (const t of ["true", "YES", "y", "1", "T"]) {
      expect(coerceBool(t)).toEqual({ value: true, ok: true });
    }
  });
  it("recognizes falsey tokens and empty", () => {
    for (const t of ["false", "no", "0", ""]) {
      expect(coerceBool(t)).toEqual({ value: false, ok: true });
    }
  });
  it("rejects garbage", () => {
    expect(coerceBool("maybe")).toEqual({ value: false, ok: false });
  });
});

describe("coerceStringArray", () => {
  it("splits on semicolons and commas, trims, dedupes", () => {
    expect(coerceStringArray("CA; NY , CA;TX")).toEqual(["CA", "NY", "TX"]);
  });
  it("returns an empty array for blank", () => {
    expect(coerceStringArray("   ")).toEqual([]);
  });
});

/* --------------------------- Header mapping ----------------------------- */

describe("parseImportPackage header mapping", () => {
  it("maps CSV columns to domain fields regardless of header casing/spacing", () => {
    const providersCsv = [
      "First Name,Last Name,NPI,Email,Home State,Start Date,Specialty",
      "Jane,Doe,1234567890,jane@x.com,KS,2026-01-15,Physical Therapy",
    ].join("\n");
    const { providers, errors } = parseImportPackage({ providersCsv });
    expect(errors).toEqual([]);
    expect(providers).toHaveLength(1);
    expect(providers[0].input).toMatchObject({
      firstName: "Jane",
      lastName: "Doe",
      npi: "1234567890",
      email: "jane@x.com",
      homeState: "KS",
      startDate: "2026-01-15",
      specialty: "Physical Therapy",
      status: "active",
    });
    // provider keys expose ref/npi/email for assignment resolution
    expect(providers[0].keys).toEqual(expect.arrayContaining(["1234567890", "jane@x.com"]));
  });

  it("expands license_state and license_states into license rows", () => {
    const providersCsv = [
      "first_name,last_name,license_state,license_number,license_states",
      "Ann,Lee,KS,KS-1,MO;OK",
    ].join("\n");
    const { providers } = parseImportPackage({ providersCsv });
    expect(providers[0].licenses).toEqual([
      {
        state: "KS",
        licenseNumber: "KS-1",
        licenseType: null,
        issueDate: null,
        expirationDate: null,
      },
      {
        state: "MO",
        licenseNumber: null,
        licenseType: null,
        issueDate: null,
        expirationDate: null,
      },
      {
        state: "OK",
        licenseNumber: null,
        licenseType: null,
        issueDate: null,
        expirationDate: null,
      },
    ]);
  });
});

/* ---------------------------- Validation -------------------------------- */

describe("parseImportPackage validation", () => {
  it("flags missing required facility name with a line number", () => {
    const facilitiesCsv = ["ref,name,state", "f1,,KS", "f2,Casa Bonita,CO"].join("\n");
    const { facilities, errors } = parseImportPackage({ facilitiesCsv });
    expect(facilities).toHaveLength(1);
    expect(facilities[0].input.name).toBe("Casa Bonita");
    const missing = errors.find((e) => e.column === "name");
    expect(missing).toMatchObject({ file: "facilities", line: 2, column: "name" });
  });

  it("flags a bad date with the source line", () => {
    const providersCsv = ["first_name,last_name,date_of_birth", "Al,Roe,1990-13-40"].join("\n");
    const { errors } = parseImportPackage({ providersCsv });
    expect(errors).toContainEqual({
      file: "providers",
      line: 2,
      column: "date_of_birth",
      message: 'Invalid date "1990-13-40"',
    });
  });

  it("flags bad npi / ssn / state formats", () => {
    const providersCsv = [
      "first_name,last_name,npi,ssn_last4,home_state",
      "Al,Roe,12,12345,KANSAS",
    ].join("\n");
    const { errors } = parseImportPackage({ providersCsv });
    expect(errors.map((e) => e.column)).toEqual(
      expect.arrayContaining(["npi", "ssn_last4", "home_state"]),
    );
  });

  it("flags an assignment referencing an unknown facility", () => {
    const facilitiesCsv = ["ref,name", "f1,Casa Bonita"].join("\n");
    const providersCsv = ["ref,first_name,last_name", "p1,Jane,Doe"].join("\n");
    const assignmentsCsv = ["provider_ref,facility_ref", "p1,f1", "p1,ghost", "nobody,f1"].join(
      "\n",
    );
    const { assignments, errors } = parseImportPackage({
      facilitiesCsv,
      providersCsv,
      assignmentsCsv,
    });
    // only the fully-resolvable assignment survives
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ providerRef: "p1", facilityRef: "f1" });
    expect(errors).toContainEqual({
      file: "provider_facility_assignments",
      line: 3,
      column: "facility_ref",
      message: 'Unknown facility "ghost" — no matching row in facilities.csv',
    });
    expect(errors).toContainEqual({
      file: "provider_facility_assignments",
      line: 4,
      column: "provider_ref",
      message: 'Unknown provider "nobody" — no matching row in providers.csv',
    });
  });

  it("resolves an assignment facility_ref by facility name when no ref column", () => {
    const facilitiesCsv = ["name", "Casa Bonita"].join("\n");
    const providersCsv = ["ref,first_name,last_name", "p1,Jane,Doe"].join("\n");
    const assignmentsCsv = ["provider_ref,facility_ref", "p1,Casa Bonita"].join("\n");
    const { assignments, errors } = parseImportPackage({
      facilitiesCsv,
      providersCsv,
      assignmentsCsv,
    });
    expect(errors).toEqual([]);
    expect(assignments).toHaveLength(1);
  });

  it("flags duplicate facility identifiers across rows", () => {
    const facilitiesCsv = ["ref,name", "f1,A", "f1,B"].join("\n");
    const { facilities, errors } = parseImportPackage({ facilitiesCsv });
    expect(facilities).toHaveLength(1);
    expect(errors).toContainEqual(
      expect.objectContaining({ file: "facilities", line: 3, column: "ref" }),
    );
  });

  it("flags a missing required column at the header line", () => {
    const assignmentsCsv = ["provider_ref", "p1"].join("\n");
    const { errors } = parseImportPackage({ assignmentsCsv });
    expect(errors).toContainEqual(
      expect.objectContaining({ file: "provider_facility_assignments", line: 1 }),
    );
  });

  it("parses a mixed valid/invalid package end to end", () => {
    const facilitiesCsv = ["ref,name,state", "loc1,Main Clinic,KS", "loc2,,KS"].join("\n");
    const providersCsv = [
      "ref,first_name,last_name,npi,is_new_grad",
      "prov1,Jane,Doe,1234567890,yes",
      "prov2,,Smith,,no",
      "prov3,Amy,Ng,999,maybe",
    ].join("\n");
    const assignmentsCsv = [
      "provider_ref,facility_ref,is_primary",
      "prov1,loc1,true",
      "prov1,loc2,true",
    ].join("\n");
    const result = parseImportPackage({ facilitiesCsv, providersCsv, assignmentsCsv });

    expect(result.facilities).toHaveLength(1);
    expect(result.providers).toHaveLength(2); // Jane + Amy (Amy has soft npi error)
    expect(result.providers[0].input.isNewGrad).toBe(true);
    // loc2 failed to parse, so the prov1→loc2 assignment cannot resolve
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]).toMatchObject({ facilityRef: "loc1", isPrimary: true });

    // one error each: missing facility name, missing provider first name, bad npi
    expect(result.errors.some((e) => e.file === "facilities" && e.column === "name")).toBe(true);
    expect(result.errors.some((e) => e.file === "providers" && e.column === "first_name")).toBe(
      true,
    );
    expect(result.errors.some((e) => e.file === "providers" && e.column === "npi")).toBe(true);
    expect(result.errors.some((e) => e.file === "providers" && e.column === "is_new_grad")).toBe(
      true,
    );
  });
});
