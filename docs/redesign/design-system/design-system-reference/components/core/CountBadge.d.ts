import React from "react";

export interface CountBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The number (or short string) to show. */
  value: React.ReactNode;
  /** Forest fill for counts that need attention; gray for idle totals. */
  active?: boolean;
}

/**
 * A small rounded number chip for counts on nav items and group rows.
 * Forest = active/attention, gray = idle. Tabular figures.
 *
 * @startingPoint section="Core" subtitle="Number count chip" viewport="700x100"
 */
export function CountBadge(props: CountBadgeProps): JSX.Element;
