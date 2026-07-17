import React from "react";

export interface SummaryChip {
  /** Action-state key: sets tone. */
  key: "needs" | "blocked" | "stalled" | "ontrack";
  /** Chip label (e.g. "Needs action"). */
  label: string;
  /** Count shown after the label. */
  count: number;
}

export interface SummaryChipsProps extends React.HTMLAttributes<HTMLDivElement> {
  chips: SummaryChip[];
  /** Controlled selection (a chip key or null). */
  selected?: string | null;
  /** Uncontrolled initial selection. */
  defaultSelected?: string | null;
  /** Fires with the new selection (or null when cleared). */
  onSelect?: (key: string | null) => void;
}

/**
 * A row of count chips atop a queue — one per action state. Single-select:
 * clicking filters the list below; clicking again clears. Selected chips get a
 * white fill, solid border, and soft ring.
 *
 * Adherence: one selected at a time; counts use tabular figures; tones match
 * ActionBadge states.
 *
 * @startingPoint section="Filters" subtitle="Count chips · click to filter" viewport="700x120"
 */
export function SummaryChips(props: SummaryChipsProps): JSX.Element;

export const CHIP_TONE_KEYS: string[];
