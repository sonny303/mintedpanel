import { createFileRoute } from "@tanstack/react-router";
import { RosterValidationWorkspace } from "@/components/rosters/RosterValidationWorkspace";
import {
  NoRosterOrganization,
  RosterError,
  RosterLoading,
  RosterPageFrame,
} from "@/components/rosters/shared";
import { useRosterMapping } from "@/hooks/useRosterEngine";
import { useActiveOrgId } from "@/lib/auth-store";

export const Route = createFileRoute("/reporting/rosters/validation/$id")({
  component: RosterValidationPage,
});

function RosterValidationPage() {
  const { id } = Route.useParams();
  const orgId = useActiveOrgId();
  const mappingQ = useRosterMapping(id);

  return (
    <RosterPageFrame
      title="Validate roster rows"
      description="Review current source data, resolve permitted exceptions with a reason, and confirm the export gate."
    >
      {!orgId ? (
        <NoRosterOrganization />
      ) : mappingQ.isLoading ? (
        <RosterLoading />
      ) : mappingQ.isError ? (
        <RosterError error={mappingQ.error} retry={() => void mappingQ.refetch()} />
      ) : mappingQ.data ? (
        <RosterValidationWorkspace key={`${orgId}:${id}`} detail={mappingQ.data} />
      ) : null}
    </RosterPageFrame>
  );
}
