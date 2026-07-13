// E3.0 TE-11 — unit coverage for the pure roster-import core: the exact
// header gate (missing/extra/renamed/duplicate/BOM/trailing-blank), the
// client file checks, the TE-6 full-SSN rejection (reject + redact, never
// truncate, never echo), per-line error assembly, and chunk boundaries.
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csvImport";
import { toCsv } from "@/lib/csv";
import {
  MAX_ROSTER_FILE_BYTES,
  REQUIRED_ROSTER_HEADERS,
  ROSTER_TEMPLATE_HEADERS,
  SSN_LAST4_FORMAT_REASON,
  SSN_REJECT_REASON,
  STAGE_CHUNK_SIZE,
  checkRosterFile,
  checkRosterHeaders,
  chunkRows,
  collectRowErrors,
  errorReportCsvRows,
  headerGateMessage,
  presentHeaders,
  previewRows,
  rosterTemplateCsv,
  scanRoster,
  scanRosterRecord,
} from "@/lib/rosterImport";

const HEADER_LINE = ROSTER_TEMPLATE_HEADERS.join(",");

// A fully-valid row in template column order.
const VALID_CELLS: Record<string, string> = {
  group_name: "Tree Hill Sports Therapy LLC",
  group_tin: "12-3456789",
  provider_first_name: "Nathan",
  provider_middle_initial: "R",
  provider_last_name: "Scott",
  npi: "1234567893",
  caqh_id: "16224897",
  specialty: "Physical Therapy",
  taxonomy_code: "225100000X",
  license_number: "PT-48213",
  license_state: "nc",
  license_issue_date: "2023-02-01",
  license_expiration_date: "1/31/2027",
  ssn_last4: "6789",
  date_of_birth: "1990-04-12",
  facility_name: "Main Clinic",
  facility_street: "1 Main St",
  facility_city: "Charlotte",
  facility_state: "NC",
  facility_zip: "28280",
};

function rowLine(over: Record<string, string> = {}): string {
  return ROSTER_TEMPLATE_HEADERS.map((h) => over[h] ?? VALID_CELLS[h]).join(",");
}

function csvWith(rows: string[], headerLine = HEADER_LINE): string {
  return [headerLine, ...rows].join("\n");
}

describe("rosterTemplateCsv", () => {
  it("is exactly the canonical header row", () => {
    expect(rosterTemplateCsv()).toBe(HEADER_LINE);
  });

  it("passes its own front gate (template === gate source)", () => {
    const parsed = parseCsv(rosterTemplateCsv());
    expect(checkRosterHeaders(parsed.headers).ok).toBe(true);
  });
});

describe("checkRosterFile", () => {
  it("accepts a .csv under the limit", () => {
    expect(checkRosterFile("roster.csv", 1024)).toBeNull();
    expect(checkRosterFile("ROSTER.CSV", 1024)).toBeNull();
  });

  it("rejects non-.csv files", () => {
    expect(checkRosterFile("roster.xlsx", 1024)).toMatch(/\.csv/);
    expect(checkRosterFile("roster.csv.pdf", 1024)).toMatch(/\.csv/);
  });

  it("rejects files over the ceiling, naming the limit", () => {
    const msg = checkRosterFile("roster.csv", MAX_ROSTER_FILE_BYTES + 1);
    expect(msg).toMatch(/10 MB/);
    expect(checkRosterFile("roster.csv", MAX_ROSTER_FILE_BYTES)).toBeNull();
  });
});

