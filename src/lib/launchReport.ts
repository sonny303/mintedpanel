// E6.6 F6.6.2 — the Launches report derivation. DATE-ONLY by design: the
// location status machine is gone (E6.2 made go-live a plain
// `facilities.effective_date`), so this report reads facility dates +
// provider assignments + open cases (with their case_facilities links) and
// NOTHING else; the designated test provider is excluded throughout. It
// restores the old Home "Launches at risk" read: a location is flagged
// at-risk when its go-live date approaches with open cases still pending or
// zero providers assigned, and Overdue when the date has passed with either
// still true; dateless locations list apart, never flagged. All date math is
// date-only against a passed-in `today` (never a clock read in the lib — the
// enrollmentReadiness idiom). Pure, no I/O.
import type { CaseStatus } from "./caseStatus";
import { isOpenCaseStatus } from "./caseStatus";
import { isTestProvider, testProviderIds, type HasTestProviderFlag } from "./testProvider";

/** A location launched within this many days back still shows ("recently
 * launched" — carried from the retired launchLocations 30-day window). */
export const LAUNCH_RECENT_WINDOW_DAYS = 30;

/** A go-live date within this many days AHEAD counts as "approaching" for
 * the at-risk flag. */
export const LAUNCH_UPCOMING_WINDOW_DAYS = 30;

/** The inline at-risk explanation (F6.6.2 AC: the rule is explained on the
 * report, single-sourced here so the e2e pins the same text). */
export const LAUNCH_AT_RISK_RULE_TEXT =
  "At risk = go-live within 30 days with open cases still pending or no providers assigned. Overdue = go-live already passed and either is still true.";

/** Which marker an at-risk row carries: go-live today or ahead ("upcoming"),
 * or already passed ("overdue"). */
export type LaunchRiskKind = "upcoming" | "overdue";

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
  /** The `credential_cases.facility_id` primary mirror. */
  facilityId: string | null;
  status: CaseStatus;
}

/** One `case_facilities` row: a location the case holds. */
export interface LaunchCaseFacilityInput {
  caseId: string;
  facilityId: string;
}

export interface LaunchAssignmentInput {
  providerId: string;
  facilityId: string;
  /** provider_facility_assignments.start_date — a future start is not yet
   * staffing the location. Legacy rows may carry none. */
  startDate?: string | null;
}

export interface LaunchProviderInput extends HasTestProviderFlag {
  id: string;
  status: string | null;
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
  /** null when the row is not at risk. */
  riskKind: LaunchRiskKind | null;
  atRiskReasons: string[];
}

/** A location with no go-live date: listed in its own section, never
 * flagged (there is no date to approach or pass). */
export interface LaunchNoDateRow extends Pick<
  LaunchReportRow,
  "facilityId" | "name" | "groupId" | "city" | "state" | "providerCount" | "openCaseCount"
