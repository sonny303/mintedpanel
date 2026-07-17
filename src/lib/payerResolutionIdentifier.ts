// E4.0 TE-6 / F4.0.3 — the resolver SEAM for the payer-issued enrollment
// identifier's label and expectedness. Payers name the individual (Type 1)
// identifier differently (Aetna's "Provider PIN", BCBS's "Provider ID"), and
// whether one is expected is a per-payer setting. That config is OWNED BY E4.2
// (F4.2.1); this epic ships only the generic default and reads it through this
// seam so E4.2 can plug the per-payer config in WITHOUT reworking the approval
// step. Pure; no I/O.
//
// The Group/Billing (Type 2 / Tax-ID) identifier is NOT per-payer configured —
// its label is fixed — so only the individual field routes through this seam.

import type { OrgPayerSetting, Payer } from "@/types";

export interface ResolutionIdentifierConfig {
  /** Label for the Individual (Type 1 NPI-linked) provider-ID field. */
  individualLabel: string;
  /** Whether this payer is expected to issue an individual identifier. E4.2
   * config; unconfigured payers default to true (offer it, skippable). */
  expected: boolean;
}

/** The unconfigured fallback used until E4.2 attaches per-payer config. */
export const DEFAULT_RESOLUTION_IDENTIFIER: ResolutionIdentifierConfig = {
  individualLabel: "Payer-issued ID",
  expected: true,
};

/** Fixed label for the Group/Billing (Type 2 / Tax-ID-linked) identifier. */
export const GROUP_PROVIDER_ID_LABEL = "Group/Billing Provider ID";

// E4.2 (F4.2.1, hardened by the payer-governance PR) — the per-payer lookup is
// now a three-tier chain, most specific wins per field:
//   1. the ORG's own setting (org_payer_settings — the only tier an org admin
//      can write; configured via the payer-admin "Configure ID" dialog),
//   2. the Minted-curated GLOBAL config on the payers row (org-read-only),
//   3. the generic "Payer-issued ID" default (offered, skippable).
// Pure — callers pass the org setting in (useOrgPayerSetting); no I/O here.
export function resolveIdentifierConfig(
  payer?: Payer | null,
  orgSetting?: OrgPayerSetting | null,
): ResolutionIdentifierConfig {
  const orgLabel = orgSetting?.resolutionIdLabel?.trim();
  const globalLabel = payer?.resolutionIdLabel?.trim();
  return {
    individualLabel: orgLabel || globalLabel || DEFAULT_RESOLUTION_IDENTIFIER.individualLabel,
    expected:
      typeof orgSetting?.resolutionIdExpected === "boolean"
        ? orgSetting.resolutionIdExpected
        : typeof payer?.resolutionIdExpected === "boolean"
          ? payer.resolutionIdExpected
          : DEFAULT_RESOLUTION_IDENTIFIER.expected,
  };
}
