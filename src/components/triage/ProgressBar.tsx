// Triage ProgressBar (M1): thin bar on a tinted track.
interface ProgressBarProps {
  value: number;
  max: number;
}

export function ProgressBar({ value, max }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className="h-1 w-full min-w-16 rounded-[var(--mp-radius-pill)] bg-mp-primary-tint overflow-hidden"
    >
      <div
        className="h-full rounded-[var(--mp-radius-pill)] bg-mp-primary transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
