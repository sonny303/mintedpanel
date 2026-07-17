import React from "react";

/**
 * Dialog — a modal card on a dimmed backdrop. Header (title + close),
 * body (children), and a footer action row. Controlled via `open`.
 * No shadow — a 1px border carries the card, matching the system.
 */
export function Dialog({ open = true, title, onClose, footer, children, width = 400, style, ...rest }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(31,41,55,.28)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: "24px",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: typeof width === "number" ? width + "px" : width,
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-tile)",
          overflow: "hidden",
          fontFamily: "var(--font-sans)",
          ...style,
        }}
        {...rest}
      >
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ fontSize: "var(--font-size-page-title)", fontWeight: "var(--font-weight-semibold)", color: "var(--text-primary)" }}>{title}</div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                width: "26px", height: "26px", display: "inline-flex", alignItems: "center", justifyContent: "center",
                border: "none", background: "transparent", borderRadius: "var(--radius-control)",
                color: "var(--text-tertiary)", fontSize: "18px", lineHeight: 1, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {"\u00D7"}
            </button>
          )}
        </div>
        <div style={{ padding: "18px" }}>{children}</div>
        {footer && (
          <div style={{ padding: "14px 18px", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "flex-end", gap: "8px", background: "var(--color-bg)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
