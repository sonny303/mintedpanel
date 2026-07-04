// Shared filter-card semantics for the grouped work views (M2 Providers,
// M3 Cases). Both pages import these instead of defining their own, so the
// four card counts and the filtered lists can never drift between pivots —
// the M3 consistency requirement.
import type { ActionBadgeTone } from "@/components/triage/ActionBadge";
import type { ActionState } from "./actionState";

export type ChipId = "all" | "needs" | "inprog" | "awaiting";

export const CHIP_STATES: Record<Exclude<ChipId, "all">, readonly ActionState[]> = {
  needs: ["needs_action", "blocked"],
  inprog: ["on_track", "stalled"],
  awaiting: ["awaiting_effective"],
};

/** A case is open (counted by the chips) unless the engine says complete. */
export function isOpenState(state: ActionState): boolean {
  return state !== "complete";
}

export interface ChipCounts {
  all: number;
  needs: number;
  inprog: number;
  awaiting: number;
}

/** The four chip totals over a set of engine states (closed states drop out). */
export function chipCounts(states: readonly ActionState[]): ChipCounts {
  const open = states.filter(isOpenState);
  return {
    all: open.length,
    needs: open.filter((s) => CHIP_STATES.needs.includes(s)).length,
    inprog: open.filter((s) => CHIP_STATES.inprog.includes(s)).length,
    awaiting: open.filter((s) => CHIP_STATES.awaiting.includes(s)).length,
  };
}

/**
 * The list-filter predicate for a selected card. Shares CHIP_STATES and
 * isOpenState with chipCounts, so a card that says N always filters the
 * list down to exactly N rows.
 */
export function matchesChip(chip: ChipId, state: ActionState): boolean {
  return chip === "all" ? isOpenState(state) : CHIP_STATES[chip].includes(state);
}

/** A case row is alert-tinted when it sits in the needs-your-action bucket. */
export function isAlertState(state: ActionState): boolean {
  return CHIP_STATES.needs.includes(state);
}

// Provider/payer rollup chip treatments, shared by both work views.
export const ACTION_BADGE_TONE: Record<ActionState, ActionBadgeTone> = {
  needs_action: "danger",
  blocked: "warn",
  stalled: "warn",
  awaiting_effective: "pending",
  on_track: "ok",
  complete: "neutral",
};

export const ACTION_BADGE_NOUN: Record<ActionState, string> = {
  needs_action: "needs action",
  blocked: "blocked",
  stalled: "stalled",
  awaiting_effective: "awaiting effective",
  on_track: "On track",
  complete: "Complete",
};

/** Rollup chip label: counted for actionable states, plain for resting ones. */
export function badgeLabel(worst: ActionState, count: number): string {
  return worst === "on_track" || worst === "complete"
    ? ACTION_BADGE_NOUN[worst]
    : `${count} ${ACTION_BADGE_NOUN[worst]}`;
}
