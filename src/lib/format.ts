// Shared date formatting helpers used across route files.
// Standardizes on 'MMM d, yyyy' (and 'MMM d, yyyy · h:mm a' for timestamps).
// All of it reads the browser's time zone: a timestamp renders as the local
// day it happened on, and a calendar-only `yyyy-MM-dd` value renders as that
// same day in every zone (parseISO reads it as local midnight, not UTC).
import { format, parseISO } from "date-fns";

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "MMM d, yyyy");
  } catch {
    return "—";
  }
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "MMM d, yyyy · h:mm a");
  } catch {
    return "—";
  }
}

/** Today as a local calendar date (`yyyy-MM-dd`): the day a browser write
 * records an activity under, such as a task's completed_date or a note's
 * touch_date. Not `toISOString().slice(0, 10)`, which is UTC's day and is
 * already tomorrow in Denver from 6 pm (5 pm in winter), while the audit row
 * and the touch form's default both still say today. */
export function todayLocal(now: Date = new Date()): string {
  return format(now, "yyyy-MM-dd");
}
