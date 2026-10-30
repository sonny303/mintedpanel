// Which provider groups the Group Contracts Matrix shows. Pure; no I/O.
//
// Until the operator touches the Groups filter, every ACTIVE group is shown
// (GCM-4, GCM-11). Inactive groups appear only when picked (D4). A deep link
// from a case (`?groupId&payerId&state`) opens the full organization view
// (GCM-20): its group is added to that default — even when inactive, so the
// linked cell can show — but it never narrows the selection, and once the
// operator has made a choice that choice stands.

export interface SelectableGroup {
  id: string;
  isActive: boolean;
}

export function resolveActiveGroupIds(input: {
  groups: readonly SelectableGroup[];
  /** null = the operator has not changed the Groups filter yet. */
  selectedGroupIds: readonly string[] | null;
  /** Added to the untouched default (the deep link's group). Only adds;
   * an unknown id is ignored. */
  includeGroupId?: string | null;
}): string[] {
  if (input.selectedGroupIds !== null) {
    const known = new Set(input.groups.map((group) => group.id));
    return [...new Set(input.selectedGroupIds)].filter((id) => known.has(id));
  }
  return input.groups
    .filter((group) => group.isActive || group.id === input.includeGroupId)
    .map((group) => group.id);
}
