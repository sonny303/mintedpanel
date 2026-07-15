import { describe, expect, it } from "vitest";
import { computeTestRun, parseFillSkipped, summarizeTestFill } from "./testRunResults";

describe("computeTestRun", () => {
  const maps = [
    { selector: "#npi", token: "provider.npi", fieldLabel: "NPI", status: "approved" as const },
    {
      selector: "#caqh",
      token: "provider.caqhId",
      fieldLabel: "CAQH ID",
      status: "approved" as const,
    },
    { selector: "#weird", token: null, fieldLabel: "Unmapped field", status: "proposed" as const },
    { selector: "#old", token: "provider.npi", fieldLabel: "old", status: "retired" as const },
  ];

  it("classifies filled / empty_token / unmapped and skips retired (TS-99)", () => {
    const r = computeTestRun(maps, { "provider.npi": "1234567890", "provider.caqhId": "" });
    // retired excluded → 3 results
    expect(r.results).toHaveLength(3);
    expect(r.results.find((x) => x.selector === "#npi")!.reason).toBe("filled");
    expect(r.results.find((x) => x.selector === "#caqh")!.reason).toBe("empty_token");
    expect(r.results.find((x) => x.selector === "#weird")!.reason).toBe("unmapped");
    expect(r.fieldsFilled).toBe(1);
    expect(r.fieldsSkipped).toEqual([
      { selector: "#caqh", label: "CAQH ID", reason: "empty_token" },
      { selector: "#weird", label: "Unmapped field", reason: "unmapped" },
    ]);
  });

  it("parses stored fields_skipped leniently", () => {
    expect(parseFillSkipped([{ selector: "a", label: "A", reason: "unmapped" }])).toEqual([
      { selector: "a", label: "A", reason: "unmapped" },
    ]);
    expect(parseFillSkipped("legacy string")).toBeNull();
    expect(parseFillSkipped([{ foo: 1 }])).toBeNull();
    expect(parseFillSkipped(null)).toBeNull();
  });

  it("summarizes into filled + fix buckets", () => {
    const s = summarizeTestFill(2, [
      { selector: "a", label: "A", reason: "unmapped" },
      { selector: "b", label: "B", reason: "empty_token" },
    ]);
    expect(s.filled).toBe(2);
    expect(s.unmapped).toHaveLength(1);
    expect(s.emptyToken).toHaveLength(1);
  });
});
