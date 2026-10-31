// Portfolio footprint (Oct 20 review, RC-05): Organization → Group → State,
// with provider and active-location counts at every level. Derived from the
// caller's member orgs at read time, never stored. Pure, no I/O, and "today"
// is passed in.
//
// Count rules:
// - Locations = active, non-reference facilities.
// - A state's providers = distinct counted providers assigned to an active
//   location of that group in that state.
// - A group's providers = distinct counted providers with a current
//   membership (no end date, or an end date not yet passed), plus anyone
//   placed at one of its locations. Members with no active location there
//   are "no location".
// - Counted providers are non-terminated, non-test, non-reference.
// - An org's totals are distinct across its groups; facilities with no group
//   roll up under a "No group" row so nothing silently drops.
import type { LifecycleState } from "@/types";

export const NO_GROUP_ID = "__no_group__";
export const UNKNOWN_STATE = "Unknown";

export interface FootprintOrgInput {
  id: string;
  name: string;
  lifecycleState: LifecycleState;
}

export interface FootprintGroupInput {
  id: string;
  orgId: string;
  name: string;
  isActive: boolean;
}

export interface FootprintFacilityInput {
  id: string;
  orgId: string;
  groupId: string | null;
  state: string | null;
  isActive: boolean;
  referenceOnly: boolean;
}

export interface FootprintProviderInput {
  id: string;
  orgId: string;
  status: string;
  isTestProvider: boolean;
  referenceOnly: boolean;
}

export interface FootprintInput {
  orgs: readonly FootprintOrgInput[];
  groups: readonly FootprintGroupInput[];
  facilities: readonly FootprintFacilityInput[];
  providers: readonly FootprintProviderInput[];
  groupMemberships: ReadonlyArray<{
    providerId: string | null;
    groupId: string | null;
    endDate: string | null;
  }>;
  facilityAssignments: ReadonlyArray<{ providerId: string | null; facilityId: string | null }>;
}

export interface StateFootprint {
  state: string;
  providers: number;
  locations: number;
}

export interface GroupFootprint {
  groupId: string;
  name: string;
  isActive: boolean;
  providers: number;
  locations: number;
  noLocationProviders: number;
  states: StateFootprint[];
}

export interface OrgFootprint {
  orgId: string;
  name: string;
  lifecycleState: LifecycleState;
  providers: number;
  locations: number;
  stateCount: number;
  groups: GroupFootprint[];
}

export interface PortfolioTotals {
  orgs: number;
  groups: number;
  states: number;
  providers: number;
  locations: number;
}

function normalizeState(value: string | null): string {
  const code = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(code) ? code : UNKNOWN_STATE;
}

function bucket<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}

