// E6.6 F6.6.4 — counts-as-reports: active locations with no providers
// assigned. Derived live from the shared facilities + assignments + providers
// caches (src/lib/countsReports.ts, staffing rule in launchReport.ts — a
// terminated, test or not-yet-started provider does not staff a location);
// no stored state, no widgets on working screens.
//
// The facility and group cells link to the group's Facilities area and its
// hub. Every staff role can open both (writes are gated inside them);
// a client audience never reaches this route (the root fences it to /reporting
// and the Enrollment Explorer), so the links need no role branch.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
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
import { useActiveOrgId } from "@/lib/auth-store";
import { fmtDate } from "@/lib/format";
import { useFacilities, useProviderGroups } from "@/hooks/useLookups";
import { localTodayIso } from "@/hooks/useEnrollmentReadiness";
import { useProviderAssignments, useProviders } from "@/hooks/useProviders";
import { providerCountsByFacility } from "@/lib/launchReport";
import { facilitiesWithoutProviders } from "@/lib/countsReports";

// The record-link style the Denials report uses for its case links.
const RECORD_LINK_CLASS = "text-[#1B4D3E] underline-offset-2 hover:underline";

export function FacilitiesWithoutProvidersReport() {
  const orgId = useActiveOrgId();
  const facilitiesQ = useFacilities();
  const groupsQ = useProviderGroups();
  const assignmentsQ = useProviderAssignments();
  const providersQ = useProviders();
  const today = localTodayIso();

  const rows = useMemo(() => {
    const counts = providerCountsByFacility(
      (assignmentsQ.data ?? []).flatMap((a) =>
        a.providerId && a.facilityId
          ? [{ providerId: a.providerId, facilityId: a.facilityId, startDate: a.startDate }]
          : [],
      ),
      providersQ.data ?? [],
      today,
    );
    return facilitiesWithoutProviders(facilitiesQ.data ?? [], counts);
  }, [facilitiesQ.data, assignmentsQ.data, providersQ.data, today]);

  const groupName = useMemo(
    () => new Map((groupsQ.data ?? []).map((g) => [g.id, g.name])),
    [groupsQ.data],
  );

  if (!orgId) {
    return <EmptyState message="Select an organization to see its unstaffed facilities." />;
  }
  if (
    facilitiesQ.isLoading ||
    groupsQ.isLoading ||
    assignmentsQ.isLoading ||
    providersQ.isLoading
  ) {
    return <Skeleton className="h-40 w-full" />;
  }
  if (rows.length === 0) {
    return <EmptyState message="Every active facility has at least one provider assigned." />;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-[#E8E5E0]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Facility</TableHead>
            <TableHead>Group</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Go-live</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            // Link only a group the group pages can resolve (they read the same
            // groups cache), so a link never lands on "Group not found".
            const groupId = row.groupId && groupName.has(row.groupId) ? row.groupId : null;
            return (
              <TableRow key={row.facilityId}>
                <TableCell className="text-[13px] font-medium">
                  {groupId ? (
                    <Link
                      to="/groups/$groupId/facilities"
                      params={{ groupId }}
                      className={RECORD_LINK_CLASS}
                    >
                      {row.name}
                    </Link>
                  ) : (
                    row.name
                  )}
                </TableCell>
                <TableCell className="text-[13px]">
                  {groupId ? (
                    <Link to="/groups/$groupId" params={{ groupId }} className={RECORD_LINK_CLASS}>
                      {groupName.get(groupId)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-[13px]">
                  {[row.city, row.state].filter(Boolean).join(", ") || "—"}
                </TableCell>
                <TableCell className="text-[13px] whitespace-nowrap">
                  {row.effectiveDate ? fmtDate(row.effectiveDate) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
