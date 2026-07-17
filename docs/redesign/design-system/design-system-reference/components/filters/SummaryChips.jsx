import React from "react";

/**
 * Action-state tones for the filter chips. Each has a soft resting tint and a
 * selected treatment (white fill, solid border, soft outline ring).
 */
const CHIP_TONES = {
  needs:   { bg: "var(--mp-tint-overdue-bg)",   fg: "var(--mp-tint-overdue-fg)",   dot: "var(--mp-status-overdue)",   ring: "rgba(220,38,38,.28)" },
  blocked: { bg: "var(--mp-tint-pending-bg)",   fg: "var(--mp-tint-pending-fg)",   dot: "var(--mp-status-pending)",   ring: "rgba(217,119,6,.28)" },
  stalled: { bg: "var(--mp-tint-idle-bg)",      fg: "var(--mp-tint-idle-fg)",      dot: "var(--mp-status-idle)",      ring: "rgba(107,114,128,.28)" },
  ontrack: { bg: "var(--mp-tint-submitted-bg)", fg: "var(--mp-tint-submitted-fg)", dot: "var(--mp-status-submitted)", ring: "rgba(8,145,178,.28)" },
};

/**
 * SummaryChips — a row of count chips, one per action state, at the top of a
 * queue. Click a chip to filter the list below; single-select, click again to
 * clear. Controlled via `selected` + `onSelect`, or uncontrolled.
 *
 * chips: [{ key: "needs"|"blocked"|"stalled"|"ontrack", label, count }]
 */
export function SummaryChips({ chips = [], selected, onSelect, defaultSelected = null, style, ...rest }) {
  const [internal, setInternal] = React.useState(defaultSelected);
  const active = selected !== undefined ? selected : internal;

  const handle = (key) => {
    const next = active === key ? null : key;
    if (selected === undefined) setInternal(next);
    onSelect && onSelect(next);
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", ...style }} {...rest}>
      {chips.map((chip) => {
        const t = CHIP_TONES[chip.key] || CHIP_TONES.stalled;
        const on = active === chip.key;
        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => handle(chip.key)}
            style={{
              display: "inline-flex", alignItems: "center", gap: "8px",
              height: "var(--control-height)", padding: "0 12px",
              borderRadius: "var(--radius-tile)",
              border: "1px solid " + (on ? t.dot : t.bg),
              background: on ? "var(--color-surface)" : t.bg,
              outline: on ? "2px solid " + t.ring : "none",
              outlineOffset: on ? "1px" : 0,
              cursor: "pointer",
              fontFamily: "var(--font-sans)", fontSize: "var(--font-size-control)",
              fontWeight: "var(--font-weight-medium)", color: t.fg,
            }}
          >
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: t.dot }} />
            {chip.label}
            <span style={{ fontWeight: "var(--font-weight-semibold)", fontVariantNumeric: "tabular-nums" }}>{chip.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export const CHIP_TONE_KEYS = Object.keys(CHIP_TONES);
