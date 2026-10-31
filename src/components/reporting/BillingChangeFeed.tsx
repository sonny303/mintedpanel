import { useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { StatusPill } from "@/components/StatusPill";
import { EmptyState } from "@/components/EmptyState";
import { ReadinessPill } from "@/components/reporting/ReadinessPill";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuthStore } from "@/lib/auth-store";
import { isCurrentBillingReadinessDate } from "@/hooks/useBillingReadiness";
import {
  assessFeedEvent,
  BILLING_FEED_KIND_LABELS,
  buildChangeFeedCsv,
  buildNewlyBillableDigestCsv,
  filterBillingFeed,
  type BillingAssessment,
  type BillingFeedEvent,
  type BillingFeedFilters,
  type BillingFeedKind,
  type BillingFeedRange,
} from "@/lib/billingReadiness";
import { downloadCsvText } from "@/lib/csv";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { BillingReadinessData } from "@/hooks/useBillingReadiness";

// Rows render a page at a time; a 90-day window at Luna scale holds thousands.
const PAGE_SIZE = 200;

const FEED_KINDS = Object.keys(BILLING_FEED_KIND_LABELS) as BillingFeedKind[];

function feedFiltersKey(filters: BillingFeedFilters): string {
  return JSON.stringify([
    filters.range,
    filters.facilityId ?? "",
    filters.payerId ?? "",
    filters.kind ?? "",
  ]);
}

function facilityIdentity(
  facility: { name: string; state: string | null; groupId: string | null },
  groups: { id: string; name: string }[],
): string {
  const groupName = groups.find((group) => group.id === facility.groupId)?.name;
  return `${facility.name} · ${facility.state ?? "State not recorded"} · ${groupName ?? "Group not recorded"}`;
}

function eventDate(event: BillingFeedEvent): string {
  return event.eventDate.includes("T") ? fmtDateTime(event.eventDate) : fmtDate(event.eventDate);
}

