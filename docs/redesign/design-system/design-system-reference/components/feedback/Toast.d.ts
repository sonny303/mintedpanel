import React from "react";

export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Accent dot tone; neutral shows none. */
  tone?: "neutral" | "success" | "info" | "warning" | "danger";
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Trailing action (e.g. an "Undo" link Button). */
  action?: React.ReactNode;
  /** Show a dismiss (×) button. */
  onClose?: () => void;
}

/**
 * Transient notification card (the app drives these via sonner; this is the
 * visual primitive). White surface, 1px border, no shadow. Mount in your own
 * toaster queue — bottom-right, stacked, auto-dismiss.
 *
 * @startingPoint section="Feedback" subtitle="Notification toast" viewport="700x140"
 */
export function Toast(props: ToastProps): JSX.Element;
