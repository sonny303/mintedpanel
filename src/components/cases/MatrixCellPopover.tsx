// Cases Matrix cell detail surfaces — rich case popovers, the gap popover that
// carries the one "Generate case" link, and the inert excluded tooltip. This
// surface is read-only and never creates cases: the gap link navigates to
// /generation, which stays the one door.
//
// Gap cells use a Popover rather than a Tooltip (handoff §7 said Tooltip)
// because a Radix tooltip is not interactive — a link inside one cannot be
// clicked or tabbed to, which would have made the "Generate case →" action
// dead. The trigger is therefore focusable so keyboard users can reach the
// link; excluded cells stay non-focusable as §4.5 requires.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { Link } from "@tanstack/react-router";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CaseStatusPill } from "@/components/cases/CaseStatusPill";
import { StatusPill } from "@/components/StatusPill";
import { EXCLUSION_REASON_LABELS } from "@/lib/generationPreview";
import { fmtDate } from "@/lib/format";
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
  /** Date-only ISO string; passed in so no cell reads the clock. */
  today: string;
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

/**
 * Hover- and focus-driven popover state, shared by case and gap cells. Only one
 * popover in the Matrix is open at a time; a short close delay lets the pointer
 * travel from the cell into the popover without dismissing it.
 */
function useHoverPopover(popoverKey: string) {
  const { openKey, setOpenKey } = useContext(MatrixPopoverContext);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const open = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpenKey(popoverKey);
  }, [popoverKey, setOpenKey]);

  const close = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenKey(null), closeDelay);
  }, [setOpenKey]);

  return {
    isOpen: openKey === popoverKey,
    setOpen: (nextOpen: boolean) => setOpenKey(nextOpen ? popoverKey : null),
    open,
    close,
    /** Spread onto the trigger and the popover content alike. */
    hoverProps: { onMouseEnter: open, onMouseLeave: close },
  };
}

function lastTouchLabel(followUp: MatrixFollowUp | undefined, today: string): string {
  if (!followUp) return "Never touched";
  const days = differenceInCalendarDays(parseISO(today), parseISO(followUp.touchDate));
  return days === 0 ? "Touched today" : `${days}d since last touch`;
}

function caseDetails(
  cell: CasesMatrixCaseCell,
  today: string,
  queueEntries: readonly QueueEntry[],
  followUp: MatrixFollowUp | undefined,
) {
  const daysOpen = Math.max(
    0,
    differenceInCalendarDays(parseISO(today), parseISO(cell.case.createdAt)),
  );
  const queueEntry = queueEntries.find((entry) => entry.caseId === cell.case.id);
  const followUpDue = followUp?.nextFollowUpDate ?? null;
  const followUpOverdue = followUpDue !== null && followUpDue < today;

  return {
    daysOpen,
    followUpDue,
    followUpOverdue,
    lastTouch: lastTouchLabel(followUp, today),
    queueEntry,
  };
}

