// DYN-TOKEN-05 — the one rule deciding which state license `license.*` means.
// Shared by the web profile (server) and the payer-PDF fill (browser), so a
// divergence here is a divergence between two surfaces filling the same form.
import { describe, expect, it } from "vitest";

import { pickLicenseForState } from "@/lib/licensePick";

const ks = { state: "KS", licenseNumber: "KS-100" };
const mo = { state: "MO", licenseNumber: "MO-200" };

describe("pickLicenseForState", () => {
  it("picks the license matching the requested state", () => {
    expect(pickLicenseForState([ks, mo], "MO").row).toBe(mo);
    expect(pickLicenseForState([ks, mo], "KS").row).toBe(ks);
  });

  it("is case- and whitespace-insensitive on the state code", () => {
    expect(pickLicenseForState([ks, mo], "mo").row).toBe(mo);
    expect(pickLicenseForState([ks, mo], " Mo ").row).toBe(mo);
  });

  it("takes the sole license when no state is named", () => {
    expect(pickLicenseForState([ks], null).row).toBe(ks);
    expect(pickLicenseForState([ks], undefined).row).toBe(ks);
    expect(pickLicenseForState([ks], "").row).toBe(ks);
  });

  // The whole point. A wrong-but-plausible license number on a payer
  // application is worse than a visible blank, so the rule declines.
  it("REFUSES to guess between several licenses with no state", () => {
    const picked = pickLicenseForState([ks, mo], null);
    expect(picked.row).toBeNull();
    expect(picked.reason).toContain("2 state licenses");
    expect(picked.reason).toContain("?state=");
  });

  it("never falls back to another state when the requested one is missing", () => {
    const picked = pickLicenseForState([ks, mo], "NC");
    expect(picked.row).toBeNull();
    expect(picked.reason).toBe("provider has no NC license");
  });

  it("says so when the provider has no licenses at all", () => {
    const picked = pickLicenseForState([], "KS");
    expect(picked.row).toBeNull();
    expect(picked.reason).toBe("provider has no state licenses");
  });

  it("reports a reason on every refusal, so a caller can always explain itself", () => {
    for (const picked of [
      pickLicenseForState([], "KS"),
      pickLicenseForState([ks, mo], null),
      pickLicenseForState([ks, mo], "NC"),
    ]) {
      expect(picked.row).toBeNull();
      expect(picked.reason).toBeTruthy();
    }
  });

  it("reads `state` the same on snake_case server rows and camelCase entities", () => {
    // The server passes raw Postgres rows, the browser passes StateLicense.
    // `state` is spelled identically in both, which is why one rule serves each.
    const serverRow = { state: "KS", license_number: "KS-100" };
    expect(pickLicenseForState([serverRow], "KS").row).toBe(serverRow);
  });
});
