// Triage SummaryChips (M1): filter chips with counts; the selected chip fills
// primary green. Chips flagged warn tint their count.
export interface SummaryChip {
  id: string;
  label: string;
  n: number;
  warn?: boolean;
}

interface SummaryChipsProps {
  chips: SummaryChip[];
  selected: string | null;
  onSelect: (id: string) => void;
}

export function SummaryChips({ chips, selected, onSelect }: SummaryChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group">
      {chips.map((chip) => {
        const isSelected = chip.id === selected;
        return (
          <button
            key={chip.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(chip.id)}
            className={`inline-flex items-center gap-1.5 rounded-[var(--mp-radius-pill)] border px-3 py-1.5 text-[var(--mp-text-sm)] font-medium transition-colors ${
              isSelected
                ? "bg-mp-primary border-mp-primary text-white"
                : "bg-mp-card border-mp-border text-[color:var(--mp-ink-secondary)] hover:border-[color:var(--mp-ink-faint)] hover:text-[color:var(--mp-ink)]"
            }`}
          >
            {chip.label}
            <span
              className={`tabular-nums text-[var(--mp-text-xs)] font-semibold ${
                isSelected
                  ? "text-white/80"
                  : chip.warn
                    ? "text-[color:var(--mp-warn)]"
                    : "text-[color:var(--mp-ink-faint)]"
              }`}
            >
              {chip.n}
            </span>
          </button>
        );
      })}
    </div>
  );
}
