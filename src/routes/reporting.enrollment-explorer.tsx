import React, { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccessContextBoundary } from "@/components/access/AccessContextBoundary";
import {
  EnrollmentFilterBar,
  type EnrollmentFiltersState,
} from "@/components/enrollment-explorer/EnrollmentFilterBar";
import { EnrollmentMatrixGrid } from "@/components/enrollment-explorer/EnrollmentMatrixGrid";
import { EnrollmentDetailDrawer } from "@/components/enrollment-explorer/EnrollmentDetailDrawer";
import {
  fetchEnrollmentCatalog,
  queryEnrollmentScopes,
  resolveExplorerContext,
} from "@/lib/enrollmentExplorerApi";
import {
  downloadCsvFile,
  generateEnrollmentExplorerCsv,
  type EnrollmentExportRecord,
} from "@/lib/enrollmentExplorerExport";
import { useAuthStore } from "@/lib/auth-store";
import type {
  EnrollmentCatalogFacility,
  EnrollmentCatalogGroup,
  EnrollmentMatrixCell,
  EnrollmentMatrixClinician,
  EnrollmentMatrixProductColumn,
  EnrollmentMatrixStats,
} from "@/types";

export const Route = createFileRoute("/reporting/enrollment-explorer")({
  component: EnrollmentExplorerPageRoute,
});

function EnrollmentExplorerPageRoute() {
  return (
    <AccessContextBoundary>
      <EnrollmentExplorerContent />
    </AccessContextBoundary>
  );
}

