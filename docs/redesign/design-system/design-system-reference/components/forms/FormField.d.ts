import React from "react";

export interface FormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 12px uppercase label above the control. */
  label?: string;
  /** Error message string (turns label + message red). `true` marks the field with no text. */
  error?: string | boolean;
  /** Muted helper text shown when there is no error. */
  hint?: string;
  /** Ties the label to the control's id. */
  htmlFor?: string;
  /** The control (Input / Select / Textarea). */
  children?: React.ReactNode;
}

/**
 * Label + control + help/error wrapper. Every form control ships inside a
 * FormField — it owns the uppercase label and the message slot.
 *
 * Adherence: labels are 12px uppercase; one message line; mark errors via
 * `error`, never a custom red <span>.
 *
 * @startingPoint section="Forms" subtitle="Label + control + message" viewport="700x160"
 */
export function FormField(props: FormFieldProps): JSX.Element;
