// E6.6 F6.6.2 — the Launches report (TS-135): locations with future or
// recent go-live dates, grouped by provider group and date-sorted, with
// provider counts, open-case counts, and the at-risk flag (Overdue once the
// date has passed); dateless locations trail in a "No go-live date" section,
// never flagged. DATE-ONLY — no
// location statuses anywhere; derivation is pure (src/lib/launchReport.ts)
// over the shared facilities / assignments / providers / cases + case
// location caches. Org-scoped inside
// the cross-org Reporting Center.
import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { statusToneClasses } from "@/components/StatusPill";
import { useActiveOrgId } from "@/lib/auth-store";
import { fmtDate } from "@/lib/format";
import { localTodayIso } from "@/hooks/useEnrollmentReadiness";
import { useCases, useOrgCaseFacilityLinks } from "@/hooks/useCases";
import { useFacilities, useProviderGroups } from "@/hooks/useLookups";
import { useProviderAssignments, useProviders } from "@/hooks/useProviders";
import {
  buildLaunchReportRows,
  buildNoGoLiveDateRows,
  groupLaunchRows,
  LAUNCH_AT_RISK_RULE_TEXT,
  launchRiskLabel,
  openCasesByFacility,
  providerCountsByFacility,
  type LaunchNoDateRow,
  type LaunchReportRow,
} from "@/lib/launchReport";

function launchTiming(row: LaunchReportRow): string {
  if (row.daysUntil > 0) return `in ${row.daysUntil} day${row.daysUntil === 1 ? "" : "s"}`;
  if (row.daysUntil === 0) return "today";
  return `${-row.daysUntil} day${row.daysUntil === -1 ? "" : "s"} ago`;
}

function LocationCell({ row }: { row: Pick<LaunchNoDateRow, "name" | "city" | "state"> }) {
  return (
    <TableCell>
      <div className="text-[13px] font-medium text-foreground">{row.name}</div>
      {row.city || row.state ? (
        <div className="text-[12px] text-muted-foreground">
          {[row.city, row.state].filter(Boolean).join(", ")}
        </div>
      ) : null}
    </TableCell>
  );
}

export function LaunchesReport() {
  const orgId = useActiveOrgId();
  const facilitiesQ = useFacilities();
  const groupsQ = useProviderGroups();
  const assignmentsQ = useProviderAssignments();
  const providersQ = useProviders();
  const casesQ = useCases();
  const caseFacilitiesQ = useOrgCaseFacilityLinks();
  const today = localTodayIso();

  const { groups, noDate } = useMemo(() => {
    // The domain type keeps the FK columns nullable; a row missing either id
    // can't join anything, so it drops at this boundary.
    const assignments = (assignmentsQ.data ?? []).flatMap((a) =>
      a.providerId && a.facilityId
        ? [{ providerId: a.providerId, facilityId: a.facilityId, startDate: a.startDate }]
        : [],
    );
    const providers = providersQ.data ?? [];
    const facilities = (facilitiesQ.data ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      groupId: f.groupId,
      effectiveDate: f.effectiveDate,
      isActive: f.isActive,
      referenceOnly: f.referenceOnly,
      city: f.city,
      state: f.state,
    }));
    const providerCounts = providerCountsByFacility(assignments, providers, today);
    const openCaseCounts = openCasesByFacility(
      (casesQ.data ?? []).map((c) => ({
        id: c.id,
        providerId: c.providerId,
        facilityId: c.facilityId,
        status: c.caseStatus,
      })),
      caseFacilitiesQ.data ?? [],
      providers,
    );
    const groupNameById = new Map((groupsQ.data ?? []).map((g) => [g.id, g.name]));
    return {
      groups: groupLaunchRows(
        buildLaunchReportRows(facilities, providerCounts, openCaseCounts, today),
        groupNameById,
      ),
      noDate: buildNoGoLiveDateRows(facilities, providerCounts, openCaseCounts, groupNameById),
    };
  }, [
    facilitiesQ.data,
    groupsQ.data,
    assignmentsQ.data,
    providersQ.data,
    casesQ.data,
    caseFacilitiesQ.data,
    today,
  ]);

  if (!orgId) {
    return <EmptyState message="Select an organization to see its upcoming launches." />;
  }
  const loading =
    facilitiesQ.isLoading ||
    groupsQ.isLoading ||
    assignmentsQ.isLoading ||
    providersQ.isLoading ||
    casesQ.isLoading ||
    caseFacilitiesQ.isLoading;
  if (loading) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-5">
      {/* The at-risk rule, stated inline (F6.6.2 AC). */}
      <p className="text-[12.5px] text-muted-foreground">{LAUNCH_AT_RISK_RULE_TEXT}</p>
      {groups.length === 0 && noDate.length === 0 ? (
        <EmptyState message="No locations opening soon, opened in the last 30 days, or waiting for a go-live date." />
      ) : (
        groups.map((g) => (
          <section key={g.groupId ?? "no-group"} aria-label={g.groupName}>
            <h2 className="mb-2 text-[14px] font-semibold text-foreground">{g.groupName}</h2>
            <div className="overflow-x-auto rounded-md border border-[#E8E5E0]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Location</TableHead>
                    <TableHead>Go-live</TableHead>
                    <TableHead className="text-right">Providers</TableHead>
                    <TableHead className="text-right">Open cases</TableHead>
                    <TableHead>Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.rows.map((row) => (
                    <TableRow key={row.facilityId}>
                      <LocationCell row={row} />
                      <TableCell className="text-[13px] whitespace-nowrap">
                        {fmtDate(row.effectiveDate)}
                        <span className="ml-1 text-[12px] text-muted-foreground">
                          ({launchTiming(row)})
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-[13px]">{row.providerCount}</TableCell>
                      <TableCell className="text-right text-[13px]">{row.openCaseCount}</TableCell>
                      <TableCell>
                        {row.atRisk ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded-[4px] px-2 py-0.5 text-[12px] font-medium ${statusToneClasses[row.riskKind === "overdue" ? "red" : "amber"]}`}
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {launchRiskLabel(row)}
                          </span>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        ))
      )}
      {noDate.length > 0 ? (
        <section aria-label="No go-live date">
          <h2 className="mb-1 text-[14px] font-semibold text-foreground">No go-live date</h2>
          <p className="mb-2 text-[12.5px] text-muted-foreground">
            Never flagged. Set a go-live date on the location to track its launch.
          </p>
          <div className="overflow-x-auto rounded-md border border-[#E8E5E0]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Location</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead className="text-right">Providers</TableHead>
                  <TableHead className="text-right">Open cases</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {noDate.map((row) => (
                  <TableRow key={row.facilityId}>
                    <LocationCell row={row} />
                    <TableCell className="text-[13px]">{row.groupName}</TableCell>
                    <TableCell className="text-right text-[13px]">{row.providerCount}</TableCell>
                    <TableCell className="text-right text-[13px]">{row.openCaseCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
