import React from "react";

export interface GroupedListItem {
  id?: React.Key;
  /** Case label (usually the payer name). */
  label: React.ReactNode;
  /** Optional mono meta (e.g. "Updated 2h ago"). */
  meta?: React.ReactNode;
  /** ActionBadge state key ("needs" | "blocked" | ...) or a custom node. */
  action?: string | React.ReactNode;
}

export interface GroupedListGroup {
  id: React.Key;
  /** Provider name. */
  title: React.ReactNode;
  /** Secondary line (state · payer count). */
  subtitle?: React.ReactNode;
  /** Count chip on the header. */
  count?: React.ReactNode;
  /** Header ActionBadge — the worst/derived state. Key or node. */
  action?: string | React.ReactNode;
  /** Cases revealed when expanded. */
  items?: GroupedListItem[];
}

export interface GroupedListProps extends React.HTMLAttributes<HTMLDivElement> {
  groups: GroupedListGroup[];
  /** Group ids open by default. */
  defaultOpen?: React.Key[];
}

/**
 * The core queue pattern: provider rows that expand to reveal their cases
 * inline. Header shows a count + derived ActionBadge; each case row shows its
 * own. Composes ActionBadge + CountBadge.
 *
 * Adherence: one ActionBadge per row; header state = the group's worst case.
 *
 * @startingPoint section="Data" subtitle="Expandable provider → cases queue" viewport="700x320"
 */
export function GroupedList(props: GroupedListProps): JSX.Element;
