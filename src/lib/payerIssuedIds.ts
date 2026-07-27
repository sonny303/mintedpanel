// Slice D (payer-and-cases screen 5) — the Awaiting-ID derivation. A payer
// that EXPECTS to issue an ID (E6.7 ID-expectation split) whose case closed
// Approved with that ID still NULL (the E6.8 "Didn't receive" escape) is
// "Awaiting ID" — DERIVED at render time from the case columns, never stored.
// Back-fill rides the existing set-later paths (the board's Group-IDs dialog
// writes payer_network_targets.payer_issued_id; an admin correction re-approves
// the case with the ID), so the wait clears by re-derivation. Pure; no I/O.
import type { CaseStatus } from "./caseStatus";
import { resolveGroupIdentifierConfig, resolveIdentifierConfig } from "./payerResolutionIdentifier";
import type { Payer } from "@/types";

/** How a case-derived enrollment row presents its payer-issued PROVIDER ID:
 * the captured value under the payer's own label, the amber Awaiting-ID wait
 * (expected + approved + NULL id), or the honest "issues nothing" state. */
export type EnrollmentIdBadge =
  | { kind: "value"; label: string; value: string }
  | { kind: "awaiting"; label: string }
  | { kind: "not_issued" };

// Only APPROVED cases derive enrollment rows (providerEnrollments.ts), so the
// caller never passes an open case here — approval is a precondition.
export function enrollmentIdBadge(
  payer: Payer | null,
  payerIssuedId: string | null,
): EnrollmentIdBadge {
  const config = resolveIdentifierConfig(payer);
  const value = (payerIssuedId ?? "").trim();
  if (value) return { kind: "value", label: config.individualLabel, value };
  return config.expected
    ? { kind: "awaiting", label: config.individualLabel }
    : { kind: "not_issued" };
}

/** The narrow case slice the group-ID derivation needs — the list projection
 * carries all of it; `payerGroupProviderId`/`caseNumber` are tolerated absent
 * on older projections (absent reads as NULL / no number, never a crash). */
export interface GroupIdCaseSlice {
  id: string;
  state: string;
  caseStatus: CaseStatus;
  payerGroupProviderId?: string | null;
  caseNumber?: number | null;
}

/** The target slice — the group's ACTIVE payer_network_targets rows for the
 * payer, whose stored payer_issued_id is the group PIN's set-later home. */
export interface GroupIdTargetSlice {
  state: string;
  payerIssuedId?: string | null;
}

export interface AwaitingGroupIdEntry {
  /** The capturing case — the approval that acknowledged the ID missing. */
  caseId: string;
  caseNumber: number | null;
  state: string;
}

/**
 * The group-side Awaiting-ID rows for one group × payer pair: the payer
 * expects a group ID, a case closed Approved with `payer_group_provider_id`
 * NULL, and no target row for that state carries a stored group PIN (the
 * set-later back-fill — storing it resolves the wait with zero case writes).
 * One entry per state, capturing case chosen deterministically (lowest case
 * number, then id) so the link is stable across renders.
 */
export function awaitingGroupIdCases(
  payer: Payer | null,
  cases: readonly GroupIdCaseSlice[],
  targets: readonly GroupIdTargetSlice[],
): AwaitingGroupIdEntry[] {
  if (!resolveGroupIdentifierConfig(payer).expected) return [];
  const backfilled = new Set(
    targets.filter((t) => (t.payerIssuedId ?? "").trim()).map((t) => t.state),
  );
  const awaiting = cases
    .filter(
      (c) =>
        c.caseStatus === "approved" &&
        !(c.payerGroupProviderId ?? "").trim() &&
        !backfilled.has(c.state),
    )
    .sort(
      (a, b) =>
        (a.caseNumber ?? Number.MAX_SAFE_INTEGER) - (b.caseNumber ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
    );
  const byState = new Map<string, AwaitingGroupIdEntry>();
  for (const c of awaiting) {
    if (byState.has(c.state)) continue;
    byState.set(c.state, { caseId: c.id, caseNumber: c.caseNumber ?? null, state: c.state });
  }
  return [...byState.values()].sort((a, b) => a.state.localeCompare(b.state));
}

/** The board's honest "nothing to chase" state: the pair has Approved
 * evidence and the payer issues no group ID at all. */
export function groupIdNotIssued(payer: Payer | null, approvedCaseCount: number): boolean {
  return approvedCaseCount > 0 && !resolveGroupIdentifierConfig(payer).expected;
}
