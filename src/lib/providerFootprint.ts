// Where a provider actually works, as pure indexed lookup. Extracted from
// generationPreview.ts (2026-09-02) so the generation grid and the provider
// Readiness card answer "does this provider belong in this state?" with ONE
// rule instead of two that can drift.
//
// The rule (unchanged from the 2026-08-14 state-footprint decision): a
// provider has a footprint in a target state when they hold an assignment at
// an ACTIVE facility of THAT GROUP in that state, OR a license on file for
// that state. Group-wide "works at some clinic" is not enough — a CO-only
// provider has no business on an Aetna-TX row.
//
// Clinic membership is group-scoped (the same provider can work in CA under
// one group and ID under another); licences are provider-scoped and cross
// every group, which is what lets a provider be a candidate in a state before
// the group opens a clinic there.
//
// No I/O and no clock reads — callers pass the rows they already hold.

export interface FootprintFacilityInput {
  id: string;
  groupId: string | null;
  /** Facility operating state. Null/absent never matches a target state. */
  state?: string | null;
  /** Inactive clinics do not count toward the footprint. Absent = active. */
  isActive?: boolean;
}

export interface FootprintFacilityAssignmentInput {
  providerId: string | null;
  facilityId: string | null;
}

export interface FootprintLicenseInput {
  providerId: string | null;
  state: string;
}

/** Why a provider qualifies — both flags can be true, and the generation
 * grid renders the difference in its derivation sentence. */
export interface ProviderFootprint {
  clinic: boolean;
  licensed: boolean;
}

/** Prebuilt lookup: build once per derivation, query per (provider, group,
 * state). Keys are internal — go through the accessors below. */
export interface FootprintIndex {
  /** `${providerId}|${groupId}` → active-clinic states under that group. */
  clinicStates: ReadonlyMap<string, ReadonlySet<string>>;
  /** providerId → states with a license on file. */
  licenseStates: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface FootprintIndexInput {
  facilities: readonly FootprintFacilityInput[];
  facilityAssignments: readonly FootprintFacilityAssignmentInput[];
  licenses?: readonly FootprintLicenseInput[];
}

function clinicStatesByProviderGroup(
  facilities: readonly FootprintFacilityInput[],
  assignments: readonly FootprintFacilityAssignmentInput[],
): Map<string, Set<string>> {
  const facilityById = new Map(facilities.map((f) => [f.id, f]));
  const out = new Map<string, Set<string>>();
  for (const fa of assignments) {
    if (!fa.providerId || !fa.facilityId) continue;
    const facility = facilityById.get(fa.facilityId);
    if (!facility?.groupId) continue;
    if (facility.isActive === false) continue;
    const state = facility.state?.trim();
    if (!state) continue;
    const key = `${fa.providerId}|${facility.groupId}`;
    if (!out.has(key)) out.set(key, new Set());
    out.get(key)?.add(state);
  }
  return out;
}

function licenseStatesByProvider(
  licenses: readonly FootprintLicenseInput[],
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const license of licenses) {
    if (!license.providerId) continue;
    const state = license.state.trim();
    if (!state) continue;
    if (!out.has(license.providerId)) out.set(license.providerId, new Set());
    out.get(license.providerId)?.add(state);
  }
  return out;
}

/** Index the org's facilities, assignments and licenses once. */
export function buildFootprintIndex(input: FootprintIndexInput): FootprintIndex {
  return {
    clinicStates: clinicStatesByProviderGroup(input.facilities, input.facilityAssignments),
    licenseStates: licenseStatesByProvider(input.licenses ?? []),
  };
}

/** Both reasons a provider qualifies for (group, state), independently. */
export function providerFootprintFor(
  index: FootprintIndex,
  providerId: string,
  groupId: string,
  state: string,
): ProviderFootprint {
  return {
    clinic: index.clinicStates.get(`${providerId}|${groupId}`)?.has(state) === true,
    licensed: index.licenseStates.get(providerId)?.has(state) === true,
  };
}

/** The gate itself: clinic OR license. */
export function hasStateFootprint(
  index: FootprintIndex,
  providerId: string,
  groupId: string,
  state: string,
): boolean {
  const { clinic, licensed } = providerFootprintFor(index, providerId, groupId, state);
  return clinic || licensed;
}

/** Every state one provider has a footprint in, across all their groups —
 * the provider-record view of the same rule (clinic states under any group
 * they belong to, plus every licensed state). Sorted A→Z. */
export function footprintStatesForProvider(index: FootprintIndex, providerId: string): string[] {
  const states = new Set<string>(index.licenseStates.get(providerId) ?? []);
  const prefix = `${providerId}|`;
  for (const [key, clinicStates] of index.clinicStates) {
    if (!key.startsWith(prefix)) continue;
    for (const state of clinicStates) states.add(state);
  }
  return [...states].sort();
}
