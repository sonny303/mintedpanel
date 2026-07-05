// Home launches-at-risk row (M5, extracted in the Home polish pass): location
// name, start date, and the shared readiness bar. Whole row navigates to the
// launch detail.
import { ProgressBar } from "@/components/triage/ProgressBar";

interface HomeLaunchRowProps {
  name: string;
  /** Formatted start date ("MMM d, yyyy", or "—" when unset). */
  startsLabel: string;
  inNetwork: number;
  denominator: number;
  onOpen: () => void;
}

export function HomeLaunchRow({
  name,
  startsLabel,
  inNetwork,
  denominator,
  onOpen,
}: HomeLaunchRowProps) {
  return (
    <li
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 px-4 py-3 cursor-pointer hover:bg-mp-muted/50 transition-colors"
    >
      <span className="flex-1 min-w-0 truncate text-[length:var(--mp-text-sm)] font-medium text-[color:var(--mp-ink)]">
        {name}
      </span>
      <span className="text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
        Starts {startsLabel}
      </span>
      <span className="flex items-center gap-2">
        <span className="w-16">
          <ProgressBar value={inNetwork} max={Math.max(denominator, 1)} />
        </span>
        <span className="tabular-nums text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)] whitespace-nowrap">
          {inNetwork} of {denominator} in-network
        </span>
      </span>
    </li>
  );
}
