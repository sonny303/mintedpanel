import React from "react";

/**
 * Textarea — multi-line note field. Matches Input's border / focus / error
 * treatment; fixed non-resizing height by default.
 */
export function Textarea({ error = false, disabled = false, rows = 3, style, onFocus, onBlur, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const border = error ? "var(--color-danger)" : focus ? "var(--color-primary)" : "var(--color-border)";
  return (
    <textarea
      rows={rows}
      disabled={disabled}
      onFocus={(e) => { setFocus(true); onFocus && onFocus(e); }}
      onBlur={(e) => { setFocus(false); onBlur && onBlur(e); }}
      style={{
        width: "100%",
        padding: "8px 10px",
        border: "1px solid " + border,
        borderRadius: "var(--radius-control)",
        background: disabled ? "var(--color-surface-muted)" : "var(--color-surface)",
        color: disabled ? "var(--text-tertiary)" : "var(--text-primary)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--font-size-control)",
        lineHeight: 1.45,
        resize: "none",
        outline: focus && !error ? "2px solid var(--focus-ring)" : "none",
        cursor: disabled ? "not-allowed" : "text",
        ...style,
      }}
      {...rest}
    />
  );
}
