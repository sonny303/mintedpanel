import React from "react";

/**
 * Card — the base container. White fill, 1px border, 6px radius, NO shadow.
 * Compose with CardHeader / CardTitle / CardDescription / CardContent / CardFooter.
 */
export function Card({ children, style, ...rest }) {
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-tile)", fontFamily: "var(--font-sans)", color: "var(--text-primary)", ...style }} {...rest}>
      {children}
    </div>
  );
}
export function CardHeader({ children, style, ...rest }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "16px", ...style }} {...rest}>{children}</div>;
}
export function CardTitle({ children, style, ...rest }) {
  return <div style={{ fontSize: "var(--font-size-section)", fontWeight: "var(--font-weight-semibold)", letterSpacing: "var(--letter-spacing-title)", lineHeight: 1.2, ...style }} {...rest}>{children}</div>;
}
export function CardDescription({ children, style, ...rest }) {
  return <div style={{ fontSize: "var(--font-size-control)", color: "var(--text-secondary)", ...style }} {...rest}>{children}</div>;
}
export function CardContent({ children, style, ...rest }) {
  return <div style={{ padding: "16px", paddingTop: 0, ...style }} {...rest}>{children}</div>;
}
export function CardFooter({ children, style, ...rest }) {
  return <div style={{ display: "flex", alignItems: "center", padding: "16px", paddingTop: 0, ...style }} {...rest}>{children}</div>;
}
