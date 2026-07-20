// Triage CaseTable (M1/M2 fix): the one table for case rows inside an
// expanded work-view group. Real table layout on md+ — PAYER/PROVIDER, the
// E6.0 unified STATUS (the dual credentialing/pipeline/contract columns are
// gone — one machine, one column), LAST TOUCH, DAYS, and a fixed unlabeled
// action column. Max one StatusPill per cell; sub-status hints render as a
// muted suffix, never a second pill. Below md the header row hides and each
// case stacks as a card.
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { CaseStatusPill } from "@/components/cases/CaseStatusPill";
import { RowCta } from "./RowCta";
import type { CaseStatus } from "@/lib/caseStatus";

export interface CaseTableRow {
  id: string;
  /** First-column content: payer (Providers view) or provider (Cases view). */
  lead: ReactNode;
  /** E6.0 — THE case status; the muted suffix carries derived hints
   * ("45d silent", "eff Jul 1"). */
  status: { status: CaseStatus; suffix?: string };
  /** E4.0 F4.0.2 — the payer Reference/Tracking ID, shown when showTrackingId. */
  trackingId?: string | null;
  lastTouch: string;
  days: number | null;
  /** Emphasize the days figure (bold ink) — set on rows needing attention. */
  daysStrong?: boolean;
  action?: { label: string; onClick: () => void } | null;
  /** Needs-your-action rows get the faint alert tint. */
  alert?: boolean;
  onOpen: () => void;
}

interface CaseTableProps {
  /** Header for the first column: "Payer" or "Provider". */
  leadLabel: string;
  rows: CaseTableRow[];
  showTrackingId?: boolean;
}

const HEAD_CELL =
  "py-3 text-left text-[length:var(--mp-text-2xs)] font-medium uppercase tracking-wider text-[color:var(--mp-ink-faint)] whitespace-nowrap";

function stop(e: MouseEvent) {
  e.stopPropagation();
}

function rowKeyDown(e: KeyboardEvent, onOpen: () => void) {
  if (e.key === "Enter") onOpen();
}

function daysCell(row: CaseTableRow) {
  if (row.days === null) return null;
  return (
    <span
      className={`tabular-nums text-[length:var(--mp-text-sm)] ${
        row.daysStrong
          ? "font-semibold text-[color:var(--mp-ink)]"
          : "text-[color:var(--mp-ink-secondary)]"
      }`}
    >
      {row.days}d
    </span>
  );
}

function statusCell(row: CaseTableRow) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <CaseStatusPill status={row.status.status} />
      {row.status.suffix ? (
        <span className="text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
          {row.status.suffix}
        </span>
      ) : null}
    </span>
  );
}

export function CaseTable({ leadLabel, rows, showTrackingId }: CaseTableProps) {
  return (
    <div className="border-t border-mp-border">
      {/* Desktop table */}
      <table className="hidden w-full md:table">
        <thead>
          <tr className="border-b border-mp-border">
            <th className={`${HEAD_CELL} w-full pl-4 pr-3`}>{leadLabel}</th>
            <th className={`${HEAD_CELL} px-3`}>Status</th>
            {showTrackingId ? <th className={`${HEAD_CELL} px-3`}>Tracking ID</th> : null}
            <th className={`${HEAD_CELL} px-3`}>Last Touch</th>
            <th className={`${HEAD_CELL} px-3`}>Days</th>
            <th className={`${HEAD_CELL} pl-3 pr-4`}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              role="link"
              tabIndex={0}
              onClick={row.onOpen}
              onKeyDown={(e) => rowKeyDown(e, row.onOpen)}
              className={`cursor-pointer ${row.alert ? "bg-mp-danger/5" : "hover:bg-mp-muted/40"}`}
            >
              <td className="w-full max-w-0 truncate py-3 pl-4 pr-3">{row.lead}</td>
              <td className="whitespace-nowrap px-3 py-3">{statusCell(row)}</td>
              {showTrackingId ? (
                <td className="whitespace-nowrap px-3 py-3 text-[length:var(--mp-text-sm)] tabular-nums text-[color:var(--mp-ink-secondary)]">
                  {row.trackingId ?? "—"}
                </td>
              ) : null}
              <td className="whitespace-nowrap px-3 py-3 text-[length:var(--mp-text-sm)] text-[color:var(--mp-ink-secondary)]">
                {row.lastTouch}
              </td>
              <td className="whitespace-nowrap px-3 py-3">{daysCell(row)}</td>
              <td className="whitespace-nowrap py-3 pl-3 pr-4 text-right" onClick={stop}>
                {row.action ? (
                  <RowCta label={row.action.label} onClick={row.action.onClick} />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile stacked cards */}
      <ul className="md:hidden">
        {rows.map((row) => (
          <li
            key={row.id}
            role="link"
            tabIndex={0}
            onClick={row.onOpen}
            onKeyDown={(e) => rowKeyDown(e, row.onOpen)}
            className={`cursor-pointer space-y-1.5 border-b border-mp-border/60 px-4 py-3 last:border-0 ${
              row.alert ? "bg-mp-danger/5" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{row.lead}</span>
              {statusCell(row)}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {showTrackingId && row.trackingId ? (
                <span className="text-[length:var(--mp-text-xs)] tabular-nums text-[color:var(--mp-ink-faint)]">
                  #{row.trackingId}
                </span>
              ) : null}
              <span className="text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
                {row.lastTouch}
              </span>
              {daysCell(row)}
            </div>
            {row.action ? (
              <div onClick={stop}>
                <RowCta label={row.action.label} onClick={row.action.onClick} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
