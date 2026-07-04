// Triage RowCta (M1/M2 fix): THE row-level action button — small secondary
// variant, max-content width, one per row. Long labels truncate past ~28ch
// with the full text preserved in the title attribute.
interface RowCtaProps {
  label: string;
  onClick: () => void;
}

export function RowCta({ label, onClick }: RowCtaProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="inline-flex w-max max-w-[28ch] items-center rounded-[var(--mp-radius-sm)] border border-mp-border bg-mp-card px-2.5 py-1 text-[var(--mp-text-xs)] font-medium text-[color:var(--mp-ink-secondary)] transition-colors hover:bg-mp-muted hover:text-[color:var(--mp-ink)]"
    >
      <span className="truncate">{label}</span>
    </button>
  );
}
