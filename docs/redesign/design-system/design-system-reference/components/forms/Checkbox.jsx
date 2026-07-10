import React from "react";

/**
 * Checkbox — 16px box, 4px radius. Checked = forest fill + white check.
 * Controlled (`checked`+`onCheckedChange`) or uncontrolled (`defaultChecked`).
 */
export function Checkbox({ checked, defaultChecked = false, onCheckedChange, disabled = false, label, style, ...rest }) {
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
        role="checkbox"
        aria-checked={on}
        disabled={disabled}
        onClick={toggle}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          width: "16px", height: "16px", flex: "none", padding: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          border: on ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
          borderRadius: "var(--radius-control)",
          background: on ? "var(--color-primary)" : "var(--color-surface)",
          outline: focus ? "2px solid var(--focus-ring)" : "none",
          cursor: "inherit", transition: "background .12s, border-color .12s",
        }}
      >
        {on && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5.2l2.3 2.3 4.7-5" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        )}
      </button>
      {label}
    </label>
  );
}
