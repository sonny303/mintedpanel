// Provider Onboarding funnel (Oct 20 review, RC-06). Four stages from today's
// data; click a stage to see who is in it and what holds them there. State
// filter only, per the Oct 19 Luna prep (no date range). Read-only.
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOnboardingFunnel } from "@/hooks/useOnboardingFunnel";
import {
  ONBOARDING_FUNNEL_STAGES,
  onboardingFunnelStageCounts,
  onboardingFunnelStates,
  type OnboardingFunnelStage,
} from "@/lib/onboardingFunnel";

const PAGE_SIZE = 100;

function percent(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 100);
}

export function OnboardingFunnelReport() {
  const { orgId, rows, isLoading, isError, refetch } = useOnboardingFunnel();
  const [state, setState] = useState("");
  const [stage, setStage] = useState<OnboardingFunnelStage>("profile_incomplete");
  const [shown, setShown] = useState({ key: "", count: PAGE_SIZE });

  const states = useMemo(() => onboardingFunnelStates(rows ?? []), [rows]);
  const filtered = useMemo(
    () => (rows ?? []).filter((row) => !state || row.states.includes(state)),
    [rows, state],
  );
  const counts = useMemo(() => onboardingFunnelStageCounts(filtered), [filtered]);
  const inStage = useMemo(() => filtered.filter((row) => row.stage === stage), [filtered, stage]);
  const viewKey = `${state}:${stage}`;
  const visibleCount = shown.key === viewKey ? shown.count : PAGE_SIZE;
  const stageInfo = ONBOARDING_FUNNEL_STAGES.find((entry) => entry.key === stage);

  if (!orgId) {
    return <EmptyState message="Select an organization to see provider onboarding." />;
  }
  if (isLoading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading provider onboarding">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ONBOARDING_FUNNEL_STAGES.map((entry) => (
            <Skeleton key={entry.key} className="h-[112px] rounded-md" />
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (isError || !rows) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background px-4 py-3 text-[13px] text-foreground"
      >
        <span>Provider onboarding could not load.</span>
        <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (rows.length === 0) {
    return <EmptyState message="No providers yet. Add providers to see onboarding progress." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-[12.5px] text-muted-foreground">
          {filtered.length.toLocaleString()} providers
          {state ? ` in ${state}` : ""}. Terminated and test records are not counted.
        </p>
        <div className="w-48 space-y-1.5">
          <span className="text-[12px] font-medium text-foreground">State</span>
          <Select value={state || "all"} onValueChange={(v) => setState(v === "all" ? "" : v)}>
            <SelectTrigger aria-label="State" className="h-9 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              {states.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Onboarding stages">
        {ONBOARDING_FUNNEL_STAGES.map((entry, i) => {
          const count = counts[entry.key];
          const share = percent(count, filtered.length);
          const selected = entry.key === stage;
          return (
            <li key={entry.key}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => setStage(entry.key)}
                className={`flex h-full w-full flex-col gap-2 rounded-md border bg-card p-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                  selected ? "border-[var(--mp-primary)]" : "border-[#E8E5E0]"
                }`}
              >
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Step {i + 1}
                </span>
                <span className="text-[14px] font-semibold text-foreground">{entry.title}</span>
                <span className="flex items-baseline gap-2">
                  <span className="text-[24px] font-semibold leading-none tabular-nums text-foreground">
                    {count.toLocaleString()}
                  </span>
                  <span className="text-[12px] text-muted-foreground">{share}%</span>
                </span>
                <span className="h-1.5 w-full rounded-full bg-muted" aria-hidden="true">
                  <span
                    className="block h-1.5 rounded-full bg-[var(--mp-primary)]"
                    style={{ width: `${share}%` }}
                  />
                </span>
                <span className="text-[12px] text-muted-foreground">{entry.description}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <section className="space-y-2" aria-label={`${stageInfo?.title ?? ""} providers`}>
        <h2 className="text-[14px] font-semibold text-foreground">
          {stageInfo?.title} · {inStage.length.toLocaleString()}
        </h2>
        {inStage.length === 0 ? (
          <EmptyState message="No providers are at this stage." />
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>NPI</TableHead>
                    <TableHead>States</TableHead>
                    {stage === "profile_incomplete" || stage === "awaiting_verification" ? (
                      <TableHead>What's needed</TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inStage.slice(0, visibleCount).map((row) => (
                    <TableRow key={row.providerId}>
                      <TableCell className="text-[13px] font-medium">{row.name}</TableCell>
                      <TableCell className="text-[12.5px] tabular-nums">
                        {row.npi ?? "Not recorded"}
                      </TableCell>
                      <TableCell className="text-[12.5px]">
                        {row.states.length > 0 ? row.states.join(", ") : "None recorded"}
                      </TableCell>
                      {stage === "profile_incomplete" || stage === "awaiting_verification" ? (
                        <TableCell className="text-[12.5px]">{row.gaps.join(" · ")}</TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {inStage.length > visibleCount ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShown({ key: viewKey, count: visibleCount + PAGE_SIZE })}
              >
                Show {Math.min(PAGE_SIZE, inStage.length - visibleCount).toLocaleString()} more
              </Button>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
