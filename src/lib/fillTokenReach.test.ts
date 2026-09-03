// DYN-TOKEN-01 / -06 — what each fill surface can reach, and what the mapping
// pickers may therefore offer. Measured in
// docs/ops/dyn-token-00-parity-spike.md.
import { describe, expect, it } from "vitest";

import { ENTITY_TOKEN_FAMILIES } from "@/lib/entityTokens";
import {
  PDF_FILL_FAMILIES,
  UNFILLABLE_FAMILIES,
  WEB_FILL_FAMILIES,
  WITHDRAWN_TOKENS,
  filterMappingTokens,
  isPdfFillableToken,
  isUnfillableToken,
  isWebFillableToken,
  isWithdrawnToken,
} from "@/lib/fillTokenReach";

describe("isPdfFillableToken", () => {
  it("admits exactly the families buildProviderTokenValues passes", () => {
    expect(isPdfFillableToken("provider.npi")).toBe(true);
    expect(isPdfFillableToken("group.tin")).toBe(true);
    expect(isPdfFillableToken("facility.city")).toBe(true);
    // DYN-TOKEN-05 — case page picks a state_licenses row and passes it.
    expect(isPdfFillableToken("license.licenseNumber")).toBe(true);
    expect(isPdfFillableToken("license.expirationDate")).toBe(true);
  });

  it("rejects every family with no row in hand on the case page", () => {
    for (const token of [
      "assignment.isPrimary",
      "groupInsurance.policyNumber",
      "user.name",
      "payer.name",
      "contract.effectiveDate",
      "mso.name",
    ]) {
      expect(isPdfFillableToken(token)).toBe(false);
    }
  });

  // The bug this constant exists to prevent: ENTITY_TOKEN_FAMILIES includes
  // `mso` because the SOP resolver passes an MSO row, and omits `license`
  // because that module does not choose a child row. buildProviderTokenValues
  // is the opposite on both counts — reusing that list would lie either way.
  it("is NOT ENTITY_TOKEN_FAMILIES — mso yes there / no here; license inverted", () => {
    expect(ENTITY_TOKEN_FAMILIES).toContain("mso");
    expect(ENTITY_TOKEN_FAMILIES).not.toContain("license");
    expect(PDF_FILL_FAMILIES).not.toContain("mso");
    expect(PDF_FILL_FAMILIES).toContain("license");
    expect(isPdfFillableToken("mso.name")).toBe(false);
    expect(isPdfFillableToken("license.state")).toBe(true);
  });
});

describe("isWebFillableToken", () => {
  it("admits the six profile source rows plus the appended user family", () => {
    for (const token of [
      "provider.npi",
      "group.tin",
      "facility.city",
      "license.expirationDate",
      "assignment.isPrimary",
      "groupInsurance.policyNumber",
      "user.name",
    ]) {
      expect(isWebFillableToken(token)).toBe(true);
    }
  });

  it("rejects the case-scoped families the profile route nulls with a reason", () => {
    expect(isWebFillableToken("payer.name")).toBe(false);
    expect(isWebFillableToken("contract.effectiveDate")).toBe(false);
    expect(isWebFillableToken("mso.name")).toBe(false);
  });

  it("reaches strictly more than the PDF fill — that gap IS the parity work", () => {
    for (const family of PDF_FILL_FAMILIES) {
      expect(WEB_FILL_FAMILIES).toContain(family);
    }
    expect(WEB_FILL_FAMILIES.length).toBeGreaterThan(PDF_FILL_FAMILIES.length);
  });
});

describe("isUnfillableToken / UNFILLABLE_FAMILIES", () => {
  it("is exactly the families NEITHER surface resolves", () => {
    for (const family of UNFILLABLE_FAMILIES) {
      expect(WEB_FILL_FAMILIES).not.toContain(family);
      expect(PDF_FILL_FAMILIES).not.toContain(family);
      expect(isUnfillableToken(`${family}.anything`)).toBe(true);
    }
  });

  it("never claims a token one surface can fill", () => {
    // license/user resolve on web only. Withdrawing them would delete working
    // web mappings — narrowing per-surface is DYN-TOKEN-02, not this bite.
    expect(isUnfillableToken("license.expirationDate")).toBe(false);
    expect(isUnfillableToken("user.name")).toBe(false);
    expect(isUnfillableToken("provider.npi")).toBe(false);
  });
});

describe("WITHDRAWN_TOKENS (DYN-TOKEN-05)", () => {
  it("withdraws the four dead providers.license_* columns", () => {
    for (const token of [
      "provider.licenseNumber",
      "provider.licenseState",
      "provider.licenseIssueDate",
      "provider.licenseExpirationDate",
    ]) {
      expect(isWithdrawnToken(token)).toBe(true);
    }
  });

  it("withdraws TOKENS, not the provider family — the rest still map", () => {
    expect(isWithdrawnToken("provider.npi")).toBe(false);
    expect(isWithdrawnToken("provider.firstName")).toBe(false);
    expect(isPdfFillableToken("provider.npi")).toBe(true);
  });

  // license.* is the canonical spelling and must NOT be caught by this list.
  it("leaves the real state_licenses tokens alone", () => {
    for (const token of [
      "license.licenseNumber",
      "license.state",
      "license.issueDate",
      "license.expirationDate",
    ]) {
      expect(isWithdrawnToken(token)).toBe(false);
    }
  });

  it("names only provider.* tokens — a family withdrawal would be the wrong tool", () => {
    for (const token of WITHDRAWN_TOKENS) {
      expect(token.startsWith("provider.")).toBe(true);
    }
  });
});

describe("filterMappingTokens", () => {
  const catalog = [
    { token: "provider.npi" },
    { token: "license.expirationDate" },
    { token: "user.name" },
    { token: "payer.name" },
    { token: "contract.effectiveDate" },
    { token: "mso.name" },
  ];

  it("drops only the never-fillable families", () => {
    expect(filterMappingTokens(catalog).map((e) => e.token)).toEqual([
      "provider.npi",
      "license.expirationDate",
      "user.name",
    ]);
  });

  it("also drops the individually withdrawn tokens", () => {
    const withLegacy = [
      { token: "provider.npi" },
      { token: "provider.licenseNumber" },
      { token: "provider.licenseState" },
      { token: "license.licenseNumber" },
    ];
    expect(filterMappingTokens(withLegacy).map((e) => e.token)).toEqual([
      "provider.npi",
      "license.licenseNumber",
    ]);
  });

  it("preserves order and passes non-token fields through untouched", () => {
    const rows = [
      { token: "payer.name", table: "payers", column: "name" },
      { token: "group.tin", table: "provider_groups", column: "tin" },
    ];
    expect(filterMappingTokens(rows)).toEqual([
      { token: "group.tin", table: "provider_groups", column: "tin" },
    ]);
  });

  it("keeps a malformed or family-less token rather than silently eating it", () => {
    // A bare key is not one of the three withdrawn families, so it stays
    // visible. Swallowing unrecognized tokens would hide a catalog bug.
    expect(filterMappingTokens([{ token: "weird" }, { token: "" }])).toHaveLength(2);
  });
});
