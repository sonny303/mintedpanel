import { createFileRoute } from "@tanstack/react-router";
import { RosterExportWorkspace } from "@/components/rosters/RosterExportWorkspace";
import {
  NoRosterOrganization,
  RosterError,
  RosterLoading,
  RosterPageFrame,
} from "@/components/rosters/shared";
import { useRosterMapping } from "@/hooks/useRosterEngine";
import { useActiveOrgId } from "@/lib/auth-store";

export const Route = createFileRoute("/reporting/rosters/export/$id")({
  component: RosterExportPage,
});

function RosterExportPage() {
  const { id } = Route.useParams();
  const orgId = useActiveOrgId();
  const mappingQ = useRosterMapping(id);

  return (
    <RosterPageFrame
      title="Export roster"
      description="Generate the selected CSV or XLSX from freshly validated source records and save the immutable snapshot."
    >
      {!orgId ? (
        <NoRosterOrganization />
      ) : mappingQ.isLoading ? (
        <RosterLoading />
      ) : mappingQ.isError ? (
        <RosterError error={mappingQ.error} retry={() => void mappingQ.refetch()} />
      ) : mappingQ.data ? (
        <RosterExportWorkspace key={`${orgId}:${id}`} detail={mappingQ.data} />
      ) : null}
    </RosterPageFrame>
  );
}
