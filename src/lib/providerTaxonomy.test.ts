import { describe, expect, it } from "vitest";
import {
  isKnownTaxonomyCode,
  taxonomyLabel,
  taxonomyOptionsForValue,
  PROVIDER_TAXONOMY_CODES,
  PROVIDER_TAXONOMY_OPTIONS,
} from "@/lib/providerTaxonomy";

describe("providerTaxonomy", () => {
  it("accepts the PT base and PTA codes", () => {
    expect(isKnownTaxonomyCode("225100000X")).toBe(true);
    expect(isKnownTaxonomyCode("225200000X")).toBe(true);
  });

  it("accepts PT specialization codes", () => {
    expect(isKnownTaxonomyCode("2251S0007X")).toBe(true);
    expect(isKnownTaxonomyCode("2251N0400X")).toBe(true);
  });

  it("accepts dietitian / nutrition taxonomy", () => {
    expect(isKnownTaxonomyCode("133V00000X")).toBe(true);
    expect(taxonomyLabel("133V00000X")).toBe("Dietitian, Nutrition, Registered");
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(isKnownTaxonomyCode("  225100000x  ")).toBe(true);
    expect(isKnownTaxonomyCode("  133v00000x  ")).toBe(true);
  });

  it("rejects codes outside the catalog", () => {
    expect(isKnownTaxonomyCode("207Q00000X")).toBe(false); // family medicine
    expect(isKnownTaxonomyCode("225X00000X")).toBe(false); // pattern-looking, not a real code
    expect(isKnownTaxonomyCode("")).toBe(false);
  });

  it("returns a label for known codes and null otherwise", () => {
    expect(taxonomyLabel("225100000X")).toBe("Physical Therapist");
    expect(taxonomyLabel("225200000x")).toBe("Physical Therapist Assistant");
    expect(taxonomyLabel("207Q00000X")).toBeNull();
  });

  it("every catalog entry validates and options stay in sync", () => {
    for (const code of Object.keys(PROVIDER_TAXONOMY_CODES)) {
      expect(isKnownTaxonomyCode(code)).toBe(true);
    }
    expect(PROVIDER_TAXONOMY_OPTIONS).toHaveLength(Object.keys(PROVIDER_TAXONOMY_CODES).length);
    expect(PROVIDER_TAXONOMY_OPTIONS.map((o) => o.code)).toContain("133V00000X");
  });

  it("taxonomyOptionsForValue appends a legacy current value outside the catalog", () => {
    const withLegacy = taxonomyOptionsForValue("207Q00000X");
    expect(withLegacy).toHaveLength(PROVIDER_TAXONOMY_OPTIONS.length + 1);
    expect(withLegacy.at(-1)).toEqual({
      code: "207Q00000X",
      label: "Current value (not in catalog)",
    });
    expect(taxonomyOptionsForValue("225100000X")).toHaveLength(PROVIDER_TAXONOMY_OPTIONS.length);
    expect(taxonomyOptionsForValue("")).toHaveLength(PROVIDER_TAXONOMY_OPTIONS.length);
  });
});
