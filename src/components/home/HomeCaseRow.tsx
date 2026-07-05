// Home queue case row (M5, extracted in the Home polish pass): one row shape
// for both case sections. "action" rows carry the status pill plus the work
// views' Days figure (submitted-else-created age, bold — these are alert
// rows); "follow-up" rows swap the pill for the due wording. One RowCta per
// row, whole row navigates.
import { StatusPill } from "@/components/triage/StatusPill";
import { RowCta } from "@/components/triage/RowCta";

interface HomeCaseRowProps {
  providerName: string;
  payerName: string;
  status: { label: string; color: string };
  /** Days since submitted (else created); null hides the figure. */
  days: number | null;
  /** Days past the follow-up date (0 = due today); follow-up rows only. */
  overdueDays?: number | null;
  variant: "action" | "follow-up";
  ctaLabel: string;
  onOpen: () => void;
}

export function HomeCaseRow({
  providerName,
  payerName,
  status,
  days,
  overdueDays,
  variant,
  ctaLabel,
  onOpen,
}: HomeCaseRowProps) {
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
        {providerName}
        <span className="text-[color:var(--mp-ink-faint)] font-normal"> · {payerName}</span>
      </span>
      {variant === "follow-up" && overdueDays != null ? (
        <span
          className={`text-[length:var(--mp-text-xs)] ${
            overdueDays > 0
              ? "font-semibold text-[color:var(--mp-danger)]"
              : "text-[color:var(--mp-ink-secondary)]"
          }`}
        >
          Follow-up due {overdueDays === 0 ? "today" : `${overdueDays}d ago`}
        </span>
      ) : (
        <span className="flex items-center gap-3">
          <StatusPill label={status.label} color={status.color} />
          {days !== null ? (
            <span className="tabular-nums text-[length:var(--mp-text-sm)] font-semibold text-[color:var(--mp-ink)]">
              {days}d
            </span>
          ) : null}
        </span>
      )}
      <span onClick={(e) => e.stopPropagation()}>
        <RowCta label={ctaLabel} onClick={onOpen} />
      </span>
    </li>
  );
}
