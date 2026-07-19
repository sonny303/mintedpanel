// E6.6 F6.6.4 — counts-as-reports: active locations per provider group.
// Derived live from the shared groups + facilities caches
// (src/lib/countsReports.ts); no stored state.
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
import { useFacilities, useProviderGroups } from "@/hooks/useLookups";
import { locationsPerGroup } from "@/lib/countsReports";

export function LocationsPerGroupReport() {
  const orgId = useActiveOrgId();
  const facilitiesQ = useFacilities();
  const groupsQ = useProviderGroups();

  const rows = useMemo(
    () =>
      locationsPerGroup(
        (groupsQ.data ?? []).map((g) => ({ id: g.id, name: g.name })),
        facilitiesQ.data ?? [],
      ),
    [groupsQ.data, facilitiesQ.data],
  );

  if (!orgId) {
    return <EmptyState message="Select an organization to see its locations per group." />;
  }
  if (facilitiesQ.isLoading || groupsQ.isLoading) return <Skeleton className="h-40 w-full" />;
  if (rows.length === 0) {
    return <EmptyState message="No provider groups yet." />;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-[#E8E5E0]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Group</TableHead>
            <TableHead className="text-right">Active locations</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.groupId ?? "no-group"}>
              <TableCell className="text-[13px] font-medium">{row.groupName}</TableCell>
              <TableCell className="text-right text-[13px]">{row.activeLocationCount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
