// E2.1 TE-1 — the 4-part-key migration's safety-net backfill rule as pure,
// unit-tested logic. The SQL in
// supabase/migrations/20260713150000_case_key_4part.sql mirrors this exactly
// (a no-op on hosted at apply time — 0 NULL-group rows — kept for rows created
// between spec and apply); keep the two in sync. The rule order is
// deterministic:
//   (a) the case's facility -> that facility's group;
//   (b) the provider's SOLE provider_group_assignments row;
//   (c) the provider's is_primary assignment;
//   (d) otherwise null — the row stays NULL-group and the legacy 3-part rule
//       still binds it (NULL = NULL under the constraint's NULLS NOT DISTINCT).
// providers.group_id is a FROZEN legacy mirror (table register: "no new
// readers") and is deliberately never consulted.

export interface BackfillCaseInput {
  providerId: string;
  facilityId: string | null;
  groupId: string | null;
}

export interface BackfillFacilityInput {
  id: string;
  groupId: string | null;
}

export interface BackfillAssignmentInput {
  providerId: string;
  groupId: string;
  isPrimary: boolean;
}

/** The group_id the migration's backfill assigns a NULL-group case, or null
 * when no rule resolves (rule d). A case that already carries a group_id is
 * returned unchanged — the backfill never rewrites a stamped key. */
export function resolveBackfillGroupId(
  caseRow: BackfillCaseInput,
  facilities: readonly BackfillFacilityInput[],
  assignments: readonly BackfillAssignmentInput[],
): string | null {
  if (caseRow.groupId !== null) return caseRow.groupId;

  // (a) facility lineage
  if (caseRow.facilityId) {
    const facility = facilities.find((f) => f.id === caseRow.facilityId);
    if (facility?.groupId) return facility.groupId;
  }

  const mine = assignments.filter((a) => a.providerId === caseRow.providerId);

  // (b) sole group membership
  if (mine.length === 1) return mine[0].groupId;

  // (c) primary assignment (the partial unique guarantees at most one)
  const primary = mine.find((a) => a.isPrimary);
  if (primary) return primary.groupId;

  // (d) unresolvable — stays NULL under the 3-part rule
  return null;
}
