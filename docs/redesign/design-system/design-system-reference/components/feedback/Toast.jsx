import React from "react";

const ACCENT = {
  neutral: null,
  success: "var(--mp-status-active)",
  info:    "var(--mp-status-review)",
  warning: "var(--mp-status-pending)",
  danger:  "var(--mp-status-overdue)",
};

/**
 * Toast — a transient notification card. White surface, 1px border, no shadow
 * (structure by border, per system rule). Presentational: mount inside your
 * own toaster queue (bottom-right, auto-dismiss).
 */
export function Toast({ tone = "neutral", title, description, action, onClose, style, ...rest }) {
  const accent = ACCENT[tone];
  return (
    <div role="status" style={{ display: "flex", alignItems: "flex-start", gap: "10px", width: "360px", maxWidth: "100%", padding: "12px 14px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-tile)", fontFamily: "var(--font-sans)", ...style }} {...rest}>
      {accent && <span style={{ width: "7px", height: "7px", marginTop: "5px", borderRadius: "50%", background: accent, flex: "none" }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <div style={{ fontSize: "var(--font-size-control)", fontWeight: "var(--font-weight-semibold)", color: "var(--text-primary)" }}>{title}</div>}
        {description && <div style={{ fontSize: "var(--font-size-body)", color: "var(--text-secondary)", marginTop: title ? "2px" : 0 }}>{description}</div>}
      </div>
      {action}
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" style={{ width: "20px", height: "20px", display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", borderRadius: "var(--radius-control)", color: "var(--text-tertiary)", fontSize: "16px", lineHeight: 1, cursor: "pointer", fontFamily: "inherit", flex: "none" }}>{"\u00D7"}</button>
      )}
    </div>
  );
}
