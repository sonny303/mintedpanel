import { describe, expect, it } from "vitest";
import { NUCC_TAXONOMY_CODE_COUNT, NUCC_TAXONOMY_CODES } from "@/lib/nuccTaxonomyCodes";
import {
  getNuccCodesForDiscipline,
  KNOWN_NUCC_CODES,
  providerDisciplineForTaxonomy,
} from "@/lib/providerDiscipline";

describe("providerDisciplineForTaxonomy", () => {
  it("maps exact PT/PTA/OT/OTA/SLP code sets", () => {
    expect(providerDisciplineForTaxonomy("2251S0007X")).toBe("PT");
    expect(providerDisciplineForTaxonomy("225200000X")).toBe("PTA");
    expect(providerDisciplineForTaxonomy("225XR0403X")).toBe("OT");
    expect(providerDisciplineForTaxonomy("224ZF0002X")).toBe("OTA");
    expect(providerDisciplineForTaxonomy("235Z00000X")).toBe("SLP");
  });

  it("maps another exact recognized NUCC code to Other", () => {
    expect(NUCC_TAXONOMY_CODES.has("133V00000X")).toBe(true);
    expect(providerDisciplineForTaxonomy("133V00000X")).toBe("Other");
  });

  it("treats blank and unrecognized codes as Unknown without prefix inference", () => {
    expect(providerDisciplineForTaxonomy(null)).toBe("Unknown");
    expect(providerDisciplineForTaxonomy("   ")).toBe("Unknown");
    expect(providerDisciplineForTaxonomy("225X99999X")).toBe("Unknown");
    expect(providerDisciplineForTaxonomy("225XR9999X")).toBe("Unknown");
  });

  it("normalizes case and checks the complete reviewed catalog", () => {
    expect(providerDisciplineForTaxonomy(" 235z00000x ")).toBe("SLP");
    expect(NUCC_TAXONOMY_CODES.size).toBe(NUCC_TAXONOMY_CODE_COUNT);
    expect(KNOWN_NUCC_CODES).toHaveLength(NUCC_TAXONOMY_CODE_COUNT);
    expect(new Set(KNOWN_NUCC_CODES).size).toBe(NUCC_TAXONOMY_CODE_COUNT);
    expect([...KNOWN_NUCC_CODES]).toEqual([...KNOWN_NUCC_CODES].sort());
  });

  it("provides complete exact-code partitions for server filtering", () => {
    const specialtyCodes = ["PT", "PTA", "OT", "OTA", "SLP", "Other"] as const;
    const partition = specialtyCodes.flatMap((category) => getNuccCodesForDiscipline(category));
    expect(new Set(partition).size).toBe(KNOWN_NUCC_CODES.length);
    expect([...partition].sort()).toEqual(KNOWN_NUCC_CODES);
    expect(getNuccCodesForDiscipline("PT")).toContain("225100000X");
    expect(getNuccCodesForDiscipline("PT")).toContain("2251S0007X");
  });
});
