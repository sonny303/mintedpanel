import React from "react";

/**
 * Input — single-line text field. Focus draws a 1px forest border + soft ring;
 * error swaps to a red border; disabled fills muted. `mono` for NPIs / IDs.
 */
export function Input({ error = false, disabled = false, mono = false, style, onFocus, onBlur, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const border = error ? "var(--color-danger)" : focus ? "var(--color-primary)" : "var(--color-border)";
  return (
    <input
      disabled={disabled}
      onFocus={(e) => { setFocus(true); onFocus && onFocus(e); }}
      onBlur={(e) => { setFocus(false); onBlur && onBlur(e); }}
      style={{
        height: "var(--control-height)",
        width: "100%",
        padding: "0 10px",
        border: "1px solid " + border,
        borderRadius: "var(--radius-control)",
        background: disabled ? "var(--color-surface-muted)" : "var(--color-surface)",
        color: disabled ? "var(--text-tertiary)" : "var(--text-primary)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        fontSize: "var(--font-size-control)",
        fontVariantNumeric: "tabular-nums",
        outline: focus && !error ? "2px solid var(--focus-ring)" : "none",
        outlineOffset: 0,
        cursor: disabled ? "not-allowed" : "text",
        ...style,
      }}
      {...rest}
    />
  );
}
