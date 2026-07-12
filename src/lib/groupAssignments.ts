// Provider↔group assignment invariants (E1.3 F1.3.2 / TE-4) as pure logic:
// a provider ALWAYS belongs to at least one group (no unassigned parking
// lot), with exactly one marked primary. The diff planner mirrors the
// license sync pattern — compute inserts/updates/deletes against the stored
// rows so the service writes the minimum and the partial unique index
// (one primary per provider) is never violated mid-flight.

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
