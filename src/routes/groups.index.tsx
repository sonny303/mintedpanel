// E6.2 F6.2.1 — the Groups front door. Multi-group orgs get the A→Z group
// list; single-group orgs auto-land on their only group's hub with zero extra
// clicks (a render-time redirect). Zero groups points at the wizard's Provider
// Group section, the one place groups are created.
import { Link, Navigate, createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFacilities, useProviderGroups } from "@/hooks/useLookups";
import { formatTin } from "@/lib/providerGroup";

export const Route = createFileRoute("/groups/")({
  component: GroupsIndexPage,
});

function GroupsIndexPage() {
  const groupsQ = useProviderGroups();
  const facilitiesQ = useFacilities();

  if (groupsQ.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Groups" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const activeGroups = (groupsQ.data ?? [])
    .filter((g) => g.isActive)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Single-group orgs land directly on the hub (F6.2.1 AC — zero extra clicks).
  if (activeGroups.length === 1) {
    return <Navigate to="/groups/$groupId" params={{ groupId: activeGroups[0].id }} replace />;
  }

  const facilityCount = (groupId: string) =>
    (facilitiesQ.data ?? []).filter((f) => f.isActive && f.groupId === groupId).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Groups"
        description="Provider groups — the entity your contracts, facilities, and payer network hang off."
      />
      {activeGroups.length === 0 ? (
        <Card className="border-[#E8E5E0]">
          <CardContent className="space-y-2 p-6">
            <p className="text-[14px] font-medium text-foreground">No provider groups yet</p>
            <p className="text-[13px] text-muted-foreground">
              Add the group's legal entity in the setup wizard — facilities and payers attach to
              it.
            </p>
            <Link
              to="/onboarding/wizard"
              search={{ section: "provider_group" }}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-[#1B4D3E] underline"
            >
              Add a provider group
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {activeGroups.map((g) => (
            <li key={g.id}>
              <Link
                to="/groups/$groupId"
                params={{ groupId: g.id }}
                className="group block rounded-md border border-[#E8E5E0] bg-white p-4 transition-colors hover:border-[#1B4D3E]"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[14px] font-semibold text-foreground">{g.name}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <div className="mt-1 text-[12.5px] text-muted-foreground">
                  {[
                    g.tin ? `TIN ${formatTin(g.tin)}` : null,
                    (g.states ?? []).length > 0 ? `Operating in ${(g.states ?? []).join(", ")}` : null,
                    `${facilityCount(g.id)} ${facilityCount(g.id) === 1 ? "facility" : "facilities"}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
