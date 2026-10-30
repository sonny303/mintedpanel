import { describe, expect, it } from "vitest";
import {
  contractSpecialtyForTaxonomy,
  contractSpecialtyKeyOf,
  contractTripleKey,
  indexContractsBySpecialty,
  isContractSpecialtyKey,
  MATRIX_SPECIALTIES,
  resolveContractForSpecialty,
} from "@/lib/contractSpecialty";
import type { ContractSpecialtyKey } from "@/types";

interface Row {
  id: string;
  groupId: string | null;
  payerId: string | null;
  state: string;
  specialtyKey?: ContractSpecialtyKey;
}

const key = { groupId: "g2", payerId: "p1", state: "KS" };

describe("contractSpecialtyForTaxonomy", () => {
  it("puts PT and PTA under Physical therapy", () => {
    expect(contractSpecialtyForTaxonomy("225100000X")).toBe("pt");
    expect(contractSpecialtyForTaxonomy("2251X0800X")).toBe("pt");
    expect(contractSpecialtyForTaxonomy("225200000X")).toBe("pt");
  });

  it("puts OT/OTA, SLP, dietitians, nutritionists and chiropractors in their own specialty", () => {
    expect(contractSpecialtyForTaxonomy("225X00000X")).toBe("ot");
    expect(contractSpecialtyForTaxonomy("224Z00000X")).toBe("ot");
    expect(contractSpecialtyForTaxonomy("235Z00000X")).toBe("slp");
    expect(contractSpecialtyForTaxonomy("133V00000X")).toBe("nutrition");
    expect(contractSpecialtyForTaxonomy("133VN1101X")).toBe("nutrition");
    expect(contractSpecialtyForTaxonomy("133N00000X")).toBe("nutrition");
    expect(contractSpecialtyForTaxonomy("111N00000X")).toBe("chiro");
  });

  it("returns null for blank, unknown and out-of-scope codes", () => {
    expect(contractSpecialtyForTaxonomy(null)).toBeNull();
    expect(contractSpecialtyForTaxonomy("  ")).toBeNull();
    expect(contractSpecialtyForTaxonomy("133V99999X")).toBeNull();
    expect(contractSpecialtyForTaxonomy("207Q00000X")).toBeNull();
  });

  it("normalizes case", () => {
    expect(contractSpecialtyForTaxonomy("133v00000x")).toBe("nutrition");
  });
});

describe("contractSpecialtyKeyOf", () => {
  it("reads a missing or unknown key as all", () => {
    expect(contractSpecialtyKeyOf({})).toBe("all");
    expect(contractSpecialtyKeyOf({ specialtyKey: null })).toBe("all");
    expect(contractSpecialtyKeyOf({ specialtyKey: "dental" })).toBe("all");
    expect(contractSpecialtyKeyOf({ specialtyKey: "nutrition" })).toBe("nutrition");
  });

  it("recognizes exactly the six keys", () => {
    expect(isContractSpecialtyKey("pt")).toBe(true);
    expect(isContractSpecialtyKey("PT")).toBe(false);
    expect(isContractSpecialtyKey(undefined)).toBe(false);
  });
});

describe("MATRIX_SPECIALTIES", () => {
  it("is Physical therapy then Nutrition in v1", () => {
    expect(MATRIX_SPECIALTIES).toEqual(["pt", "nutrition"]);
  });
});

describe("resolveContractForSpecialty", () => {
  const shared: Row = { id: "all", ...key, specialtyKey: "all" };
  const nutrition: Row = { id: "nu", ...key, specialtyKey: "nutrition" };
  const legacy: Row = { id: "legacy", groupId: "g1", payerId: "p1", state: "co" };

  it("prefers the specialty's own record over the shared one", () => {
    const index = indexContractsBySpecialty([shared, nutrition]);
    expect(resolveContractForSpecialty(index, key, "nutrition")).toEqual({
      contract: nutrition,
      shared: false,
    });
  });

  it("falls back to the all-specialties record, marked shared", () => {
    const index = indexContractsBySpecialty([shared, nutrition]);
    expect(resolveContractForSpecialty(index, key, "pt")).toEqual({
      contract: shared,
      shared: true,
    });
  });

  it("gives an unknown specialty only the shared record", () => {
    expect(
      resolveContractForSpecialty(indexContractsBySpecialty([nutrition]), key, null),
    ).toBeNull();
    expect(
      resolveContractForSpecialty(indexContractsBySpecialty([shared, nutrition]), key, null),
    ).toEqual({ contract: shared, shared: true });
  });

  it("treats a pre-migration row with no key as all, and matches state case-insensitively", () => {
    const index = indexContractsBySpecialty([legacy]);
    expect(
      resolveContractForSpecialty(index, { groupId: "g1", payerId: "p1", state: "CO" }, "pt"),
    ).toEqual({ contract: legacy, shared: true });
  });

  it("returns null when nothing exists at the key", () => {
    expect(resolveContractForSpecialty(indexContractsBySpecialty([]), key, "pt")).toBeNull();
  });

  it("keys the triple with an upper-cased state", () => {
    expect(contractTripleKey({ groupId: "g", payerId: "p", state: "ks" })).toBe("g|p|KS");
  });
});
