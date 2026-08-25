// Cases Matrix table — renders the read-only provider × payer board from the
// pure matrix derivation and keeps case navigation separate from gap actions.
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import {
  MatrixCellPopover,
  MatrixCellPopoverProvider,
} from "@/components/cases/MatrixCellPopover";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { QueueEntry } from "@/lib/nextBestActions";
import type {
  CasesMatrix,
  CasesMatrixSection,
} from "@/lib/casesMatrix";
import type { CaseFollowUp } from "@/services/touches";

export type CasesMatrixGroupBy = "state" | "group";

export interface CasesMatrixProps {
  matrix: CasesMatrix | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  payerId: string;
  groupBy: CasesMatrixGroupBy;
  queueEntries: readonly QueueEntry[];
  followUps?: ReadonlyMap<string, CaseFollowUp>;
  onReset: () => void;
}

function MatrixLoading() {
  return (
    <div className="overflow-x-auto rounded-md border border-[#E8E5E0] bg-white">
      <table className="min-w-[720px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[#E8E5E0]">
            <th className="sticky left-0 top-0 z-20 min-w-[220px] bg-[#FAFAF9] px-3 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              <Skeleton className="h-4 w-24" />
            </th>
            {[0, 1, 2, 3].map((column) => (
              <th
                key={column}
                className="sticky top-0 z-10 min-w-[140px] bg-[#FAFAF9] px-3 text-left"
              >
                <Skeleton className="h-4 w-20" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3, 4].map((row) => (
            <tr key={row} className="border-b border-[#F0EEE9]">
              <th scope="row" className="sticky left-0 z-10 bg-white px-3 text-left">
                <Skeleton className="h-4 w-36" />
              </th>
              {[0, 1, 2, 3].map((cell) => (
                <td key={cell} className="px-3 py-2">
                  <Skeleton className="h-8 w-full" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sectionSort(
  a: CasesMatrixSection,
  b: CasesMatrixSection,
  groupBy: CasesMatrixGroupBy,
): number {
  if (groupBy === "group") {
    return (
      a.groupName.localeCompare(b.groupName) ||
      a.stateName.localeCompare(b.stateName) ||
      a.groupId.localeCompare(b.groupId)
    );
  }
  return (
    a.stateName.localeCompare(b.stateName) ||
    a.groupName.localeCompare(b.groupName) ||
    a.groupId.localeCompare(b.groupId)
  );
}

export function CasesMatrix({
  matrix,
  isLoading,
  isError,
  refetch,
  payerId,
  groupBy,
  queueEntries,
  followUps,
  onReset,
}: CasesMatrixProps) {
  if (isError) {
    return (
      <div className="rounded-md border border-[#E8E5E0] px-3 py-12 text-center">
        <div className="mb-3 text-[13px] text-foreground">Couldn&apos;t load the cases matrix.</div>
        <Button variant="outline" size="sm" onClick={refetch}>
          Retry
        </Button>
      </div>
    );
  }
  if (isLoading || matrix === undefined) return <MatrixLoading />;

  const sections = matrix.sections
    .map((section) => ({
      section,
      columns: payerId
        ? section.columns.filter((column) => column.payerId === payerId)
        : section.columns,
    }))
    .filter(({ section, columns }) => section.rows.length > 0 && columns.length > 0)
    .sort((a, b) => sectionSort(a.section, b.section, groupBy));

  if (sections.length === 0) {
    return (
      <EmptyState
        message={matrix.eligibleProviderCount === 0 ? "No active providers with open cases" : "Nothing matches these filters"}
        description={
          matrix.eligibleProviderCount === 0
            ? "Providers appear here once they have at least one case that still needs work."
            : "Adjust the Matrix filters to see cases."
        }
        action={
          matrix.eligibleProviderCount > 0 ? (
            <Button variant="outline" size="sm" onClick={onReset}>
              Reset filters
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <MatrixCellPopoverProvider>
      <TooltipProvider delayDuration={150}>
        <div className="overflow-x-auto rounded-md border border-[#E8E5E0] bg-white">
        <div className="min-w-[720px]">
          {sections.map(({ section, columns }) => (
            <table
              key={`${section.groupId}|${section.state}`}
              className="w-full border-collapse text-[13px]"
            >
              <thead>
                <tr className="border-b border-[#E8E5E0]">
                  <th
                    scope="col"
                    className="sticky left-0 top-0 z-20 min-w-[220px] bg-[#FAFAF9] px-3 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground"
                  >
                    Provider
                  </th>
                  {columns.map((column) => (
                    <th
                      key={column.payerId}
                      scope="col"
                      className="sticky top-0 z-10 min-w-[140px] whitespace-nowrap border-b border-[#E8E5E0] bg-[#FAFAF9] px-3 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground"
                    >
                      {column.payerName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[#E8E5E0] bg-[#FAFAF9]">
                  <th
                    scope="colgroup"
                    colSpan={columns.length + 1}
                    className="px-3 py-2 text-left font-semibold text-foreground"
                  >
                    <span>{section.stateName}</span>
                    <span className="ml-1 text-muted-foreground">({section.state})</span>
                    <span className="ml-3 text-[12px] font-normal text-muted-foreground">
                      {section.groupName} · {section.providerCount}{" "}
                      {section.providerCount === 1 ? "provider" : "providers"} ·{" "}
                      {section.openCaseCount} open
                    </span>
                  </th>
                </tr>
                {section.rows.map((row) => (
                  <tr
                    key={row.providerId}
                    className="border-b border-[#F0EEE9] last:border-0 hover:bg-[#FAFAF9]"
                  >
                    <th
                      scope="row"
                      className="sticky left-0 z-10 min-w-[220px] bg-white px-3 py-2 text-left font-medium text-foreground"
                    >
                      {row.providerName}
                    </th>
                    {columns.map((column) => {
                      const cell = row.cells[column.payerId];
                      return (
                        <td
                          key={column.payerId}
                          className={
                            "min-h-8 min-w-[140px] border-l border-[#F0EEE9] align-middle " +
                            (cell?.kind === "case" ? "p-0 " : "px-2 py-1.5 ") +
                            (cell?.kind === "case" && cell.dimmed ? "opacity-50" : "")
                          }
                        >
                          {cell ? (
                            <MatrixCellPopover
                              cell={cell}
                              providerName={row.providerName}
                              payerName={column.payerName}
                              queueEntries={queueEntries}
                              followUp={
                                cell.kind === "case" ? followUps?.get(cell.case.id) : undefined
                              }
                            />
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
        </div>
      </TooltipProvider>
    </MatrixCellPopoverProvider>
  );
}
