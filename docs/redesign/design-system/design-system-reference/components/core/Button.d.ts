import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight. Primary = solid forest, secondary = outline, destructive = red, link = text-only. */
  variant?: "primary" | "secondary" | "destructive" | "link";
  /** Dim + disable pointer events. */
  disabled?: boolean;
  /** Show an inline spinner and set a progress cursor (still rendered inline). */
  loading?: boolean;
  children?: React.ReactNode;
}

/**
 * The button primitive. Fixed 34px height and 4px radius across all variants;
 * hover, disabled and loading are handled internally.
 *
 * Adherence:
 * - One primary button per view/section; pair with a secondary "Cancel".
 * - `destructive` only for irreversible actions.
 * - `link` for inline navigation, not primary actions.
 * - Never override height/radius/weight.
 *
 * @startingPoint section="Core" subtitle="Primary / secondary / destructive / link" viewport="700x150"
 */
export function Button(props: ButtonProps): JSX.Element;
