// E6.6 F6.6.4 — counts-as-reports: active locations with no providers
// assigned. Derived live from the shared facilities + assignments caches
// (src/lib/countsReports.ts); no stored state, no widgets on working screens.
import { useMemo } from "react";
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
import { useProviderAssignments } from "@/hooks/useProviders";
import { providerCountsByFacility } from "@/lib/launchReport";
import { facilitiesWithoutProviders } from "@/lib/countsReports";

export function FacilitiesWithoutProvidersReport() {
  const orgId = useActiveOrgId();
  const facilitiesQ = useFacilities();
  const groupsQ = useProviderGroups();
  const assignmentsQ = useProviderAssignments();

  const rows = useMemo(() => {
    const counts = providerCountsByFacility(
      (assignmentsQ.data ?? []).flatMap((a) =>
        a.providerId && a.facilityId
          ? [{ providerId: a.providerId, facilityId: a.facilityId }]
          : [],
      ),
    );
    return facilitiesWithoutProviders(facilitiesQ.data ?? [], counts);
  }, [facilitiesQ.data, assignmentsQ.data]);

  const groupName = useMemo(
    () => new Map((groupsQ.data ?? []).map((g) => [g.id, g.name])),
    [groupsQ.data],
  );

  if (!orgId) {
    return <EmptyState message="Select an organization to see its unstaffed facilities." />;
  }
  if (facilitiesQ.isLoading || groupsQ.isLoading || assignmentsQ.isLoading) {
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
          {rows.map((row) => (
            <TableRow key={row.facilityId}>
              <TableCell className="text-[13px] font-medium">{row.name}</TableCell>
              <TableCell className="text-[13px]">
                {row.groupId ? (groupName.get(row.groupId) ?? "—") : "—"}
              </TableCell>
              <TableCell className="text-[13px]">
                {[row.city, row.state].filter(Boolean).join(", ") || "—"}
              </TableCell>
              <TableCell className="text-[13px] whitespace-nowrap">
                {row.effectiveDate ? fmtDate(row.effectiveDate) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
