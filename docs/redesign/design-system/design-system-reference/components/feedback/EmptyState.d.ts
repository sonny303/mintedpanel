import React from "react";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Headline — say what's absent ("No cases match these filters"). */
  title?: string;
  /** Supporting line — the next step. */
  description?: string;
  /** Optional action, usually a secondary Button ("Clear filters"). */
  action?: React.ReactNode;
  /** Show skeleton rows instead of a message. */
  loading?: boolean;
  /** Skeleton row count when loading. Default 2. */
  rows?: number;
}

/**
 * Centered empty message with an optional action, plus a `loading` skeleton
 * variant. Drop inside a bordered container / table body.
 *
 * Adherence: title states what's absent; copy is filter-aware and calm.
 *
 * @startingPoint section="Feedback" subtitle="Empty + loading variants" viewport="700x220"
 */
export function EmptyState(props: EmptyStateProps): JSX.Element;
