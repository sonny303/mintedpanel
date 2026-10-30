// MINT-73 — the one definition of a case's age. "Days open" is whole calendar
// days since the case was created; the Cases list, the Matrix cell popover and
// the case Details card all read it from here, so the same case never shows two
// different "Days open" numbers. Calendar days in the viewer's local time, not
// 24-hour periods. No I/O.
import { differenceInCalendarDays, parseISO } from "date-fns";

/** Whole calendar days since the case was created; never negative. */
export function caseDaysOpen(createdAt: string, now: Date): number {
  return Math.max(0, differenceInCalendarDays(now, parseISO(createdAt)));
}
