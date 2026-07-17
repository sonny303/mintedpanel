import { describe, it, expect } from "vitest";
import {
  MAX_QUICK_CARD_FIELDS,
  QUICK_CARD_FIELD_CATALOG,
  isQuickCardField,
  validateQuickCardFields,
} from "./quickCardCatalog";

describe("quick-card catalog (E4.3 TE-16)", () => {
  it("structurally excludes ssnLast4 and any vault/full-SSN token", () => {
    expect(isQuickCardField("provider.ssnLast4")).toBe(false);
    // A hypothetical full-SSN / vault token is never in the catalog.
    expect(isQuickCardField("provider.ssn")).toBe(false);
    expect(QUICK_CARD_FIELD_CATALOG).not.toContain("provider.ssnLast4");
  });

  it("excludes case-scoped payer/mso/contract tokens (never resolve on a profile)", () => {
    for (const key of QUICK_CARD_FIELD_CATALOG) {
      expect(key.startsWith("payer.")).toBe(false);
      expect(key.startsWith("mso.")).toBe(false);
      expect(key.startsWith("contract.")).toBe(false);
    }
  });

  it("includes the default card fields (NPI, CAQH, license #, DOB, group NPI, TIN, malpractice)", () => {
    for (const key of [
      "provider.npi",
      "provider.caqhId",
      "license.licenseNumber",
      "provider.dateOfBirth",
      "group.npiType2",
      "group.tin",
      "groupInsurance.insurerName",
      "groupInsurance.policyEndDate",
    ]) {
      expect(isQuickCardField(key)).toBe(true);
    }
  });

  it("has no duplicate catalog entries", () => {
    expect(new Set(QUICK_CARD_FIELD_CATALOG).size).toBe(QUICK_CARD_FIELD_CATALOG.length);
  });
});

describe("validateQuickCardFields", () => {
  it("accepts a bounded, deduped, ordered list of catalog keys and preserves order", () => {
    const fields = ["license.licenseNumber", "provider.npi", "group.tin"];
    const result = validateQuickCardFields(fields);
    expect(result).toEqual({ ok: true, fields });
  });

  it("accepts an empty list (clears the layout)", () => {
    expect(validateQuickCardFields([])).toEqual({ ok: true, fields: [] });
  });

  it("rejects a non-array", () => {
    expect(validateQuickCardFields("provider.npi").ok).toBe(false);
    expect(validateQuickCardFields(null).ok).toBe(false);
    expect(validateQuickCardFields({ 0: "provider.npi" }).ok).toBe(false);
  });

  it("rejects a non-string element", () => {
    expect(validateQuickCardFields(["provider.npi", 42]).ok).toBe(false);
  });

  it("rejects an excluded/unknown key (ssnLast4)", () => {
    const result = validateQuickCardFields(["provider.npi", "provider.ssnLast4"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/ssnLast4/);
  });

  it("rejects a duplicate key", () => {
    const result = validateQuickCardFields(["provider.npi", "provider.npi"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/duplicate/);
  });

  it(`rejects more than ${MAX_QUICK_CARD_FIELDS} entries`, () => {
    const tooMany = QUICK_CARD_FIELD_CATALOG.slice(0, MAX_QUICK_CARD_FIELDS + 1);
    // Guard: the catalog is large enough for this bound to be exercised.
    expect(tooMany.length).toBe(MAX_QUICK_CARD_FIELDS + 1);
    expect(validateQuickCardFields(tooMany).ok).toBe(false);
  });
});