describe("checkRosterHeaders (front gate)", () => {
  it("passes the exact template header set", () => {
    const { headers } = parseCsv(csvWith([rowLine()]));
    expect(checkRosterHeaders(headers)).toEqual({ ok: true, missing: [], extra: [] });
  });

  it("is order-insensitive", () => {
    const reversed = [...ROSTER_TEMPLATE_HEADERS].reverse().join(",");
    const { headers } = parseCsv(reversed);
    expect(checkRosterHeaders(headers).ok).toBe(true);
  });

  it("tolerates cosmetic differences (case, spaces, BOM)", () => {
    const cosmetic =
      "\uFEFF" + HEADER_LINE.replace("group_name", "Group Name").replace("npi", "NPI");
    const { headers } = parseCsv(cosmetic);
    expect(checkRosterHeaders(headers).ok).toBe(true);
  });

  it("names a renamed column as missing + extra (the TS-58 'npi number' case)", () => {
    const renamed = HEADER_LINE.replace("npi,", "npi number,");
    const result = checkRosterHeaders(parseCsv(renamed).headers);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["npi"]);
    expect(result.extra).toEqual(["npi_number"]);
    expect(headerGateMessage(result)).toContain("npi");
    expect(headerGateMessage(result)).toContain("npi_number");
  });

  it("names a missing column", () => {
    const withoutTin = ROSTER_TEMPLATE_HEADERS.filter((h) => h !== "group_tin").join(",");
    const result = checkRosterHeaders(parseCsv(withoutTin).headers);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["group_tin"]);
    expect(result.extra).toEqual([]);
  });

  it("names an extra column", () => {
    const result = checkRosterHeaders(parseCsv(`${HEADER_LINE},favorite_color`).headers);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual(["favorite_color"]);
  });

  it("flags a duplicated template header as extra", () => {
    const result = checkRosterHeaders(parseCsv(`${HEADER_LINE},npi`).headers);
    expect(result.ok).toBe(false);
    expect(result.extra).toEqual(["npi (duplicate)"]);
  });

  it("ignores trailing blank columns but flags an interior blank header", () => {
    expect(checkRosterHeaders(parseCsv(`${HEADER_LINE},,`).headers).ok).toBe(true);
    const interior = `group_name,,${ROSTER_TEMPLATE_HEADERS.slice(1).join(",")}`;
    const result = checkRosterHeaders(parseCsv(interior).headers);
    expect(result.ok).toBe(false);
    expect(result.extra).toEqual(["(unnamed column)"]);
  });

  it("reports every template header missing for an empty file", () => {
    const result = checkRosterHeaders(parseCsv("").headers);
    expect(result.ok).toBe(false);
    expect(result.missing).toHaveLength(ROSTER_TEMPLATE_HEADERS.length);
  });

  it("headerGateMessage is null on pass", () => {
    expect(headerGateMessage({ ok: true, missing: [], extra: [] })).toBeNull();
  });
});

describe("scanRosterRecord — staging", () => {
  it("stages a valid row with normalized mapped values", () => {
    const parsed = parseCsv(csvWith([rowLine()]));
    const [row] = scanRoster(parsed);
    expect(row.rowState).toBe("staged");
    expect(row.errorColumn).toBeNull();
    expect(row.errorReason).toBeNull();
    expect(row.line).toBe(2);
    expect(row.mapped).toMatchObject({
      group_tin: "123456789", // dashed TIN stored bare
      license_state: "NC", // uppercased
      license_expiration_date: "2027-01-31", // M/D/YYYY → ISO
      ssn_last4: "6789",
      provider_middle_initial: "R",
    });
    expect(row.raw.npi).toBe("1234567893");
  });

  it("maps blanks in optional columns to null", () => {
    const parsed = parseCsv(
      csvWith([
        rowLine({
          provider_middle_initial: "",
          caqh_id: "",
          license_state: "",
          license_number: "",
          license_issue_date: "",
          license_expiration_date: "",
          ssn_last4: "",
          date_of_birth: "",
        }),
      ]),
    );
    const [row] = scanRoster(parsed);
    expect(row.rowState).toBe("staged");
    expect(row.mapped).toMatchObject({
      provider_middle_initial: null,
      caqh_id: null,
      license_state: null,
      ssn_last4: null,
      date_of_birth: null,
    });
  });

  it("scans columns by the file's order, not the template's", () => {
    const reversedHeaders = [...ROSTER_TEMPLATE_HEADERS].reverse();
    const line = reversedHeaders.map((h) => VALID_CELLS[h]).join(",");
    const parsed = parseCsv([reversedHeaders.join(","), line].join("\n"));
    const [row] = scanRoster(parsed);
    expect(row.rowState).toBe("staged");
    expect(row.mapped?.npi).toBe("1234567893");
    expect(row.mapped?.facility_zip).toBe("28280");
  });
});

