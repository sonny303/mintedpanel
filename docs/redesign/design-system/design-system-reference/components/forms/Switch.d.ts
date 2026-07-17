import React from "react";

export interface SwitchProps extends Omit<React.HTMLAttributes<HTMLLabelElement>, "onChange"> {
  /** Controlled state. */
  checked?: boolean;
  /** Uncontrolled initial state. */
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Inline label to the right. */
  label?: React.ReactNode;
}

/**
 * 34×18 toggle — forest track when on, white knob. For settings and
 * enable/disable state (checkbox = selection, switch = state).
 *
 * @startingPoint section="Forms" subtitle="Switch · on / off / disabled" viewport="700x110"
 */
export function Switch(props: SwitchProps): JSX.Element;
