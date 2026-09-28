import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Download, RefreshCw } from "lucide-react";
import { EnrollmentReportFilters } from "@/components/reporting/enrollment-explorer/EnrollmentReportFilters";
import { EnrollmentReportMatrix } from "@/components/reporting/enrollment-explorer/EnrollmentReportMatrix";
import { EnrollmentScopeDrawer } from "@/components/reporting/enrollment-explorer/EnrollmentScopeDrawer";
import { EnrollmentStaffWorkspace } from "@/components/reporting/enrollment-explorer/EnrollmentStaffWorkspace";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEnrollmentReport, useEnrollmentReportContext } from "@/hooks/useEnrollmentReport";
import { downloadEnrollmentReportCsv } from "@/lib/enrollmentExplorerApi";
import { deriveEnrollmentReportProviders } from "@/lib/enrollmentReportView";
import type {
  EnrollmentReportFilters as Filters,
  EnrollmentReportLocation,
  EnrollmentReportProvider,
} from "@/types";

interface ReportSearch extends Omit<Filters, "groupId" | "facilityId" | "productId"> {
  org?: string;
  group?: string;
  facility?: string;
  product?: string;
}

function isConflict(error: unknown): boolean {
  return error instanceof Error && "status" in error && Number(error.status) === 409;
}

function isAccessDenied(error: unknown): boolean {
  return error instanceof Error && "status" in error && [401, 403].includes(Number(error.status));
}

function validateSearch(search: Record<string, unknown>): ReportSearch {
  const text = (key: string) =>
    typeof search[key] === "string" ? (search[key] as string) : undefined;
  const discipline = text("discipline");
  const status = text("status");
  const allowedDisciplines = ["PT", "PTA", "OT", "OTA", "SLP", "Other", "Unknown"];
  const allowedStatuses = [
    "not_started",
    "in_progress",
    "submitted",
    "in_review",
    "action_required",
    "approved",
    "denied",
    "not_pursuing",
    "terminated",
    "needs_verification",
  ];
  return {
    org: text("org"),
    group: text("group"),
    state: text("state"),
    facility: text("facility"),
    product: text("product"),
    discipline:
      discipline && allowedDisciplines.includes(discipline)
        ? (discipline as Filters["discipline"])
        : undefined,
    status: status && allowedStatuses.includes(status) ? (status as Filters["status"]) : undefined,
    search: text("search"),
    historical: search.historical === true || search.historical === "true" ? true : undefined,
  };
}

export const Route = createFileRoute("/reporting/enrollment-explorer")({
  validateSearch,
  component: EnrollmentExplorerRoute,
});

function EnrollmentExplorerRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/reporting/enrollment-explorer" });
  const context = useEnrollmentReportContext();
  const contextMatchesUrl = Boolean(context && (!search.org || search.org === context.orgId));
  const filters = useMemo<Filters>(
    () => ({
      groupId: search.group,
      state: search.state,
      facilityId: search.facility,
      productId: search.product,
      discipline: search.discipline,
      status: search.status,
      search: search.search,
      historical: search.historical,
    }),
    [search],
  );
  const report = useEnrollmentReport(filters, contextMatchesUrl);
  const [exportReportInvalid, setExportReportInvalid] = useState(false);
  const reportInvalid =
    isConflict(report.error) || isAccessDenied(report.error) || exportReportInvalid;
  const pages = report.data?.pages ?? [];
  const firstPage = pages[0];
  const providers = useMemo(() => deriveEnrollmentReportProviders(pages), [pages]);
  const [selectedScope, setSelectedScope] = useState<{
    location: EnrollmentReportLocation;
    provider: EnrollmentReportProvider;
    label: string;
  } | null>(null);
  const [locationChoices, setLocationChoices] = useState<{
    provider: EnrollmentReportProvider;
    locations: EnrollmentReportLocation[];
    cell: { sectionKey: string; productId: string };
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const scopeTrigger = useRef<HTMLElement | null>(null);
  const scopeTriggerTestId = useRef<string | null>(null);
  const exportController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (context && !search.org) {
      void navigate({ replace: true, search: (previous) => ({ ...previous, org: context.orgId }) });
    }
  }, [context, navigate, search.org]);
  useEffect(() => () => exportController.current?.abort(), [context?.contextRevision]);
  useEffect(() => {
    setSelectedScope(null);
    setLocationChoices(null);
    scopeTrigger.current = null;
    scopeTriggerTestId.current = null;
    exportController.current?.abort();
    setExportReportInvalid(false);
  }, [context?.orgId, context?.audience, context?.contextRevision]);
  useEffect(() => {
    if (firstPage?.viewToken) setExportReportInvalid(false);
  }, [firstPage?.viewToken]);

  const updateFilters = useCallback(
    (next: Filters) => {
      void navigate({
        replace: true,
        search: (previous) => ({
          ...previous,
          group: next.groupId,
          state: next.state,
          facility: next.facilityId,
          product: next.productId,
          discipline: next.discipline,
          status: next.status,
          search: next.search,
          historical: next.historical,
        }),
      });
    },
    [navigate],
  );

  const openLocations = useCallback(
    (
      provider: EnrollmentReportProvider,
      locations: EnrollmentReportLocation[],
      trigger: HTMLButtonElement,
      cell: { sectionKey: string; productId: string },
    ) => {
      if (!locations.length) return;
      scopeTrigger.current = trigger;
      scopeTriggerTestId.current = trigger.dataset.testid ?? null;
      const section = firstPage?.sections.find((item) => item.key === cell.sectionKey);
      const column = section?.columns.find((item) => item.productId === cell.productId);
      const label = `${section?.groupLabel ?? "Group"} · ${section?.state ?? "State"} · ${column?.payerLabel ?? "Payer"} · ${column?.productLabel ?? "Product"}`;
      if (locations.length === 1) {
        setSelectedScope({ provider, location: locations[0], label });
        return;
      }
      setLocationChoices({ provider, locations, cell });
    },
    [firstPage?.sections],
  );

  const exportCsv = async () => {
    if (!context || !firstPage) return;
    exportController.current?.abort();
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setExportMessage("");
    setExportReportInvalid(false);
    try {
      const blob = await downloadEnrollmentReportCsv(context, filters, firstPage.viewToken, {
        signal: controller.signal,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "enrollment-report.csv";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setExportMessage("CSV download started.");
    } catch (error) {
      if (!controller.signal.aborted) {
        if (isConflict(error) || isAccessDenied(error)) setExportReportInvalid(true);
        setExportMessage(
          isConflict(error)
            ? "The report snapshot expired. Refresh before reviewing or downloading."
            : isAccessDenied(error)
              ? "Access to this report changed. Refresh the access context before continuing."
              : error instanceof Error
                ? error.message
                : "CSV could not be prepared.",
        );
      }
    } finally {
      if (exportController.current === controller) {
        exportController.current = null;
        setExporting(false);
      }
    }
  };

  const isStaff = context?.audience === "staff";

  return (
    <main
      className="mx-auto max-w-[1800px] px-3 pb-10 sm:px-6"
      data-testid="enrollment-explorer-page"
    >
      <Link
        to="/reporting"
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Reporting Center
      </Link>
      <PageHeader
        title="Enrollment Explorer"
        description={
          isStaff
            ? "Review provider enrollment by group, location, payer product, and state."
            : "View payer enrollment published for your assigned provider groups."
        }
        actions={
          contextMatchesUrl && firstPage && !reportInvalid ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void exportCsv()}
              disabled={exporting}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />{" "}
              {exporting ? "Preparing…" : "Download CSV"}
            </Button>
          ) : undefined
        }
      />
      {!context ? (
        <div
          role="status"
          className="rounded-md border bg-card p-4 text-[13px] text-muted-foreground"
        >
          Select an organization and access audience to view enrollment.
        </div>
      ) : !contextMatchesUrl ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-card p-4 text-[13px] text-destructive"
        >
          The organization in this report URL does not match the selected verified access context.
          Switch context to continue.
        </div>
      ) : (
        <>
          <EnrollmentReportFilters
            filters={filters}
            choices={firstPage?.filterChoices}
            onChange={updateFilters}
          />
          {report.error ? (
            <div
              role="alert"
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-950"
            >
              <span>
                {isAccessDenied(report.error)
                  ? "Access to this report is no longer valid. Refresh the access context before continuing."
                  : isConflict(report.error)
                    ? "This report snapshot is no longer current. Refresh before reviewing or downloading."
                    : report.error instanceof Error
                      ? report.error.message
                      : "The report could not be loaded."}
              </span>
              <Button size="sm" variant="outline" onClick={() => void report.refetch()}>
                <RefreshCw className="mr-1.5 h-3 w-3" /> Refresh snapshot
              </Button>
            </div>
          ) : null}
          {exportReportInvalid && !report.error ? (
            <div
              role="alert"
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-950"
            >
              <span>
                {exportMessage ||
                  "This report snapshot is no longer current. Refresh before reviewing or downloading."}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setExportReportInvalid(false);
                  void report.refetch();
                }}
              >
                <RefreshCw className="mr-1.5 h-3 w-3" /> Refresh snapshot
              </Button>
            </div>
          ) : null}
          {report.isLoading ? (
            <div className="rounded-md border bg-card p-4 text-center text-[12px] text-muted-foreground">
              Loading authorized enrollment snapshot…
            </div>
          ) : firstPage && !reportInvalid ? (
            <>
              <p className="mb-3 text-[11px] text-muted-foreground">
                {isStaff
                  ? "Staff CSV includes matching published and draft enrollment records; drafts are labeled draft."
                  : "Client CSV includes published enrollment records."}{" "}
                Empty cells are excluded. Import NPI and payer-reference columns as text to preserve
                leading zeros.
              </p>
              {firstPage.accessState === "no_grants" ? (
                <div
                  role="status"
                  className="rounded-md border bg-card p-4 text-[12px] text-muted-foreground"
                >
                  No groups are available in this selected access context.
                </div>
              ) : firstPage.accessState === "empty_cohort" ? (
                <div
                  role="status"
                  className="rounded-md border bg-card p-4 text-[12px] text-muted-foreground"
                >
                  No matching providers or published enrollment are available for these filters.
                </div>
              ) : (
                <>
                  {!firstPage.sections.length && providers.length ? (
                    <p
                      role="status"
                      className="mb-3 rounded-md border bg-card p-4 text-[12px] text-muted-foreground"
                    >
                      Provider cohort loaded. No payer products are configured for these authorized
                      groups, so no enrollment cells are projected.
                    </p>
                  ) : null}
                  <EnrollmentReportMatrix
                    providers={providers}
                    sections={firstPage.sections}
                    onOpenLocations={openLocations}
                  />
                </>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11px] text-muted-foreground">
                  {report.hasNextPage
                    ? "50-provider pages · columns and filters are fixed to this snapshot."
                    : "End of provider list."}
                </span>
                {report.hasNextPage ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={report.isFetchingNextPage}
                    onClick={() => void report.fetchNextPage()}
                  >
                    {report.isFetchingNextPage ? "Loading…" : "Load next 50 providers"}
                  </Button>
                ) : null}
              </div>
            </>
          ) : !report.error && !reportInvalid ? (
            <div className="rounded-md border bg-card p-4 text-center text-[12px] text-muted-foreground">
              No matching enrollment rows.
            </div>
          ) : null}
          {isStaff ? <EnrollmentStaffWorkspace filters={filters} /> : null}
          {exportMessage && !exportReportInvalid ? (
            <p role="status" aria-live="polite" className="mt-2 text-[11px] text-muted-foreground">
              {exportMessage}
            </p>
          ) : null}
        </>
      )}
      <Dialog
        open={Boolean(locationChoices)}
        onOpenChange={(open) => {
          if (!open) setLocationChoices(null);
        }}
      >
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
          data-testid="enrollment-location-picker"
        >
          <DialogHeader>
            <DialogTitle>Choose an enrollment location</DialogTitle>
            <DialogDescription>
              {locationChoices?.provider.name} has multiple authorized locations in this payer
              product.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {locationChoices?.locations.map((location) => (
              <button
                type="button"
                key={location.scopeId}
                className="flex w-full items-start justify-between gap-3 rounded-md border p-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  const section = firstPage?.sections.find(
                    (item) => item.key === locationChoices.cell.sectionKey,
                  );
                  const column = section?.columns.find(
                    (item) => item.productId === locationChoices.cell.productId,
                  );
                  setSelectedScope({
                    location,
                    provider: locationChoices.provider,
                    label: `${section?.groupLabel ?? "Group"} · ${section?.state ?? "State"} · ${column?.payerLabel ?? "Payer"} · ${column?.productLabel ?? "Product"}`,
                  });
                  setLocationChoices(null);
                }}
              >
                <span>
                  <strong className="block text-[12px]">{location.facilityLabel}</strong>
                  <span className="text-[11px] text-muted-foreground">
                    {(() => {
                      const section = firstPage?.sections.find(
                        (item) => item.key === locationChoices.cell.sectionKey,
                      );
                      const column = section?.columns.find(
                        (item) => item.productId === locationChoices.cell.productId,
                      );
                      return `${section?.groupLabel ?? "Group"} · ${section?.state ?? "State"} · ${column?.payerLabel ?? "Payer"} · ${column?.productLabel ?? "Product"} · ${location.status.replaceAll("_", " ")}${location.historical ? " · historical" : ""}`;
                    })()}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <EnrollmentScopeDrawer
        scopeId={selectedScope?.location.scopeId ?? null}
        facilityLabel={
          selectedScope
            ? `${selectedScope.label} · ${selectedScope.location.facilityLabel}`
            : undefined
        }
        providerName={selectedScope?.provider.name}
        historical={Boolean(selectedScope?.location.historical)}
        historicalStatus={selectedScope?.location.status}
        open={Boolean(selectedScope)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedScope(null);
          }
        }}
        onRestoreFocus={() => {
          window.requestAnimationFrame(() => {
            const trigger = scopeTrigger.current;
            const target = trigger?.isConnected
              ? trigger
              : scopeTriggerTestId.current
                ? document.querySelector<HTMLElement>(
                    `[data-testid="${scopeTriggerTestId.current}"]`,
                  )
                : null;
            target?.focus();
          });
        }}
      />
    </main>
  );
}
