import React from "react";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Red border to mark an invalid value. */
  error?: boolean;
  disabled?: boolean;
  /** Visible rows. Default 3. */
  rows?: number;
}

/**
 * Multi-line note field. Same border / focus / error treatment as Input;
 * non-resizing by default.
 *
 * @startingPoint section="Forms" subtitle="Multi-line note field" viewport="700x140"
 */
export function Textarea(props: TextareaProps): JSX.Element;
