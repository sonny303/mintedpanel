// Triage FilterCards (M1/M2 fix): the four stat cards above the work views
// ARE the filter — exactly one active at a time. Small uppercase label over a
// large count; active card fills primary, inactive cards stay white.
export interface FilterCard {
  id: string;
  label: string;
  n: number;
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
              className={`block text-[var(--mp-text-2xs)] font-medium uppercase tracking-wider ${
                isSelected ? "text-white/85" : "text-[color:var(--mp-ink-secondary)]"
              }`}
            >
              {card.label}
            </span>
            <span
              className={`mt-2 block text-[var(--mp-text-3xl)] font-semibold leading-none tabular-nums ${
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
