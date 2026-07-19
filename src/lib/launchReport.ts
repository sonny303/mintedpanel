// E6.6 F6.6.2 — the Launches report derivation. DATE-ONLY by design: the
// location status machine is gone (E6.2 made go-live a plain
// `facilities.effective_date`), so this report reads facility dates +
// provider assignments + open cases and NOTHING else. It restores the old
// Home "Launches at risk" read: a location is flagged at-risk when its
// go-live date approaches with open cases still pending or zero providers
// assigned. All date math is date-only against a passed-in `today` (never a
// clock read in the lib — the enrollmentReadiness idiom). Pure, no I/O.
import type { CaseStatus } from "./caseStatus";
import { isOpenCaseStatus } from "./caseStatus";

/** A location launched within this many days back still shows ("recently
 * launched" — carried from the retired launchLocations 30-day window). */
export const LAUNCH_RECENT_WINDOW_DAYS = 30;

/** A go-live date within this many days AHEAD counts as "approaching" for
 * the at-risk flag. */
export const LAUNCH_UPCOMING_WINDOW_DAYS = 30;

/** The inline at-risk explanation (F6.6.2 AC: the rule is explained on the
 * report, single-sourced here so the e2e pins the same text). */
export const LAUNCH_AT_RISK_RULE_TEXT =
  "At risk = go-live within 30 days with open cases still pending or no providers assigned.";

export interface LaunchFacilityInput {
  id: string;
  name: string;
  groupId: string | null;
  effectiveDate: string | null;
  isActive: boolean;
  referenceOnly: boolean;
  city?: string | null;
  state?: string | null;
}

export interface LaunchCaseInput {
  id: string;
  providerId: string;
  facilityId: string | null;
  status: CaseStatus;
}

export interface LaunchAssignmentInput {
  providerId: string;
  facilityId: string;
}

export interface LaunchReportRow {
  facilityId: string;
  name: string;
  groupId: string | null;
  city: string | null;
  state: string | null;
  effectiveDate: string;
  /** Negative = launched N days ago; 0 = today. */
  daysUntil: number;
  providerCount: number;
  openCaseCount: number;
  atRisk: boolean;
  atRiskReasons: string[];
}

export interface LaunchReportGroup {
  groupId: string | null;
  groupName: string;
  rows: LaunchReportRow[];
}

const dayMs = 24 * 60 * 60 * 1000;

function toUtcDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Whole days from `today` to `date` (date-only; negative = past). */
export function daysUntil(date: string, today: string): number | null {
  const d = toUtcDay(date);
  const t = toUtcDay(today);
  if (d === null || t === null) return null;
  return Math.round((d - t) / dayMs);
}

/** Distinct assigned providers per facility. */
export function providerCountsByFacility(
  assignments: readonly LaunchAssignmentInput[],
): Map<string, number> {
  const byFacility = new Map<string, Set<string>>();
  for (const a of assignments) {
    const set = byFacility.get(a.facilityId) ?? new Set<string>();
    set.add(a.providerId);
    byFacility.set(a.facilityId, set);
  }
  return new Map(Array.from(byFacility, ([facilityId, set]) => [facilityId, set.size]));
}

/**
 * Open cases per facility — the E2.3 union rule: a case reaches a facility
 * through its explicit `facility_id` OR through its provider's assignment
 * there (generation-created cases carry no facility_id, so the assignment
 * path is what makes the count honest). A provider assigned to two
 * facilities counts their open case toward both — the case is pending for
 * each location's go-live.
 */
export function openCasesByFacility(
  cases: readonly LaunchCaseInput[],
  assignments: readonly LaunchAssignmentInput[],
): Map<string, number> {
  const facilitiesByProvider = new Map<string, Set<string>>();
  for (const a of assignments) {
    const set = facilitiesByProvider.get(a.providerId) ?? new Set<string>();
    set.add(a.facilityId);
    facilitiesByProvider.set(a.providerId, set);
  }
  const counts = new Map<string, number>();
  for (const c of cases) {
    if (!isOpenCaseStatus(c.status)) continue;
    const reached = new Set<string>(facilitiesByProvider.get(c.providerId) ?? []);
    if (c.facilityId) reached.add(c.facilityId);
    for (const facilityId of reached) {
      counts.set(facilityId, (counts.get(facilityId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The report rows: ACTIVE, non-reference facilities whose go-live date is in
 * the future or within the recent window (dateless locations are not
 * launches — excluded). Sorted date ascending, name tiebreak.
 */
export function buildLaunchReportRows(
  facilities: readonly LaunchFacilityInput[],
  providerCountByFacility: ReadonlyMap<string, number>,
  openCaseCountByFacility: ReadonlyMap<string, number>,
  today: string,
): LaunchReportRow[] {
  const rows: LaunchReportRow[] = [];
  for (const f of facilities) {
    if (!f.isActive || f.referenceOnly || !f.effectiveDate) continue;
    const days = daysUntil(f.effectiveDate, today);
    if (days === null || days < -LAUNCH_RECENT_WINDOW_DAYS) continue;
    const providerCount = providerCountByFacility.get(f.id) ?? 0;
    const openCaseCount = openCaseCountByFacility.get(f.id) ?? 0;
    const approaching = days >= 0 && days <= LAUNCH_UPCOMING_WINDOW_DAYS;
    const atRiskReasons: string[] = [];
    if (approaching && openCaseCount > 0) atRiskReasons.push("open cases still pending");
    if (approaching && providerCount === 0) atRiskReasons.push("no providers assigned");
    rows.push({
      facilityId: f.id,
      name: f.name,
      groupId: f.groupId,
      city: f.city ?? null,
      state: f.state ?? null,
      effectiveDate: f.effectiveDate,
      daysUntil: days,
      providerCount,
      openCaseCount,
      atRisk: atRiskReasons.length > 0,
      atRiskReasons,
    });
  }
  return rows.sort(
    (a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name) || a.facilityId.localeCompare(b.facilityId),
  );
}

/** Group the (already date-sorted) rows by provider group, groups A→Z by
 * name; ungrouped locations trail under "No group". */
export function groupLaunchRows(
  rows: readonly LaunchReportRow[],
  groupNameById: ReadonlyMap<string, string>,
): LaunchReportGroup[] {
  const byGroup = new Map<string | null, LaunchReportRow[]>();
  for (const row of rows) {
    const key = row.groupId && groupNameById.has(row.groupId) ? row.groupId : null;
    const list = byGroup.get(key) ?? [];
    list.push(row);
    byGroup.set(key, list);
  }
  const groups: LaunchReportGroup[] = Array.from(byGroup, ([groupId, groupRows]) => ({
    groupId,
    groupName: groupId ? (groupNameById.get(groupId) ?? "No group") : "No group",
    rows: groupRows,
  }));
  return groups.sort((a, b) => {
    if (a.groupId === null) return 1;
    if (b.groupId === null) return -1;
    return a.groupName.localeCompare(b.groupName);
  });
}
