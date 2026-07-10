import React from "react";

export interface CopyButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value" | "onCopy"> {
  /** The string written to the clipboard (e.g. an NPI or CAQH number). */
  value: string;
  /** Resting label. Default "Copy". */
  label?: string;
  /** Success label shown for ~1.2s (rendered with a leading check). Default "Copied". */
  copiedLabel?: string;
  /** Fired after a successful copy. */
  onCopy?: (value: string, e: React.MouseEvent) => void;
}

/**
 * A 26px copy chip for IDs. Copies to clipboard and holds a green confirmed
 * state for ~1.2s. Pair with a mono value in a key/value ID grid.
 *
 * @startingPoint section="Core" subtitle="Copy chip with confirmed state" viewport="700x100"
 */
export function CopyButton(props: CopyButtonProps): JSX.Element;
