// E6.6 F6.6.4 — the PM's counts-as-reports ruling: occasional counts are
// simple org-scoped report tables, never widgets on working screens. Two
// derivations over existing data (zero stored state): facilities with no
// assigned providers, and active locations per group. Pure, no I/O.

export interface CountsFacilityInput {
  id: string;
  name: string;
  groupId: string | null;
  city?: string | null;
  state?: string | null;
  effectiveDate?: string | null;
  isActive: boolean;
  referenceOnly: boolean;
}

export interface FacilityWithoutProvidersRow {
  facilityId: string;
  name: string;
  groupId: string | null;
  city: string | null;
  state: string | null;
  effectiveDate: string | null;
}

/** ACTIVE, non-reference facilities with zero assigned providers, A→Z. */
export function facilitiesWithoutProviders(
  facilities: readonly CountsFacilityInput[],
  providerCountByFacility: ReadonlyMap<string, number>,
): FacilityWithoutProvidersRow[] {
  return facilities
    .filter((f) => f.isActive && !f.referenceOnly && !(providerCountByFacility.get(f.id) ?? 0))
    .map((f) => ({
      facilityId: f.id,
      name: f.name,
      groupId: f.groupId,
      city: f.city ?? null,
      state: f.state ?? null,
      effectiveDate: f.effectiveDate ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.facilityId.localeCompare(b.facilityId));
}

export interface LocationsPerGroupRow {
  groupId: string | null;
  groupName: string;
  activeLocationCount: number;
}

/** Active (non-reference) locations per provider group, groups A→Z; every
 * group appears (zero counts included); ungrouped locations trail under
 * "No group" only when any exist. */
export function locationsPerGroup(
  groups: readonly { id: string; name: string }[],
  facilities: readonly CountsFacilityInput[],
): LocationsPerGroupRow[] {
  const counts = new Map<string | null, number>();
  for (const f of facilities) {
    if (!f.isActive || f.referenceOnly) continue;
    const key = f.groupId && groups.some((g) => g.id === f.groupId) ? f.groupId : null;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rows: LocationsPerGroupRow[] = groups
    .map((g) => ({
      groupId: g.id,
      groupName: g.name,
      activeLocationCount: counts.get(g.id) ?? 0,
    }))
    .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.groupId!.localeCompare(b.groupId!));
  const ungrouped = counts.get(null) ?? 0;
  if (ungrouped > 0) {
    rows.push({ groupId: null, groupName: "No group", activeLocationCount: ungrouped });
  }
  return rows;
}
