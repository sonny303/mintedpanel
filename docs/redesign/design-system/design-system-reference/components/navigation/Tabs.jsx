import React from "react";

/**
 * Tabs — segmented tab bar. Muted track; active tab lifts to a white card with
 * a 1px border (no shadow — consistent with the system). Controlled via
 * `value`+`onValueChange` or uncontrolled via `defaultValue`.
 */
export function Tabs({ tabs = [], value, defaultValue, onValueChange, style, ...rest }) {
  const [internal, setInternal] = React.useState(defaultValue ?? (tabs[0] && tabs[0].value));
  const active = value !== undefined ? value : internal;
  const select = (v) => { if (value === undefined) setInternal(v); onValueChange && onValueChange(v); };

  return (
    <div role="tablist" style={{ display: "inline-flex", alignItems: "center", gap: "2px", height: "34px", padding: "3px", background: "var(--color-surface-muted)", borderRadius: "var(--radius-tile)", fontFamily: "var(--font-sans)", ...style }} {...rest}>
      {tabs.map((tab) => {
        const on = active === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => select(tab.value)}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              height: "28px", padding: "0 12px", whiteSpace: "nowrap",
              border: on ? "1px solid var(--color-border)" : "1px solid transparent",
              borderRadius: "var(--radius-control)", cursor: "pointer",
              fontFamily: "inherit", fontSize: "var(--font-size-control)", fontWeight: "var(--font-weight-medium)",
              background: on ? "var(--color-surface)" : "transparent",
              color: on ? "var(--text-primary)" : "var(--text-secondary)",
              transition: "background .12s, color .12s",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
