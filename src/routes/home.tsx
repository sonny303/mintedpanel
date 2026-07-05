// Home / Today (M5, polished in the Home lane pass): the login landing page.
// A cross-entity action queue — only what needs Sowmya, ordered by urgency.
// Engine states come from src/lib/actionState.ts, never recomputed ad hoc;
// section shells and rows live in src/components/home/.
import { useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { HomeSection, HomeViewAllLink } from "@/components/home/HomeSection";
import { HomeCaseRow } from "@/components/home/HomeCaseRow";
import { HomeLaunchRow } from "@/components/home/HomeLaunchRow";
import { useProviders } from "@/hooks/useProviders";
import { useCases } from "@/hooks/useCases";
import { useTasks } from "@/hooks/useTasks";
import { useContracts } from "@/hooks/useContracts";
import { useLastTouchDates, useFollowUpsDue } from "@/hooks/useTouches";
import { usePayers, useStatusConfigs } from "@/hooks/useAdmin";
import { useLaunchLocations } from "@/hooks/useLaunches";
import { getActionState, ACTION_STATE_SEVERITY, type ActionState } from "@/lib/actionState";
import { launchReadiness } from "@/lib/launchReadiness";
import { fmtDate } from "@/lib/format";
import type { CredentialCase } from "@/types";

export const Route = createFileRoute("/home")({
  component: HomePage,
});

const PRE_CRED_PAYER_NAME = "Pre-Credentialing Setup";
const SECTION_CAP = 10;
const LAUNCH_RISK_WINDOW_DAYS = 30;
const AT_RISK_STATUSES = new Set(["Pending Fulfillment", "Ready for Launch"]);

const severityRank = (s: ActionState) => ACTION_STATE_SEVERITY.indexOf(s);

interface QueueCase {
  case: CredentialCase;
  state: ActionState;
  providerName: string;
  payerName: string;
  statusLabel: string;
  statusColor: string;
  nextTaskTitle: string | null;
  followUpDate: string | null;
  /** The work views' Days figure: age since submitted (else created). */
  days: number | null;
}

function HomePage() {
  const navigate = useNavigate();
  const providersQ = useProviders();
  const casesQ = useCases();
  const tasksQ = useTasks();
  const contractsQ = useContracts();
  const payersQ = usePayers();
  const statusConfigsQ = useStatusConfigs();
  const lastTouchQ = useLastTouchDates();
  const followUpsQ = useFollowUpsDue();
  const locationsQ = useLaunchLocations();

  const loading = casesQ.isLoading || providersQ.isLoading || statusConfigsQ.isLoading;
  const failed = providersQ.isError || casesQ.isError || payersQ.isError || statusConfigsQ.isError;
  const now = new Date();

  const rows: QueueCase[] = useMemo(() => {
    const statusById = new Map((statusConfigsQ.data ?? []).map((s) => [s.id, s]));
    const providerById = new Map((providersQ.data ?? []).map((p) => [p.id, p]));
    const payerById = new Map((payersQ.data ?? []).map((p) => [p.id, p]));
    const openTasksByCase = new Map<string, { title: string; dueDate: string | null }[]>();
    for (const t of tasksQ.data ?? []) {
      if (!t.caseId || t.status === "completed") continue;
      const list = openTasksByCase.get(t.caseId) ?? [];
      list.push({ title: t.title, dueDate: t.dueDate });
      openTasksByCase.set(t.caseId, list);
    }
    return (casesQ.data ?? []).map((c) => {
      const status = c.credentialingStatusId
        ? (statusById.get(c.credentialingStatusId) ?? null)
        : null;
      const openTasks = openTasksByCase.get(c.id) ?? [];
      const provider = providerById.get(c.providerId);
      const state = getActionState({
        statusLabel: status?.label ?? null,
        actionBucket: status?.actionBucket ?? null,
        openTaskDueDates: openTasks.map((t) => t.dueDate),
        lastTouchDate: lastTouchQ.data?.get(c.id) ?? null,
        createdAt: c.createdAt,
        confirmedEffectiveDate: c.confirmedEffectiveDate,
        expectedEffectiveDate: c.expectedEffectiveDate,
        now,
      });
      return {
        case: c,
        state,
        providerName: provider ? `${provider.firstName} ${provider.lastName}` : "Unknown",
        payerName: payerById.get(c.payerId)?.name ?? "Unknown payer",
        statusLabel: status?.label ?? "No status",
        statusColor: status?.color ?? "var(--mp-neutral)",
        nextTaskTitle: openTasks[0]?.title ?? null,
        followUpDate: followUpsQ.data?.get(c.id)?.nextFollowUpDate ?? null,
        days:
          state === "complete"
            ? null
            : differenceInCalendarDays(now, parseISO(c.submittedDate ?? c.createdAt)),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is derived each render by design
  }, [
    casesQ.data,
    providersQ.data,
    payersQ.data,
    statusConfigsQ.data,
    tasksQ.data,
    lastTouchQ.data,
    followUpsQ.data,
  ]);

  // Worst state first, oldest first within a state — the work views' order.
  const needsAction = rows
    .filter((r) => r.state === "needs_action" || r.state === "blocked")
    .sort(
      (a, b) => severityRank(a.state) - severityRank(b.state) || (b.days ?? -1) - (a.days ?? -1),
    );

  const followUps = rows
    .filter(
      (r) =>
        r.state !== "complete" &&
        r.followUpDate != null &&
        differenceInCalendarDays(now, parseISO(r.followUpDate)) >= 0,
    )
    .sort((a, b) => (a.followUpDate ?? "").localeCompare(b.followUpDate ?? ""));

  const launchesAtRisk = useMemo(() => {
    const statusById = new Map((statusConfigsQ.data ?? []).map((s) => [s.id, s]));
    const payerById = new Map((payersQ.data ?? []).map((p) => [p.id, p]));
    const activePayerIds = (payersQ.data ?? [])
      .filter((p) => p.isActive && p.name !== PRE_CRED_PAYER_NAME)
      .map((p) => p.id);
    return (locationsQ.data ?? [])
      .filter((l) => {
        const label = l.statusId ? statusById.get(l.statusId)?.label : null;
        if (!label || !AT_RISK_STATUSES.has(label) || !l.effectiveDate) return false;
        const daysOut = differenceInCalendarDays(parseISO(l.effectiveDate), now);
        return daysOut >= 0 && daysOut <= LAUNCH_RISK_WINDOW_DAYS;
      })
      .map((l) => {
        const readiness = launchReadiness({
          cases: (casesQ.data ?? [])
            .filter((c) => c.facilityId === l.id)
            .map((c) => ({
              statusLabel: c.credentialingStatusId
                ? (statusById.get(c.credentialingStatusId)?.label ?? null)
                : null,
              isPreCred: payerById.get(c.payerId)?.name === PRE_CRED_PAYER_NAME,
            })),
          activePayerIds,
          contractedPayerIdsInState: new Set(
            (contractsQ.data ?? [])
              .filter((c) => c.groupId === l.groupId && c.state === l.state && c.payerId)
              .map((c) => c.payerId as string),
          ),
        });
        return { launch: l, readiness };
      })
      .filter(({ readiness }) => readiness.share === null || readiness.share < 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is derived each render by design
  }, [locationsQ.data, casesQ.data, contractsQ.data, payersQ.data, statusConfigsQ.data]);

  const allClear =
    !loading && needsAction.length === 0 && followUps.length === 0 && launchesAtRisk.length === 0;

  const openCase = (id: string) => () => navigate({ to: "/cases/$id", params: { id } });

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Home" description={format(now, "EEEE, MMMM d")} />
      {failed ? (
        <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-6 text-center text-[length:var(--mp-text-sm)] text-[color:var(--mp-danger)]">
          Couldn't load the queue. Refresh to retry.
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-[var(--mp-radius-lg)] bg-mp-muted animate-pulse" />
          ))}
        </div>
      ) : allClear ? (
        <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card px-6 py-16 text-center">
          <div className="text-[length:var(--mp-text-2xl)] font-semibold text-[color:var(--mp-primary)]">
            You're caught up.
          </div>
          <p className="mt-2 text-[length:var(--mp-text-sm)] text-[color:var(--mp-ink-secondary)]">
            Nothing needs your action right now.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <HomeSection
            title="Needs your action"
            count={needsAction.length}
            viewAll={<HomeViewAllLink to="/providers" search={{ chip: "needs" }} />}
          >
            <ul className="divide-y divide-[color:var(--mp-border)]">
              {needsAction.slice(0, SECTION_CAP).map((r) => (
                <HomeCaseRow
                  key={r.case.id}
                  variant="action"
                  providerName={r.providerName}
                  payerName={r.payerName}
                  status={{ label: r.statusLabel, color: r.statusColor }}
                  days={r.days}
                  ctaLabel={r.nextTaskTitle ?? "Open case"}
                  onOpen={openCase(r.case.id)}
                />
              ))}
            </ul>
          </HomeSection>
          <HomeSection
            title="Follow-ups due"
            count={followUps.length}
            viewAll={<HomeViewAllLink to="/cases" />}
          >
            <ul className="divide-y divide-[color:var(--mp-border)]">
              {followUps.slice(0, SECTION_CAP).map((r) => (
                <HomeCaseRow
                  key={r.case.id}
                  variant="follow-up"
                  providerName={r.providerName}
                  payerName={r.payerName}
                  status={{ label: r.statusLabel, color: r.statusColor }}
                  days={r.days}
                  overdueDays={
                    r.followUpDate ? differenceInCalendarDays(now, parseISO(r.followUpDate)) : null
                  }
                  ctaLabel="Log touch"
                  onOpen={openCase(r.case.id)}
                />
              ))}
            </ul>
          </HomeSection>
          <HomeSection
            title="Launches at risk"
            count={launchesAtRisk.length}
            viewAll={<HomeViewAllLink to="/launches" />}
          >
            <ul className="divide-y divide-[color:var(--mp-border)]">
              {launchesAtRisk.slice(0, SECTION_CAP).map(({ launch, readiness }) => (
                <HomeLaunchRow
                  key={launch.id}
                  name={launch.name}
                  startsLabel={fmtDate(launch.effectiveDate)}
                  inNetwork={readiness.inNetwork}
                  denominator={readiness.denominator}
                  onOpen={() => navigate({ to: "/launches/$id", params: { id: launch.id } })}
                />
              ))}
            </ul>
          </HomeSection>
        </div>
      )}
    </div>
  );
}
