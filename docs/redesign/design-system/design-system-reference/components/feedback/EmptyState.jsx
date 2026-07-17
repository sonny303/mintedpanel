import React from "react";

function SkeletonRow() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
      <div style={{ width: "40px", height: "40px", borderRadius: "var(--radius-tile)", background: "var(--mp-chip-idle)", animation: "mp-pulse 1.4s ease-in-out infinite", flex: "none" }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{ height: "11px", width: "52%", borderRadius: "var(--radius-control)", background: "var(--mp-chip-idle)", animation: "mp-pulse 1.4s ease-in-out infinite" }} />
        <div style={{ height: "9px", width: "32%", borderRadius: "var(--radius-control)", background: "var(--color-border-subtle)", animation: "mp-pulse 1.4s ease-in-out infinite" }} />
      </div>
    </div>
  );
}

/**
 * EmptyState — a centered message with an optional action, plus a `loading`
 * variant that shows skeleton rows. Lives inside a bordered container.
 */
export function EmptyState({ title, description, action, loading = false, rows = 2, style, ...rest }) {
  if (loading) {
    return (
      <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px", justifyContent: "center", fontFamily: "var(--font-sans)", ...style }} {...rest}>
        {Array.from({ length: rows }).map((_, i) => <SkeletonRow key={i} />)}
        <div style={{ fontSize: "var(--font-size-body)", color: "var(--text-tertiary)", textAlign: "center" }}>Loading</div>
      </div>
    );
  }
  return (
    <div
      style={{
        minHeight: "160px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: "12px", padding: "24px", textAlign: "center", fontFamily: "var(--font-sans)", ...style,
      }}
      {...rest}
    >
      <div style={{ width: "40px", height: "40px", borderRadius: "var(--radius-tile)", background: "var(--color-surface-muted)", border: "1px solid var(--color-border)" }} />
      <div>
        <div style={{ fontSize: "var(--font-size-section)", fontWeight: "var(--font-weight-semibold)", color: "var(--text-primary)", marginBottom: "4px" }}>{title}</div>
        {description && <div style={{ fontSize: "var(--font-size-control)", color: "var(--text-secondary)", maxWidth: "36ch" }}>{description}</div>}
      </div>
      {action}
    </div>
  );
}
