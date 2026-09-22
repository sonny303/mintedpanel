// Which group insurance policy the `groupInsurance.*` tokens resolve from —
// ONE definition, shared by the web fill (`services/providerProfile.ts`,
// server-side) and the payer-PDF fill (`lib/pdfFill.ts`, browser-side).
//
// A group can hold several policies (malpractice + general liability, primary
// + secondary). "The policy number" is not one answer until the rule below
// chooses. Surfaces must never disagree about which row a token means.
//
// E4.3 F4.3.5 Q4 (PM decision 2026-07-17), refined by 20260729120000 (at most
// one primary malpractice per group via partial unique index):
//   - no group → null
//   - zero policies → null
//   - a sole policy → that one (whatever its type — nothing to disambiguate)
//   - several → malpractice only (`professional_liability`); if none, null
//   - among malpractice → primary coverage_level wins; within a level the
//     newest policy_end_date wins; a date-less row never beats a dated one;
//     ties break by id so the pick is stable across reads

/** Malpractice insurance_type. Same literal the DB and UI use. */
export const MALPRACTICE_INSURANCE_TYPE = "professional_liability";

/**
 * The shape the rule reads. Server rows are snake_case; browser entities
 * (`InsurancePolicy`) are camelCase. Both spellings are accepted so one
 * generic serves each surface without a conversion at the boundary.
 */
export interface PolicyLike {
  id?: unknown;
  insuranceType?: unknown;
  insurance_type?: unknown;
  coverageLevel?: unknown;
  coverage_level?: unknown;
  policyEndDate?: unknown;
  policy_end_date?: unknown;
}

export interface PolicyPickResult<T> {
  /** The chosen policy, or null when the rule declines to choose. */
  row: T | null;
  /** Why nothing was chosen. Absent on a successful pick. */
  reason?: string;
}

function insuranceTypeOf(p: PolicyLike): string {
  return String(p.insuranceType ?? p.insurance_type ?? "");
}

function isPrimaryCoverage(p: PolicyLike): boolean {
  // Default "primary" matches the DB column default and toPolicy()'s coerce —
  // a null/missing coverage_level is treated as primary, not secondary.
  return String(p.coverageLevel ?? p.coverage_level ?? "primary") === "primary";
}

function policyEndDateOf(p: PolicyLike): string {
  const raw = p.policyEndDate ?? p.policy_end_date;
  return typeof raw === "string" ? raw : "";
}

/**
 * Pick the group insurance policy `groupInsurance.*` tokens resolve from.
 *
 * `hasGroup` is the caller's responsibility: the web profile checks
 * `providers.group_id`; the case page checks the case's `groupId`. Passing
 * an empty list with `hasGroup: true` means "this group has no policies",
 * which is a different honest failure from "no group at all".
 */
export function pickGroupInsurancePolicy<T extends PolicyLike>(
  policies: readonly T[],
  hasGroup: boolean,
): PolicyPickResult<T> {
  if (!hasGroup) return { row: null, reason: "provider has no group" };
  if (policies.length === 0) {
    return { row: null, reason: "group has no insurance policies" };
  }
  if (policies.length === 1) return { row: policies[0] as T };

  const malpractice = policies.filter((p) => insuranceTypeOf(p) === MALPRACTICE_INSURANCE_TYPE);
  if (malpractice.length === 0) {
    return {
      row: null,
      reason: `group has ${policies.length} insurance policies and none is malpractice (${MALPRACTICE_INSURANCE_TYPE}); not resolvable to a single row`,
    };
  }

  const sorted = [...malpractice].sort((a, b) => {
    const aPrimary = isPrimaryCoverage(a);
    const bPrimary = isPrimaryCoverage(b);
    if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;
    const aEnd = policyEndDateOf(a);
    const bEnd = policyEndDateOf(b);
    if (aEnd !== bEnd) return bEnd.localeCompare(aEnd);
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });
  return { row: sorted[0] as T };
}
