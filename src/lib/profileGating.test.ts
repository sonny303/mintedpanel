import { describe, expect, it } from "vitest";
import type { ProviderReadinessFacts } from "./enrollmentReadiness";
import {
  evaluateProfileGate,
  normalizeRequiredAttributes,
  outreachTaskTitle,
  PROFILE_ATTRIBUTE_KEYS,
} from "./profileGating";

function facts(overrides: Partial<ProviderReadinessFacts>): ProviderReadinessFacts {
  return {
    providerId: "p1",
    providerName: "Riggins, Tim",
    npiPresent: true,
    caqhIdPresent: true,
    caqhLastAttestedDate: "2026-06-01",
    dobPresent: true,
    ssnLast4Present: true,
    homeAddressPresent: true,
    ...overrides,
  };
}

describe("profileGating", () => {
  it("normalizes stored attributes, dropping unknown + dupes", () => {
    expect(normalizeRequiredAttributes(["caqh_id", "npi", "caqh_id", "bogus", 3])).toEqual([
      "caqh_id",
      "npi",
    ]);
    expect(normalizeRequiredAttributes(null)).toEqual([]);
    expect(normalizeRequiredAttributes("caqh_id")).toEqual([]);
  });

  it("passes when every required attribute is present", () => {
    const r = evaluateProfileGate(["caqh_id", "npi"], facts({}));
    expect(r.passed).toBe(true);
    expect(r.unmet).toEqual([]);
  });

  it("blocks with the exact unmet attributes in catalog order (TS-96)", () => {
    const r = evaluateProfileGate(
      ["npi", "caqh_id", "home_address"],
      facts({ caqhIdPresent: false, homeAddressPresent: false }),
    );
    expect(r.passed).toBe(false);
    expect(r.unmet.map((u) => u.key)).toEqual(["caqh_id", "home_address"]);
    expect(r.unmet[0].label).toBe("CAQH ID");
  });

  it("empty requirements never block", () => {
    expect(evaluateProfileGate([], facts({ caqhIdPresent: false })).passed).toBe(true);
  });

  it("builds an outreach title naming the missing attributes", () => {
    const r = evaluateProfileGate(["caqh_id"], facts({ caqhIdPresent: false }));
    expect(outreachTaskTitle("Riggins, Tim", r.unmet)).toBe(
      "Collect missing info from Riggins, Tim: CAQH ID",
    );
  });

  it("every catalog key is evaluable", () => {
    for (const key of PROFILE_ATTRIBUTE_KEYS) {
      // a provider missing everything must report each key as unmet
      const allMissing = facts({
        npiPresent: false,
        caqhIdPresent: false,
        caqhLastAttestedDate: null,
        dobPresent: false,
        ssnLast4Present: false,
        homeAddressPresent: false,
      });
      expect(evaluateProfileGate([key], allMissing).passed).toBe(false);
    }
  });
});
