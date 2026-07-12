// Read-only roster summary on Account Detail (E1.3 F1.3.4): count, names,
// license states — no edit affordances; editing stays in the onboarding
// wizard (E1.0 single-front-door rule). Fed by the SHARED provider list
// projection (PHI-narrowed) + the org-wide license summary read.
import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProviders } from "@/hooks/useProviders";
import { useOrgStateLicenses } from "@/hooks/useLookups";

export function RosterSummaryCard() {
  const providersQ = useProviders();
  const licensesQ = useOrgStateLicenses();
  const roster = (providersQ.data ?? []).filter((p) => p.status !== "terminated");

  const statesOf = (providerId: string): string =>
    [
      ...new Set(
        (licensesQ.data ?? []).filter((l) => l.providerId === providerId).map((l) => l.state),
      ),
    ].join(", ");

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h2 className="text-[15px] font-semibold text-foreground">
          Providers{roster.length > 0 ? ` (${roster.length})` : ""}
        </h2>
        {providersQ.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 rounded-md" />
            <Skeleton className="h-10 rounded-md" />
          </div>
        ) : providersQ.isError ? (
          <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#B91C1C]">
            We couldn't load the roster.
          </div>
        ) : roster.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No providers yet — build the roster in{" "}
            <Link to="/onboarding/wizard" className="font-medium text-primary underline">
              onboarding
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-2">
            {roster.map((p) => (
              <li key={p.id} className="rounded-md border border-[#E8E5E0] px-3 py-2">
                <div className="text-[13px] font-medium text-foreground">
                  {p.firstName} {p.lastName}
                  {p.credentials ? (
                    <span className="text-muted-foreground">, {p.credentials}</span>
                  ) : null}
                </div>
                <div className="text-[12px] text-muted-foreground">
                  {[p.npi ? `NPI ${p.npi}` : null, statesOf(p.id) || null]
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
