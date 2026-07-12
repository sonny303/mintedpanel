// Read-only provider-group summary on Account Detail (E1.1 F1.1.3).
// Consistent with Account Detail's read-only intake role (E0.8): name, TIN,
// states per active group, NO edit affordances — editing happens only in the
// onboarding wizard (E1.0 single-front-door rule). Fed by the SHARED
// useProviderGroups() read so group mutations refresh this card too.
import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProviderGroups } from "@/hooks/useLookups";
import { formatTin } from "@/lib/providerGroup";

export function GroupSummaryCard() {
  const groupsQ = useProviderGroups();
  const activeGroups = (groupsQ.data ?? []).filter((g) => g.isActive);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h2 className="text-[15px] font-semibold text-foreground">Provider groups</h2>
        {groupsQ.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 rounded-md" />
            <Skeleton className="h-10 rounded-md" />
          </div>
        ) : groupsQ.isError ? (
          <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#B91C1C]">
            We couldn't load provider groups.
          </div>
        ) : activeGroups.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No provider group yet — add one in{" "}
            <Link to="/onboarding/wizard" className="font-medium text-primary underline">
              onboarding
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-2">
            {activeGroups.map((g) => (
              <li key={g.id} className="rounded-md border border-[#E8E5E0] px-3 py-2">
                <div className="text-[13px] font-medium text-foreground">{g.name}</div>
                <div className="text-[12px] text-muted-foreground">
                  {[
                    g.tin ? `TIN ${formatTin(g.tin)}` : null,
                    g.states?.length ? g.states.join(", ") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
