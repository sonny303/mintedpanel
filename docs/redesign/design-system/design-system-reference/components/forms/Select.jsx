import React from "react";

/**
 * Select — native select with the system's custom chevron. Same box metrics
 * and focus ring as Input. Pass <option> children.
 */
export function Select({ error = false, disabled = false, children, style, onFocus, onBlur, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const border = error ? "var(--color-danger)" : focus ? "var(--color-primary)" : "var(--color-border)";
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <select
        disabled={disabled}
        onFocus={(e) => { setFocus(true); onFocus && onFocus(e); }}
        onBlur={(e) => { setFocus(false); onBlur && onBlur(e); }}
        style={{
          height: "var(--control-height)",
          width: "100%",
          padding: "0 30px 0 10px",
          border: "1px solid " + border,
          borderRadius: "var(--radius-control)",
          background: disabled ? "var(--color-surface-muted)" : "var(--color-surface)",
          color: disabled ? "var(--text-tertiary)" : "var(--text-primary)",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--font-size-control)",
          appearance: "none",
          WebkitAppearance: "none",
          outline: focus && !error ? "2px solid var(--focus-ring)" : "none",
          cursor: disabled ? "not-allowed" : "pointer",
          ...style,
        }}
        {...rest}
      >
        {children}
      </select>
      <span
        style={{
          position: "absolute", right: "12px", top: "12px",
          width: "7px", height: "7px",
          borderRight: "1.5px solid var(--text-secondary)",
          borderBottom: "1.5px solid var(--text-secondary)",
          transform: "rotate(45deg)", pointerEvents: "none",
        }}
      />
    </div>
  );
}
