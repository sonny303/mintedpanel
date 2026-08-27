// Cases Matrix cell detail surfaces — rich case popovers, the gap popover that
// carries the one "Generate case" link, and the inert excluded tooltip. This
// surface is read-only and never creates cases: the gap link navigates to
// /generation, which stays the one door.
//
// Gap cells use a Popover rather than a Tooltip because a Radix tooltip is not
// interactive — a link inside one cannot be clicked or tabbed to, which would
// have made the "Generate case →" action dead. The trigger is therefore
// focusable so keyboard users can reach the link. Excluded cells stay
// non-focusable: an excluded cell does nothing, so it must not signal
// interactivity to pointer or keyboard.
//
// FOCUS IS OWNED HERE, NOT BY RADIX. A hover-opened popover must never move
// focus, because these triggers open on focus: Radix's non-modal Content
// focuses its container on mount and hands focus back to the trigger on
// unmount, which with open-on-focus/close-on-blur triggers is a closed loop —
// open → content steals focus → trigger blurs → close → Radix refocuses the
// trigger → open. That loop is what made a stationary hover blink at the
// close-delay interval. Both hand-offs are therefore suppressed unless the
// user genuinely put focus inside the popover (the Enter/Space affordance on
// gap cells), which is the one case where focus has somewhere to go back to.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { Link } from "@tanstack/react-router";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CaseStatusPill } from "@/components/cases/CaseStatusPill";
import { StatusPill } from "@/components/StatusPill";
import { EXCLUSION_REASON_LABELS } from "@/lib/generationPreview";
import { fmtDate } from "@/lib/format";
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
  followUp?: MatrixFollowUp;
}

interface MatrixFollowUp {
  touchDate: string;
  nextFollowUpDate: string | null;
}

const closeDelay = 120;

/** The first thing a keyboard user can reach inside an open popover. */
const focusableInContent = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

const MatrixPopoverContext = createContext<{
  openKey: string | null;
  setOpenKey: Dispatch<SetStateAction<string | null>>;
}>({
  openKey: null,
  setOpenKey: () => undefined,
});

export function MatrixCellPopoverProvider({ children }: { children: ReactNode }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Memoized so an unrelated re-render of the board (any of the eight queries
  // behind useCasesMatrix settling) doesn't re-render every cell.
  const value = useMemo(() => ({ openKey, setOpenKey }), [openKey]);
  return <MatrixPopoverContext.Provider value={value}>{children}</MatrixPopoverContext.Provider>;
}

/**
 * Hover- and focus-driven popover state, shared by case and gap cells. Only one
 * popover in the Matrix is open at a time; a short close delay lets the pointer
 * travel from the cell into the popover without dismissing it.
 *
 * The returned `triggerProps` / `contentProps` are the whole contract — spread
 * them rather than re-wiring pointer or focus handlers per cell, or the
 * open/blur/refocus loop documented at the top of this file comes back.
 */
function useHoverPopover(popoverKey: string) {
  const { openKey, setOpenKey } = useContext(MatrixPopoverContext);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  /** True only while the user has deliberately moved focus into the popover. */
  const focusInside = useRef(false);
  /** Swallows exactly the focus Radix restores to the trigger on close. */
  const ignoreNextFocus = useRef(false);

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
    // Only dismiss if this cell still owns the open popover. Each cell has its
    // own timer, so hovering A → B would otherwise let A's delayed close null
    // the key after B already opened — the panel vanishes under a stationary
    // pointer on B.
    closeTimer.current = setTimeout(() => {
      setOpenKey((current) => (current === popoverKey ? null : current));
    }, closeDelay);
  }, [popoverKey, setOpenKey]);

  const openFromFocus = useCallback(() => {
    // Escape (or a dismissing click) closed the popover and Radix put focus
    // back on the cell. Re-opening on that focus would undo the dismissal.
    if (ignoreNextFocus.current) {
      ignoreNextFocus.current = false;
      return;
    }
    open();
  }, [open]);

  // Blur dismisses, but focus moving from the cell INTO its own
  // popover is not a dismissal — that is the keyboard path to the link.
  const handleBlur = useCallback(
    (event: React.FocusEvent<HTMLElement>) => {
      const next = event.relatedTarget as Node | null;
      if (next && contentRef.current?.contains(next)) {
        focusInside.current = true;
        return;
      }
      focusInside.current = false;
      close();
    },
    [close],
  );

  /** Hands focus to the popover's first control so the link is keyboard-reachable. */
  const focusContent = useCallback(() => {
    const target = contentRef.current?.querySelector<HTMLElement>(focusableInContent);
    if (!target) return false;
    focusInside.current = true;
    target.focus();
    return true;
  }, []);

  return {
    isOpen: openKey === popoverKey,
    setOpen: (nextOpen: boolean) => setOpenKey(nextOpen ? popoverKey : null),
    open,
    close,
    focusContent,
    triggerProps: {
      onMouseEnter: open,
      onMouseLeave: close,
      onFocus: openFromFocus,
      onBlur: handleBlur,
    },
    contentProps: {
      ref: contentRef,
      onMouseEnter: open,
      onMouseLeave: close,
      onBlur: handleBlur,
      onOpenAutoFocus: (event: Event) => {
        // Never on open. Hover must not move focus at all, and a keyboard user
        // keeps the cell's focus ring while they read.
        event.preventDefault();
      },
      onCloseAutoFocus: (event: Event) => {
        if (focusInside.current) {
          // Focus is about to be destroyed with the content, so let Radix put
          // it back on the trigger — and swallow that one focus event so the
          // popover the user just dismissed does not immediately reopen.
          ignoreNextFocus.current = true;
        } else {
          event.preventDefault();
        }
        focusInside.current = false;
      },
    },
  };
}

