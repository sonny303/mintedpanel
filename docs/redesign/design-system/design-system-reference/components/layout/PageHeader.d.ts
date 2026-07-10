import React from "react";

export interface PageHeaderProps extends React.HTMLAttributes<HTMLElement> {
  /** Page title — 16/600, sentence case. */
  title: React.ReactNode;
  /** One-line description under the title. */
  description?: React.ReactNode;
  /** Right-aligned action row (usually one primary Button max). */
  actions?: React.ReactNode;
}

/**
 * Title + description + actions above a 1px divider. Required at the top of
 * every routed page.
 *
 * Adherence: title 16/600 sentence case; one primary action max; description
 * is one line, no marketing copy.
 *
 * @startingPoint section="Layout" subtitle="Page title + actions row" viewport="700x120"
 */
export function PageHeader(props: PageHeaderProps): JSX.Element;