export function buildPortfolioFootprint(input: FootprintInput, today: string): OrgFootprint[] {
  const counted = new Set(
    input.providers
      .filter((p) => p.status !== "terminated" && !p.isTestProvider && !p.referenceOnly)
      .map((p) => p.id),
  );
  const groupsById = new Map(input.groups.map((g) => [g.id, g]));
  const activeFacilities = input.facilities.filter((f) => f.isActive && !f.referenceOnly);
  const facilitiesById = new Map(activeFacilities.map((f) => [f.id, f]));
  const groupKey = (f: FootprintFacilityInput) =>
    f.groupId && groupsById.has(f.groupId) ? f.groupId : `${NO_GROUP_ID}:${f.orgId}`;

  // group → state → facility ids / provider ids
  const stateLocations = new Map<string, Map<string, number>>();
  for (const f of activeFacilities) {
    const states = stateLocations.get(groupKey(f)) ?? new Map<string, number>();
    const state = normalizeState(f.state);
    states.set(state, (states.get(state) ?? 0) + 1);
    stateLocations.set(groupKey(f), states);
  }
  const stateProviders = new Map<string, Map<string, Set<string>>>();
  const placedProviders = new Map<string, Set<string>>();
  for (const a of input.facilityAssignments) {
    if (!a.providerId || !a.facilityId || !counted.has(a.providerId)) continue;
    const f = facilitiesById.get(a.facilityId);
    if (!f) continue;
    const key = groupKey(f);
    const states = stateProviders.get(key) ?? new Map<string, Set<string>>();
    bucket(states, normalizeState(f.state), a.providerId);
    stateProviders.set(key, states);
    bucket(placedProviders, key, a.providerId);
  }
  const members = new Map<string, Set<string>>();
  for (const m of input.groupMemberships) {
    if (!m.providerId || !m.groupId || !counted.has(m.providerId)) continue;
    if (m.endDate !== null && m.endDate.slice(0, 10) < today) continue;
    bucket(members, m.groupId, m.providerId);
  }

  function groupFootprint(key: string, name: string, isActive: boolean): GroupFootprint {
    const locations = stateLocations.get(key) ?? new Map<string, number>();
    const providersByState = stateProviders.get(key) ?? new Map<string, Set<string>>();
    const placed = placedProviders.get(key) ?? new Set<string>();
    const all = new Set([...(members.get(key) ?? []), ...placed]);
    const states = [...new Set([...locations.keys(), ...providersByState.keys()])]
      .map((state) => ({
        state,
        providers: providersByState.get(state)?.size ?? 0,
        locations: locations.get(state) ?? 0,
      }))
      .sort(
        (a, b) =>
          Number(a.state === UNKNOWN_STATE) - Number(b.state === UNKNOWN_STATE) ||
          a.state.localeCompare(b.state),
      );
    return {
      groupId: key,
      name,
      isActive,
      providers: all.size,
      locations: [...locations.values()].reduce((n, c) => n + c, 0),
      noLocationProviders: [...all].filter((id) => !placed.has(id)).length,
      states,
    };
  }

  return input.orgs
    .map((org) => {
      const groups = input.groups
        .filter((g) => g.orgId === org.id)
        .map((g) => groupFootprint(g.id, g.name, g.isActive))
        .sort((a, b) => a.name.localeCompare(b.name) || a.groupId.localeCompare(b.groupId));
      const ungroupedKey = `${NO_GROUP_ID}:${org.id}`;
      if (stateLocations.has(ungroupedKey) || stateProviders.has(ungroupedKey)) {
        groups.push(groupFootprint(ungroupedKey, "No group", true));
      }
      const providerIds = new Set<string>();
      for (const g of groups) {
        for (const id of members.get(g.groupId) ?? []) providerIds.add(id);
        for (const id of placedProviders.get(g.groupId) ?? []) providerIds.add(id);
      }
      const states = new Set(
        groups.flatMap((g) => g.states.map((s) => s.state)).filter((s) => s !== UNKNOWN_STATE),
      );
      return {
        orgId: org.id,
        name: org.name,
        lifecycleState: org.lifecycleState,
        providers: providerIds.size,
        locations: groups.reduce((n, g) => n + g.locations, 0),
        stateCount: states.size,
        groups,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.orgId.localeCompare(b.orgId));
}

/** Headline totals across the given orgs (providers distinct within each org). */
export function portfolioTotals(orgs: readonly OrgFootprint[]): PortfolioTotals {
  const states = new Set<string>();
  for (const org of orgs) {
    for (const g of org.groups)
      for (const s of g.states) if (s.state !== UNKNOWN_STATE) states.add(s.state);
  }
  return {
    orgs: orgs.length,
    groups: orgs.reduce(
      (n, o) => n + o.groups.filter((g) => !g.groupId.startsWith(NO_GROUP_ID)).length,
      0,
    ),
    states: states.size,
    providers: orgs.reduce((n, o) => n + o.providers, 0),
    locations: orgs.reduce((n, o) => n + o.locations, 0),
  };
}

export type FootprintSortKey = "state" | "providers" | "locations";
export type SortDirection = "asc" | "desc";

/** Sort a group's state rows; numeric sorts break ties by state code. */
export function sortStates(
  rows: readonly StateFootprint[],
  key: FootprintSortKey,
  direction: SortDirection,
): StateFootprint[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = key === "state" ? a.state.localeCompare(b.state) : a[key] - b[key];
    return sign * primary || a.state.localeCompare(b.state);
  });
}
