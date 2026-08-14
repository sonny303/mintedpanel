// Provider↔facility assignment rules (E1.4) as pure logic.
// - Group-scoped picker (F1.4.2, locked R3 decision): a provider may only be
//   assigned to facilities owned by their group(s) — never the whole org.
// - Editor invariants: every assignment needs a start date; when any
//   assignments exist, exactly one is primary (F1.4.3 — the DB partial
//   unique caps at one; the lower bound lives here). Removing the primary
//   while others remain therefore forces a re-pick before save.
// - The diff planner mirrors the E1.3 pattern; the actual primary swap runs
//   through the atomic set_primary_assignment RPC in the service.
import type { Facility } from "@/types";

/** Facilities eligible for a provider = ACTIVE facilities owned by one of
 * the provider's groups. Ungrouped facilities (group_id null) are never
 * offered — that's E1.2's linkage gap, not an assignment surface. */
export function facilitiesForProviderGroups(
  groupIds: readonly string[],
  facilities: readonly Facility[],
): Facility[] {
  const ids = new Set(groupIds);
  return facilities.filter((f) => f.isActive && f.groupId !== null && ids.has(f.groupId));
}

export interface AssignmentDraft {
  facilityId: string;
  startDate: string;
  isPrimary: boolean;
}

export const START_DATE_REQUIRED_MESSAGE = "Every assignment needs a start date";
export const ONE_PRIMARY_ASSIGNMENT_MESSAGE = "Exactly one location must be marked primary";

/** Add Provider has no primary picker (F1.4.3). The first selected facility
 * is primary until the coordinator changes it on the record. Empty ids are
 * dropped so a lone real facility still becomes primary. */
export function markFirstFacilityPrimary(
  facilityIds: readonly string[],
): Array<{ facilityId: string; isPrimary: boolean }> {
  return facilityIds
    .filter((id) => id.length > 0)
    .map((facilityId, index) => ({ facilityId, isPrimary: index === 0 }));
}

export interface AssignmentPrimaryCandidate {
  id: string;
  providerId: string;
  isPrimary: boolean;
  createdAt: string;
}

/** Providers with assignments and no primary: promote the earliest row
 * (created_at, then id). Providers that already have a primary are left
 * alone. Used after roster import, where the commit RPC inserts every
 * facility as non-primary. */
export function firstAssignmentIdsToPromote(rows: readonly AssignmentPrimaryCandidate[]): string[] {
  const byProvider = new Map<string, AssignmentPrimaryCandidate[]>();
  for (const row of rows) {
    const list = byProvider.get(row.providerId) ?? [];
    list.push(row);
    byProvider.set(row.providerId, list);
  }
  const ids: string[] = [];
  for (const list of byProvider.values()) {
    if (list.some((r) => r.isPrimary)) continue;
    const first = [...list].sort((a, b) =>
      a.createdAt === b.createdAt
        ? a.id.localeCompare(b.id)
        : a.createdAt.localeCompare(b.createdAt),
    )[0];
    if (first) ids.push(first.id);
  }
  return ids;
}

/** Returns an error message, or null when the draft set is valid. An empty
 * set is valid here — the wizard surfaces the gap as section progress (the
 * PM's "no unassigned resting state" is a readiness concern, not a DB block). */
export function validateAssignmentDrafts(drafts: readonly AssignmentDraft[]): string | null {
  if (drafts.some((d) => !d.startDate.trim())) return START_DATE_REQUIRED_MESSAGE;
  if (drafts.length > 0) {
    const primaries = drafts.filter((d) => d.isPrimary).length;
    if (primaries !== 1) return ONE_PRIMARY_ASSIGNMENT_MESSAGE;
  }
  const ids = new Set(drafts.map((d) => d.facilityId));
  if (ids.size !== drafts.length) return "Each location can be assigned only once";
  return null;
}

export interface StoredFacilityAssignment {
  id: string;
  facilityId: string;
  isPrimary: boolean;
  startDate: string | null;
}

export interface FacilityAssignmentSyncPlan {
  /** New rows — inserted with is_primary=false; the primary is resolved last
   * through the atomic RPC so the partial unique can never trip. */
  inserts: AssignmentDraft[];
  /** Surviving rows whose start_date changed. */
  updates: Array<{ id: string; startDate: string }>;
  deleteIds: string[];
  /** The facility that must end up primary (null when the set is empty). */
  primaryFacilityId: string | null;
  /** True when the currently-primary stored row already matches — no swap. */
  primaryAlreadySet: boolean;
}

export function planFacilityAssignmentSync(
  incoming: readonly AssignmentDraft[],
  stored: readonly StoredFacilityAssignment[],
): FacilityAssignmentSyncPlan {
  const error = validateAssignmentDrafts(incoming);
  if (error) throw new Error(error);

  const incomingByFacility = new Map(incoming.map((d) => [d.facilityId, d]));
  const storedByFacility = new Map(stored.map((r) => [r.facilityId, r]));

  const inserts = incoming.filter((d) => !storedByFacility.has(d.facilityId));
  const deleteIds = stored.filter((r) => !incomingByFacility.has(r.facilityId)).map((r) => r.id);
  const updates = incoming
    .filter((d) => {
      const match = storedByFacility.get(d.facilityId);
      return match !== undefined && (match.startDate ?? "") !== d.startDate;
    })
    .map((d) => ({ id: storedByFacility.get(d.facilityId)!.id, startDate: d.startDate }));

  const primaryFacilityId = incoming.find((d) => d.isPrimary)?.facilityId ?? null;
  const primaryStored = primaryFacilityId ? storedByFacility.get(primaryFacilityId) : undefined;
  const primaryAlreadySet = Boolean(primaryStored?.isPrimary);

  return { inserts, updates, deleteIds, primaryFacilityId, primaryAlreadySet };
}
