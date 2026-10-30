// One Group Contracts Matrix cell (GCM-7, GCM-8, GCM-26, GCM-31). The cell's
// meaning comes from src/lib/groupContractsMatrix.ts; this only renders it:
// a short status label in its tone, "All" for an all-specialties record, one
// date line, and a note icon whose tooltip shows the note.
import { memo } from "react";
import { FileText } from "lucide-react";
import { StatusPill, statusToneClasses } from "@/components/StatusPill";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ContractStatusTone, ContractsMatrixCell } from "@/lib/groupContractsMatrix";
import { cn } from "@/lib/utils";
import type { Contract } from "@/types";
import { CONTRACT_TONE_COLORS } from "./contractsMatrixView";

/** Not started reads as "not begun": the neutral pill with a dashed outline. */
const NOT_STARTED_OUTLINE = "border border-dashed border-[var(--mp-ink-faint)]";

/** A small swatch in a tone, for the Status filter chips and the legend. */
export function ContractToneSwatch({ tone }: { tone: ContractStatusTone }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] border",
        statusToneClasses[CONTRACT_TONE_COLORS[tone]],
        tone === "not-started" ? "border-dashed border-[var(--mp-ink-faint)]" : "border-current",
      )}
    />
  );
}

/** The neutral "All" tag on an all-specialties record (a tag chip, not a pill). */
export function SharedTag() {
  return (
    <span
      title="All specialties"
      className="inline-flex h-[18px] items-center rounded-[var(--mp-radius-control)] border border-[var(--mp-border)] bg-[var(--mp-card)] px-1 text-[11px] font-medium leading-none text-[var(--mp-ink-secondary)]"
    >
      All
    </span>
  );
}

interface ContractsMatrixCellViewProps {
  cell: ContractsMatrixCell<Contract>;
  domId: string;
  segmentStart: boolean;
  canWrite: boolean;
  highlighted: boolean;
  onOpen: (cell: ContractsMatrixCell<Contract>) => void;
}

function RecordContent({
  cell,
}: {
  cell: Extract<ContractsMatrixCell<Contract>, { kind: "record" }>;
}) {
  const color = CONTRACT_TONE_COLORS[cell.tone];
  return (
    <>
      <span className="flex items-center gap-1">
        <StatusPill
          status={color}
          label={cell.shortLabel}
          className={cn(
            "whitespace-nowrap",
            cell.tone === "not-started" ? NOT_STARTED_OUTLINE : undefined,
          )}
        />
        {cell.shared ? <SharedTag /> : null}
      </span>
      {cell.dateLine || cell.hasNote ? (
        <span className="flex items-center gap-1 text-[12px] leading-none text-[var(--mp-ink-secondary)]">
          {cell.dateLine ? <span className="whitespace-nowrap">{cell.dateLine}</span> : null}
          {cell.hasNote ? (
            <FileText aria-hidden="true" className="h-3 w-3" data-testid="contract-note-icon" />
          ) : null}
        </span>
      ) : null}
    </>
  );
}

const BUTTON_CLASS =
  "flex h-full min-h-[46px] w-full flex-col items-center justify-center gap-1 rounded-[var(--mp-radius-control)] px-1 py-1 transition-colors hover:bg-[var(--mp-muted)] focus-visible:outline-none focus-visible:shadow-[var(--mp-focus)]";

function ContractsMatrixCellViewInner({
  cell,
  domId,
  segmentStart,
  canWrite,
  highlighted,
  onOpen,
}: ContractsMatrixCellViewProps) {
  const tdClass = cn(
    "h-[62px] w-[132px] min-w-[132px] border-b border-b-[var(--mp-border-subtle)] p-1 text-center align-middle",
    segmentStart
      ? "border-l-2 border-l-[var(--mp-border-dashed)]"
      : "border-l border-l-[var(--mp-border-subtle)]",
    cell.kind === "outside" ? "bg-[var(--mp-muted)]" : "bg-[var(--mp-card)]",
    highlighted
      ? "bg-[var(--mp-primary-tint)] outline outline-2 -outline-offset-2 outline-[var(--mp-primary)]"
      : null,
  );
  const fade = cell.dimmed ? "opacity-40" : undefined;

  if (cell.kind === "outside") {
    return (
      <td id={domId} className={tdClass} data-cell-kind="outside">
        <span className="sr-only">{cell.ariaLabel}</span>
      </td>
    );
  }

  if (cell.kind === "empty") {
    if (!canWrite) {
      return (
        <td id={domId} className={tdClass} data-cell-kind="empty">
          <span aria-hidden="true" className={cn("text-[var(--mp-ink-faint)]", fade)}>
            —
          </span>
          <span className="sr-only">{cell.ariaLabel}</span>
        </td>
      );
    }
    return (
      <td id={domId} className={tdClass} data-cell-kind="empty">
        <button
          type="button"
          aria-label={cell.ariaLabel}
          aria-current={highlighted ? "location" : undefined}
          onClick={() => onOpen(cell)}
          className={cn(BUTTON_CLASS, "text-[var(--mp-ink-faint)]", fade)}
        >
          <span aria-hidden="true">—</span>
        </button>
      </td>
    );
  }

  const button = (
    <button
      type="button"
      aria-label={cell.ariaLabel}
      aria-current={highlighted ? "location" : undefined}
      onClick={() => onOpen(cell)}
      className={cn(BUTTON_CLASS, fade)}
    >
      <RecordContent cell={cell} />
    </button>
  );

  return (
    <td id={domId} className={tdClass} data-cell-kind="record">
      {cell.note ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs whitespace-pre-wrap">
            {cell.note}
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
    </td>
  );
}

export const ContractsMatrixCellView = memo(ContractsMatrixCellViewInner);
