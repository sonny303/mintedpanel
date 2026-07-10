// Triage StatusPill (M1): color arrives as a prop — resolved from
// status_configs.color at M2. Never hardcode hues here. The suffix is a
// derived fragment (e.g. "45d silent") rendered muted, outside the pill.
//
// E0.9 design-system conformance: the raw hue is mapped to a semantic tone
// (reusing hexToStatusColor) and rendered with the DS fixed tint + darker-ink
// token pair at 4px radius — replacing the old color-mix tint + raw-hue text.
import { hexToStatusColor, statusToneClasses } from "@/components/StatusPill";

interface StatusPillProps {
  label: string;
  color: string;
  suffix?: string;
}

export function StatusPill({ label, color, suffix }: StatusPillProps) {
  const tone = hexToStatusColor(color);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className={`inline-flex items-center rounded-[var(--mp-radius-control)] px-2.5 py-0.5 text-[length:var(--mp-text-xs)] font-medium leading-4 ${statusToneClasses[tone]}`}
      >
        {label}
      </span>
      {suffix ? (
        <span className="text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
          {suffix}
        </span>
      ) : null}
    </span>
  );
}
