// E1.7b TE-7 — the concrete reconciliation test: every token the SOP
// authoring picker advertises is one the client resolver can substitute, and
// the case-scoped catalog families are excluded from dataFields authoring.
import { describe, expect, it } from "vitest";
import { AUTHORING_EXCLUDED_TOKENS, filterAuthoringTokens } from "./sopAuthoringTokens";
import { isResolvableToken } from "./sopResolver";

// A representative slice of the live get_sop_field_tokens() catalog plus the
// user.* family the token-catalog service appends.
const CATALOG = [
  { token: "provider.firstName", table: "providers", column: "first_name" },
  { token: "provider.npi", table: "providers", column: "npi" },
  { token: "provider.deaNumber", table: "providers", column: "dea_number" },
  { token: "group.tin", table: "provider_groups", column: "tin" },
  { token: "facility.street", table: "facilities", column: "street" },
  { token: "facility.city", table: "facilities", column: "city" },
  { token: "license.licenseNumber", table: "state_licenses", column: "license_number" },
  { token: "payer.name", table: "payers", column: "name" },
  { token: "mso.portalUrl", table: "msos", column: "portal_url" },
  { token: "contract.effectiveDate", table: "contracts", column: "effective_date" },
  { token: "assignment.startDate", table: "provider_facility_assignments", column: "start_date" },
  {
    token: "groupInsurance.policyNumber",
    table: "group_insurance_policies",
    column: "policy_number",
  },
  { token: "user.name", table: "auth", column: "user_metadata.full_name" },
  { token: "user.email", table: "auth", column: "jwt.email" },
  { token: "provider.ssnLast4", table: "providers", column: "ssn_last4" },
];

describe("filterAuthoringTokens", () => {
  it("advertises only resolver-resolvable tokens", () => {
    for (const entry of filterAuthoringTokens(CATALOG)) {
      expect(isResolvableToken(entry.token)).toBe(true);
    }
  });

  it("widens with the catalog: an entity column the resolver never named is kept", () => {
    const kept = filterAuthoringTokens(CATALOG).map((e) => e.token);
    expect(kept).toContain("provider.deaNumber");
  });

  it("drops the policy-excluded tokens even though they resolve", () => {
    const kept = filterAuthoringTokens(CATALOG).map((e) => e.token);
    for (const token of AUTHORING_EXCLUDED_TOKENS) {
      expect(isResolvableToken(token)).toBe(true);
      expect(kept).not.toContain(token);
    }
  });

  it("keeps resolvable catalog tokens, including the TE-7 aliases", () => {
    const kept = filterAuthoringTokens(CATALOG).map((e) => e.token);
    expect(kept).toContain("provider.firstName");
    expect(kept).toContain("provider.npi");
    expect(kept).toContain("group.tin");
    expect(kept).toContain("facility.street");
    expect(kept).toContain("license.licenseNumber");
    expect(kept).toContain("mso.portalUrl");
  });

  it("excludes case-scoped families and tokens the resolver cannot substitute", () => {
    const kept = filterAuthoringTokens(CATALOG).map((e) => e.token);
    expect(kept).not.toContain("payer.name");
    expect(kept).not.toContain("contract.effectiveDate");
    expect(kept).not.toContain("assignment.startDate");
    expect(kept).not.toContain("groupInsurance.policyNumber");
    expect(kept).not.toContain("user.name");
    expect(kept).not.toContain("user.email");
  });
});
