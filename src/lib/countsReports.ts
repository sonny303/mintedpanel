// E6.6 F6.6.4 — the PM's counts-as-reports ruling: occasional counts are
// simple org-scoped report tables, never widgets on working screens. One
// derivation over existing data (zero stored state): facilities with no
// assigned providers. Active locations per group now live in the Portfolio
// footprint (src/lib/portfolioFootprint.ts). Pure, no I/O.

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