function CaseCellPopover({
  cell,
  providerName,
  payerName,
  today,
  queueEntries,
  followUp,
}: MatrixCellPopoverProps & { cell: CasesMatrixCaseCell }) {
  const popover = useHoverPopover(`case:${cell.case.id}`);
  const details = caseDetails(cell, today, queueEntries, followUp);

  return (
    <Popover open={popover.isOpen} onOpenChange={popover.setOpen}>
      <PopoverTrigger asChild>
        <Link
          to="/cases/$id"
          params={{ id: cell.case.id }}
          className="flex min-h-8 w-full items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--mp-primary)] focus-visible:ring-offset-1"
          onMouseEnter={popover.open}
          onMouseLeave={popover.close}
          onFocus={popover.open}
          onBlur={popover.close}
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
                className="h-2 w-2 rounded-full bg-[color:var(--mp-danger)]"
                title="Overdue task"
                aria-label="Overdue task"
              />
            ) : null}
            {cell.stale === "never" ? (
              <span
                className="h-2 w-2 rounded-full border border-[color:var(--mp-warn)]"
                title="Never touched"
                aria-label="Never touched"
              />
            ) : cell.stale === "quiet" ? (
              <span
                className="h-2 w-2 rounded-full bg-[color:var(--mp-warn)]"
                title="Went quiet"
                aria-label="Went quiet"
              />
            ) : null}
          </span>
          <span className="sr-only">Open case</span>
        </Link>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-4" {...popover.hoverProps}>
        <div className="space-y-3 text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[12px] font-medium">
              {cell.case.caseNumber != null ? `C-${cell.case.caseNumber}` : "Case"}
            </span>
            <CaseStatusPill status={cell.case.caseStatus} />
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <span className="text-muted-foreground">Provider</span>
            <span>{providerName}</span>
            <span className="text-muted-foreground">Payer</span>
            <span>{payerName}</span>
            <span className="text-muted-foreground">State</span>
            <span>{cell.case.state}</span>
            <span className="text-muted-foreground">Days open</span>
            <span>{details.daysOpen}d</span>
            <span className="text-muted-foreground">Last touch</span>
            <span>{details.lastTouch}</span>
            <span className="text-muted-foreground">Follow-up</span>
            <span className={details.followUpOverdue ? "text-[color:var(--mp-danger)]" : undefined}>
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
            <div className="border-t border-mp-border pt-3">
              <div className="font-medium">{details.queueEntry.action}</div>
              <div className="mt-0.5 text-[12px] text-muted-foreground">
                {details.queueEntry.reason}
              </div>
            </div>
          ) : null}
          <Link
            to="/cases/$id"
            params={{ id: cell.case.id }}
            className="inline-flex text-[12px] font-medium text-[color:var(--mp-primary)] hover:underline"
          >
            Open case →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GapCellPopover({
  cell,
  providerName,
  payerName,
}: {
  cell: CasesMatrixGapCell;
  providerName: string;
  payerName: string;
}) {
  const popover = useHoverPopover(
    `gap:${cell.generation.providerId}:${cell.generation.groupId}:${cell.generation.payerId}:${cell.generation.state}`,
  );

  return (
    <Popover open={popover.isOpen} onOpenChange={popover.setOpen}>
      <PopoverTrigger asChild>
        {/* Focusable so the Generate link is keyboard-reachable, but it is not a
            navigation target itself — activating it only opens the popover. */}
        <span
          role="button"
          tabIndex={0}
          className="flex min-h-8 w-full cursor-default items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--mp-primary)] focus-visible:ring-offset-1"
          onMouseEnter={popover.open}
          onMouseLeave={popover.close}
          onFocus={popover.open}
          onBlur={popover.close}
          aria-label={`${providerName}, ${payerName}, ${cell.generation.state}, not started`}
        >
          <StatusPill status="gray" label="Not started" className="opacity-60" />
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3" {...popover.hoverProps}>
        <div className="space-y-2 text-[13px]">
          <div>
            <div className="font-medium">{payerName}</div>
            <div className="text-[12px] text-muted-foreground">
              Not started · {cell.generation.state}
            </div>
          </div>
          <Link
            to="/generation"
            search={{
              provider: cell.generation.providerId,
              payer: cell.generation.payerId,
              group: cell.generation.groupId,
            }}
            className="inline-flex text-[12px] font-medium text-[color:var(--mp-primary)] hover:underline"
          >
            Generate case →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ExcludedCellTooltip({ cell }: { cell: CasesMatrixExcludedCell }) {
  return (
    <Tooltip>
      {/* Inert and non-focusable per handoff §4.5 — an excluded cell must not
          signal interactivity to pointer or keyboard. */}
      <TooltipTrigger asChild>
        <span className="flex min-h-8 w-full cursor-default items-center justify-center">
          <span className="text-muted-foreground opacity-60" aria-hidden="true">
            —
          </span>
          <span className="sr-only">Excluded — {EXCLUSION_REASON_LABELS[cell.reason]}</span>
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
      return (
        <GapCellPopover
          cell={props.cell}
          providerName={props.providerName}
          payerName={props.payerName}
        />
      );
    case "excluded":
      return <ExcludedCellTooltip cell={props.cell} />;
  }
}
