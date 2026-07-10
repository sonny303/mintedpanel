import React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Status tone. Drives both tint pair and dot color. */
  tone?: "active" | "review" | "pending" | "overdue" | "submitted" | "idle";
  /** Show a leading solid dot (used to signal derived state — see ActionBadge). */
  dot?: boolean;
  children?: React.ReactNode;
}

/**
 * The single status-pill primitive. Six tones map to the product's payer-status
 * vocabulary; height, radius and weight are fixed by the system.
 *
 * Adherence:
 * - Use `tone`, never ad-hoc background/color.
 * - Keep labels one or two words; badges never wrap.
 * - A bare tone pill = payer status. Add `dot` only when the value is a derived
 *   action state (prefer <ActionBadge> for that).
 *
 * @startingPoint section="Core" subtitle="Six-tone status pill" viewport="700x120"
 */
export function Badge(props: BadgeProps): JSX.Element;

export const BADGE_TONES: string[];
