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

import type { Payer } from "@/types";

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

// E4.2 (F4.2.1) — per-payer lookup. A payer whose config names its individual
// identifier (e.g. Aetna "Provider PIN") and whether it is expected overrides
// the generic default; an unconfigured payer (null label) falls back to the
// generic "Payer-issued ID" optional field.
export function resolveIdentifierConfig(payer?: Payer | null): ResolutionIdentifierConfig {
  if (!payer) return DEFAULT_RESOLUTION_IDENTIFIER;
  const label = payer.resolutionIdLabel?.trim();
  return {
    individualLabel: label ? label : DEFAULT_RESOLUTION_IDENTIFIER.individualLabel,
    expected:
      typeof payer.resolutionIdExpected === "boolean"
        ? payer.resolutionIdExpected
        : DEFAULT_RESOLUTION_IDENTIFIER.expected,
  };
}
