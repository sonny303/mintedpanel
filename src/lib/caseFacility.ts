// Case ↔ facility resolution: stamp a location onto a new credentialing case
// from the provider's group-scoped assignments, and list the same set for the
// post-create editor. Pure — no I/O.
//
// Stamp rule (product): among ACTIVE facilities that (a) the provider is
// assigned to and (b) belong to the case's group —
//   • exactly one → that facility
//   • several → the assignment marked primary, if any
//   • otherwise (zero, or several with no primary) → null (ambiguous / none)
// A null case.groupId cannot be scoped → null. Inactive facilities never stamp.
import type { Facility, FacilityAssignment } from "@/types";

export interface CaseFacilityAssignmentRef {
  providerId: string | null;
  facilityId: string | null;
  isPrimary: boolean | null;
}

export interface CaseFacilityRef {
  id: string;
  groupId: string | null;
  isActive: boolean;
}

/** Provider's assigned facilities under the case's group (active only by
 * default). Used by the stamp resolver and the case-detail picker. */
export function facilitiesForCaseProvider(
  providerId: string,
  groupId: string | null | undefined,
  assignments: readonly CaseFacilityAssignmentRef[],
  facilities: readonly CaseFacilityRef[],
  opts?: { includeInactiveIds?: ReadonlySet<string> },
): string[] {
  if (!groupId) return [];
  const assigned = new Set(
    assignments
      .filter((a) => a.providerId === providerId && a.facilityId)
      .map((a) => a.facilityId as string),
  );
  if (assigned.size === 0) return [];
  const includeInactive = opts?.includeInactiveIds ?? new Set<string>();
  return facilities
    .filter(
      (f) =>
        assigned.has(f.id) && f.groupId === groupId && (f.isActive || includeInactive.has(f.id)),
    )
    .map((f) => f.id);
}

/** Resolve the facility id to stamp on create. See module docstring. */
export function resolveCaseFacilityId(
  providerId: string,
  groupId: string | null | undefined,
  assignments: readonly CaseFacilityAssignmentRef[],
  facilities: readonly CaseFacilityRef[],
): string | null {
  const eligibleIds = facilitiesForCaseProvider(providerId, groupId, assignments, facilities);
  if (eligibleIds.length === 0) return null;
  if (eligibleIds.length === 1) return eligibleIds[0] ?? null;

  const eligible = new Set(eligibleIds);
  const primary = assignments.find(
    (a) =>
      a.providerId === providerId &&
      a.facilityId != null &&
      eligible.has(a.facilityId) &&
      a.isPrimary === true,
  );
  return primary?.facilityId ?? null;
}

/** Convenience: look up Facility rows for the picker, preserving name order. */
export function caseFacilityOptions(
  providerId: string,
  groupId: string | null | undefined,
  assignments: readonly FacilityAssignment[],
  facilities: readonly Facility[],
  currentFacilityId?: string | null,
): Facility[] {
  const includeInactiveIds = currentFacilityId != null ? new Set([currentFacilityId]) : undefined;
  const ids = new Set(
    facilitiesForCaseProvider(providerId, groupId, assignments, facilities, {
      includeInactiveIds,
    }),
  );
  return facilities
    .filter((f) => ids.has(f.id))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** True when facilityId is allowed on this case (null clears; otherwise must
 * be in the provider×group assignment set — inactive current is accepted so a
 * stale stamp remains editable away). */
export function isEligibleCaseFacility(
  facilityId: string | null,
  providerId: string,
  groupId: string | null | undefined,
  assignments: readonly CaseFacilityAssignmentRef[],
  facilities: readonly CaseFacilityRef[],
): boolean {
  if (facilityId == null) return true;
  const ids = facilitiesForCaseProvider(providerId, groupId, assignments, facilities, {
    includeInactiveIds: new Set([facilityId]),
  });
  return ids.includes(facilityId);
}

// E1.1 (Track B) — multi-location cases. `case_facilities` holds the full
// set; `credential_cases.facility_id` stays a PRIMARY MIRROR of whichever row
// has `isPrimary: true`. These two helpers are the pure decisions the service
// layer (`addCaseFacility`/`removeCaseFacility`) needs and nothing more —
// eligibility for ADDING a location is still `isEligibleCaseFacility` above,
// unrelaxed.

export interface CaseFacilityNameRef {
  facilityId: string;
  facilityName: string;
}

/** Which facility becomes primary when the current primary is removed from a
 * case's location set. Alphabetical by name — the same sort
 * `caseFacilityOptions` already uses for the picker, so promotion is
 * deterministic and never asks the coordinator to choose. `remaining` is the
 * location set AFTER the removed row is excluded; empty → null (the case
 * reverts to "no location", same as clearing `setCaseFacility` today). */
export function pickNextPrimaryCaseFacility(
  remaining: readonly CaseFacilityNameRef[],
): string | null {
  if (remaining.length === 0) return null;
  const sorted = remaining.slice().sort((a, b) => a.facilityName.localeCompare(b.facilityName));
  return sorted[0]?.facilityId ?? null;
}
