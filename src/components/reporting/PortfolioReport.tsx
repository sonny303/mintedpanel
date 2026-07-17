// Portfolio dashboard — the Reporting Center's first report (redesign E0.6,
// F0.6.2–F0.6.5 / TE-4). Composed from existing primitives + the reused,
// chrome-decoupled PortfolioContent (metrics + In motion/Prospects, unchanged).
// Adds the per-state breakdown, the complete org list (all incl inactive, name +
// state — inactive shown under its own group heading, never a per-org status
// label), and the operator share panel.
import { useMemo } from "react";
import { MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PortfolioContent } from "@/components/portfolio/PortfolioContent";
import { ShareReportPanel } from "@/components/reporting/ShareReportPanel";
import { usePortfolio } from "@/hooks/usePortfolio";
import { usePortfolioOrgStates } from "@/hooks/useReporting";
import { splitPortfolio, stateBreakdown } from "@/lib/portfolio";
import type { PortfolioOrg } from "@/types";

type OrgWithState = PortfolioOrg & { state: string | null };

function StateBreakdown({ orgs }: { orgs: OrgWithState[] }) {
  const rows = useMemo(() => stateBreakdown(orgs), [orgs]);
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-[15px] font-semibold text-foreground">By state</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
          {rows.map((r) => (
            <div key={r.state} className="rounded-md border border-[#E8E5E0] px-3 py-2">
              <div className="text-[20px] font-semibold tabular-nums text-foreground">
                {r.count}
              </div>
              <div className="text-[12px] text-muted-foreground">{r.state}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function OrgTable({ title, orgs }: { title: string; orgs: OrgWithState[] }) {
  if (orgs.length === 0) return null;
  return (
    <section className="space-y-2" aria-label={title}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="overflow-hidden rounded-md border border-[#E8E5E0]">
        {orgs.map((o, i) => (
          <div
            key={o.id}
            className={`flex items-center justify-between gap-3 px-4 py-2.5 ${
              i > 0 ? "border-t border-[#E8E5E0]" : ""
            }`}
          >
            <span className="truncate text-[14px] font-medium text-foreground">{o.name}</span>
            <span className="shrink-0 text-[13px] text-muted-foreground">{o.state ?? "—"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// F0.6.3 — the complete book of business: every org incl. inactive, name + state.
// Grouped by lifecycle so inactive is visually distinct via a group heading (the
// E0.0/E0.4 rule: never a per-org status label).
function AllOrganizations({ orgs }: { orgs: OrgWithState[] }) {
  const buckets = useMemo(() => splitPortfolio(orgs), [orgs]);
  const withState = (list: PortfolioOrg[]) => list as OrgWithState[];
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-foreground">All organizations</h2>
        <OrgTable title="In motion" orgs={withState(buckets.inMotion)} />
        <OrgTable title="Prospects" orgs={withState(buckets.prospects)} />
        <OrgTable title="Inactive" orgs={withState(buckets.inactive)} />
      </CardContent>
    </Card>
  );
}

export function PortfolioReport() {
  const { data: orgs } = usePortfolio();
  const { data: states } = usePortfolioOrgStates();

  const orgsWithState: OrgWithState[] = useMemo(
    () => (orgs ?? []).map((o) => ({ ...o, state: states?.[o.id] ?? null })),
    [orgs, states],
  );

  return (
    <div className="space-y-6">
      {/* Reused verbatim (F0.0.5 / TE-3): metrics + In motion/Prospects sections. */}
      <PortfolioContent />
      <StateBreakdown orgs={orgsWithState} />
      <AllOrganizations orgs={orgsWithState} />
      <ShareReportPanel />
    </div>
  );
}
