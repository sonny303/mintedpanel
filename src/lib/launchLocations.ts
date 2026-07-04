// Launch-location domain logic (launch PRD v2.1): a launch is not its own
// entity, it is a facilities row in a pre-active location-track status. The
// Launches page is a filtered view of locations. Statuses are org-configurable
// status_configs rows, matched by label — the same idiom the case pipeline
// uses for "In-Network". Pure functions only; no I/O.
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import type { Facility, StatusConfig } from "@/types";

/** Live rows stay in Recently Launched for this many days, then drop off. */
export const RECENTLY_LAUNCHED_DAYS = 30;

export const LIVE_STATUS_LABEL = "Live";
export const INACTIVE_STATUS_LABEL = "Inactive";

/** Early-pipeline statuses show the date as a target, later ones as a start. */
const TARGET_LABELS = new Set(["Planned", "Interviewing"]);
const STARTS_LABELS = new Set(["Pending Fulfillment", "Ready for Launch", LIVE_STATUS_LABEL]);

/** Form-field label for the effective date, switching with the status. */
export function launchDateFieldLabel(statusLabel: string | null | undefined): string {
  if (statusLabel && TARGET_LABELS.has(statusLabel)) return "Target date";
  if (statusLabel && STARTS_LABELS.has(statusLabel)) return "Start date";
  return "Effective date";
}

export interface LocationRow {
  facility: Facility;
  /** location-track status config, null for plain active locations */
  status: StatusConfig | null;
}

export function isLiveLabel(label: string | null | undefined): boolean {
  return label === LIVE_STATUS_LABEL;
}

export function isInactiveLabel(label: string | null | undefined): boolean {
  return label === INACTIVE_STATUS_LABEL;
}

export interface LaunchSections {
  /** Live with an effective date inside the window (future dates tolerated) */
  recentlyLaunched: LocationRow[];
  /** every pre-Live status, dated rows first ascending, no-date rows last */
  pipeline: LocationRow[];
}

/**
 * Splits locations into the two Launches-page sections. Rows with no location
 * status (plain active locations), Inactive rows, and soft-archived rows
 * (is_active = false) never appear. Live rows older than the window drop off
 * the page entirely.
 */
export function splitLaunchSections(rows: LocationRow[], today: Date): LaunchSections {
  const recentlyLaunched: LocationRow[] = [];
  const pipeline: LocationRow[] = [];
  for (const row of rows) {
    if (!row.facility.isActive) continue;
    const label = row.status?.label ?? null;
    if (label === null || isInactiveLabel(label)) continue;
    if (isLiveLabel(label)) {
      const date = row.facility.effectiveDate;
      if (date && differenceInCalendarDays(today, parseISO(date)) <= RECENTLY_LAUNCHED_DAYS) {
        recentlyLaunched.push(row);
      }
      continue;
    }
    pipeline.push(row);
  }
  recentlyLaunched.sort(
    (a, b) =>
      (b.facility.effectiveDate ?? "").localeCompare(a.facility.effectiveDate ?? "") ||
      a.facility.name.localeCompare(b.facility.name),
  );
  pipeline.sort(comparePipelineRows);
  return { recentlyLaunched, pipeline };
}

/** Date ascending, rows without a date last, name as the tie-break. */
export function comparePipelineRows(a: LocationRow, b: LocationRow): number {
  const da = a.facility.effectiveDate;
  const db = b.facility.effectiveDate;
  if (da && db && da !== db) return da.localeCompare(db);
  if (da && !db) return -1;
  if (!da && db) return 1;
  return a.facility.name.localeCompare(b.facility.name);
}

/**
 * Row date display: "Target Mmm D, YYYY" early in the pipeline, "Starts
 * Mmm D, YYYY" once a provider is secured, nothing for Prospect/Inactive.
 * Admin-added statuses outside the seeded seven show the bare date.
 */
export function launchDateDisplay(
  statusLabel: string | null | undefined,
  effectiveDate: string | null | undefined,
): string {
  if (!statusLabel || statusLabel === "Prospect" || isInactiveLabel(statusLabel)) return "—";
  const prefix = TARGET_LABELS.has(statusLabel)
    ? "Target"
    : STARTS_LABELS.has(statusLabel)
      ? "Starts"
      : null;
  if (!effectiveDate) return "No date";
  const formatted = format(parseISO(effectiveDate), "MMM d, yyyy");
  return prefix ? `${prefix} ${formatted}` : formatted;
}

/**
 * NEW STATE: the location's state has no Live location in the same group.
 * Locations without a location status count as live — they are plain active
 * sites that predate the pipeline. Soft-archived locations don't count.
 */
export function isNewStateLaunch(candidate: Facility, all: LocationRow[]): boolean {
  if (!candidate.state) return false;
  return !all.some(
    (row) =>
      row.facility.id !== candidate.id &&
      row.facility.isActive &&
      row.facility.groupId === candidate.groupId &&
      row.facility.state === candidate.state &&
      (row.status === null || isLiveLabel(row.status.label)),
  );
}

/** "Start date passed. Mark Live?" — pre-Live rows whose date is behind us. */
export function needsGoLiveNudge(
  statusLabel: string | null | undefined,
  effectiveDate: string | null | undefined,
  today: Date,
): boolean {
  if (!statusLabel || isLiveLabel(statusLabel) || isInactiveLabel(statusLabel)) return false;
  if (!effectiveDate) return false;
  return differenceInCalendarDays(today, parseISO(effectiveDate)) > 0;
}

export interface TransitionCheckInput {
  toStatusLabel: string;
  hasProvider: boolean;
  linkedCaseCount: number;
}

/** Soft transition checks — warn, never block. */
export function transitionWarnings(input: TransitionCheckInput): string[] {
  const warnings: string[] = [];
  if (input.toStatusLabel === "Ready for Launch" && !input.hasProvider) {
    warnings.push("No provider is assigned to this location yet.");
  }
  if (isLiveLabel(input.toStatusLabel) && input.linkedCaseCount === 0) {
    warnings.push("No credentialing cases are linked to this location yet.");
  }
  return warnings;
}
