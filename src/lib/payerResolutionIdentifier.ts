// E4.0 TE-6 / F4.0.3 — the resolver SEAM for the payer-issued enrollment
// identifier's label and expectedness. Payers name the individual (Type 1)
// identifier differently (Aetna's "Provider PIN", BCBS's "Provider ID"), and
// whether one is expected is a per-payer fact. Pure; no I/O.
//
// 2026-07-20 re-scope (user handoff): the label is a property of the PAYER
// DEFINITION with the generic default beneath it. The former
// org_payer_settings override tier is retired app-side (the table stays
// dormant per the additive rule; no reader remains). The issued VALUE never
// lives here: it is captured where it is issued — on the provider's
// enrollment fact (enrollment_facts.payer_issued_id) or the group's payer
// network target (payer_network_targets.payer_issued_id).
//
// E6.7 F6.7.1a (the ID-expectation split): a payer may issue a GROUP ID, a
// PROVIDER ID, both, or neither — one pair can't say which, so `payers` now
// carries provider_id_label/-_expected AND group_id_label/-_expected. The
// individual chain reads the NEW provider pair first, then the deprecated
// legacy resolution_id_* pair (stop-write, backfilled into the provider pair
// at migration time), then the generic default. The group side gets its own
// resolver — its label was fixed before E6.7 and now defaults the same way.
// set_case_status enforces the same expectations at Approved (require exactly
// the expected IDs); keep this module in lockstep with that RPC's COALESCE
// chain (migration 20260727120000).

import type { Payer } from "@/types";

export interface ResolutionIdentifierConfig {
  /** Label for the Individual (Type 1 NPI-linked) provider-ID field. */
  individualLabel: string;
  /** Whether this payer is expected to issue an individual identifier.
   * Unconfigured payers default to true (offer it, required at Approved). */
  expected: boolean;
}

/** The unconfigured fallback used when the payer carries no curated config. */
export const DEFAULT_RESOLUTION_IDENTIFIER: ResolutionIdentifierConfig = {
  individualLabel: "Payer-issued ID",
  expected: true,
};

/** Default label for the Group/Billing (Type 2 / Tax-ID-linked) identifier —
 * overridable per payer via group_id_label since E6.7. */
export const GROUP_PROVIDER_ID_LABEL = "Group/Billing Provider ID";

export interface GroupIdentifierConfig {
  /** Label for the Group/Billing (Type 2 / Tax-ID-linked) provider-ID field. */
  groupLabel: string;
  /** Whether this payer is expected to issue a group identifier.
   * Unconfigured payers default to false (today's behavior — optional). */
  expected: boolean;
}

export const DEFAULT_GROUP_IDENTIFIER: GroupIdentifierConfig = {
  groupLabel: GROUP_PROVIDER_ID_LABEL,
  expected: false,
};

// Individual chain, most specific wins per field:
//   1. the E6.7 provider pair on the payers row,
//   2. the deprecated legacy resolution pair (stop-write),
//   3. the generic "Payer-issued ID" default (expected).
export function resolveIdentifierConfig(payer?: Payer | null): ResolutionIdentifierConfig {
  const providerLabel = payer?.providerIdLabel?.trim();
  const legacyLabel = payer?.resolutionIdLabel?.trim();
  const expected =
    typeof payer?.providerIdExpected === "boolean"
      ? payer.providerIdExpected
      : typeof payer?.resolutionIdExpected === "boolean"
        ? payer.resolutionIdExpected
        : DEFAULT_RESOLUTION_IDENTIFIER.expected;
  return {
    individualLabel: providerLabel || legacyLabel || DEFAULT_RESOLUTION_IDENTIFIER.individualLabel,
    expected,
  };
}

// Group chain: the E6.7 group pair, else the fixed default (not expected).
export function resolveGroupIdentifierConfig(payer?: Payer | null): GroupIdentifierConfig {
  const groupLabel = payer?.groupIdLabel?.trim();
  return {
    groupLabel: groupLabel || DEFAULT_GROUP_IDENTIFIER.groupLabel,
    expected:
      typeof payer?.groupIdExpected === "boolean"
        ? payer.groupIdExpected
        : DEFAULT_GROUP_IDENTIFIER.expected,
  };
}
