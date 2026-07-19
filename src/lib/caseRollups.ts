// E6.0 F6.0.5 — derived rollups: everything above case level is math over
// case statuses and enrollment facts, never set by anyone. Pure functions,
// no I/O. Consumers: E6.2 (the group × payer fulfillment board), E6.4 (the
// provider "x of y approved" progress), E6.6 (the provider-first denial
// rollup report). E6.0 ships the derivations; those epics render them.
//
// Enrollment facts are the E6.4 concept ("active under THIS group's contract",
// recorded — never auto-cases). Until E6.4 models them, callers pass an empty
// array and the rollup derives from case statuses alone; the input shape is
// the contract E6.4 fills in.
import type { CaseStatus } from "./caseStatus";
import { isOpenCaseStatus } from "./caseStatus";

/** Group × payer fulfillment: Targeted → In Progress → Active,
 * most-advanced-case-wins. Active = ≥1 Approved case OR an enrollment fact. */
export type PayerFulfillment = "targeted" | "in_progress" | "active";

export interface FulfillmentTarget {
  groupId: string;
  payerId: string;
  state: string;
}

export interface FulfillmentCaseRow {
  /** Legacy NULL-group cases never join a group's board row. */
  groupId: string | null;
  payerId: string;
  state: string;
  status: CaseStatus;
}

export interface EnrollmentFactRow {
  groupId: string;
  payerId: string;
  /** Optional state grain — a stateless fact covers the pair everywhere. */
  state?: string | null;
}

export interface GroupPayerFulfillmentRow {
  groupId: string;
  payerId: string;
  fulfillment: PayerFulfillment;
  /** ≥1 Denied case at the pair and no Approved one — the board's denial
   * marker (reverts to In Progress when a reapplied case reopens, TS-116). */
  hasDenial: boolean;
  approvedCount: number;
  openCount: number;
  deniedCount: number;
  /** Target states at the pair, sorted A→Z (the board's chip row). */
  targetStates: string[];
}

const pairKey = (groupId: string, payerId: string) => `${groupId}|${payerId}`;

/**
 * One row per (group, payer) pair that is targeted OR carries a case/fact.
 * Most-advanced-case-wins: active > in_progress > targeted. A pair whose only
 * cases are closed non-approved (denied / not pursuing) falls back to
 * `targeted` — the work is not in motion — with `hasDenial` flagging the
 * denial marker for the board.
 */
export function groupPayerFulfillment(
  targets: readonly FulfillmentTarget[],
  cases: readonly FulfillmentCaseRow[],
  enrollmentFacts: readonly EnrollmentFactRow[] = [],
): GroupPayerFulfillmentRow[] {
  const rows = new Map<string, GroupPayerFulfillmentRow>();
  const ensure = (groupId: string, payerId: string): GroupPayerFulfillmentRow => {
    const key = pairKey(groupId, payerId);
    let row = rows.get(key);
    if (!row) {
      row = {
        groupId,
        payerId,
        fulfillment: "targeted",
        hasDenial: false,
        approvedCount: 0,
        openCount: 0,
        deniedCount: 0,
        targetStates: [],
      };
      rows.set(key, row);
    }
    return row;
  };

  for (const t of targets) {
    const row = ensure(t.groupId, t.payerId);
    if (!row.targetStates.includes(t.state)) row.targetStates.push(t.state);
  }
  for (const c of cases) {
    if (!c.groupId) continue;
    const row = ensure(c.groupId, c.payerId);
    if (c.status === "approved") row.approvedCount += 1;
    else if (c.status === "denied") row.deniedCount += 1;
    else if (isOpenCaseStatus(c.status)) row.openCount += 1;
  }
  const factPairs = new Set(enrollmentFacts.map((f) => pairKey(f.groupId, f.payerId)));

  for (const [key, row] of rows) {
    const active = row.approvedCount > 0 || factPairs.has(key);
    row.fulfillment = active ? "active" : row.openCount > 0 ? "in_progress" : "targeted";
    row.hasDenial = row.deniedCount > 0 && !active;
    row.targetStates.sort((a, b) => a.localeCompare(b));
  }

  return Array.from(rows.values()).sort(
    (a, b) => a.groupId.localeCompare(b.groupId) || a.payerId.localeCompare(b.payerId),
  );
}

export interface ProviderProgressCaseRow {
  providerId: string;
  status: CaseStatus;
}

export interface ProviderCaseProgress {
  approved: number;
  /** Denominator: the provider's cases excluding Not Pursuing opt-outs (an
   * opt-out is not a payer the provider is working toward). */
  total: number;
}

/** E6.4's provider record header: "x of y approved" per provider. */
export function providerCaseProgress(
  cases: readonly ProviderProgressCaseRow[],
): Map<string, ProviderCaseProgress> {
  const byProvider = new Map<string, ProviderCaseProgress>();
  for (const c of cases) {
    if (c.status === "not_pursuing") continue;
    const row = byProvider.get(c.providerId) ?? { approved: 0, total: 0 };
    row.total += 1;
    if (c.status === "approved") row.approved += 1;
    byProvider.set(c.providerId, row);
  }
  return byProvider;
}

export interface DenialRollupCaseRow {
  id: string;
  providerId: string;
  payerId: string;
  state: string;
  status: CaseStatus;
}

export interface DenialInfo {
  reasonLabel: string | null;
  deniedAt: string | null;
}

export interface DenialRow {
  caseId: string;
  providerId: string;
  payerId: string;
  state: string;
  reasonLabel: string | null;
  deniedAt: string | null;
}

/**
 * E6.6's denial report rows: one per currently-Denied case, carrying the
 * reason + date from the case's status history (the caller resolves the
 * latest denial history entry per case into `denialInfoByCase`). A reapplied
 * case (back to In Progress) leaves the rollup — the prior denial stays
 * visible in the case's own history, not here.
 */
export function buildDenialRows(
  cases: readonly DenialRollupCaseRow[],
  denialInfoByCase: ReadonlyMap<string, DenialInfo> = new Map(),
): DenialRow[] {
  return cases
    .filter((c) => c.status === "denied")
    .map((c) => ({
      caseId: c.id,
      providerId: c.providerId,
      payerId: c.payerId,
      state: c.state,
      reasonLabel: denialInfoByCase.get(c.id)?.reasonLabel ?? null,
      deniedAt: denialInfoByCase.get(c.id)?.deniedAt ?? null,
    }))
    .sort(
      (a, b) =>
        a.providerId.localeCompare(b.providerId) ||
        a.payerId.localeCompare(b.payerId) ||
        a.state.localeCompare(b.state),
    );
}

/** Provider-first grouping (the report's default pivot). */
export function groupDenialsByProvider(rows: readonly DenialRow[]): Map<string, DenialRow[]> {
  const byProvider = new Map<string, DenialRow[]>();
  for (const row of rows) {
    const list = byProvider.get(row.providerId) ?? [];
    list.push(row);
    byProvider.set(row.providerId, list);
  }
  return byProvider;
}

/** Payer-first pivot (pattern spotting: the same payer denying everywhere). */
export function groupDenialsByPayer(rows: readonly DenialRow[]): Map<string, DenialRow[]> {
  const byPayer = new Map<string, DenialRow[]>();
  for (const row of rows) {
    const list = byPayer.get(row.payerId) ?? [];
    list.push(row);
    byPayer.set(row.payerId, list);
  }
  return byPayer;
}
