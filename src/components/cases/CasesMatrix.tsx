// Cases Matrix table — renders the read-only provider × payer board from the
// pure matrix derivation and keeps case navigation separate from gap actions.
// `Group by` re-nests the two section dimensions (state and group); it never
// changes which sections exist (handoff D3).
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { MatrixCellPopover, MatrixCellPopoverProvider } from "@/components/cases/MatrixCellPopover";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CasesMatrix, CasesMatrixColumn, CasesMatrixSection } from "@/lib/casesMatrix";
import type { CaseFollowUp } from "@/services/touches";

export type CasesMatrixGroupBy = "state" | "group";

export interface CasesMatrixProps {
  matrix: CasesMatrix | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  payerId: string;
  groupBy: CasesMatrixGroupBy;
  /** Date-only ISO string; passed down so no cell reads the clock. */
  today: string;
  followUps?: ReadonlyMap<string, CaseFollowUp>;
  onReset: () => void;
}

interface VisibleSection {
  section: CasesMatrixSection;
  columns: CasesMatrixColumn[];
}

interface SectionBucket {
  key: string;
  /** The dimension `Group by` nests everything under. */
  outerLabel: string;
  outerSuffix: string | null;
  sections: VisibleSection[];
}

function MatrixLoading() {
  return (
    <div className="overflow-x-auto rounded-md border border-mp-border bg-mp-card">
      <table className="min-w-[720px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-mp-border">
            <th className="sticky left-0 top-0 z-20 min-w-[220px] bg-mp-muted px-3 text-left">
              <Skeleton className="h-4 w-24" />
            </th>
            {[0, 1, 2, 3].map((column) => (
              <th
                key={column}
                className="sticky top-0 z-10 min-w-[140px] bg-mp-muted px-3 text-left"
              >
                <Skeleton className="h-4 w-20" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3, 4].map((row) => (
            <tr key={row} className="border-b border-[color:var(--mp-border-subtle)]">
              <th scope="row" className="sticky left-0 z-10 bg-mp-card px-3 text-left">
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

/**
 * Nest the flat section list under whichever dimension `Group by` selects.
 * Default (`state`) buckets by state and labels each table with its group;
 * `group` buckets by group and labels each table with its state.
 */
function bucketSections(
  sections: readonly VisibleSection[],
  groupBy: CasesMatrixGroupBy,
): SectionBucket[] {
  const buckets = new Map<string, SectionBucket>();
  for (const visible of sections) {
    const { section } = visible;
    const key = groupBy === "group" ? section.groupId : section.state;
    const bucket = buckets.get(key) ?? {
      key,
      outerLabel: groupBy === "group" ? section.groupName : section.stateName,
      outerSuffix: groupBy === "group" ? null : section.state,
      sections: [],
    };
    bucket.sections.push(visible);
    buckets.set(key, bucket);
  }

  const innerLabel = (visible: VisibleSection) =>
    groupBy === "group" ? visible.section.stateName : visible.section.groupName;

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      sections: bucket.sections.sort(
        (a, b) =>
          innerLabel(a).localeCompare(innerLabel(b)) ||
          a.section.groupId.localeCompare(b.section.groupId),
      ),
    }))
    .sort((a, b) => a.outerLabel.localeCompare(b.outerLabel) || a.key.localeCompare(b.key));
}

export function CasesMatrix({
  matrix,
  isLoading,
  isError,
  refetch,
  payerId,
  groupBy,
  today,
  followUps,
  onReset,
}: CasesMatrixProps) {
  if (isError) {
    return (
      <div className="rounded-md border border-mp-border px-3 py-12 text-center">
        <div className="mb-3 text-[13px] text-foreground">Couldn&apos;t load the cases matrix.</div>
        <Button variant="outline" size="sm" onClick={refetch}>
          Retry
        </Button>
      </div>
    );
  }
  if (isLoading || matrix === undefined) return <MatrixLoading />;

  const visibleSections: VisibleSection[] = matrix.sections
    .map((section) => ({
      section,
      columns: payerId
        ? section.columns.filter((column) => column.payerId === payerId)
        : section.columns,
    }))
    .filter(({ section, columns }) => section.rows.length > 0 && columns.length > 0);

  if (visibleSections.length === 0) {
    const noProviders = matrix.eligibleProviderCount === 0;
    return (
      <EmptyState
        message={
          noProviders ? "No active providers with open cases" : "Nothing matches these filters"
        }
        description={
          noProviders
            ? "Providers appear here once they have at least one case that still needs work."
            : "Adjust the Matrix filters to see cases."
        }
        action={
          noProviders ? undefined : (
            <Button variant="outline" size="sm" onClick={onReset}>
              Reset filters
            </Button>
          )
        }
      />
    );
  }

  const buckets = bucketSections(visibleSections, groupBy);

  return (
    <MatrixCellPopoverProvider>
      <TooltipProvider delayDuration={150}>
        <div className="space-y-5">
          {buckets.map((bucket) => (
            <section key={bucket.key}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {bucket.outerLabel}
                {bucket.outerSuffix ? (
                  <span className="ml-1 font-normal">· {bucket.outerSuffix}</span>
                ) : null}
              </h3>
              <div className="space-y-4">
                {bucket.sections.map(({ section, columns }) => (
                  <div
                    key={`${section.groupId}|${section.state}`}
                    className="overflow-x-auto rounded-md border border-mp-border bg-mp-card"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 border-b border-mp-border bg-mp-muted px-3 py-2">
                      <span className="text-[13px] font-semibold text-foreground">
                        {groupBy === "group" ? section.stateName : section.groupName}
                      </span>
                      {groupBy === "group" ? (
                        <span className="text-[12px] text-muted-foreground">({section.state})</span>
                      ) : null}
                      <span className="text-[12px] text-muted-foreground">
                        · {section.providerCount}{" "}
                        {section.providerCount === 1 ? "provider" : "providers"} ·{" "}
                        {section.openCaseCount} open
                      </span>
                    </div>
                    <table className="w-full min-w-[720px] border-collapse text-[13px]">
                      <caption className="sr-only">
                        {section.groupName} in {section.stateName}: provider by payer case status
                      </caption>
                      <thead>
                        <tr className="border-b border-mp-border">
                          <th
                            scope="col"
                            className="sticky left-0 top-0 z-20 min-w-[220px] bg-mp-muted px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground"
                          >
                            Provider
                          </th>
                          {columns.map((column) => (
                            <th
                              key={column.payerId}
                              scope="col"
                              className="sticky top-0 z-10 min-w-[140px] whitespace-nowrap bg-mp-muted px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground"
                            >
                              {column.payerName}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {section.rows.map((row) => (
                          <tr
                            key={row.providerId}
                            className="border-b border-[color:var(--mp-border-subtle)] last:border-0 hover:bg-mp-muted"
                          >
                            <th
                              scope="row"
                              className="sticky left-0 z-10 min-w-[220px] bg-mp-card px-3 py-2 text-left font-medium text-foreground"
                            >
                              {row.providerName}
                            </th>
                            {columns.map((column) => {
                              const cell = row.cells[column.payerId];
                              return (
                                <td
                                  key={column.payerId}
                                  className={
                                    "min-w-[140px] border-l border-[color:var(--mp-border-subtle)] align-middle " +
                                    (cell?.kind === "case" ? "p-0 " : "px-2 py-1.5 ") +
                                    (cell?.kind === "case" && cell.dimmed ? "opacity-50" : "")
                                  }
                                >
                                  {cell ? (
                                    <MatrixCellPopover
                                      cell={cell}
                                      providerName={row.providerName}
                                      payerName={column.payerName}
                                      today={today}
                                      followUp={
                                        cell.kind === "case"
                                          ? followUps?.get(cell.case.id)
                                          : undefined
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
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </TooltipProvider>
    </MatrixCellPopoverProvider>
  );
}
