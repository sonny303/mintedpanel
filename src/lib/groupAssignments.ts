// Provider↔group assignment invariants (E1.3 F1.3.2 / TE-4) as pure logic:
// a provider ALWAYS belongs to at least one group (no unassigned parking
// lot), with exactly one marked primary. The diff planner mirrors the
// license sync pattern — compute inserts/updates/deletes against the stored
// rows so the service writes the minimum and the partial unique index
// (one primary per provider) is never violated mid-flight.

import type { ProviderGroupRef } from "@/types";

export interface GroupAssignmentInput {
  groupId: string;
  isPrimary: boolean;
}

export const LAST_ASSIGNMENT_MESSAGE = "A provider must keep at least one group assignment";
export const ONE_PRIMARY_MESSAGE = "Exactly one group must be marked primary";

/** Returns an error message, or null when the assignment set is valid. */
export function validateGroupAssignments(assignments: GroupAssignmentInput[]): string | null {
  if (assignments.length === 0) return LAST_ASSIGNMENT_MESSAGE;
  const primaries = assignments.filter((a) => a.isPrimary).length;
  if (primaries !== 1) return ONE_PRIMARY_MESSAGE;
  const ids = new Set(assignments.map((a) => a.groupId));
  if (ids.size !== assignments.length) return "Each group can be assigned only once";
  return null;
}

export interface StoredAssignment {
  id: string;
  groupId: string;
  isPrimary: boolean;
}

export interface AssignmentSyncPlan {
  /** New rows to insert. Demotions run FIRST so the single-primary partial
   * unique index can never trip while the new primary is inserted/promoted. */
  inserts: GroupAssignmentInput[];
  /** Existing rows to demote (is_primary=false). */
  demoteIds: string[];
  /** Existing row to promote (is_primary=true), when it isn't already. */
  promoteId: string | null;
  deleteIds: string[];
  /** The primary group id — mirrored onto providers.group_id (frozen legacy
   * mirror; no new readers). */
  primaryGroupId: string;
}

export function planAssignmentSync(
  incoming: GroupAssignmentInput[],
  stored: StoredAssignment[],
): AssignmentSyncPlan {
  const error = validateGroupAssignments(incoming);
  if (error) throw new Error(error);

  const incomingByGroup = new Map(incoming.map((a) => [a.groupId, a]));
  const storedByGroup = new Map(stored.map((a) => [a.groupId, a]));
  const primaryGroupId = incoming.find((a) => a.isPrimary)!.groupId;

  const inserts = incoming.filter((a) => !storedByGroup.has(a.groupId));
  const deleteIds = stored.filter((a) => !incomingByGroup.has(a.groupId)).map((a) => a.id);
  const demoteIds = stored
    .filter((a) => incomingByGroup.has(a.groupId) && a.isPrimary && a.groupId !== primaryGroupId)
    .map((a) => a.id);
  const promoteTarget = storedByGroup.get(primaryGroupId);
  const promoteId = promoteTarget && !promoteTarget.isPrimary ? promoteTarget.id : null;

  return { inserts, demoteIds, promoteId, deleteIds, primaryGroupId };
}

// ---------------------------------------------------------------------------
// List-row group names (2026-08-19) — the pure half of `withGroups`.
// ---------------------------------------------------------------------------

/** One `provider_group_assignments` row reduced to what naming needs, with the
 * group name resolved by the caller's embed. */
export interface ProviderGroupMembershipRow {
  providerId: string;
  groupId: string;
  groupName: string | null;
  isPrimary: boolean;
  endDate: string | null;
}

/**
 * Index membership rows by provider, primary first then A→Z by name.
 *
 * ENDED memberships are dropped: a provider who left a group should not be
 * labelled with it in a picker. A row whose group embed came back empty is
 * dropped too — an unnamed chip is worse than no chip, and the only way to get
 * one is a group the caller cannot read, which is exactly what should not
 * render. A provider with several memberships keeps all of them; that plurality
 * is the whole point (the same human can work under two groups).
 */
export function indexProviderGroups(
  rows: readonly ProviderGroupMembershipRow[],
): Map<string, ProviderGroupRef[]> {
  const byProvider = new Map<string, ProviderGroupRef[]>();
  for (const row of rows) {
    if (row.endDate != null) continue;
    const name = (row.groupName ?? "").trim();
    if (name === "") continue;
    const list = byProvider.get(row.providerId) ?? [];
    if (list.some((g) => g.id === row.groupId)) continue;
    list.push({ id: row.groupId, name, isPrimary: row.isPrimary });
    byProvider.set(row.providerId, list);
  }
  for (const list of byProvider.values()) {
    list.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }
  return byProvider;
}

/** Attach the indexed groups to their rows. Every row gets a `groups` array —
 * an empty one means "no group on file", which is a real state the caller must
 * be able to render honestly (absent would mean "not requested"). */
export function attachProviderGroups<T extends { id: string }>(
  rows: readonly T[],
  byProvider: ReadonlyMap<string, ProviderGroupRef[]>,
): Array<T & { groups: ProviderGroupRef[] }> {
  return rows.map((row) => ({ ...row, groups: byProvider.get(row.id) ?? [] }));
}
