import { createFileRoute } from "@tanstack/react-router";
import { MappingWorkspace } from "@/components/rosters/MappingWorkspace";
import {
  NoRosterOrganization,
  RosterError,
  RosterLoading,
  RosterPageFrame,
} from "@/components/rosters/shared";
import { useRosterMapping } from "@/hooks/useRosterEngine";
import { useActiveOrgId } from "@/lib/auth-store";

export const Route = createFileRoute("/reporting/rosters/mapping/$id")({
  component: RosterMappingPage,
});

function RosterMappingPage() {
  const { id } = Route.useParams();
  const orgId = useActiveOrgId();
  const mappingQ = useRosterMapping(id);

  return (
    <RosterPageFrame
      title="Map roster fields"
      description="Choose the source records and grain, connect each payer column, and inspect the generated rows."
    >
      {!orgId ? (
        <NoRosterOrganization />
      ) : mappingQ.isLoading ? (
        <RosterLoading />
      ) : mappingQ.isError ? (
        <RosterError error={mappingQ.error} retry={() => void mappingQ.refetch()} />
      ) : mappingQ.data ? (
        <MappingWorkspace
          key={`${orgId}:${id}:${mappingQ.data.mapping.revision}`}
          detail={mappingQ.data}
        />
      ) : null}
    </RosterPageFrame>
  );
}
