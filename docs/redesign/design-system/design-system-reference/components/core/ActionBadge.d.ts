import React from "react";

export interface ActionBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Derived action state. Sets both label and tone. */
  state?: "needs" | "blocked" | "stalled" | "ontrack" | "awaiting";
  /** Override the default label copy for this state. */
  children?: React.ReactNode;
}

/**
 * The derived, one-per-case action state ("Needs action", "Blocked", "Stalled",
 * "On track", "Awaiting effective date"). Built on Badge; always dotted so it
 * visually separates from a payer-status Badge.
 *
 * Adherence:
 * - Exactly one ActionBadge per case/provider row — it's the worst/derived state.
 * - Don't restyle; the state → tone mapping is fixed.
 *
 * @startingPoint section="Core" subtitle="Derived action state (dotted)" viewport="700x120"
 */
export function ActionBadge(props: ActionBadgeProps): JSX.Element;

export const ACTION_STATE_KEYS: string[];
