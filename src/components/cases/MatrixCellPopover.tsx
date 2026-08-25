// Cases Matrix cell detail surfaces — rich case popovers plus the focused
// gap and excluded tooltips. This surface is read-only and never creates cases.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { Link } from "@tanstack/react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CaseStatusPill } from "@/components/cases/CaseStatusPill";
import { StatusPill } from "@/components/StatusPill";
import { EXCLUSION_REASON_LABELS } from "@/lib/generationPreview";
import { fmtDate } from "@/lib/format";
import { localTodayIso } from "@/hooks/useEnrollmentReadiness";
import type { QueueEntry } from "@/lib/nextBestActions";
import type {
  CasesMatrixCaseCell,
  CasesMatrixCell,
  CasesMatrixExcludedCell,
  CasesMatrixGapCell,
} from "@/lib/casesMatrix";

interface MatrixCellPopoverProps {
  cell: CasesMatrixCell;
  providerName: string;
  payerName: string;
  queueEntries: readonly QueueEntry[];
  followUp?: MatrixFollowUp;
}

interface MatrixFollowUp {
  touchDate: string;
  nextFollowUpDate: string | null;
}

const closeDelay = 120;
const MatrixPopoverContext = createContext<{
  openKey: string | null;
  setOpenKey: (key: string | null) => void;
}>({
  openKey: null,
  setOpenKey: () => undefined,
});

export function MatrixCellPopoverProvider({ children }: { children: ReactNode }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <MatrixPopoverContext.Provider value={{ openKey, setOpenKey }}>
      {children}
    </MatrixPopoverContext.Provider>
  );
}

function lastTouchLabel(followUp: MatrixFollowUp | undefined): string {
  if (!followUp) return "Never touched";
  const days = differenceInCalendarDays(
    parseISO(localTodayIso()),
    parseISO(followUp.touchDate),
  );
  return days === 0 ? "Touched today" : `${days}d since last touch`;
}

function caseDetails(
  cell: CasesMatrixCaseCell,
  providerName: string,
  payerName: string,
  queueEntries: readonly QueueEntry[],
  followUp: MatrixFollowUp | undefined,
) {
  const today = localTodayIso();
  const daysOpen = Math.max(
    0,
    differenceInCalendarDays(parseISO(today), parseISO(cell.case.createdAt)),
  );
  const queueEntry = queueEntries.find((entry) => entry.caseId === cell.case.id);
  const followUpDue =
    followUp?.nextFollowUpDate ??
    null;
  const followUpOverdue = followUpDue !== null && followUpDue < today;

  return {
    daysOpen,
    followUpDue,
    followUpOverdue,
    lastTouch: lastTouchLabel(followUp),
    queueEntry,
    providerName,
    payerName,
  };
}

function CaseCellPopover({
  cell,
  providerName,
  payerName,
  queueEntries,
  followUp,
}: MatrixCellPopoverProps & { cell: CasesMatrixCaseCell }) {
  const { openKey, setOpenKey } = useContext(MatrixPopoverContext);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const details = caseDetails(cell, providerName, payerName, queueEntries, followUp);
  const popoverKey = `case:${cell.case.id}`;

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const openPopover = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpenKey(popoverKey);
  };
  const closePopover = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenKey(null), closeDelay);
  };

  return (
    <Popover
      open={openKey === popoverKey}
      onOpenChange={(nextOpen) => setOpenKey(nextOpen ? popoverKey : null)}
    >
      <PopoverTrigger asChild>
        <Link
          to="/cases/$id"
          params={{ id: cell.case.id }}
          className="flex min-h-8 w-full items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[#1B4D3E] focus-visible:ring-offset-1"
          onMouseEnter={openPopover}
          onMouseLeave={closePopover}
          onFocus={openPopover}
          onBlur={closePopover}
          onKeyDown={(event) => {
            if (event.key === " ") {
              event.preventDefault();
              event.currentTarget.click();
            }
          }}
          aria-label={`${providerName}, ${payerName}, ${cell.case.state}, open case`}
        >
          <span className="flex items-center gap-1.5">
            <CaseStatusPill status={cell.case.caseStatus} />
            {cell.hasOverdueTask ? (
              <span
                className="h-2 w-2 rounded-full bg-[#DC2626]"
                title="Overdue follow-up"
                aria-label="Overdue follow-up"
              />
            ) : null}
            {cell.stale === "never" ? (
              <span
                className="h-2 w-2 rounded-full border border-[#D97706]"
                title="Never touched"
                aria-label="Never touched"
              />
            ) : cell.stale === "quiet" ? (
              <span
                className="h-2 w-2 rounded-full bg-[#D97706]"
                title="Went quiet"
                aria-label="Went quiet"
              />
            ) : null}
          </span>
          <span className="sr-only">Open case</span>
        </Link>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-4"
        onMouseEnter={openPopover}
        onMouseLeave={closePopover}
      >
        <div className="space-y-3 text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[12px] font-medium">
              {cell.case.caseNumber != null ? `C-${cell.case.caseNumber}` : "Case"}
            </span>
            <CaseStatusPill status={cell.case.caseStatus} />
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <span className="text-muted-foreground">Provider</span>
            <span>{details.providerName}</span>
            <span className="text-muted-foreground">Payer</span>
            <span>{details.payerName}</span>
            <span className="text-muted-foreground">State</span>
            <span>{cell.case.state}</span>
            <span className="text-muted-foreground">Days open</span>
            <span>{details.daysOpen}d</span>
            <span className="text-muted-foreground">Last touch</span>
            <span>{details.lastTouch}</span>
            <span className="text-muted-foreground">Follow-up</span>
            <span className={details.followUpOverdue ? "text-[#B91C1C]" : undefined}>
              {details.followUpDue ? (
                <>
                  {fmtDate(details.followUpDue)}
                  {details.followUpOverdue ? " · overdue" : ""}
                </>
              ) : (
                "—"
              )}
            </span>
          </div>
          {details.queueEntry ? (
            <div className="border-t border-[#E8E5E0] pt-3">
              <div className="font-medium">{details.queueEntry.action}</div>
              <div className="mt-0.5 text-[12px] text-muted-foreground">
                {details.queueEntry.reason}
              </div>
            </div>
          ) : null}
          <Link
            to="/cases/$id"
            params={{ id: cell.case.id }}
            className="inline-flex text-[12px] font-medium text-[#1B4D3E] hover:underline"
          >
            Open case →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GapCellTooltip({ cell, payerName }: { cell: CasesMatrixGapCell; payerName: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex min-h-8 w-full items-center justify-center">
          <StatusPill status="gray" label="Not started" className="opacity-60" />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-1">
          <div>{payerName} · Not started</div>
          <Link
            to="/generation"
            search={{
              provider: cell.generation.providerId,
              payer: cell.generation.payerId,
              group: cell.generation.groupId,
            }}
            className="font-medium text-white underline"
          >
            Generate case →
          </Link>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function ExcludedCellTooltip({
  cell,
}: {
  cell: CasesMatrixExcludedCell;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex min-h-8 w-full items-center justify-center">
          <span className="text-muted-foreground opacity-60">—</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {EXCLUSION_REASON_LABELS[cell.reason]}
        {cell.note ? ` — ${cell.note}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

export function MatrixCellPopover(props: MatrixCellPopoverProps) {
  switch (props.cell.kind) {
    case "case":
      return <CaseCellPopover {...props} cell={props.cell} />;
    case "gap":
      return <GapCellTooltip cell={props.cell} payerName={props.payerName} />;
    case "excluded":
      return <ExcludedCellTooltip cell={props.cell} />;
  }
}
