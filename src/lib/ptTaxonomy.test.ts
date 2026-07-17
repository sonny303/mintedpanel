import { describe, expect, it } from "vitest";
import { isPtTaxonomyCode, ptTaxonomyLabel, PT_TAXONOMY_CODES } from "@/lib/ptTaxonomy";

describe("ptTaxonomy", () => {
  it("accepts the PT base and PTA codes", () => {
    expect(isPtTaxonomyCode("225100000X")).toBe(true);
    expect(isPtTaxonomyCode("225200000X")).toBe(true);
  });

  it("accepts PT specialization codes", () => {
    expect(isPtTaxonomyCode("2251S0007X")).toBe(true);
    expect(isPtTaxonomyCode("2251N0400X")).toBe(true);
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(isPtTaxonomyCode("  225100000x  ")).toBe(true);
  });

  it("rejects non-PT taxonomy codes", () => {
    expect(isPtTaxonomyCode("207Q00000X")).toBe(false); // family medicine
    expect(isPtTaxonomyCode("225X00000X")).toBe(false); // pattern-looking, not a real code
    expect(isPtTaxonomyCode("")).toBe(false);
  });

  it("returns a label for known codes and null otherwise", () => {
    expect(ptTaxonomyLabel("225100000X")).toBe("Physical Therapist");
    expect(ptTaxonomyLabel("225200000x")).toBe("Physical Therapist Assistant");
    expect(ptTaxonomyLabel("207Q00000X")).toBeNull();
  });

  it("every catalog entry validates", () => {
    for (const code of Object.keys(PT_TAXONOMY_CODES)) {
      expect(isPtTaxonomyCode(code)).toBe(true);
    }
  });
});