export function BillingChangeFeed({ readiness }: { readiness: BillingReadinessData }) {
  const [range, setRange] = useState<BillingFeedRange>(30);
  const [facilityId, setFacilityId] = useState("");
  const [payerId, setPayerId] = useState("");
  const [kind, setKind] = useState<BillingFeedKind | "">("");
  const [digestBusy, setDigestBusy] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const currentFilters = useMemo<BillingFeedFilters>(
    () => ({
      range,
      facilityId: facilityId || undefined,
      payerId: payerId || undefined,
      kind: kind || undefined,
    }),
    [range, facilityId, payerId, kind],
  );
  const filtersKey = feedFiltersKey(currentFilters);
  const [visible, setVisible] = useState({ key: filtersKey, count: PAGE_SIZE });
  const visibleCount = visible.key === filtersKey ? visible.count : PAGE_SIZE;
  const filtersKeyRef = useRef(filtersKey);
  filtersKeyRef.current = filtersKey;

  const facilities = useMemo(
    () =>
      [...(readiness.data?.snapshot.facilities ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [readiness.data?.snapshot.facilities],
  );
  const payers = useMemo(
    () => [...(readiness.data?.snapshot.payers ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [readiness.data?.snapshot.payers],
  );
  const rows = useMemo(
    () =>
      readiness.data
        ? filterBillingFeed(readiness.data.feed, currentFilters, readiness.data.asOf)
        : [],
    [readiness.data, currentFilters],
  );
  const shownRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount]);
  const assessmentByEvent = useMemo(() => {
    const results = new Map<string, BillingAssessment | null>();
    if (!readiness.data) return results;
    for (const event of shownRows) {
      results.set(event.id, assessFeedEvent(readiness.data.snapshot, event, readiness.data.asOf));
    }
    return results;
  }, [readiness.data, shownRows]);

  const canDownload = Boolean(
    readiness.data &&
    readiness.orgId &&
    readiness.userId &&
    !readiness.isFetching &&
    !readiness.isError &&
    !readiness.isStale &&
    !digestBusy,
  );

  async function downloadDigest() {
    const orgId = readiness.orgId;
    const userId = readiness.userId;
    const requestedFilters = currentFilters;
    const requestedFiltersKey = filtersKey;
    if (!canDownload || !orgId || !userId) return;

    setDigestBusy(true);
    setDownloadError("");
    try {
      const fresh = await readiness.refreshForDigest();
      const current = useAuthStore.getState();
      if (
        filtersKeyRef.current !== requestedFiltersKey ||
        current.activeOrgId !== orgId ||
        current.session?.user.id !== userId
      ) {
        return;
      }
      if (!fresh || fresh.orgId !== orgId || fresh.userId !== userId) {
        setDownloadError(
          "A complete current read was not available. Retry after the source data loads.",
        );
        return;
      }
      const currentFeed = filterBillingFeed(fresh.feed, requestedFilters, fresh.asOf);
      const csv = buildNewlyBillableDigestCsv(fresh.snapshot, currentFeed, fresh.asOf);
      if (!isCurrentBillingReadinessDate(fresh.asOf)) {
        setDownloadError(
          "A complete current read was not available. Retry after the source data loads.",
        );
        return;
      }
      downloadCsvText("newly-billable-digest.csv", csv);
    } catch {
      const current = useAuthStore.getState();
      if (current.activeOrgId === orgId && current.session?.user.id === userId) {
        setDownloadError("The digest could not be refreshed. No file was created.");
      }
    } finally {
      setDigestBusy(false);
    }
  }

  function downloadChanges() {
    const data = readiness.data;
    if (!canDownload || !data) return;
    setDownloadError("");
    if (!isCurrentBillingReadinessDate(data.asOf)) {
      setDownloadError(
        "A complete current read was not available. Retry after the source data loads.",
      );
      return;
    }
    downloadCsvText(
      "credentialing-changes.csv",
      buildChangeFeedCsv(data.snapshot, rows, data.asOf),
    );
  }

  return (
    <div className="space-y-3 pt-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-foreground">Credentialing changes</h2>
          <p className="mt-0.5 max-w-3xl text-[12px] text-muted-foreground">
            Recorded approval transitions and surviving facility links appear with recorded dates.
            Termination and license-expiration warnings are derived from current dates and are not a
            complete history.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canDownload || rows.length === 0}
            onClick={downloadChanges}
          >
            <Download className="h-3.5 w-3.5" />
            Export changes
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canDownload}
            onClick={() => void downloadDigest()}
          >
            <Download className="h-3.5 w-3.5" />
            Newly Billable Digest
          </Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-md border border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <span className="text-[12px] font-medium text-foreground">Date range</span>
          <Select
            value={String(range)}
            onValueChange={(value) => setRange(Number(value) as BillingFeedRange)}
            disabled={!readiness.data}
          >
            <SelectTrigger aria-label="Date range" className="h-9 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <span className="text-[12px] font-medium text-foreground">Change type</span>
          <Select
            value={kind || "all"}
            onValueChange={(value) => setKind(value === "all" ? "" : (value as BillingFeedKind))}
            disabled={!readiness.data}
          >
            <SelectTrigger aria-label="Change type" className="h-9 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All changes</SelectItem>
              {FEED_KINDS.map((value) => (
                <SelectItem key={value} value={value}>
                  {BILLING_FEED_KIND_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <span className="text-[12px] font-medium text-foreground">Facility</span>
          <Select
            value={facilityId || "all"}
            onValueChange={(value) => setFacilityId(value === "all" ? "" : value)}
            disabled={!readiness.data}
          >
            <SelectTrigger aria-label="Facility" className="h-9 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All facilities</SelectItem>
              {facilities.map((facility) => (
                <SelectItem key={facility.id} value={facility.id}>
                  {facilityIdentity(facility, readiness.data?.snapshot.groups ?? [])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <span className="text-[12px] font-medium text-foreground">Payer</span>
          <Select
            value={payerId || "all"}
            onValueChange={(value) => setPayerId(value === "all" ? "" : value)}
            disabled={!readiness.data}
          >
            <SelectTrigger aria-label="Payer" className="h-9 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All payers</SelectItem>
              {payers.map((payer) => (
                <SelectItem key={payer.id} value={payer.id}>
                  {payer.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {downloadError ? (
        <p role="alert" className="text-[12px] text-[var(--mp-danger-ink)]">
          {downloadError}
        </p>
      ) : null}

      {!readiness.data ? (
        <EmptyState message="Change feed is unavailable until all current organization reads succeed." />
      ) : rows.length === 0 ? (
        <EmptyState message="No recorded or date-derived changes match these filters." />
      ) : (
        <TooltipProvider delayDuration={150}>
          <p className="text-[12px] text-muted-foreground" aria-live="polite">
            {rows.length === 1 ? "1 change" : `${rows.length.toLocaleString()} changes`}
            {rows.length > shownRows.length
              ? ` · showing the newest ${shownRows.length.toLocaleString()}`
              : ""}
          </p>
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Clinician</TableHead>
                  <TableHead>Facility</TableHead>
                  <TableHead>Payer</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Current readiness</TableHead>
                  <TableHead>Recorded confirmed effective date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shownRows.map((event) => {
                  const assessment = assessmentByEvent.get(event.id);
                  return (
                    <TableRow key={event.id}>
                      <TableCell className="whitespace-nowrap text-[12.5px]">
                        {eventDate(event)}
                      </TableCell>
                      <TableCell className="text-[12.5px] font-medium">{event.title}</TableCell>
                      <TableCell>
                        <StatusPill
                          status={event.recorded ? "blue" : "amber"}
                          label={event.recorded ? "Recorded" : "Date-derived"}
                        />
                      </TableCell>
                      <TableCell className="text-[12.5px]">{event.providerName}</TableCell>
                      <TableCell className="text-[12.5px]">
                        {event.facilityName ?? "Not recorded"}
                      </TableCell>
                      <TableCell className="text-[12.5px]">
                        {event.payerName ?? "Not recorded"}
                      </TableCell>
                      <TableCell className="text-[12.5px]">
                        {event.state ?? "Not recorded"}
                      </TableCell>
                      <TableCell>
                        {assessment ? (
                          <ReadinessPill
                            status={assessment.status}
                            label={assessment.label}
                            reasons={assessment.reasons}
                          />
                        ) : (
                          <StatusPill status="gray" label="Unable to assess" />
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-[12.5px]">
                        {assessment?.confirmedEffectiveDate
                          ? fmtDate(assessment.confirmedEffectiveDate)
                          : "Not recorded"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {rows.length > shownRows.length ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setVisible({ key: filtersKey, count: visibleCount + PAGE_SIZE })}
            >
              Show {Math.min(PAGE_SIZE, rows.length - shownRows.length).toLocaleString()} more
            </Button>
          ) : null}
        </TooltipProvider>
      )}
    </div>
  );
}
