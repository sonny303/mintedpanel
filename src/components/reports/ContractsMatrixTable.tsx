// One specialty's table in the Group Contracts Matrix (GCM-2, GCM-3, GCM-23,
// GCM-25, GCM-28): a collapsible, labelled section whose table carries two
// header rows (group over its states, or state over its groups), a heavier
// divider where a header segment starts, a fixed payer column and fixed header
// rows, and horizontal scrolling inside its own box.
import { useCallback, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AddButton } from "@/components/providers/RecordSectionCard";
import { EmptyState } from "@/components/EmptyState";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type {
  ContractsMatrixCell,
  ContractsMatrixCellLocation,
  ContractsMatrixRow,
  ContractsMatrixTable as MatrixTable,
} from "@/lib/groupContractsMatrix";
import { cn } from "@/lib/utils";
import type { Contract } from "@/types";
import { ContractsMatrixCellView } from "./ContractsMatrixCell";
import { contractsMatrixCellDomId, countLabel } from "./contractsMatrixView";

const HEADER_TOP_ROW = "h-[52px]";
const HEADER_SECOND_ROW_TOP = "top-[52px]";

interface ContractsMatrixTableProps {
  table: MatrixTable<Contract>;
  canWrite: boolean;
  highlight: ContractsMatrixCellLocation | null;
  /** Why the table has no rows, when it has none. */
  emptyRowsMessage: string;
  onOpenCell: (
    table: MatrixTable<Contract>,
    row: ContractsMatrixRow<Contract>,
    cell: ContractsMatrixCell<Contract>,
  ) => void;
  onAddState?: () => void;
}

