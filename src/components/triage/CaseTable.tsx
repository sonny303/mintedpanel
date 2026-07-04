// Triage CaseTable (M1/M2 fix): the one table for case rows inside an
// expanded work-view group. Real table layout on md+ — PAYER/PROVIDER,
// CREDENTIALING, GROUP CONTRACT, LAST TOUCH, DAYS, and a fixed unlabeled
// action column. Max one StatusPill per cell; sub-status hints render as the
// pill's muted suffix, never a second pill. Below md the header row hides and
// each case stacks as a card.
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { StatusPill } from "./StatusPill";
import { RowCta } from "./RowCta";

export interface CaseTableRow {
  id: string;
  /** First-column content: payer (Providers view) or provider (Cases view). */
  lead: ReactNode;
  status: { label: string; color: string; suffix?: string };
  /** Derived group-contract status; null renders a muted dash. */
  contract: { label: string; color: string } | null;
  lastTouch: string;
  days: number | null;
  daysDanger?: boolean;
  action?: { label: string; onClick: () => void } | null;
  /** Needs-your-action rows get the faint alert tint. */
  alert?: boolean;
  onOpen: () => void;
}

interface CaseTableProps {
  /** Header for the first column: "Payer" or "Provider". */
  leadLabel: string;
  rows: CaseTableRow[];
}

const HEAD_CELL =
  "py-2 text-left text-[var(--mp-text-2xs)] font-semibold uppercase tracking-wider text-[color:var(--mp-ink-faint)] whitespace-nowrap";

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
      className={`tabular-nums text-[var(--mp-text-sm)] ${
        row.daysDanger
          ? "font-semibold text-[color:var(--mp-danger)]"
          : "text-[color:var(--mp-ink-secondary)]"
      }`}
    >
      {row.days}d
    </span>
  );
}

function contractCell(row: CaseTableRow) {
  return row.contract ? (
    <StatusPill label={row.contract.label} color={row.contract.color} />
  ) : (
    <span className="text-[var(--mp-text-sm)] text-[color:var(--mp-ink-faint)]">–</span>
  );
}

export function CaseTable({ leadLabel, rows }: CaseTableProps) {
  return (
    <div className="border-t border-mp-border">
      {/* Desktop table */}
      <table className="hidden w-full md:table">
        <thead>
          <tr className="border-b border-mp-border">
            <th className={`${HEAD_CELL} w-full pl-4 pr-3`}>{leadLabel}</th>
            <th className={`${HEAD_CELL} px-3`}>Credentialing</th>
            <th className={`${HEAD_CELL} px-3`}>Group Contract</th>
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
              className={`h-10 cursor-pointer border-b border-mp-border/60 last:border-0 ${
                row.alert ? "bg-mp-danger/5" : "hover:bg-mp-muted/40"
              }`}
            >
              <td className="w-full max-w-0 truncate py-1.5 pl-4 pr-3">{row.lead}</td>
              <td className="whitespace-nowrap px-3 py-1.5">
                <StatusPill
                  label={row.status.label}
                  color={row.status.color}
                  suffix={row.status.suffix}
                />
              </td>
              <td className="whitespace-nowrap px-3 py-1.5">{contractCell(row)}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-[var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
                {row.lastTouch}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5">{daysCell(row)}</td>
              <td className="whitespace-nowrap py-1.5 pl-3 pr-4 text-right" onClick={stop}>
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
              <StatusPill
                label={row.status.label}
                color={row.status.color}
                suffix={row.status.suffix}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {contractCell(row)}
              <span className="text-[var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
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
