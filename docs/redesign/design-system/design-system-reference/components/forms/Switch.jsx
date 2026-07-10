import React from "react";

/**
 * Switch — 34×18 toggle. On = forest track, knob slides right. Controlled
 * (`checked`+`onCheckedChange`) or uncontrolled (`defaultChecked`).
 */
export function Switch({ checked, defaultChecked = false, onCheckedChange, disabled = false, label, style, ...rest }) {
  const [internal, setInternal] = React.useState(defaultChecked);
  const on = checked !== undefined ? checked : internal;
  const [focus, setFocus] = React.useState(false);
  const toggle = () => {
    if (disabled) return;
    const next = !on;
    if (checked === undefined) setInternal(next);
    onCheckedChange && onCheckedChange(next);
  };
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, fontFamily: "var(--font-sans)", fontSize: "var(--font-size-control)", color: "var(--text-primary)", ...style }} {...rest}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={toggle}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          width: "34px", height: "18px", flex: "none", padding: "2px",
          display: "inline-flex", alignItems: "center",
          border: "none", borderRadius: "9px",
          background: on ? "var(--color-primary)" : "var(--mp-chip-idle)",
          outline: focus ? "2px solid var(--focus-ring)" : "none",
          cursor: "inherit", transition: "background .15s",
        }}
      >
        <span style={{ width: "14px", height: "14px", borderRadius: "50%", background: "#FFFFFF", transform: on ? "translateX(16px)" : "translateX(0)", transition: "transform .15s" }} />
      </button>
      {label}
    </label>
  );
}
