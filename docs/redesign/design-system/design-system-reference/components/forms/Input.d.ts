import React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Red border to mark an invalid value (pair with a message via FormField). */
  error?: boolean;
  disabled?: boolean;
  /** Render the value in Geist Mono with tabular figures — for NPIs / IDs. */
  mono?: boolean;
}

/**
 * Single-line text input. Focus = 1px forest border + soft ring; error = red
 * border; disabled = muted fill. Wrap with FormField for label + message.
 *
 * @startingPoint section="Forms" subtitle="Text input · all states" viewport="700x120"
 */
export function Input(props: InputProps): JSX.Element;