describe("scanRosterRecord — TE-6 full-SSN guard", () => {
  it("rejects a dashed SSN in the ssn_last4 column — never truncates to a last-4", () => {
    const parsed = parseCsv(csvWith([rowLine({ ssn_last4: "123-45-6789" })]));
    const [row] = scanRoster(parsed);
    expect(row.rowState).toBe("error");
    expect(row.errorColumn).toBe("ssn_last4");
    expect(row.errorReason).toBe(SSN_REJECT_REASON);
    // Never echoed, never derived, and REDACTED from raw.
    expect(row.errorReason).not.toContain("6789");
    expect(row.raw.ssn_last4).toBe("");
    expect(row.mapped).toBeNull();
  });

  it("rejects a bare 9-digit value outside the TIN column", () => {
    const parsed = parseCsv(csvWith([rowLine({ caqh_id: "123456789" })]));
    const [row] = scanRoster(parsed);
    expect(row.rowState).toBe("error");
    expect(row.errorColumn).toBe("caqh_id");
    expect(row.errorReason).toBe(SSN_REJECT_REASON);
    expect(row.raw.caqh_id).toBe("");
  });

  it("allows a bare 9-digit group_tin but rejects a dashed SSN pattern there", () => {
    const bare = scanRoster(parseCsv(csvWith([rowLine({ group_tin: "123456789" })])))[0];
    expect(bare.rowState).toBe("staged");
    expect(bare.mapped?.group_tin).toBe("123456789");

    const dashed = scanRoster(parseCsv(csvWith([rowLine({ group_tin: "123-45-6789" })])))[0];
    expect(dashed.rowState).toBe("error");
    expect(dashed.errorColumn).toBe("group_tin");
    expect(dashed.errorReason).toBe(SSN_REJECT_REASON);
    expect(dashed.raw.group_tin).toBe("");
  });

  it("redacts every SSN-like cell even when an earlier column already failed the row", () => {
    const parsed = parseCsv(csvWith([rowLine({ caqh_id: "987654321", ssn_last4: "123-45-6789" })]));
    const [row] = scanRoster(parsed);
    expect(row.errorColumn).toBe("caqh_id");
    expect(row.raw.caqh_id).toBe("");
    expect(row.raw.ssn_last4).toBe("");
  });

  it("rejects a 5-digit ssn_last4 with the non-echoing format reason", () => {
    const parsed = parseCsv(csvWith([rowLine({ ssn_last4: "67890" })]));
    const [row] = scanRoster(parsed);
    expect(row.rowState).toBe("error");
    expect(row.errorColumn).toBe("ssn_last4");
    expect(row.errorReason).toBe(SSN_LAST4_FORMAT_REASON);
    expect(row.errorReason).not.toContain("67890");
  });
});

describe("scanRosterRecord — required + format checks", () => {
  it("requires the five-part dedupe inputs", () => {
    for (const h of REQUIRED_ROSTER_HEADERS) {
      const [row] = scanRoster(parseCsv(csvWith([rowLine({ [h]: "" })])));
      expect(row.rowState).toBe("error");
      expect(row.errorColumn).toBe(h);
      expect(row.errorReason).toContain("required");
    }
  });

  it("rejects a malformed NPI with column and reason (the TS-60 case)", () => {
    const parsed = parseCsv(csvWith([rowLine({ npi: "12345" })]));
    const [row] = scanRoster(parsed);
    expect(row.rowState).toBe("error");
    expect(row.errorColumn).toBe("npi");
    expect(row.errorReason).toContain("10 digits");
  });

  it("rejects bad TIN, state, date, and middle-initial formats", () => {
    expect(scanRoster(parseCsv(csvWith([rowLine({ group_tin: "12345" })])))[0]).toMatchObject({
      rowState: "error",
      errorColumn: "group_tin",
    });
    expect(
      scanRoster(parseCsv(csvWith([rowLine({ facility_state: "North Carolina" })])))[0],
    ).toMatchObject({ rowState: "error", errorColumn: "facility_state" });
    expect(
      scanRoster(parseCsv(csvWith([rowLine({ date_of_birth: "not-a-date" })])))[0],
    ).toMatchObject({ rowState: "error", errorColumn: "date_of_birth" });
    expect(
      scanRoster(parseCsv(csvWith([rowLine({ provider_middle_initial: "Ray" })])))[0],
    ).toMatchObject({ rowState: "error", errorColumn: "provider_middle_initial" });
  });

  it("errors a row with more values than the header row", () => {
    const parsed = parseCsv(csvWith([`${rowLine()},overflow`]));
    const [row] = scanRoster(parsed);
    expect(row.rowState).toBe("error");
    expect(row.errorColumn).toBeNull();
    expect(row.errorReason).toContain("21 values");
  });

  it("reports one error per row in deterministic order (SSN sweep wins)", () => {
    const parsed = parseCsv(csvWith([rowLine({ npi: "12345", caqh_id: "123456789" })]));
    const [row] = scanRoster(parsed);
    expect(row.errorColumn).toBe("caqh_id");
    expect(row.errorReason).toBe(SSN_REJECT_REASON);
  });
});

