import { describe, expect, it } from "vitest";
import { serializeRosterFile } from "./rosterSpreadsheet";

describe("serializeRosterFile", () => {
  it("writes RFC 4180 CSV with CRLF records and escaped quotes, commas, and CR-only cells", () => {
    const bytes = serializeRosterFile(
      ["Name, display", "Note", "Carriage"],
      [['Dr. "A"', "line one\rline two", "comma, inside"]],
      "csv",
    );

    expect(new TextDecoder().decode(bytes)).toBe(
      '"Name, display",Note,Carriage\r\n"Dr. ""A""","line one\rline two","comma, inside"\r\n',
    );
  });

  it("makes formula-like CSV text safe after leading whitespace/control characters", () => {
    const bytes = serializeRosterFile(
      ["Value"],
      [["=1+1"], [" \t@SUM(A1:A2)"], ["\r-1+2"], ["plain text"]],
      "csv",
    );

    expect(new TextDecoder().decode(bytes)).toBe(
      "Value\r\n'=1+1\r\n' \t@SUM(A1:A2)\r\n\"'\r-1+2\"\r\nplain text\r\n",
    );
  });

  it("preserves Unicode as UTF-8 and appends a final CRLF", () => {
    const bytes = serializeRosterFile(["Clinician"], [["Zoë Rodríguez"]], "csv");
    expect([...bytes.slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toBe("Clinician\r\nZoë Rodríguez\r\n");
  });

  it("creates deterministic XLSX bytes with inline strings for identifiers and TINs", () => {
    const headers = ["NPI", "TIN", "Organization", "Notes"];
    const rows = [
      ["0012345678", "000123456", "Café & Care <North>", 'Comma, quote " and\r\nnew line\ronly'],
    ];
    const first = serializeRosterFile(headers, rows, "xlsx");
    const second = serializeRosterFile(headers, rows, "xlsx");
    const archiveText = new TextDecoder().decode(first);

    expect([...first.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(first).toEqual(second);
    expect(archiveText).toContain('t="inlineStr"');
    expect(archiveText).toContain("0012345678");
    expect(archiveText).toContain("000123456");
    expect(archiveText).toContain("Café &amp; Care &lt;North&gt;");
    expect(archiveText).toContain("Comma, quote &quot; and&#13;\nnew line&#13;only");
  });

  it("supports a header-only workbook without generating fake rows", () => {
    const archive = serializeRosterFile(["NPI", "TIN"], [], "xlsx");
    expect([...archive.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(new TextDecoder().decode(archive)).toContain('<dimension ref="A1:B1"/>');
  });

  it("rejects mismatched rows and XLSX text the spreadsheet format cannot store", () => {
    expect(() => serializeRosterFile(["NPI", "TIN"], [["123"]], "csv")).toThrow(
      "Roster row 1 has 1 cells; expected 2.",
    );
    expect(() => serializeRosterFile(["Value"], [["bad\u0001value"]], "xlsx")).toThrow(
      "XLSX cell A2 contains a character Excel cannot store.",
    );
  });
});
