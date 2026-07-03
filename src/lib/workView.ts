// Shared chip semantics for the grouped work views (M2 Providers, M3 Cases).
// Both pages import these instead of defining their own, so the four chip
// counts can never drift between pivots — the M3 consistency requirement.
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
