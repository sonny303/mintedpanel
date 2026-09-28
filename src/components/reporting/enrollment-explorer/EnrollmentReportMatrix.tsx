import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  EnrollmentReportLocation,
  EnrollmentReportProductColumn,
  EnrollmentReportProvider,
  EnrollmentReportSection,
} from "@/types";

const PROVIDER_WIDTH = 270;
const COLUMN_WIDTH = 190;
const HEADER_HEIGHT = 58;
const ROW_HEIGHT = 66;

type FlatColumn = EnrollmentReportProductColumn & {
  sectionKey: string;
  groupLabel: string;
  state: string;
};

function statusText(location: EnrollmentReportLocation): string {
  if (location.publicationState === "stale" || location.status === "needs_verification") {
    return "Needs verification";
  }
  if (location.historical) return `Historical · ${location.status.replaceAll("_", " ")}`;
  if (location.publicationState === "draft") return "Staff draft";
  return location.status.replaceAll("_", " ");
}

export function EnrollmentReportMatrix({
  providers,
  sections,
  onOpenLocations,
}: {
  providers: EnrollmentReportProvider[];
  sections: EnrollmentReportSection[];
  onOpenLocations: (
    provider: EnrollmentReportProvider,
    locations: EnrollmentReportLocation[],
    trigger: HTMLButtonElement,
    cell: { sectionKey: string; productId: string },
  ) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const mobileScrollRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const columns = useMemo<FlatColumn[]>(
    () =>
      sections.flatMap((section) =>
        section.columns.map((column) => ({
          ...column,
          sectionKey: section.key,
          groupLabel: section.groupLabel,
          state: section.state,
        })),
      ),
    [sections],
  );
  const locationsByProvider = useMemo(() => {
    const index = new Map<string, Map<string, Map<string, EnrollmentReportLocation[]>>>();
    for (const provider of providers) {
      const sectionsIndex = new Map<string, Map<string, EnrollmentReportLocation[]>>();
      for (const cell of provider.cells) {
        const products = sectionsIndex.get(cell.sectionKey) ?? new Map();
        products.set(cell.productId, cell.locations);
        sectionsIndex.set(cell.sectionKey, products);
      }
      index.set(provider.providerId, sectionsIndex);
    }
    return index;
  }, [providers]);
  const rowVirtualizer = useVirtualizer({
    count: providers.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    getItemKey: (index) => providers[index]?.providerId ?? index,
  });
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COLUMN_WIDTH,
    overscan: 3,
    getItemKey: (index) => columns[index]?.key ?? index,
  });
  const mobileRowVirtualizer = useVirtualizer({
    count: providers.length,
    getScrollElement: () => mobileScrollRef.current,
    estimateSize: () => 148,
    overscan: 5,
    getItemKey: (index) => providers[index]?.providerId ?? index,
  });
  const virtualColumns = columnVirtualizer.getVirtualItems();
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalWidth = PROVIDER_WIDTH + columnVirtualizer.getTotalSize();

  return (
    <>
      <div className="mb-2 flex items-center justify-between text-[12px] text-muted-foreground">
        <span>
          {providers.length} provider{providers.length === 1 ? "" : "s"} loaded
        </span>
        <span className="hidden sm:inline">Scroll horizontally to view all product columns</span>
      </div>
      {!isMobile ? (
        <div
          ref={scrollRef}
          role="grid"
          aria-label="Provider enrollment matrix"
          aria-rowcount={providers.length + 1}
          aria-colcount={columns.length + 1}
          className="relative hidden h-[min(68vh,720px)] overflow-auto rounded-md border bg-background md:block"
          data-testid="enrollment-matrix"
        >
          <div
            style={{
              width: totalWidth,
              height: HEADER_HEIGHT + rowVirtualizer.getTotalSize(),
              position: "relative",
            }}
          >
            <div
              role="row"
              className="sticky top-0 z-30 border-b bg-muted/95 backdrop-blur"
              style={{ height: HEADER_HEIGHT, width: totalWidth }}
            >
              <div
                role="columnheader"
                className="sticky left-0 z-40 flex h-full items-center border-r bg-muted px-3 text-[12px] font-semibold"
                style={{ width: PROVIDER_WIDTH }}
              >
                Provider
              </div>
              {virtualColumns.map((virtualColumn) => {
                const column = columns[virtualColumn.index];
                return (
                  <div
                    key={column.key}
                    role="columnheader"
                    aria-colindex={virtualColumn.index + 2}
                    className="absolute top-0 flex h-full flex-col justify-center border-r px-3"
                    style={{
                      left: PROVIDER_WIDTH + virtualColumn.start,
                      width: virtualColumn.size,
                    }}
                    title={`${column.groupLabel} · ${column.state} · ${column.payerLabel} · ${column.productLabel}`}
                  >
                    <span className="truncate text-[10px] text-muted-foreground">
                      {column.groupLabel} · {column.state}
                    </span>
                    <span className="truncate text-[12px] font-semibold">{column.payerLabel}</span>
                    <span className="truncate text-[11px]">{column.productLabel}</span>
                  </div>
                );
              })}
            </div>
            {virtualRows.map((virtualRow) => {
            const provider = providers[virtualRow.index];
            const providerLocations = locationsByProvider.get(provider.providerId);
            return (
                <div
                  key={provider.providerId}
                  role="row"
                  aria-rowindex={virtualRow.index + 2}
                  className="absolute left-0 flex border-b bg-background hover:bg-muted/30"
                  style={{
                    top: HEADER_HEIGHT + virtualRow.start,
                    height: virtualRow.size,
                    width: totalWidth,
                  }}
                >
                  <div
                    role="rowheader"
                    className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r bg-background px-3"
                    style={{ width: PROVIDER_WIDTH }}
                  >
                    <span className="truncate text-[12px] font-semibold">{provider.name}</span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      {provider.npi ? `NPI ${provider.npi}` : "NPI not recorded"} ·{" "}
                      {provider.discipline}
                    </span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      {provider.status}
                      {provider.referenceOnly ? " · reference" : ""} ·{" "}
                      {provider.verificationState.replaceAll("_", " ")}
                    </span>
                  </div>
                  {virtualColumns.map((virtualColumn) => {
                    const column = columns[virtualColumn.index];
                  const eligible = provider.sectionKeys.includes(column.sectionKey);
                  const locations = eligible
                    ? providerLocations?.get(column.sectionKey)?.get(column.productId) ?? []
                    : [];
                    return (
                      <div
                        key={`${provider.providerId}:${column.key}`}
                        role="gridcell"
                        aria-colindex={virtualColumn.index + 2}
                        className="absolute top-0 flex items-center border-r px-2"
                        style={{
                          left: PROVIDER_WIDTH + virtualColumn.start,
                          width: virtualColumn.size,
                          height: ROW_HEIGHT,
                        }}
                      >
                        {!eligible ? (
                          <span
                            aria-label="Not in this provider group"
                            className="text-[11px] text-muted-foreground/60"
                          >
                            —
                          </span>
                        ) : locations.length ? (
                          <button
                            type="button"
                            data-testid={`enrollment-cell-${provider.providerId}-${column.productId}`}
                            aria-label={`${provider.name}, ${column.groupLabel}, ${column.state}, ${column.productLabel}: ${locations.length} location${locations.length === 1 ? "" : "s"}, ${statusText(locations[0])}`}
                            onClick={(event) =>
                              onOpenLocations(provider, locations, event.currentTarget, column)
                            }
                            className="flex max-w-full items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-left text-[11px] hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="truncate capitalize">{statusText(locations[0])}</span>
                            {locations.length > 1 ? (
                              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5">
                                {locations.length}
                              </span>
                            ) : null}
                          </button>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            No published enrollment
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {isMobile ? (
        <div
          ref={mobileScrollRef}
          className="max-h-[72vh] overflow-y-auto"
          data-testid="enrollment-mobile-list"
        >
          <div style={{ height: mobileRowVirtualizer.getTotalSize(), position: "relative" }}>
            {mobileRowVirtualizer.getVirtualItems().map((virtualRow) => {
              const provider = providers[virtualRow.index];
              const providerSections = sections.filter((section) =>
                provider.sectionKeys.includes(section.key),
              );
              const scopedLocations = provider.cells.flatMap((cell) => cell.locations);
              const uniqueLocations = [
                ...new Map(scopedLocations.map((item) => [item.scopeId, item])).values(),
              ];
              const hasExpandedDetails = expandedProviderId === provider.providerId;
              return (
                <article
                  key={provider.providerId}
                  data-index={virtualRow.index}
                  ref={mobileRowVirtualizer.measureElement}
                  className="absolute left-0 right-0 rounded-md border bg-card p-3"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-[13px] font-semibold">{provider.name}</h2>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {provider.npi ? `NPI ${provider.npi}` : "NPI not recorded"} ·{" "}
                        {provider.discipline} · {provider.status}
                      </p>
                    </div>
                    {provider.referenceOnly ? (
                      <span className="rounded bg-muted px-2 py-1 text-[10px]">Reference</span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {uniqueLocations.length
                      ? `${uniqueLocations.length} enrollment location${uniqueLocations.length === 1 ? "" : "s"}`
                      : sections.length === 0
                        ? "No configured product sections"
                        : "No published enrollment"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {providerSections.map((section) => (
                      <span key={section.key} className="rounded bg-muted px-2 py-1 text-[10px]">
                        {section.groupLabel} · {section.state}
                      </span>
                    ))}
                  </div>
                  {uniqueLocations.length ? (
                    <button
                      type="button"
                      aria-expanded={hasExpandedDetails}
                      className="mt-2 rounded-md border px-2.5 py-1.5 text-[11px] hover:bg-muted"
                      onClick={() =>
                        setExpandedProviderId(hasExpandedDetails ? null : provider.providerId)
                      }
                    >
                      {hasExpandedDetails
                        ? "Hide scoped locations"
                        : `View ${uniqueLocations.length} scoped location${uniqueLocations.length === 1 ? "" : "s"}`}
                    </button>
                  ) : null}
                  {uniqueLocations.length && hasExpandedDetails ? (
                    <div className="mt-3 space-y-1">
                      {provider.cells
                        .filter((cell) => cell.locations.length > 0)
                        .map((cell) => {
                          const column = columns.find((item) => item.key === cell.key) ?? {
                            sectionKey: cell.sectionKey,
                            productId: cell.productId,
                            key: cell.key,
                            payerLabel: "Payer",
                            productLabel: "Product",
                            groupLabel:
                              sections.find((section) => section.key === cell.sectionKey)
                                ?.groupLabel ?? "Group",
                            state:
                              sections.find((section) => section.key === cell.sectionKey)?.state ??
                              "State",
                          };
                          const section = sections.find((item) => item.key === cell.sectionKey);
                          return (
                            <div key={cell.key} className="rounded-md border p-2">
                              <p className="text-[10px] font-medium text-muted-foreground">
                                {column.groupLabel} · {column.state} · {column.payerLabel} ·{" "}
                                {column.productLabel}
                              </p>
                              {cell.locations.map((location) => (
                                <button
                                  type="button"
                                  key={location.scopeId}
                                  aria-label={`${column.groupLabel}, ${column.state}, ${column.payerLabel}, ${column.productLabel}, ${location.facilityLabel}, ${statusText(location)}`}
                                  onClick={(event) =>
                                    onOpenLocations(provider, [location], event.currentTarget, {
                                      sectionKey: cell.sectionKey,
                                      productId: cell.productId,
                                    })
                                  }
                                  className="mt-1 flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left text-[11px] hover:bg-muted"
                                >
                                  <span>
                                    {location.facilityLabel}
                                    {section ? ` · ${section.state}` : ""}
                                  </span>
                                  <span className="capitalize">{statusText(location)}</span>
                                </button>
                              ))}
                            </div>
                          );
                        })}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
