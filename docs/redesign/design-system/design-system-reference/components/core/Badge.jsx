import React from "react";

/**
 * Status tone → soft tint pair (background / foreground) + solid dot color.
 * The six tones are the payer-status vocabulary of the whole product.
 */
const TONES = {
  active:    { bg: "var(--mp-tint-active-bg)",    fg: "var(--mp-tint-active-fg)",    dot: "var(--mp-status-active)" },
  review:    { bg: "var(--mp-tint-review-bg)",    fg: "var(--mp-tint-review-fg)",    dot: "var(--mp-status-review)" },
  pending:   { bg: "var(--mp-tint-pending-bg)",   fg: "var(--mp-tint-pending-fg)",   dot: "var(--mp-status-pending)" },
  overdue:   { bg: "var(--mp-tint-overdue-bg)",   fg: "var(--mp-tint-overdue-fg)",   dot: "var(--mp-status-overdue)" },
  submitted: { bg: "var(--mp-tint-submitted-bg)", fg: "var(--mp-tint-submitted-fg)", dot: "var(--mp-status-submitted)" },
  idle:      { bg: "var(--mp-tint-idle-bg)",      fg: "var(--mp-tint-idle-fg)",      dot: "var(--mp-status-idle)" },
};

/**
 * Badge — the single pill primitive. Six tones, optional leading dot.
 * Height 22px, 4px radius, 12px medium label. No shadow, no border.
 */
export function Badge({ tone = "idle", dot = false, children, style, ...rest }) {
  const t = TONES[tone] || TONES.idle;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: dot ? "6px" : 0,
        height: "var(--badge-height)",
        padding: "0 8px",
        borderRadius: "var(--radius-control)",
        background: t.bg,
        color: t.fg,
        fontFamily: "var(--font-sans)",
        fontSize: "var(--font-size-body)",
        fontWeight: "var(--font-weight-medium)",
        lineHeight: 1,
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      {dot && (
        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: t.dot, flex: "none" }} />
      )}
      {children}
    </span>
  );
}

export const BADGE_TONES = Object.keys(TONES);
