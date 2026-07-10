import React from "react";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Red border to mark an invalid selection. */
  error?: boolean;
  disabled?: boolean;
  /** <option> elements. */
  children?: React.ReactNode;
}

/**
 * Native select with the system chevron. Matches Input's box + focus ring.
 *
 * @startingPoint section="Forms" subtitle="Select with system chevron" viewport="700x120"
 */
export function Select(props: SelectProps): JSX.Element;
