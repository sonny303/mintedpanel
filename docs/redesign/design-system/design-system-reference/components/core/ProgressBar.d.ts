import React from "react";

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Current value. */
  value: number;
  /** Maximum. Default 100. */
  max?: number;
  /** Optional left-aligned label above the track. */
  label?: string;
  /** Override the right-aligned count text (default "value of max"). */
  countText?: string;
  /** Show the count text. Default true. */
  showCount?: boolean;
}

/**
 * A readiness bar — forest fill on a muted track, with an optional label +
 * mono "x of y" count row. Used for coverage / in-network progress.
 *
 * Adherence: forest fill only; keep the track 6px; never color the fill by state.
 *
 * @startingPoint section="Core" subtitle="Readiness / coverage bar" viewport="700x140"
 */
export function ProgressBar(props: ProgressBarProps): JSX.Element;
