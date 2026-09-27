import { useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { EmptyState } from "@/components/EmptyState";
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
import { useAuthStore } from "@/lib/auth-store";
import { isCurrentBillingReadinessDate } from "@/hooks/useBillingReadiness";
import {
  buildNewlyBillableDigestCsv,
  evaluateBillingReadiness,
  filterBillingFeed,
  type BillingAssessment,
  type BillingFeedEvent,
  type BillingFeedFilters,
  type BillingFeedRange,
} from "@/lib/billingReadiness";
import { downloadCsvText } from "@/lib/csv";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { BillingReadinessData, BillingReadinessQueryData } from "@/hooks/useBillingReadiness";

const STATUS_TONE: Record<BillingAssessment["status"], StatusColor> = {
  ready: "green",
  hold: "amber",
  stop: "red",
};

function feedFiltersKey(filters: BillingFeedFilters): string {
  return JSON.stringify([filters.range, filters.facilityId ?? "", filters.payerId ?? ""]);
}

function facilityIdentity(
  facility: { name: string; state: string | null; groupId: string | null },
  groups: { id: string; name: string }[],
): string {
  const groupName = groups.find((group) => group.id === facility.groupId)?.name;
  return `${facility.name} · ${facility.state ?? "State not recorded"} · ${groupName ?? "Group not recorded"}`;
}

function eventAssessment(
  data: BillingReadinessQueryData | undefined,
  event: BillingFeedEvent,
): BillingAssessment | null {
  if (!data || !event.payerId || !event.facilityId) return null;
  const assessment = evaluateBillingReadiness(
    data.snapshot,
    { providerId: event.providerId, facilityId: event.facilityId, payerId: event.payerId },
    data.asOf,
  );
  if (
    !assessment?.case ||
    assessment.case.id !== event.caseId ||
    assessment.case.groupId !== event.groupId
  ) {
    return null;
  }
  return assessment;
}

function eventDate(event: BillingFeedEvent): string {
  return event.eventDate.includes("T") ? fmtDateTime(event.eventDate) : fmtDate(event.eventDate);
}

export function BillingChangeFeed({ readiness }: { readiness: BillingReadinessData }) {
  const [range, setRange] = useState<BillingFeedRange>(30);
  const [facilityId, setFacilityId] = useState("");
  const [payerId, setPayerId] = useState("");
  const [digestBusy, setDigestBusy] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const currentFilters = useMemo<BillingFeedFilters>(
    () => ({ range, facilityId: facilityId || undefined, payerId: payerId || undefined }),
    [range, facilityId, payerId],
  );
  const filtersKey = feedFiltersKey(currentFilters);
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
  const assessmentByEvent = useMemo(() => {
    const results = new Map<string, BillingAssessment | null>();
    for (const event of rows) results.set(event.id, eventAssessment(readiness.data, event));
    return results;
  }, [readiness.data, rows]);

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

      <div className="grid gap-3 rounded-md border border-border p-4 sm:grid-cols-3">
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
              {rows.map((event) => {
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
                    <TableCell className="text-[12.5px]">{event.state ?? "Not recorded"}</TableCell>
                    <TableCell>
                      {assessment ? (
                        <StatusPill
                          status={STATUS_TONE[assessment.status]}
                          label={assessment.label}
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
      )}
    </div>
  );
}
