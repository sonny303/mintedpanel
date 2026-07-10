import React from "react";

/**
 * CopyButton — a compact copy chip for IDs (NPI, CAQH, license #). Copies
 * `value` to the clipboard and flips to a green "Copied" state for ~1.2s.
 */
export function CopyButton({ value = "", label = "Copy", copiedLabel = "Copied", style, onCopy, ...rest }) {
  const [copied, setCopied] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const timer = React.useRef(null);

  React.useEffect(() => () => timer.current && clearTimeout(timer.current), []);

  const handleClick = async (e) => {
    try { await navigator.clipboard.writeText(String(value)); } catch (_) {}
    setCopied(true);
    onCopy && onCopy(value, e);
    timer.current && clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  };

  const base = {
    display: "inline-flex", alignItems: "center", gap: "6px",
    height: "var(--control-height-xs)", padding: "0 9px",
    borderRadius: "var(--radius-control)", cursor: "pointer",
    fontFamily: "var(--font-sans)", fontSize: "var(--font-size-body)",
    lineHeight: 1, transition: "background .12s, color .12s, border-color .12s",
  };
  const resting = hover
    ? { border: "1px solid var(--color-border)", background: "var(--color-surface-muted)", color: "var(--text-primary)" }
    : { border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--text-secondary)" };
  const done = { border: "1px solid #A7D9C4", background: "#ECF7F1", color: "var(--mp-tint-active-fg)" };

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...base, ...(copied ? done : resting), ...style }}
      {...rest}
    >
      {copied ? "\u2713 " + copiedLabel : label}
    </button>
  );
}
