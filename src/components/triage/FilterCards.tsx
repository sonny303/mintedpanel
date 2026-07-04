// Triage FilterCards (M1/M2 fix): the four stat cards above the work views
// ARE the filter — exactly one active at a time. Small uppercase label over a
// large count, per the approved mockup. Alert cards tint their label when the
// count is > 0 (and the card isn't the filled active one).
export interface FilterCard {
  id: string;
  label: string;
  n: number;
  alert?: boolean;
}

interface FilterCardsProps {
  cards: FilterCard[];
  selected: string;
  onSelect: (id: string) => void;
}

export function FilterCards({ cards, selected, onSelect }: FilterCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4" role="group">
      {cards.map((card) => {
        const isSelected = card.id === selected;
        const labelColor = isSelected
          ? "text-white/85"
          : card.alert && card.n > 0
            ? "text-[color:var(--mp-danger)]"
            : "text-[color:var(--mp-ink-faint)]";
        return (
          <button
            key={card.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(card.id)}
            className={`rounded-[var(--mp-radius-md)] border p-4 text-left transition-colors ${
              isSelected
                ? "border-mp-primary bg-mp-primary"
                : "border-mp-border bg-mp-card hover:border-[color:var(--mp-ink-faint)]"
            }`}
          >
            <span
              className={`block text-[var(--mp-text-2xs)] font-medium uppercase tracking-wider ${labelColor}`}
            >
              {card.label}
            </span>
            <span
              className={`mt-2 block text-[var(--mp-text-xl)] font-semibold leading-none tabular-nums ${
                isSelected ? "text-white" : "text-[color:var(--mp-ink)]"
              }`}
            >
              {card.n}
            </span>
          </button>
        );
      })}
    </div>
  );
}
