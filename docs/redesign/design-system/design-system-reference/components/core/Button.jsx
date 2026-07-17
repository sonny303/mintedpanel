import React from "react";

const VARIANTS = {
  primary: {
    base:  { border: "1px solid var(--color-primary)", background: "var(--color-primary)", color: "var(--text-on-primary)" },
    hover: { border: "1px solid var(--color-primary-hover)", background: "var(--color-primary-hover)" },
    spinnerTrack: "rgba(255,255,255,.4)", spinnerHead: "#FFFFFF", disabledOpacity: 0.4,
  },
  secondary: {
    base:  { border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--text-primary)" },
    hover: { background: "var(--color-surface-muted)" },
    spinnerTrack: "rgba(27,77,62,.25)", spinnerHead: "var(--color-primary)", disabledOpacity: 0.45,
  },
  destructive: {
    base:  { border: "1px solid var(--color-danger)", background: "var(--color-danger)", color: "var(--text-on-primary)" },
    hover: { border: "1px solid var(--color-danger-hover)", background: "var(--color-danger-hover)" },
    spinnerTrack: "rgba(255,255,255,.4)", spinnerHead: "#FFFFFF", disabledOpacity: 0.4,
  },
  link: {
    base:  { border: "none", background: "transparent", color: "var(--color-primary)", padding: "0 2px" },
    hover: { color: "var(--color-nav)", textDecoration: "underline" },
    spinnerTrack: "rgba(27,77,62,.25)", spinnerHead: "var(--color-primary)", disabledOpacity: 0.45,
  },
};

function Spinner({ track, head }) {
  return (
    <span
      style={{
        width: "13px", height: "13px", borderRadius: "50%",
        border: "2px solid " + track, borderTopColor: head,
        animation: "mp-spin .7s linear infinite", display: "inline-block", flex: "none",
      }}
    />
  );
}

/**
 * Button — four variants (primary / secondary / destructive / link) across
 * default, hover, disabled and loading. 34px tall, 4px radius, 13px medium.
 */
export function Button({
  variant = "primary",
  disabled = false,
  loading = false,
  type = "button",
  children,
  style,
  onMouseEnter,
  onMouseLeave,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const v = VARIANTS[variant] || VARIANTS.primary;
  const isLink = variant === "link";
  const inactive = disabled || loading;

  return (
    <button
      type={type}
      disabled={disabled}
      onMouseEnter={(e) => { setHover(true); onMouseEnter && onMouseEnter(e); }}
      onMouseLeave={(e) => { setHover(false); onMouseLeave && onMouseLeave(e); }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: isLink ? "6px" : "8px",
        height: "var(--control-height)",
        padding: isLink ? "0 2px" : "0 14px",
        borderRadius: "var(--radius-control)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--font-size-control)",
        fontWeight: "var(--font-weight-medium)",
        whiteSpace: "nowrap",
        cursor: loading ? "progress" : disabled ? "not-allowed" : "pointer",
        opacity: disabled ? v.disabledOpacity : 1,
        transition: "background .12s, border-color .12s, color .12s",
        ...v.base,
        ...(hover && !inactive ? v.hover : null),
        ...style,
      }}
      {...rest}
    >
      {loading && <Spinner track={v.spinnerTrack} head={v.spinnerHead} />}
      {children}
    </button>
  );
}
