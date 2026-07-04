// M2 priority engine: classifies a case into exactly one action state from
// its status bucket, open tasks, last touch, and effective dates. Pure and
// deterministic — rules evaluate top-down, first match wins (see build spec).
import { differenceInCalendarDays, parseISO } from "date-fns";

export type ActionState =
  "needs_action" | "blocked" | "awaiting_effective" | "stalled" | "on_track" | "complete";

// Single source for the stalled threshold — cases.index imports this too.
// A waiting_payer case with no touch inside this window counts as stalled.
export const STALLED_AFTER_DAYS = 14;

// Severity order for provider-level rollups (worst first).
export const ACTION_STATE_SEVERITY: readonly ActionState[] = [
  "needs_action",
  "blocked",
  "stalled",
  "awaiting_effective",
  "on_track",
  "complete",
];

export interface ActionStateInput {
  /** status_configs.label of the case's credentialing status, if any */
  statusLabel: string | null;
  /** status_configs.action_bucket of the case's credentialing status, if any */
  actionBucket: string | null;
  /** due dates (ISO) of the case's open (not completed) tasks; null = no due date */
  openTaskDueDates: readonly (string | null)[];
  /** most recent touches.touch_date for the case, if any */
  lastTouchDate: string | null;
  /** case created_at — the stalled anchor when the case has never been touched */
  createdAt: string;
  confirmedEffectiveDate: string | null;
  expectedEffectiveDate: string | null;
  /**
   * true when the case sits on the Pre-Credentialing Setup sentinel payer.
   * Pre-cred has no payer effective date, so an Approved pre-cred case is
   * genuinely complete and must not be pulled into awaiting_effective.
   */
  isPreCred?: boolean;
  /** injectable clock for tests */
  now?: Date;
}

export function getActionState(input: ActionStateInput): ActionState {
  const now = input.now ?? new Date();

  const hasDueOrOverdueTask = input.openTaskDueDates.some(
    (due) => due != null && differenceInCalendarDays(now, parseISO(due)) >= 0,
  );

  // 1. needs_action: our court, or any open task due today / overdue.
  if (input.actionBucket === "ours" || hasDueOrOverdueTask) return "needs_action";

  // 2. blocked: waiting on the provider. No status maps here yet — the bucket
  // is admin-configurable, so the rule ships anyway.
  if (input.actionBucket === "waiting_provider") return "blocked";

  // 3. awaiting_effective: Approved but not yet billable — either the
  // (confirmed, else expected) effective date is still in the future, or no
  // effective date has been recorded at all. An Approved case with a null
  // effective date is NOT complete: someone still has to chase the date.
  const effective = input.confirmedEffectiveDate ?? input.expectedEffectiveDate;
  if (
    input.statusLabel === "Approved" &&
    !input.isPreCred &&
    (effective == null || differenceInCalendarDays(parseISO(effective), now) > 0)
  ) {
    return "awaiting_effective";
  }

  // 4/5. waiting on the payer: stalled vs on_track by touch recency.
  if (input.actionBucket === "waiting_payer") {
    return daysSilent(input, now) >= STALLED_AFTER_DAYS ? "stalled" : "on_track";
  }

  // 6. complete.
  if (input.actionBucket === "complete") return "complete";

  // Unclassified status (or case without a status): nothing routes it, so it
  // needs a human. Surfaces misconfiguration instead of hiding it.
  return "needs_action";
}

/** Days since the last touch (or case creation when never touched). */
export function daysSilent(
  input: Pick<ActionStateInput, "lastTouchDate" | "createdAt">,
  now: Date = new Date(),
): number {
  const anchor = input.lastTouchDate ?? input.createdAt;
  return differenceInCalendarDays(now, parseISO(anchor));
}

/** Worst state across a set (by severity order); null for an empty set. */
export function worstActionState(states: readonly ActionState[]): ActionState | null {
  let worstIndex = Infinity;
  for (const state of states) {
    const index = ACTION_STATE_SEVERITY.indexOf(state);
    if (index < worstIndex) worstIndex = index;
  }
  return Number.isFinite(worstIndex) ? ACTION_STATE_SEVERITY[worstIndex] : null;
}
