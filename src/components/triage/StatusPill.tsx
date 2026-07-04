// Triage StatusPill (M1): color arrives as a prop — resolved from
// status_configs.color at M2. Never hardcode hues here. The suffix is a
// derived fragment (e.g. "45d silent") rendered muted, outside the pill.
interface StatusPillProps {
  label: string;
  color: string;
  suffix?: string;
}

export function StatusPill({ label, color, suffix }: StatusPillProps) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className="inline-flex items-center rounded-[var(--mp-radius-pill)] px-2.5 py-0.5 text-[var(--mp-text-xs)] font-medium leading-4"
        style={{
          color,
          backgroundColor: `color-mix(in srgb, ${color} 12%, white)`,
        }}
      >
        {label}
      </span>
      {suffix ? (
        <span className="text-[var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">{suffix}</span>
      ) : null}
    </span>
  );
}
