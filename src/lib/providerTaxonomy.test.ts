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

  it("offers exact OT, OTA, and SLP catalog codes for enrollment capture", () => {
    for (const code of [
      "225X00000X",
      "225XR0403X",
      "225XE0001X",
      "225XE1200X",
      "225XF0002X",
      "225XG0600X",
      "225XH1200X",
      "225XH1300X",
      "225XL0004X",
      "225XM0800X",
      "225XN1300X",
      "225XP0200X",
      "225XP0019X",
      "224Z00000X",
      "224ZR0403X",
      "224ZE0001X",
      "224ZF0002X",
      "224ZL0004X",
      "235Z00000X",
    ]) {
      expect(isKnownTaxonomyCode(code), code).toBe(true);
      expect(taxonomyLabel(code), code).not.toBeNull();
    }
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(isKnownTaxonomyCode("  225100000x  ")).toBe(true);
    expect(isKnownTaxonomyCode("  133v00000x  ")).toBe(true);
  });

  it("rejects codes outside the catalog", () => {
    expect(isKnownTaxonomyCode("207Q00000X")).toBe(false); // family medicine
    expect(isKnownTaxonomyCode("225X99999X")).toBe(false); // looks plausible, absent from catalog
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
