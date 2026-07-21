// 2026-07-21 user direction — ONE enrollment picture per provider, derived.
// A provider's standing with a payer resolves through two records: an
// APPROVED case (the worked path — approval captures the effective date and
// the payer-issued individual ID on the case itself, E4.0/E6.0) and a
// manually recorded enrollment fact (the E6.2 migration-capture path). The
// provider record's Enrollments panel renders BOTH through this reducer, so
// resolving a case updates the enrollment picture with the case's own data —
// synergy by DERIVATION, never a dual write: facts stay migration-capture
// (they NEVER come from approvals), approval facts stay on the case, and a
// status correction away from Approved re-derives the row out automatically.
//
// Deliberately NO dedupe when a live fact and an approved case cover the same
// provider x group x payer x state: the fact row must stay visible so its own
// record (Edit-ID, expiry history) stays reachable and honest — a silently
// suppressed live fact would keep suppressing generation candidates while
// hiding that it exists. The board's rollup already treats either source as
// Active, so double counting is not a concern here — this is a display grain.
import type { CredentialCase, EnrollmentFact } from "@/types";

export interface ProviderEnrollmentRow {
  /** Stable render key ("fact:<id>" | "case:<id>"). */
  key: string;
  source: "fact" | "case";
  /** Set on fact rows — the Edit-ID / Expire target. */
  factId?: string;
  /** Set on case rows — the "Open case" link target. */
  caseId?: string;
  groupId: string | null;
  payerId: string;
  state: string;
  effectiveDate: string | null;
  payerIssuedId: string | null;
  /** Fact rows: expired_at IS NULL. Case rows: always true (only APPROVED
   * cases derive a row, and approval is live standing by definition). */
  live: boolean;
  /** Fact rows only — the expiry stamp for the Expired pill. */
  expiredAt: string | null;
}

/** The narrow case slice this reducer needs (the list projection carries it;
 * `payerIndividualProviderId` may be absent on older narrow projections —
 * tolerated as null, never a crash). */
export type EnrollmentCaseSlice = Pick<
  CredentialCase,
  "id" | "providerId" | "groupId" | "payerId" | "state" | "caseStatus" | "confirmedEffectiveDate"
> &
  Partial<Pick<CredentialCase, "payerIndividualProviderId">>;

export function buildProviderEnrollmentRows(
  providerId: string,
  facts: readonly EnrollmentFact[],
  cases: readonly EnrollmentCaseSlice[],
): ProviderEnrollmentRow[] {
  const rows: ProviderEnrollmentRow[] = [];
  for (const f of facts) {
    if (f.providerId !== providerId) continue;
    rows.push({
      key: `fact:${f.id}`,
      source: "fact",
      factId: f.id,
      groupId: f.groupId,
      payerId: f.payerId,
      state: f.state,
      effectiveDate: f.effectiveDate ?? null,
      payerIssuedId: f.payerIssuedId ?? null,
      live: f.expiredAt === null,
      expiredAt: f.expiredAt ?? null,
    });
  }
  for (const c of cases) {
    if (c.providerId !== providerId) continue;
    // Only a resolved-Approved case IS an enrollment. Every other status is
    // in-flight casework — the record's Cases panel owns that view.
    if (c.caseStatus !== "approved") continue;
    rows.push({
      key: `case:${c.id}`,
      source: "case",
      caseId: c.id,
      groupId: c.groupId ?? null,
      payerId: c.payerId,
      state: c.state,
      effectiveDate: c.confirmedEffectiveDate ?? null,
      payerIssuedId: c.payerIndividualProviderId ?? null,
      live: true,
      expiredAt: null,
    });
  }
  return rows;
}
