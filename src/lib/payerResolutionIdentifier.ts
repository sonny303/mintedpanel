// E4.0 TE-6 / F4.0.3 — the resolver SEAM for the payer-issued enrollment
// identifier's label and expectedness. Payers name the individual (Type 1)
// identifier differently (Aetna's "Provider PIN", BCBS's "Provider ID"), and
// whether one is expected is a per-payer fact. Pure; no I/O.
//
// 2026-07-20 re-scope (user handoff): the label is a property of the PAYER
// DEFINITION — the Minted-curated `payers.resolution_id_label` /
// `resolution_id_expected` columns — with the generic default beneath it. The
// former org_payer_settings override tier is retired app-side (the table stays
// dormant per the additive rule; no reader remains). The issued VALUE never
// lives here: it is captured where it is issued — on the provider's
// enrollment fact (enrollment_facts.payer_issued_id) or the group's payer
// network target (payer_network_targets.payer_issued_id).
//
// The Group/Billing (Type 2 / Tax-ID) identifier is NOT per-payer configured —
// its label is fixed — so only the individual field routes through this seam.

import type { Payer } from "@/types";

export interface ResolutionIdentifierConfig {
  /** Label for the Individual (Type 1 NPI-linked) provider-ID field. */
  individualLabel: string;
  /** Whether this payer is expected to issue an individual identifier.
   * Unconfigured payers default to true (offer it, skippable). */
  expected: boolean;
}

/** The unconfigured fallback used when the payer carries no curated config. */
export const DEFAULT_RESOLUTION_IDENTIFIER: ResolutionIdentifierConfig = {
  individualLabel: "Payer-issued ID",
  expected: true,
};

/** Fixed label for the Group/Billing (Type 2 / Tax-ID-linked) identifier. */
export const GROUP_PROVIDER_ID_LABEL = "Group/Billing Provider ID";

// The per-payer lookup is a two-tier chain, most specific wins per field:
//   1. the Minted-curated config on the payers row (org-read-only —
//      catalog identity is platform-managed),
//   2. the generic "Payer-issued ID" default (offered, skippable).
export function resolveIdentifierConfig(payer?: Payer | null): ResolutionIdentifierConfig {
  const globalLabel = payer?.resolutionIdLabel?.trim();
  return {
    individualLabel: globalLabel || DEFAULT_RESOLUTION_IDENTIFIER.individualLabel,
    expected:
      typeof payer?.resolutionIdExpected === "boolean"
        ? payer.resolutionIdExpected
        : DEFAULT_RESOLUTION_IDENTIFIER.expected,
  };
}
