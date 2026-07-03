// Triage RowCta (M1): inline row action button. Renders purely from props;
// wiring to the case's next open task lands at M2.
interface RowCtaProps {
  label: string;
  onClick: () => void;
}

export function RowCta({ label, onClick }: RowCtaProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center rounded-[var(--mp-radius-sm)] bg-mp-primary-tint px-2.5 py-1 text-[var(--mp-text-xs)] font-semibold text-[color:var(--mp-primary)] transition-colors hover:bg-mp-primary hover:text-white whitespace-nowrap"
    >
      {label}
    </button>
  );
}
