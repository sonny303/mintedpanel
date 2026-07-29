// E6.2 F6.2.1 — the group hub: group facts (editable, admin, audited) plus the
// two area doors (Facilities, Payer Network) with live counts. The layout
// route above renders the breadcrumb.
//
// 2026-07-29: the hub also carries the group's malpractice/insurance coverage
// and its documents, so a group edited here has the same capabilities it has
// in the onboarding wizard — same form, same panels, no gap.
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Building2, Network } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GroupFactsCard } from "@/components/groups/GroupFactsCard";
import { InsurancePanel } from "@/components/groups/InsurancePanel";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { useFacilities, useProviderGroups } from "@/hooks/useLookups";
import { usePayerNetworkTargets } from "@/hooks/usePayerNetworkTargets";
import { useCanWrite } from "@/lib/permissions";

export const Route = createFileRoute("/groups/$groupId/")({
  component: GroupHubPage,
});

function GroupHubPage() {
  const { groupId } = Route.useParams();
  const canWrite = useCanWrite();
  const groupsQ = useProviderGroups();
  const facilitiesQ = useFacilities();
  const targetsQ = usePayerNetworkTargets();
  const group = (groupsQ.data ?? []).find((g) => g.id === groupId);
  if (!group) return null; // the layout renders the not-found state

  const facilityCount = (facilitiesQ.data ?? []).filter(
    (f) => f.isActive && f.groupId === groupId,
  ).length;
  const targetedPayerCount = new Set(
    (targetsQ.data ?? [])
      .filter((t) => t.groupId === groupId && t.status === "active")
      .map((t) => t.payerId),
  ).size;

  const areas = [
    {
      to: "/groups/$groupId/facilities" as const,
      icon: Building2,
      label: "Facilities",
      detail: `${facilityCount} active ${facilityCount === 1 ? "location" : "locations"} — practice locations, go-live dates, CSV import.`,
    },
    {
      to: "/groups/$groupId/payer-network" as const,
      icon: Network,
      label: "Payer Network",
      detail: `${targetedPayerCount} ${targetedPayerCount === 1 ? "payer" : "payers"} targeted — the contract's promise-vs-reality board.`,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={group.name}
        description="The group's facts, locations, and payer network."
      />
      <GroupFactsCard group={group} />
      <div className="grid gap-3 sm:grid-cols-2">
        {areas.map((a) => (
          <Link key={a.label} to={a.to} params={{ groupId }} className="group">
            <Card className="h-full border-[#E8E5E0] transition-colors group-hover:border-[#1B4D3E]">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
                    <a.icon className="h-4 w-4 text-[#1B4D3E]" aria-hidden />
                    {a.label}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="mt-1 text-[12.5px] text-muted-foreground">{a.detail}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <InsurancePanel groupId={groupId} canEdit={canWrite} />
      <TooltipProvider delayDuration={200}>
        <DocumentsPanel ownerType="group" ownerId={groupId} ownerName={group.name} />
      </TooltipProvider>
    </div>
  );
}