/** The dot flags a case cell shows, and their spelled-out form in the popover. */
interface CellFlag {
  key: string;
  label: string;
  dotClassName: string;
}

function cellFlags(cell: CasesMatrixCaseCell): CellFlag[] {
  const flags: CellFlag[] = [];
  if (cell.hasOverdueTask) {
    flags.push({
      key: "overdue",
      label: "Overdue task",
      dotClassName: "bg-[color:var(--mp-danger)]",
    });
  }
  if (cell.stale === "never") {
    flags.push({
      key: "never",
      label: "Never touched",
      dotClassName: "border border-[color:var(--mp-warn)]",
    });
  } else if (cell.stale === "quiet") {
    flags.push({ key: "quiet", label: "Went quiet", dotClassName: "bg-[color:var(--mp-warn)]" });
  }
  return flags;
}

function lastTouchLabel(followUp: MatrixFollowUp | undefined, today: string): string {
  if (!followUp) return "Never touched";
  const days = differenceInCalendarDays(parseISO(today), parseISO(followUp.touchDate));
  return days === 0 ? "Touched today" : `${days}d since last touch`;
}

function caseDetails(
  cell: CasesMatrixCaseCell,
  today: string,
  followUp: MatrixFollowUp | undefined,
) {
  const daysOpen = Math.max(
    0,
    differenceInCalendarDays(parseISO(today), parseISO(cell.case.createdAt)),
  );
  const followUpDue = followUp?.nextFollowUpDate ?? null;
  const followUpOverdue = followUpDue !== null && followUpDue < today;

  return {
    daysOpen,
    followUpDue,
    followUpOverdue,
    lastTouch: lastTouchLabel(followUp, today),
  };
}

function CaseCellPopover({
  cell,
  providerName,
  payerName,
  today,
  followUp,
}: MatrixCellPopoverProps & { cell: CasesMatrixCaseCell }) {
  const popover = useHoverPopover(`case:${cell.case.id}`);
  const details = caseDetails(cell, today, followUp);
  const flags = cellFlags(cell);

  return (
    <Popover open={popover.isOpen} onOpenChange={popover.setOpen}>
      <PopoverTrigger asChild>
        <Link
          to="/cases/$id"
          params={{ id: cell.case.id }}
          className="flex min-h-8 w-full items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--mp-primary)] focus-visible:ring-offset-1"
          {...popover.triggerProps}
          onKeyDown={(event) => {
            if (event.key === " ") {
              event.preventDefault();
              event.currentTarget.click();
            }
          }}
          // The flags are spelled out here rather than left on per-dot `title`
          // attributes: a native tooltip is a second, independently-timed popup
          // over the same pixels, and it is unreachable to a screen reader
          // inside an aria-labelled link anyway.
          aria-label={[
            `${providerName}, ${payerName}, ${cell.case.state}, open case`,
            ...flags.map((flag) => flag.label),
          ].join(", ")}
        >
          <span className="flex items-center gap-1.5">
            <CaseStatusPill status={cell.case.caseStatus} />
            {flags.map((flag) => (
              <span
                key={flag.key}
                className={`h-2 w-2 rounded-full ${flag.dotClassName}`}
                aria-hidden="true"
              />
            ))}
          </span>
          <span className="sr-only">Open case</span>
        </Link>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-4" {...popover.contentProps}>
        <div className="space-y-3 text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[12px] font-medium">
              {cell.case.caseNumber != null ? `C-${cell.case.caseNumber}` : "Case"}
            </span>
            <CaseStatusPill status={cell.case.caseStatus} />
          </div>
          {/* Provider, payer and state are deliberately absent: the row header,
              column header and section header already name all three for the
              cell being hovered, so repeating them here is the panel's least
              useful third. They stay in the trigger's accessible name, which is
              the one place a screen-reader user does NOT get them from context. */}
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {cell.case.submittedDate ? (
              <>
                <span className="text-muted-foreground">Submitted</span>
                <span>{fmtDate(cell.case.submittedDate)}</span>
              </>
            ) : null}
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
          {flags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {flags.map((flag) => (
                <span
                  key={flag.key}
                  className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground"
                >
                  <span
                    className={`h-2 w-2 rounded-full ${flag.dotClassName}`}
                    aria-hidden="true"
                  />
                  {flag.label}
                </span>
              ))}
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
          {...popover.triggerProps}
          // Radix's Trigger toggles on click. When hover already opened the
          // panel, preventDefault stops that toggle from closing it. When the
          // panel is closed (touch / no hover), let the click open it.
          onClick={(event) => {
            if (popover.isOpen) event.preventDefault();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            // Enter/Space is the keyboard's way into the popover — the content
            // is portalled, so it is not simply the next thing in tab order.
            if (!popover.focusContent()) popover.open();
          }}
          aria-label={`${providerName}, ${payerName}, ${cell.generation.state}, not started`}
        >
          <StatusPill status="gray" label="Not started" className="opacity-60" />
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3" {...popover.contentProps}>
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
      {/* Inert and non-focusable — an excluded cell does nothing, so it must not
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
