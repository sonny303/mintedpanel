// Read-only facilities summary on Account Detail (E1.2 F1.2.3): name, group,
// city/state per active facility — no edit affordances; editing stays in the
// onboarding wizard (E1.0 single-front-door rule). Fed by the SHARED
// facilities + provider-groups reads so wizard mutations refresh this card.
import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFacilities, useProviderGroups } from "@/hooks/useLookups";

export function FacilitySummaryCard() {
  const facilitiesQ = useFacilities();
  const groupsQ = useProviderGroups();
  const active = (facilitiesQ.data ?? []).filter((f) => f.isActive);
  const groupById = new Map((groupsQ.data ?? []).map((g) => [g.id, g.name]));

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h2 className="text-[15px] font-semibold text-foreground">Facilities</h2>
        {facilitiesQ.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 rounded-md" />
            <Skeleton className="h-10 rounded-md" />
          </div>
        ) : facilitiesQ.isError ? (
          <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#B91C1C]">
            We couldn't load facilities.
          </div>
        ) : active.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No facilities yet — add locations in{" "}
            <Link to="/onboarding/wizard" className="font-medium text-primary underline">
              onboarding
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-2">
            {active.map((f) => (
              <li key={f.id} className="rounded-md border border-[#E8E5E0] px-3 py-2">
                <div className="text-[13px] font-medium text-foreground">{f.name}</div>
                <div className="text-[12px] text-muted-foreground">
                  {[
                    f.groupId ? groupById.get(f.groupId) : null,
                    [f.city, f.state].filter(Boolean).join(", "),
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
