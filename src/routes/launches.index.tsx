// Launches pipeline at /launches (M4). Read view: fixed-palette status pills,
// derived readiness (one definition: src/lib/launchReadiness.ts), NEW STATE
// tags, and a recently-launched strip (live, started within 60 days).
import { useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/triage/StatusPill";
import { ProgressBar } from "@/components/triage/ProgressBar";
import { useLaunches } from "@/hooks/useLaunches";
import { useProviders } from "@/hooks/useProviders";
import { useCases } from "@/hooks/useCases";
import { useContracts } from "@/hooks/useContracts";
import { usePayers, useStatusConfigs } from "@/hooks/useAdmin";
import { LAUNCH_STATUS_META } from "@/lib/launchDisplay";
import { launchReadiness, isNewState, type LaunchReadiness } from "@/lib/launchReadiness";
import type { Launch, Provider } from "@/types";

export const Route = createFileRoute("/launches/")({
  component: LaunchesPage,
});

const PRE_CRED_PAYER_NAME = "Pre-Credentialing Setup";
const RECENT_DAYS = 60;

interface LaunchRow {
  launch: Launch;
  director: string | null;
  readiness: LaunchReadiness;
  newState: boolean;
  providerCount: number;
}

function LaunchesPage() {
  const navigate = useNavigate();
  const launchesQ = useLaunches();
  const providersQ = useProviders();
  const casesQ = useCases();
  const contractsQ = useContracts();
  const payersQ = usePayers();
  const statusConfigsQ = useStatusConfigs();

  const loading = launchesQ.isLoading || providersQ.isLoading || casesQ.isLoading;
  const failed = launchesQ.isError;

  const rows: LaunchRow[] = useMemo(() => {
    const launches = launchesQ.data ?? [];
    const providers = providersQ.data ?? [];
    const cases = casesQ.data ?? [];
    const statusById = new Map((statusConfigsQ.data ?? []).map((s) => [s.id, s]));
    const payerById = new Map((payersQ.data ?? []).map((p) => [p.id, p]));
    const providerById = new Map(providers.map((p) => [p.id, p]));
    const activePayerIds = (payersQ.data ?? [])
      .filter((p) => p.isActive && p.name !== PRE_CRED_PAYER_NAME)
      .map((p) => p.id);

    return launches.map((launch) => {
      const linked = providers.filter((p) => p.launchId === launch.id);
      const linkedIds = new Set(linked.map((p) => p.id));
      const launchCases = cases
        .filter((c) => linkedIds.has(c.providerId))
        .map((c) => ({
          statusLabel: c.credentialingStatusId
            ? (statusById.get(c.credentialingStatusId)?.label ?? null)
            : null,
          isPreCred: payerById.get(c.payerId)?.name === PRE_CRED_PAYER_NAME,
        }));
      const contracted = new Set(
        (contractsQ.data ?? [])
          .filter(
            (c) => c.groupId === launch.groupId && c.state === launch.state && c.payerId != null,
          )
          .map((c) => c.payerId as string),
      );
      const director: Provider | null = launch.clinicDirectorProviderId
        ? (providerById.get(launch.clinicDirectorProviderId) ?? null)
        : null;
      return {
        launch,
        director: director
          ? `${director.firstName} ${director.lastName}`
          : (launch.clinicDirectorName ?? null),
        readiness: launchReadiness({
          cases: launchCases,
          activePayerIds,
          contractedPayerIdsInState: contracted,
        }),
        newState: isNewState(contracted),
        providerCount: linked.length,
      };
    });
  }, [
    launchesQ.data,
    providersQ.data,
    casesQ.data,
    contractsQ.data,
    payersQ.data,
    statusConfigsQ.data,
  ]);

  const now = new Date();
  const recentlyLaunched = rows.filter(
    (r) =>
      r.launch.status === "live" &&
      r.launch.confirmedStartDate != null &&
      differenceInCalendarDays(now, parseISO(r.launch.confirmedStartDate)) <= RECENT_DAYS &&
      differenceInCalendarDays(now, parseISO(r.launch.confirmedStartDate)) >= 0,
  );
  const recentIds = new Set(recentlyLaunched.map((r) => r.launch.id));
  const pipeline = rows.filter((r) => !recentIds.has(r.launch.id));

  function timing(l: Launch): string {
    if (l.confirmedStartDate) return `Starts ${format(parseISO(l.confirmedStartDate), "MMM d")}`;
    if (l.targetMonth) return `Target ${format(parseISO(l.targetMonth), "MMM yyyy")}`;
    return "No date";
  }

  function launchRow(r: LaunchRow) {
    const meta = LAUNCH_STATUS_META[r.launch.status];
    return (
      <div
        key={r.launch.id}
        role="link"
        tabIndex={0}
        onClick={() => navigate({ to: "/launches/$id", params: { id: r.launch.id } })}
        onKeyDown={(e) => {
          if (e.key === "Enter") navigate({ to: "/launches/$id", params: { id: r.launch.id } });
        }}
        className="cursor-pointer px-4 py-3 hover:bg-mp-muted/50 transition-colors"
      >
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3">
          <div className="flex items-center gap-2 md:w-56 md:flex-shrink-0">
            <StatusPill label={meta.label} color={meta.color} />
            {r.newState ? <StatusPill label="New state" color="var(--mp-warn)" /> : null}
          </div>
          <div className="flex-1 min-w-0">
            <div className="truncate text-[var(--mp-text-sm)] font-medium text-[color:var(--mp-ink)]">
              {r.launch.name}
            </div>
            <div className="truncate text-[var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
              {[r.launch.gymName, [r.launch.city, r.launch.state].filter(Boolean).join(", ")]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <span className="text-[var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)] md:w-28">
            {timing(r.launch)}
          </span>
          <span className="truncate text-[var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)] md:w-32">
            {r.director ?? "—"}
          </span>
          <span className="flex items-center gap-2 md:w-44">
            {r.readiness.denominator > 0 ? (
              <>
                <span className="w-16">
                  <ProgressBar value={r.readiness.inNetwork} max={r.readiness.denominator} />
                </span>
                <span className="tabular-nums text-[var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)] whitespace-nowrap">
                  {r.readiness.inNetwork} of {r.readiness.denominator} in-network
                </span>
              </>
            ) : (
              <span className="text-[var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
                No cases yet
              </span>
            )}
            {r.readiness.contractGap ? (
              <span title="An active payer lacks a group contract in this state">
                <AlertTriangle className="w-3.5 h-3.5 text-[color:var(--mp-warn)]" />
              </span>
            ) : null}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Launches"
        description={`${rows.length} launches · ${pipeline.length} in pipeline`}
      />

      {failed ? (
        <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-6 text-center text-[var(--mp-text-sm)] text-[color:var(--mp-danger)]">
          Couldn't load launches. Refresh to retry.
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-[var(--mp-radius-lg)] bg-mp-muted animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState message="No launches yet" description="Imported launches appear here." />
      ) : (
        <div className="space-y-5">
          {recentlyLaunched.length > 0 ? (
            <section>
              <h2 className="mb-2 text-[var(--mp-text-xs)] font-semibold uppercase tracking-wider text-[color:var(--mp-ink-faint)]">
                Recently launched
              </h2>
              <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card divide-y divide-[color:var(--mp-border)]">
                {recentlyLaunched.map(launchRow)}
              </div>
            </section>
          ) : null}
          <section>
            <h2 className="mb-2 text-[var(--mp-text-xs)] font-semibold uppercase tracking-wider text-[color:var(--mp-ink-faint)]">
              Pipeline
            </h2>
            <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card divide-y divide-[color:var(--mp-border)]">
              {pipeline.map(launchRow)}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
