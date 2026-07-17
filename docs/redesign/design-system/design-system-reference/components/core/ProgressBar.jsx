import React from "react";

/**
 * ProgressBar — credentialing readiness. Forest fill on a muted track.
 * Optional label row with a mono "x of y" count. 6px track, 4px radius.
 */
export function ProgressBar({ value = 0, max = 100, label, countText, showCount = true, style, ...rest }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const count = countText != null ? countText : max ? value + " of " + max : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", ...style }} {...rest}>
      {(label || (showCount && count)) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}>
          {label && (
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--font-size-control)", color: "var(--text-primary)" }}>
              {label}
            </span>
          )}
          {showCount && count && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-body)", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
              {count}
            </span>
          )}
        </div>
      )}
      <div style={{ height: "6px", background: "var(--color-surface-muted)", borderRadius: "var(--radius-control)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: pct + "%", background: "var(--color-primary)", borderRadius: "var(--radius-control)" }} />
      </div>
    </div>
  );
}