> {
  groupName: string;
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

/**
 * Distinct providers staffing each facility: an assignment counts only when
 * its provider is not terminated, not the test provider, and has started
 * (start_date on or before `today`). Also drives Facilities Without
 * Providers, so a location staffed only by a departed, test or future hire
 * reads as unstaffed on both reports. A provider the list does not carry is
 * counted (nothing says it is ineligible).
 */
export function providerCountsByFacility(
  assignments: readonly LaunchAssignmentInput[],
  providers: readonly LaunchProviderInput[],
  today: string,
): Map<string, number> {
  const providerById = new Map(providers.map((p) => [p.id, p]));
  const todayDay = toUtcDay(today);
  const byFacility = new Map<string, Set<string>>();
  for (const a of assignments) {
    const provider = providerById.get(a.providerId);
    if (provider && (provider.status === "terminated" || isTestProvider(provider))) continue;
    const startDay = a.startDate ? toUtcDay(a.startDate) : null;
    if (startDay !== null && todayDay !== null && startDay > todayDay) continue;
    const set = byFacility.get(a.facilityId) ?? new Set<string>();
    set.add(a.providerId);
    byFacility.set(a.facilityId, set);
  }
  return new Map(Array.from(byFacility, ([facilityId, set]) => [facilityId, set.size]));
}

/**
 * Open cases per facility, attributed through `case_facilities`: a case
 * counts once at each location it holds. A case with no `case_facilities`
 * rows falls back to its `facility_id` primary mirror (creation stamps the
 * mirror without writing the child row). Never through the provider's
 * assignments: a provider at two clinics does not make a case pending at
 * both. The test provider's cases never count.
 */
export function openCasesByFacility(
  cases: readonly LaunchCaseInput[],
  caseFacilities: readonly LaunchCaseFacilityInput[],
  providers: readonly LaunchProviderInput[],
): Map<string, number> {
  const testIds = testProviderIds(providers);
  const facilitiesByCase = new Map<string, Set<string>>();
  for (const link of caseFacilities) {
    const set = facilitiesByCase.get(link.caseId) ?? new Set<string>();
    set.add(link.facilityId);
    facilitiesByCase.set(link.caseId, set);
  }
  const counts = new Map<string, number>();
  for (const c of cases) {
    if (!isOpenCaseStatus(c.status) || testIds.has(c.providerId)) continue;
    const linked = facilitiesByCase.get(c.id);
    const reached = linked ?? (c.facilityId ? [c.facilityId] : []);
    for (const facilityId of reached) {
      counts.set(facilityId, (counts.get(facilityId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The report rows: ACTIVE, non-reference facilities whose go-live date is in
 * the future or within the recent window (dateless locations are listed
 * apart by buildNoGoLiveDateRows). Sorted date ascending, name tiebreak.
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
    // The same test ahead of go-live (upcoming) and after it (overdue); only a
    // date beyond the upcoming window is exempt.
    const checked = days <= LAUNCH_UPCOMING_WINDOW_DAYS;
    const atRiskReasons: string[] = [];
    if (checked && openCaseCount > 0) atRiskReasons.push("open cases still pending");
    if (checked && providerCount === 0) atRiskReasons.push("no providers assigned");
    const atRisk = atRiskReasons.length > 0;
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
      atRisk,
      riskKind: atRisk ? (days < 0 ? "overdue" : "upcoming") : null,
      atRiskReasons,
    });
  }
  return rows.sort(
    (a, b) =>
      a.daysUntil - b.daysUntil ||
      a.name.localeCompare(b.name) ||
      a.facilityId.localeCompare(b.facilityId),
  );
}

/** The Risk pill text: "At risk — reasons" up to go-live, "Overdue by N
 * days — reasons" once it has passed; null when the row is not flagged. */
export function launchRiskLabel(row: LaunchReportRow): string | null {
  if (!row.riskKind) return null;
  const reasons = row.atRiskReasons.join("; ");
  if (row.riskKind === "upcoming") return `At risk — ${reasons}`;
  const days = -row.daysUntil;
  return `Overdue by ${days} day${days === 1 ? "" : "s"} — ${reasons}`;
}

/**
 * The "No go-live date" section: ACTIVE, non-reference facilities with no
 * go-live date, never flagged. Ordered the way the dated report reads: group
 * A→Z by name, ungrouped last (a groupId missing from the map folds into
 * "No group"), then location name.
 */
export function buildNoGoLiveDateRows(
  facilities: readonly LaunchFacilityInput[],
  providerCountByFacility: ReadonlyMap<string, number>,
  openCaseCountByFacility: ReadonlyMap<string, number>,
  groupNameById: ReadonlyMap<string, string>,
): LaunchNoDateRow[] {
  const rows: LaunchNoDateRow[] = [];
  for (const f of facilities) {
    if (!f.isActive || f.referenceOnly || f.effectiveDate) continue;
    rows.push({
      facilityId: f.id,
      name: f.name,
      groupId: f.groupId,
      groupName: (f.groupId ? groupNameById.get(f.groupId) : undefined) ?? "No group",
      city: f.city ?? null,
      state: f.state ?? null,
      providerCount: providerCountByFacility.get(f.id) ?? 0,
      openCaseCount: openCaseCountByFacility.get(f.id) ?? 0,
    });
  }
  const ungrouped = (r: LaunchNoDateRow) => !(r.groupId && groupNameById.has(r.groupId));
  return rows.sort(
    (a, b) =>
      Number(ungrouped(a)) - Number(ungrouped(b)) ||
      a.groupName.localeCompare(b.groupName) ||
      a.name.localeCompare(b.name) ||
      a.facilityId.localeCompare(b.facilityId),
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
