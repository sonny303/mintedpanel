export function resolveActiveGroupIds(input: {
  groups: { id: string }[];
  selectedGroupIds: string[] | null;
  contextGroupId?: string;
}): string[] {
  const known = new Set(input.groups.map((group) => group.id));
  if (input.selectedGroupIds !== null) {
    return input.selectedGroupIds.filter((id) => known.has(id));
  }
  if (input.contextGroupId && known.has(input.contextGroupId)) {
    return [input.contextGroupId];
  }
  return input.groups[0] ? [input.groups[0].id] : [];
}
