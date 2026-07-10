import React from "react";

export interface TabItem { value: string; label: React.ReactNode; }

export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  tabs: TabItem[];
  /** Controlled active value. */
  value?: string;
  /** Uncontrolled initial value (defaults to first tab). */
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

/**
 * Segmented tab bar — muted track, active tab lifts to white with a 1px border
 * (no shadow). Drives Reports (Summary/Matrix/Contracts/Roster), Case detail,
 * Settings. Render the active panel yourself, keyed off the value.
 *
 * Adherence: 2–6 one/two-word labels; don't restyle the active lift.
 *
 * @startingPoint section="Navigation" subtitle="Segmented tab bar" viewport="700x120"
 */
export function Tabs(props: TabsProps): JSX.Element;