describe("scanRoster — partial success (the F3.0.4 gherkin)", () => {
  it("stages 57 of 60 rows when 3 carry malformed NPIs, and reports each", () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      rowLine({
        npi: [10, 25, 40].includes(i) ? "999" : String(1000000000 + i),
        provider_last_name: `Scott${i}`,
      }),
    );
    const scanned = scanRoster(parseCsv(csvWith(rows)));
    const staged = scanned.filter((r) => r.rowState === "staged");
    const errors = collectRowErrors(scanned);
    expect(staged).toHaveLength(57);
    expect(errors).toHaveLength(3);
    // Lines are 1-based with the header on line 1 → data starts at 2.
    expect(errors.map((e) => e.line)).toEqual([12, 27, 42]);
    for (const e of errors) {
      expect(e.column).toBe("npi");
      expect(e.reason).toContain("10 digits");
    }
  });
});

describe("chunkRows (TE-3 batch boundaries)", () => {
  it("splits on exact multiples with no empty tail", () => {
    const chunks = chunkRows(
      Array.from({ length: 1000 }, (_, i) => i),
      500,
    );
    expect(chunks.map((c) => c.length)).toEqual([500, 500]);
  });

  it("carries the remainder in the last chunk", () => {
    const chunks = chunkRows(
      Array.from({ length: 1250 }, (_, i) => i),
      500,
    );
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 250]);
    expect(chunks[2][249]).toBe(1249);
  });

  it("handles empty input and size 1", () => {
    expect(chunkRows([], 500)).toEqual([]);
    expect(chunkRows([1, 2], 1)).toEqual([[1], [2]]);
  });

  it("defaults to the shared STAGE_CHUNK_SIZE", () => {
    const chunks = chunkRows(Array.from({ length: STAGE_CHUNK_SIZE + 1 }, (_, i) => i));
    expect(chunks.map((c) => c.length)).toEqual([STAGE_CHUNK_SIZE, 1]);
  });

  it("rejects a nonsensical size", () => {
    expect(() => chunkRows([1], 0)).toThrow();
  });
});

describe("error report assembly", () => {
  it("builds the downloadable (row, column, reason) CSV", () => {
    const rows = errorReportCsvRows([
      { line: 12, column: "npi", reason: 'NPI must be exactly 10 digits, got "999"' },
      { line: 30, column: null, reason: "Row has 21 values but the header row has 20 columns" },
    ]);
    expect(rows[0]).toEqual(["row", "column", "reason"]);
    expect(rows[1]).toEqual([12, "npi", 'NPI must be exactly 10 digits, got "999"']);
    expect(rows[2][1]).toBe(""); // null column renders empty
    expect(toCsv(rows)).toContain('"NPI must be exactly 10 digits, got ""999"""');
  });
});

describe("preview helpers", () => {
  it("returns the file's header order and the first rows", () => {
    const parsed = parseCsv(csvWith([rowLine(), rowLine({ provider_last_name: "James" })]));
    expect(presentHeaders(parsed)).toEqual([...ROSTER_TEMPLATE_HEADERS]);
    const rows = previewRows(parsed, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("Tree Hill Sports Therapy LLC");
    expect(rows[0]).toHaveLength(ROSTER_TEMPLATE_HEADERS.length);
  });

  it("skips blank trailing header columns", () => {
    const parsed = parseCsv(csvWith([`${rowLine()},`], `${HEADER_LINE},`));
    expect(presentHeaders(parsed)).toEqual([...ROSTER_TEMPLATE_HEADERS]);
    expect(previewRows(parsed, 1)[0]).toHaveLength(ROSTER_TEMPLATE_HEADERS.length);
  });
});
