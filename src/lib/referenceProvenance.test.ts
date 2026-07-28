import { describe, it, expect } from "vitest";
import { resolveReferenceProvenance } from "./referenceProvenance";
import type { Touch } from "@/types";

function touch(over: Partial<Touch>): Touch {
  return {
    id: "t1",
    entryType: "touchpoint",
    outcome: "submitted",
    touchDate: "2026-07-10",
    source: "extension",
    ...over,
  } as Touch;
}

describe("resolveReferenceProvenance (S4.5 / C3)", () => {
  it("returns null when the case has no reference — nothing to pre-fill", () => {
    expect(resolveReferenceProvenance(null, [touch({})])).toBeNull();
    expect(resolveReferenceProvenance("   ", [touch({})])).toBeNull();
  });

  it("attributes a Workbench submission and dates it", () => {
    const result = resolveReferenceProvenance("REF-1001", [touch({})]);
    expect(result).toEqual({
      reference: "REF-1001",
      capturedAt: "2026-07-10",
      fromWorkbench: true,
    });
  });

  it("does NOT credit the Workbench for a manually logged submission", () => {
    // A reference typed into the webapp must not read as extension-captured.
    const result = resolveReferenceProvenance("REF-1001", [touch({ source: "manual" })]);
    expect(result?.fromWorkbench).toBe(false);
    expect(result?.capturedAt).toBe("2026-07-10");
  });

  it("uses the NEWEST submission touch as the recording event", () => {
    const result = resolveReferenceProvenance("REF-1001", [
      touch({ id: "old", touchDate: "2026-06-01", source: "manual" }),
      touch({ id: "new", touchDate: "2026-07-10", source: "extension" }),
    ]);
    expect(result?.capturedAt).toBe("2026-07-10");
    expect(result?.fromWorkbench).toBe(true);
  });

  it("ignores non-submission entries when picking the recording event", () => {
    // Notes and system events share the touchlog; only a submission counts.
    const result = resolveReferenceProvenance("REF-1001", [
      touch({ id: "note", entryType: "note", outcome: null, touchDate: "2026-07-20" }),
      touch({ id: "sub", touchDate: "2026-07-10" }),
    ]);
    expect(result?.capturedAt).toBe("2026-07-10");
  });

  it("still pre-fills when the reference has no identifiable recording touch", () => {
    // A reference set by a path that logged no submission touch is still the
    // number to pre-fill — it just carries no date or attribution.
    const result = resolveReferenceProvenance("REF-1001", []);
    expect(result).toEqual({ reference: "REF-1001", capturedAt: null, fromWorkbench: false });
  });
});
