// Portfolio (Oct 20 review, RC-05): Organization → Group → State with provider
// and active-location counts. Replaces the "In motion" / "Prospects" tiles and
// absorbs the retired Locations per Group report. Cross-org: RLS scopes every
// read to the caller's member orgs, so a customer login sees only its own.
// The empty and all-inactive states still render PortfolioContent, which owns
// the create-organization next action.
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PortfolioContent } from "@/components/portfolio/PortfolioContent";
import { ShareReportPanel } from "@/components/reporting/ShareReportPanel";
import { localTodayIso } from "@/hooks/useEnrollmentReadiness";
import { usePortfolio } from "@/hooks/usePortfolio";
import { usePortfolioFootprint } from "@/hooks/useReporting";
import { useAuthStore } from "@/lib/auth-store";
import { splitPortfolio } from "@/lib/portfolio";
import {
  buildPortfolioFootprint,
  portfolioTotals,
  sortStates,
  UNKNOWN_STATE,
  type FootprintSortKey,
  type GroupFootprint,
  type OrgFootprint,
  type SortDirection,
} from "@/lib/portfolioFootprint";
import { US_STATE_NAMES } from "@/lib/usStates";

const WORKSPACE_ENTRY = "/cases" as const;

interface SortState {
  key: FootprintSortKey;
  direction: SortDirection;
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

function stateLabel(code: string): string {
  if (code === UNKNOWN_STATE) return "State not recorded";
  const name = (US_STATE_NAMES as Record<string, string>)[code];
  return name ? `${code} · ${name}` : code;
}

function sortGroups(groups: GroupFootprint[], sort: SortState): GroupFootprint[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...groups].sort((a, b) => {
    const primary = sort.key === "state" ? a.name.localeCompare(b.name) : a[sort.key] - b[sort.key];
    return sign * primary || a.name.localeCompare(b.name);
  });
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[24px] font-semibold leading-none tracking-tight tabular-nums text-foreground">
          {value.toLocaleString()}
        </div>
        <div className="mt-1 text-[13px] text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  column: FootprintSortKey;
  sort: SortState;
  onSort: (column: FootprintSortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === column;
  const Icon = sort.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className={align === "right" ? "text-right" : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {label}
        {active ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
      </button>
    </TableHead>
  );
}

function OrgCard({
  org,
  sort,
  onSort,
}: {
  org: OrgFootprint;
  sort: SortState;
  onSort: (column: FootprintSortKey) => void;
}) {
  const navigate = useNavigate();
  const setActiveOrg = useAuthStore((s) => s.setActiveOrg);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const groups = useMemo(() => sortGroups(org.groups, sort), [org.groups, sort]);
  const toggle = (groupId: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">{org.name}</h2>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {plural(groups.filter((g) => g.name !== "No group").length, "group", "groups")} ·{" "}
              {plural(org.stateCount, "state", "states")} ·{" "}
              {plural(org.providers, "provider", "providers")} ·{" "}
              {plural(org.locations, "location", "locations")}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Open ${org.name}`}
            onClick={() => {
              setActiveOrg(org.orgId);
              navigate({ to: WORKSPACE_ENTRY });
            }}
          >
            Open workspace
          </Button>
        </div>

        {groups.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No groups recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[#E8E5E0]">
            <Table aria-label={`${org.name} groups and states`}>
              <TableHeader>
                <TableRow>
                  <SortHeader label="Group / State" column="state" sort={sort} onSort={onSort} />
                  <SortHeader
                    label="Providers"
                    column="providers"
                    sort={sort}
                    onSort={onSort}
                    align="right"
                  />
                  <SortHeader
                    label="Locations"
                    column="locations"
                    sort={sort}
                    onSort={onSort}
                    align="right"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => {
                  const open = !collapsed.has(group.groupId);
                  const Chevron = open ? ChevronDown : ChevronRight;
                  return [
                    <TableRow key={group.groupId} className="bg-muted/40">
                      <TableCell className="text-[13px] font-semibold">
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => toggle(group.groupId)}
                          className="inline-flex items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          <Chevron className="h-4 w-4 shrink-0" aria-hidden="true" />
                          {group.name}
                        </button>
                        <span className="ml-2 text-[12px] font-normal text-muted-foreground">
                          {plural(group.states.length, "state", "states")}
                          {group.isActive ? "" : " · inactive group"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-[13px] font-semibold tabular-nums">
                        {group.providers.toLocaleString()}
                        {group.noLocationProviders > 0 ? (
                          <span className="block text-[11.5px] font-normal text-muted-foreground">
                            {group.noLocationProviders.toLocaleString()} without a location
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right text-[13px] font-semibold tabular-nums">
                        {group.locations.toLocaleString()}
                      </TableCell>
                    </TableRow>,
                    ...(open
                      ? sortStates(group.states, sort.key, sort.direction).map((state) => (
                          <TableRow key={`${group.groupId}:${state.state}`}>
                            <TableCell className="pl-10 text-[13px]">
                              {stateLabel(state.state)}
                            </TableCell>
                            <TableCell className="text-right text-[13px] tabular-nums">
                              {state.providers.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right text-[13px] tabular-nums">
                              {state.locations.toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))
                      : []),
                  ];
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PortfolioReport() {
  const portfolio = usePortfolio();
  const footprint = usePortfolioFootprint();
  const [sort, setSort] = useState<SortState>({ key: "state", direction: "asc" });
  const buckets = useMemo(() => splitPortfolio(portfolio.data ?? []), [portfolio.data]);
  const orgs = useMemo(
    () =>
      footprint.data
        ? buildPortfolioFootprint(
            { orgs: [...buckets.inMotion, ...buckets.prospects], ...footprint.data },
            localTodayIso(),
          )
        : [],
    [buckets, footprint.data],
  );
  const totals = useMemo(() => portfolioTotals(orgs), [orgs]);
  const onSort = (key: FootprintSortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "state" ? "asc" : "desc" },
    );

  if (portfolio.isLoading || (!buckets.isEmpty && footprint.isLoading)) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading portfolio">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[74px] rounded-md" />
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-md" />
      </div>
    );
  }

  // No orgs, all-inactive, or a failed org read: PortfolioContent owns those
  // states (and the create-organization next action).
  if (portfolio.isError || buckets.isEmpty) {
    return (
      <div className="space-y-6">
        <PortfolioContent />
        <ShareReportPanel />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {footprint.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background px-4 py-3 text-[13px] text-foreground"
        >
          <span>Provider and location counts could not load.</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void footprint.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label="Organizations" value={totals.orgs} />
            <StatTile label="Groups" value={totals.groups} />
            <StatTile label="States" value={totals.states} />
            <StatTile label="Providers" value={totals.providers} />
            <StatTile label="Locations" value={totals.locations} />
          </div>
          <p className="text-[12px] text-muted-foreground">
            Providers count active and onboarding clinicians, not terminated or test records. A
            state's providers are those assigned to an active location there. Locations are active
            facilities.
          </p>
          {orgs.map((org) => (
            <OrgCard key={org.orgId} org={org} sort={sort} onSort={onSort} />
          ))}
        </>
      )}

      {buckets.inactive.length > 0 ? (
        <section className="space-y-2" aria-label="Inactive">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Inactive
          </h3>
          <div className="overflow-hidden rounded-md border border-[#E8E5E0]">
            {buckets.inactive.map((org, i) => (
              <div
                key={org.id}
                className={`px-4 py-2.5 text-[14px] text-foreground ${i > 0 ? "border-t border-[#E8E5E0]" : ""}`}
              >
                {org.name}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <ShareReportPanel />
    </div>
  );
}