function EnrollmentExplorerContent() {
  const accessContext = useAuthStore((s) => s.accessContext);
  const activeOrgId = useAuthStore((s) => s.activeOrgId);
  const clientOrgs = accessContext?.clientOrgs ?? [];
  const selectedOrgId =
    accessContext?.audience === "client"
      ? (accessContext.selectedOrgId ?? clientOrgs[0]?.orgId ?? "")
      : (activeOrgId ?? "");

  const context = resolveExplorerContext({
    orgId: selectedOrgId,
    audience: accessContext?.audience ?? "staff",
    contextRevision: accessContext?.contextRevision ?? "rev-init",
  });
  const isClient = context.audience === "client";
  const selectedClientOrg = clientOrgs.find((o) => o.orgId === context.orgId);

  // 1. Load catalog (payers, products, targets, facilities, groups)
  const catalogQuery = useQuery({
    queryKey: ["enrollment-catalog", context.orgId, context.contextRevision, isClient],
    queryFn: () => fetchEnrollmentCatalog(context),
    staleTime: 60_000,
  });

  const rawGroups: EnrollmentCatalogGroup[] = useMemo(() => {
    return isClient
      ? (selectedClientOrg?.groups.map((g) => ({ id: g.groupId, name: g.groupName })) ?? [])
      : (catalogQuery.data?.groups ?? []);
  }, [isClient, selectedClientOrg, catalogQuery.data?.groups]);

  const facilities: EnrollmentCatalogFacility[] = catalogQuery.data?.facilities ?? [];
  const defaultProducts: EnrollmentMatrixProductColumn[] = catalogQuery.data?.products ?? [];

  // 2. Filter state
  const [filters, setFilters] = useState<EnrollmentFiltersState>(() => ({
    search: "",
    groupId: isClient && rawGroups.length === 1 ? rawGroups[0].id : "all",
    facilityId: "all",
    discipline: "all",
    statusBucket: "all",
  }));

  // Update default group filter if client groups load late
  React.useEffect(() => {
    if (isClient && rawGroups.length === 1 && filters.groupId === "all") {
      setFilters((prev) => ({ ...prev, groupId: rawGroups[0].id }));
    }
  }, [isClient, rawGroups, filters.groupId]);

  // 3. Query Scopes & Matrix Data
  const scopesQuery = useQuery({
    queryKey: [
      "enrollment-matrix-scopes",
      context.orgId,
      context.contextRevision,
      filters,
      isClient,
    ],
    queryFn: () => queryEnrollmentScopes(context, filters),
    staleTime: 30_000,
  });

  const clinicians: EnrollmentMatrixClinician[] = scopesQuery.data?.clinicians ?? [];
  const products: EnrollmentMatrixProductColumn[] =
    scopesQuery.data?.products && scopesQuery.data.products.length > 0
      ? scopesQuery.data.products
      : defaultProducts;

  const cells: Record<string, EnrollmentMatrixCell> = scopesQuery.data?.cells ?? {};

  const stats: EnrollmentMatrixStats = scopesQuery.data?.stats ?? {
    totalClinicians: clinicians.length,
    activeEnrollments: Object.values(cells).filter((c) => c.status === "approved").length,
    pendingPayerAction: Object.values(cells).filter(
      (c) => c.actionOwner === "Payer" || c.status === "submitted" || c.status === "in_review",
    ).length,
    actionableClientBlockers: Object.values(cells).filter(
      (c) =>
        c.status === "action_required" ||
        c.actionOwner === "Client" ||
        Boolean(c.clientSafeBlocker),
    ).length,
  };

  // 4. Slide-over detail drawer state
  const [selectedDrawerState, setSelectedDrawerState] = useState<{
    open: boolean;
    scopeId: string | null;
    clinicianName: string;
    npi: string;
    payerName: string;
    productName: string;
    facilityName?: string;
  }>({
    open: false,
    scopeId: null,
    clinicianName: "",
    npi: "",
    payerName: "",
    productName: "",
  });

  const handleCellClick = (
    cell: EnrollmentMatrixCell | null,
    clinician: EnrollmentMatrixClinician,
    product: EnrollmentMatrixProductColumn,
  ) => {
    setSelectedDrawerState({
      open: true,
      scopeId: cell?.scopeId ?? null,
      clinicianName: `${clinician.lastName}, ${clinician.firstName}`,
      npi: clinician.npi,
      payerName: product.payerName,
      productName: product.displayName,
      facilityName: facilities.find((f) => clinician.facilityIds.includes(f.id))?.name,
    });
  };

  // 5. CSV Export Handler
  const [exporting, setExporting] = useState(false);
  const handleExportCsv = () => {
    setExporting(true);
    try {
      const records: EnrollmentExportRecord[] = [];
      for (const clinician of clinicians) {
        for (const prod of products) {
          const cellKey = `${clinician.providerId}:${prod.productId}`;
          const cell = cells[cellKey];
          if (cell && cell.status !== "not_started") {
            const fac = facilities.find((f) => f.id === cell.facilityId);
            const grp = rawGroups.find((g) => (clinician.groupIds ?? []).includes(g.id));
            records.push({
              providerName: `${clinician.lastName}, ${clinician.firstName}`,
              npi: clinician.npi,
              discipline: clinician.discipline,
              groupName: grp?.name ?? "Provider Group",
              payerName: prod.payerName,
              productName: prod.displayName,
              state: "CO",
              facilityName: fac?.name ?? "Primary Location",
              status: cell.status === "approved" ? "Approved" : cell.status.replace(/_/g, " "),
              publicationState: cell.status === "needs_verification" ? "Needs Verification" : "Published",
              effectiveDate: cell.effectiveDate,
              actionOwner: cell.actionOwner,
              blockerReason: cell.clientSafeBlocker,
              payerReference: cell.payerReference,
              retroWindow: null,
              proofCount: cell.proofCount,
            });
          }
        }
      }

      const csvContent = generateEnrollmentExplorerCsv(records);
      const dateStr = new Date().toISOString().split("T")[0];
      downloadCsvFile(`enrollment-explorer-${dateStr}.csv`, csvContent);
    } catch (err) {
      console.error("Failed to generate CSV export:", err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5 p-1">
      {/* Breadcrumb to Reporting Center */}
      <Link
        to="/reporting"
        className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Reporting Center
      </Link>

      {/* Page Header */}
      <PageHeader
        title="Enrollment Explorer"
        description="Self-service matrix of clinician enrollments across payer products with version-bound proof."
      />

      {/* Filter Bar & KPI Summary Strip */}
      <EnrollmentFilterBar
        filters={filters}
        onFiltersChange={setFilters}
        groups={rawGroups}
        facilities={facilities}
        stats={stats}
        isClient={isClient}
        onExportCsv={handleExportCsv}
        exporting={exporting}
      />

      {/* Virtualized Matrix Grid */}
      <EnrollmentMatrixGrid
        clinicians={clinicians}
        products={products}
        cells={cells}
        onCellClick={handleCellClick}
        isLoading={scopesQuery.isLoading || catalogQuery.isLoading}
      />

      {/* Slide-Over Proof Detail Drawer */}
      <EnrollmentDetailDrawer
        scopeId={selectedDrawerState.scopeId}
        clinicianName={selectedDrawerState.clinicianName}
        npi={selectedDrawerState.npi}
        payerName={selectedDrawerState.payerName}
        productName={selectedDrawerState.productName}
        facilityName={selectedDrawerState.facilityName}
        open={selectedDrawerState.open}
        onOpenChange={(open) => setSelectedDrawerState((prev) => ({ ...prev, open }))}
        isClient={isClient}
      />
    </div>
  );
}
