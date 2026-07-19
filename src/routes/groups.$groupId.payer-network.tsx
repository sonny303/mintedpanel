// E6.2 F6.2.3/F6.2.4 — the group's Payer Network area: the fulfillment board
// plus the eligibility-filtered attach (dialog + CSV). The layout route
// renders the breadcrumb.
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { PayerNetworkBoardContent } from "@/components/groups/PayerNetworkBoardContent";
import { useProviderGroups } from "@/hooks/useLookups";

export const Route = createFileRoute("/groups/$groupId/payer-network")({
  component: GroupPayerNetworkPage,
});

function GroupPayerNetworkPage() {
  const { groupId } = Route.useParams();
  const groupsQ = useProviderGroups();
  const group = (groupsQ.data ?? []).find((g) => g.id === groupId);
  if (!group) return null; // the layout renders the not-found state

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payer Network"
        description={`${group.name}'s promise-vs-reality board — every payer target, its fulfillment, and the candidates awaiting generation.`}
      />
      <PayerNetworkBoardContent group={group} />
    </div>
  );
}
