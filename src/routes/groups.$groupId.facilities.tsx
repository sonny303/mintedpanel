// E6.2 F6.2.2 — the group's Facilities area (list treatment + CRUD + CSV
// import). The layout route renders the breadcrumb.
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { GroupFacilitiesContent } from "@/components/groups/GroupFacilitiesContent";
import { useProviderGroups } from "@/hooks/useLookups";

export const Route = createFileRoute("/groups/$groupId/facilities")({
  component: GroupFacilitiesPage,
});

function GroupFacilitiesPage() {
  const { groupId } = Route.useParams();
  const groupsQ = useProviderGroups();
  const group = (groupsQ.data ?? []).find((g) => g.id === groupId);
  if (!group) return null; // the layout renders the not-found state

  return (
    <div className="space-y-6">
      <PageHeader
        title="Facilities"
        description={`${group.name}'s practice locations — state-grouped, with go-live dates and provider coverage.`}
      />
      <GroupFacilitiesContent group={group} />
    </div>
  );
}
