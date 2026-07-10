import React from "react";

export interface CheckboxProps extends Omit<React.HTMLAttributes<HTMLLabelElement>, "onChange"> {
  /** Controlled state. */
  checked?: boolean;
  /** Uncontrolled initial state. */
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Inline label text to the right of the box. */
  label?: React.ReactNode;
}

/**
 * 16px checkbox, 4px radius. Checked = forest fill + white check; focus = soft
 * ring. Used in forms and bulk row selection.
 *
 * Adherence: always give it a visible label (inline `label` or a FormField).
 *
 * @startingPoint section="Forms" subtitle="Checkbox · states" viewport="700x110"
 */
export function Checkbox(props: CheckboxProps): JSX.Element;
