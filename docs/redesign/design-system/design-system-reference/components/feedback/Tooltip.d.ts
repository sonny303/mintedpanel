import React from "react";

export interface TooltipProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Tooltip text — short, one line. */
  label: React.ReactNode;
  /** Placement. Default "top". */
  side?: "top" | "bottom";
  /** The trigger element (usually an icon-only button). */
  children?: React.ReactNode;
}

/**
 * Dark ink bubble on hover/focus. MANDATORY on icon-only buttons (a11y).
 * 12px text, 4px radius, no arrow, no delay styling here (production uses
 * Radix with its own timing).
 *
 * @startingPoint section="Feedback" subtitle="Icon-button tooltip" viewport="700x110"
 */
export function Tooltip(props: TooltipProps): JSX.Element;
