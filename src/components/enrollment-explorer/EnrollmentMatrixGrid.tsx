import React, { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { StatusPill, type StatusColor } from "@/components/StatusPill";

function statusToPillColor(status: string): StatusColor {
  switch (status) {
    case "approved":
      return "green";
    case "in_progress":
    case "submitted":
    case "credentialed":
      return "blue";
    case "action_required":
    case "needs_action":
    case "in_review":
      return "amber";
    case "denied":
    case "expired":
      return "red";
    default:
      return "gray";
  }
}
import type {
  EnrollmentMatrixCell,
  EnrollmentMatrixClinician,
  EnrollmentMatrixProductColumn,
} from "@/types";

interface EnrollmentMatrixGridProps {
  clinicians: EnrollmentMatrixClinician[];
  products: EnrollmentMatrixProductColumn[];
  cells: Record<string, EnrollmentMatrixCell>;
  onCellClick: (
    cell: EnrollmentMatrixCell | null,
    clinician: EnrollmentMatrixClinician,
    product: EnrollmentMatrixProductColumn,
  ) => void;
  isLoading?: boolean;
}

interface PayerColumnGroup {
  payerId: string;
  payerName: string;
  products: EnrollmentMatrixProductColumn[];
}

export function EnrollmentMatrixGrid({
  clinicians,
  products,
  cells,
  onCellClick,
  isLoading = false,
}: EnrollmentMatrixGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Row virtualization with @tanstack/react-virtual
  const rowVirtualizer = useVirtualizer({
    count: clinicians.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 12,
    initialRect: { width: 1200, height: 600 },
  });

  // Group products by payer for top header row
  const payerGroups = useMemo<PayerColumnGroup[]>(() => {
    const map = new Map<string, PayerColumnGroup>();
    for (const prod of products) {
      const existing = map.get(prod.payerId);
      if (existing) {
        existing.products.push(prod);
      } else {
        map.set(prod.payerId, {
          payerId: prod.payerId,
          payerName: prod.payerName || "Payer",
          products: [prod],
        });
      }
    }
    return Array.from(map.values());
  }, [products]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0;

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-lg border border-border bg-card text-[13px] text-muted-foreground">
        Loading clinician enrollment matrix…
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="relative max-h-[700px] w-full overflow-auto rounded-lg border border-border bg-card shadow-xs"
      data-testid="enrollment-matrix-grid"
    >
      <table className="w-full border-collapse text-left">
        {/* Sticky Double-Tier Header */}
        <thead className="sticky top-0 z-30 bg-muted/95 backdrop-blur-xs">
          {/* Tier 1: Grouped Payer Names */}
          <tr>
            <th
              rowSpan={2}
              className="sticky left-0 z-40 w-[240px] min-w-[240px] border-b-2 border-r border-border bg-muted/95 px-3 py-2 text-[12px] font-semibold text-foreground shadow-xs"
            >
              <div className="flex items-center justify-between">
                <span>Clinician / NPI</span>
                <span className="text-[11px] font-normal text-muted-foreground">
                  ({clinicians.length})
                </span>
              </div>
            </th>

            {payerGroups.map((group) => (
              <th
                key={group.payerId}
                colSpan={group.products.length}
                className="border-b border-r border-border bg-muted/80 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate"
                title={group.payerName}
              >
                {group.payerName}
              </th>
            ))}
          </tr>

          {/* Tier 2: Payer Product Sub-Columns */}
          <tr>
            {products.map((prod) => (
              <th
                key={prod.productId}
                className="w-[160px] min-w-[160px] max-w-[200px] border-b-2 border-r border-border bg-muted/90 px-2 py-1.5 text-[12px] font-medium text-foreground truncate"
                title={prod.displayName}
                data-testid={`column-header-${prod.productId}`}
              >
                {prod.displayName}
              </th>
            ))}
          </tr>
        </thead>

        {/* Virtualized Body */}
        <tbody>
          {clinicians.length === 0 ? (
            <tr>
              <td
                colSpan={products.length + 1}
                className="p-12 text-center text-[13px] text-muted-foreground"
              >
                No clinicians match the selected filter criteria.
              </td>
            </tr>
          ) : (
            <>
              {paddingTop > 0 && (
                <tr>
                  <td
                    style={{ height: `${paddingTop}px` }}
                    colSpan={products.length + 1}
                  />
                </tr>
              )}

              {virtualItems.map((virtualRow) => {
                const clinician = clinicians[virtualRow.index];
                return (
                  <tr
                    key={clinician.providerId}
                    className="h-[44px] border-b border-border transition-colors hover:bg-muted/20"
                    data-testid={`matrix-row-${clinician.providerId}`}
                  >
                    {/* Sticky Left Rail: Clinician Identity */}
                    <td className="sticky left-0 z-20 w-[240px] min-w-[240px] border-r border-border bg-background px-3 py-1.5 shadow-xs">
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="min-w-0">
                          <div
                            className="truncate text-[13px] font-semibold text-foreground leading-tight"
                            title={`${clinician.lastName}, ${clinician.firstName}`}
                          >
                            {clinician.lastName}, {clinician.firstName}
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {clinician.npi}
                          </div>
                        </div>

                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {clinician.discipline}
                        </span>
                      </div>
                    </td>

                    {/* Product Status Cells */}
                    {products.map((prod) => {
                      const cellKey = `${clinician.providerId}:${prod.productId}`;
                      const cell = cells[cellKey];

                      if (!cell || cell.status === "not_started") {
                        return (
                          <td
                            key={prod.productId}
                            className="w-[160px] min-w-[160px] max-w-[200px] border-r border-border px-2 py-1.5 text-center text-[12px] text-muted-foreground/40 hover:bg-muted/20 cursor-pointer transition-colors"
                            onClick={() => onCellClick(null, clinician, prod)}
                            title="No published enrollment record"
                            data-testid={`cell-${clinician.providerId}-${prod.productId}`}
                          >
                            —
                          </td>
                        );
                      }

                      return (
                        <td
                          key={prod.productId}
                          className="w-[160px] min-w-[160px] max-w-[200px] border-r border-border px-2 py-1.5 hover:bg-muted/40 cursor-pointer transition-colors"
                          onClick={() => onCellClick(cell, clinician, prod)}
                          data-testid={`cell-${clinician.providerId}-${prod.productId}`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <StatusPill
                              status={statusToPillColor(cell.status)}
                              label={cell.status === "approved" ? "Approved" : cell.status.replace(/_/g, " ")}
                              className="text-[11px] px-2 py-0.5 capitalize truncate"
                            />

                            {/* Multi-Facility Count or Action Indicator */}
                            <div className="flex items-center gap-1 shrink-0">
                              {cell.facilityCount > 1 ? (
                                <span
                                  className="rounded bg-muted px-1 py-0.2 text-[10px] font-medium text-muted-foreground"
                                  title={`${cell.facilityCount} facilities`}
                                >
                                  {cell.facilityCount} locs
                                </span>
                              ) : null}

                              {cell.actionOwner && cell.status !== "approved" ? (
                                <span
                                  className={`h-2 w-2 rounded-full ${
                                    cell.actionOwner === "Payer"
                                      ? "bg-blue-500"
                                      : cell.actionOwner === "Client"
                                        ? "bg-amber-500"
                                        : "bg-emerald-500"
                                  }`}
                                  title={`Action Owner: ${cell.actionOwner}`}
                                />
                              ) : null}
                            </div>
                          </div>

                          {/* Effective Date snippet for approved cells */}
                          {cell.effectiveDate && cell.status === "approved" ? (
                            <div className="mt-0.5 text-[10px] text-muted-foreground font-mono">
                              Eff: {cell.effectiveDate}
                            </div>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {paddingBottom > 0 && (
                <tr>
                  <td
                    style={{ height: `${paddingBottom}px` }}
                    colSpan={products.length + 1}
                  />
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
