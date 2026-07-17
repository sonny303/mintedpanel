import React from "react";

/**
 * Tooltip — dark ink bubble on hover/focus. Wraps its child; mandatory on
 * icon-only buttons (a11y rule). Position: top or bottom.
 */
export function Tooltip({ label, side = "top", children, style, ...rest }) {
  const [open, setOpen] = React.useState(false);
  const pos = side === "bottom" ? { top: "calc(100% + 6px)" } : { bottom: "calc(100% + 6px)" };
  return (
    <span
      style={{ position: "relative", display: "inline-flex", ...style }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      {...rest}
    >
      {children}
      {open && (
        <span role="tooltip" style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", ...pos, zIndex: 40, whiteSpace: "nowrap", padding: "5px 8px", background: "var(--text-primary)", color: "#FFFFFF", borderRadius: "var(--radius-control)", fontFamily: "var(--font-sans)", fontSize: "var(--font-size-body)", lineHeight: 1.3, pointerEvents: "none" }}>
          {label}
        </span>
      )}
    </span>
  );
}
