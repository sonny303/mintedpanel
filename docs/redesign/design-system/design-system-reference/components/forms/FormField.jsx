import React from "react";

/**
 * FormField — the label + control + help/error wrapper. 12px uppercase label
 * above; error message (red) or hint (tertiary) below. Turns the label red
 * when `error` is set to mark the field.
 */
export function FormField({ label, error, hint, htmlFor, children, style, ...rest }) {
  const message = typeof error === "string" ? error : hint;
  const messageColor = error ? "var(--color-danger)" : "var(--text-tertiary)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", ...style }} {...rest}>
      {label && (
        <label
          htmlFor={htmlFor}
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "var(--font-size-label)",
            fontWeight: "var(--font-weight-semibold)",
            letterSpacing: "var(--letter-spacing-label)",
            textTransform: "uppercase",
            color: error ? "var(--color-danger)" : "var(--text-secondary)",
          }}
        >
          {label}
        </label>
      )}
      {children}
      {message && (
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--font-size-body)", color: messageColor }}>
          {message}
        </span>
      )}
    </div>
  );
}
