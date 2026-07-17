import React from "react";

/**
 * CountBadge — a small number chip. Forest for active/attention counts,
 * muted gray for idle totals. Used in nav items and group rows.
 */
export function CountBadge({ value, active = false, style, ...rest }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "18px",
        height: "18px",
        padding: "0 5px",
        borderRadius: "var(--radius-pill)",
        background: active ? "var(--color-primary)" : "var(--mp-chip-idle)",
        color: active ? "var(--text-on-primary)" : "var(--text-secondary)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--font-size-meta)",
        fontWeight: "var(--font-weight-semibold)",
        fontVariantNumeric: "tabular-nums",
        lineHeight: 1,
        ...style,
      }}
      {...rest}
    >
      {value}
    </span>
  );
}