export function ContractsMatrixTable({
  table,
  canWrite,
  highlight,
  emptyRowsMessage,
  onOpenCell,
  onAddState,
}: ContractsMatrixTableProps) {
  const [open, setOpen] = useState(true);
  const headingId = useId();
  const contentId = useId();
  const { counts } = table;

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section aria-labelledby={headingId} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                aria-controls={contentId}
                aria-label={open ? `Collapse ${table.label}` : `Expand ${table.label}`}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--mp-radius-control)] border border-[var(--mp-border)] bg-[var(--mp-card)] text-[var(--mp-ink-secondary)] hover:text-[var(--mp-ink)] focus-visible:outline-none focus-visible:shadow-[var(--mp-focus)]"
              >
                <ChevronDown
                  aria-hidden="true"
                  className={cn("h-4 w-4 transition-transform", open ? "" : "-rotate-90")}
                />
              </button>
            </CollapsibleTrigger>
            <h3 id={headingId} className="text-[16px] font-semibold text-[var(--mp-ink)]">
              {table.label}
            </h3>
            <span className="text-[13px] text-[var(--mp-ink-secondary)]">
              {[
                countLabel(counts.groups, "group"),
                countLabel(counts.states, "state"),
                countLabel(counts.payers, "payer"),
              ].join(" · ")}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-[var(--mp-ink-secondary)]">
              <span className="font-semibold text-[var(--mp-ok-ink)]">{counts.inNetwork}</span> in
              network
            </span>
            {onAddState ? <AddButton label="Add state" onClick={onAddState} /> : null}
          </div>
        </div>

        <CollapsibleContent id={contentId}>
          {table.rows.length === 0 ? (
            <div className="rounded-md border border-[var(--mp-border)] p-8">
              <EmptyState message={emptyRowsMessage} />
            </div>
          ) : (
            <MatrixGrid
              table={table}
              canWrite={canWrite}
              highlight={highlight}
              onOpenCell={onOpenCell}
            />
          )}
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function MatrixGrid({
  table,
  canWrite,
  highlight,
  onOpenCell,
}: Pick<ContractsMatrixTableProps, "table" | "canWrite" | "highlight" | "onOpenCell">) {
  const byState = table.headerSegments[0]?.kind === "state";
  return (
    <div className="max-h-[70vh] overflow-auto rounded-md border border-[var(--mp-border)]">
      <table className="w-max border-separate border-spacing-0 text-[13px]">
        <caption className="sr-only">{`${table.label} contracts by payer, ${byState ? "state and group" : "group and state"}`}</caption>
        <colgroup>
          <col className="w-[160px] sm:w-[248px]" />
        </colgroup>
        {table.headerSegments.map((segment) => (
          <colgroup key={segment.key} span={segment.span} />
        ))}
        <thead>
          <tr>
            <td
              className={cn(
                "sticky left-0 top-0 z-30 w-[160px] min-w-[160px] border-b sm:w-[248px] sm:min-w-[248px] border-r border-[var(--mp-border)] bg-[var(--mp-muted)]",
                HEADER_TOP_ROW,
              )}
            />
            {table.headerSegments.map((segment, index) => (
              <th
                key={segment.key}
                scope="colgroup"
                colSpan={segment.span}
                className={cn(
                  "sticky top-0 z-20 border-b border-[var(--mp-border)] bg-[var(--mp-muted)] px-3 py-1.5 text-left align-middle font-normal",
                  HEADER_TOP_ROW,
                  index === 0 ? "" : "border-l-2 border-l-[var(--mp-border-dashed)]",
                )}
              >
                {segment.kind === "group" ? (
                  <>
                    <span className="block truncate text-[13px] font-semibold text-[var(--mp-ink)]">
                      {segment.groupName}
                    </span>
                    {segment.groupTin ? (
                      <span className="block text-[12px] text-[var(--mp-ink-secondary)]">
                        TIN {segment.groupTin}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="block text-center">
                    <span className="block text-[13px] font-semibold text-[var(--mp-ink)]">
                      {segment.state}
                    </span>
                    <span className="block text-[12px] text-[var(--mp-ink-secondary)]">
                      {countLabel(segment.groupCount, "group")}
                    </span>
                  </span>
                )}
              </th>
            ))}
          </tr>
          <tr>
            <th
              scope="col"
              className={cn(
                "sticky left-0 z-30 h-9 border-b border-r border-[var(--mp-border)] bg-[var(--mp-muted)] px-4 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--mp-ink-secondary)]",
                HEADER_SECOND_ROW_TOP,
              )}
            >
              Payer
            </th>
            {table.columns.map((column, index) => (
              <th
                key={column.key}
                scope="col"
                title={byState ? undefined : `${column.groupName} · ${column.state}`}
                className={cn(
                  "sticky z-20 h-9 w-[132px] min-w-[132px] max-w-[132px] border-b border-[var(--mp-border)] bg-[var(--mp-muted)] px-2 text-center font-semibold text-[var(--mp-ink)]",
                  HEADER_SECOND_ROW_TOP,
                  byState ? "truncate text-[12px]" : "text-[13px]",
                  column.segmentStart && index > 0
                    ? "border-l-2 border-l-[var(--mp-border-dashed)]"
                    : index > 0
                      ? "border-l border-l-[var(--mp-border-subtle)]"
                      : "",
                )}
              >
                {column.headerLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <MatrixRow
              key={row.payerId}
              table={table}
              row={row}
              canWrite={canWrite}
              highlight={highlight}
              onOpenCell={onOpenCell}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixRow({
  table,
  row,
  canWrite,
  highlight,
  onOpenCell,
}: Pick<ContractsMatrixTableProps, "table" | "canWrite" | "highlight" | "onOpenCell"> & {
  row: ContractsMatrixRow<Contract>;
}) {
  const open = useCallback(
    (cell: ContractsMatrixCell<Contract>) => onOpenCell(table, row, cell),
    [onOpenCell, table, row],
  );
  return (
    <tr>
      <th
        scope="row"
        className="sticky left-0 z-10 w-[160px] min-w-[160px] max-w-[160px] sm:w-[248px] sm:min-w-[248px] sm:max-w-[248px] border-b border-r border-b-[var(--mp-border-subtle)] border-r-[var(--mp-border)] bg-[var(--mp-card)] px-3 py-2 text-left align-middle text-[13px] font-medium sm:px-4 leading-snug text-[var(--mp-ink)]"
      >
        <span className="line-clamp-2 whitespace-normal break-words" title={row.payerName}>
          {row.payerName}
        </span>
      </th>
      {row.cells.map((cell, index) => (
        <ContractsMatrixCellView
          key={cell.columnKey}
          cell={cell}
          domId={contractsMatrixCellDomId(table.specialty, cell.columnKey, row.payerId)}
          segmentStart={index > 0 && table.columns[index]?.segmentStart === true}
          canWrite={canWrite}
          highlighted={
            highlight !== null &&
            highlight.specialty === table.specialty &&
            highlight.columnKey === cell.columnKey &&
            highlight.payerId === row.payerId
          }
          onOpen={open}
        />
      ))}
    </tr>
  );
}
