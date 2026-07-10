import React from "react";

export interface DialogProps {
  /** Controls visibility. Default true. */
  open?: boolean;
  /** Header title. */
  title?: React.ReactNode;
  /** Called on backdrop click and close button. Omit to hide the close button. */
  onClose?: () => void;
  /** Footer action row — typically a secondary Cancel + primary Button. */
  footer?: React.ReactNode;
  /** Dialog body. */
  children?: React.ReactNode;
  /** Max width in px (or a CSS string). Default 400. */
  width?: number | string;
  style?: React.CSSProperties;
}

/**
 * Modal card on a dimmed backdrop — header (title + close), body, footer
 * actions. No shadow; a 1px border carries the card.
 *
 * Adherence: actions live in `footer`, right-aligned, primary last. Keep the
 * body to one task.
 *
 * @startingPoint section="Feedback" subtitle="Modal on dimmed backdrop" viewport="700x320"
 */
export function Dialog(props: DialogProps): JSX.Element | null;
