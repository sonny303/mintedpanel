import React from "react";

/**
 * PageHeader — page title (16/600), optional description, right-aligned
 * actions, above a 1px divider. Required at the top of every routed page.
 */
export function PageHeader({ title, description, actions, style, ...rest }) {
  return (
    <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", paddingBottom: "16px", marginBottom: "24px", borderBottom: "1px solid var(--color-border)", fontFamily: "var(--font-sans)", ...style }} {...rest}>
      <div>
        <h1 style={{ margin: 0, fontSize: "var(--font-size-page-title)", fontWeight: "var(--font-weight-semibold)", letterSpacing: "var(--letter-spacing-title)", color: "var(--text-primary)" }}>{title}</h1>
        {description && <p style={{ margin: "4px 0 0", fontSize: "var(--font-size-control)", color: "var(--text-secondary)" }}>{description}</p>}
      </div>
      {actions && <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "none" }}>{actions}</div>}
    </header>
  );
}
