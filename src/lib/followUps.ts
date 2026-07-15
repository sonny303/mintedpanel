// E4.1 F4.1.2: the follow-up carry-forward reducer. This is the round-3 CRITICAL
// fix — a touch with no next_follow_up_date CARRIES the prior active follow-up
// forward; it never clears it. Clearing is only ever the explicit entry-form
// control, stored as `clears_follow_up = true`. Pure and org-agnostic: the
// caller passes a case's touchpoint rows (entry_type = 'touchpoint' only) and
// gets back the active follow-up, or null when none is active.

export interface FollowUpTouch {
  id: string;
  touchDate: string; // yyyy-mm-dd
  createdAt: string; // ISO timestamp
  nextFollowUpDate: string | null; // yyyy-mm-dd
  clearsFollowUp: boolean;
}

export interface ActiveFollowUp {
  date: string; // yyyy-mm-dd
  sourceTouchId: string; // the touch that set the still-active follow-up
}

export type FollowUpStatus = "overdue" | "due_today" | "upcoming" | "none";

// Latest-first tie-break: (touch_date DESC, created_at DESC, id DESC). Returns
// > 0 when `a` should sort AFTER `b` (i.e. `b` is more recent).
function compareLatestFirst(a: FollowUpTouch, b: FollowUpTouch): number {
  if (a.touchDate !== b.touchDate) return a.touchDate < b.touchDate ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

// Walk touchpoints latest-first and return the first one that RESOLVES the
// follow-up: an explicit clear (clears_follow_up = true) → no active follow-up;
// a set date → that date is the active follow-up. Date-less, non-clearing
// touches are skipped so the prior follow-up carries forward. A row that both
// clears and carries a date is treated as a clear (the explicit control wins);
// the entry form never produces that combination.
export function resolveActiveFollowUp(touchpoints: FollowUpTouch[]): ActiveFollowUp | null {
  const ordered = [...touchpoints].sort(compareLatestFirst);
  for (const t of ordered) {
    if (t.clearsFollowUp) return null;
    if (t.nextFollowUpDate) return { date: t.nextFollowUpDate, sourceTouchId: t.id };
  }
  return null;
}

// Follow-up status relative to a reference day (both yyyy-mm-dd). String compare
// is safe for ISO dates. A date strictly before today is overdue.
export function followUpStatus(date: string | null | undefined, today: string): FollowUpStatus {
  if (!date) return "none";
  if (date < today) return "overdue";
  if (date === today) return "due_today";
  return "upcoming";
}

export function isFollowUpOverdue(date: string | null | undefined, today: string): boolean {
  return followUpStatus(date, today) === "overdue";
}
