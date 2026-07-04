// Home / Today (M5): the login landing page. A cross-entity action queue —
// only what needs Sowmya, ordered by urgency. Engine states come from
// src/lib/actionState.ts, never recomputed ad hoc.
import { useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/triage/StatusPill";
import { ProgressBar } from "@/components/triage/ProgressBar";
import { RowCta } from "@/components/triage/RowCta";
import { useProviders } from "@/hooks/useProviders";
import { useCases } from "@/hooks/useCases";
import { useTasks } from "@/hooks/useTasks";
import { useContracts } from "@/hooks/useContracts";
import { useLastTouchDates, useFollowUpsDue } from "@/hooks/useTouches";
import { usePayers, useStatusConfigs } from "@/hooks/useAdmin";
import { useLaunchLocations } from "@/hooks/useLaunches";
import { getActionState, type ActionState } from "@/lib/actionState";
import { launchReadiness } from "@/lib/launchReadiness";
import type { CredentialCase } from "@/types";

export const Route = createFileRoute("/home")({
  component: HomePage,
});

const PRE_CRED_PAYER_NAME = "Pre-Credentialing Setup";
const SECTION_CAP = 10;
const LAUNCH_RISK_WINDOW_DAYS = 30;
const AT_RISK_STATUSES = new Set(["Pending Fulfillment", "Ready for Launch"]);

interface QueueCase {
  case: CredentialCase;
  state: ActionState;
  providerName: string;
  payerName: string;
  statusLabel: string;
  statusColor: string;
  nextTaskTitle: string | null;
  followUpDate: string | null;
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
  // Any errored query must block the "you're caught up" verdict — a failed
  // fetch is not the same as an empty queue. Silence here would tell Sowmya
  // she has no work when we simply couldn't load it.
  const failed =
    casesQ.isError ||
    providersQ.isError ||
    statusConfigsQ.isError ||
    tasksQ.isError ||
    contractsQ.isError ||
    payersQ.isError ||
    lastTouchQ.isError ||
    followUpsQ.isError ||
    locationsQ.isError;
  const retry = () => {
    void casesQ.refetch();
    void providersQ.refetch();
    void statusConfigsQ.refetch();
    void tasksQ.refetch();
    void contractsQ.refetch();
    void payersQ.refetch();
    void lastTouchQ.refetch();
    void followUpsQ.refetch();
    void locationsQ.refetch();
  };
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
      return {
        case: c,
        state: getActionState({
          statusLabel: status?.label ?? null,
          actionBucket: status?.actionBucket ?? null,
          openTaskDueDates: openTasks.map((t) => t.dueDate),
          lastTouchDate: lastTouchQ.data?.get(c.id) ?? null,
          createdAt: c.createdAt,
          confirmedEffectiveDate: c.confirmedEffectiveDate,
          expectedEffectiveDate: c.expectedEffectiveDate,
          isPreCred: payerById.get(c.payerId)?.name === PRE_CRED_PAYER_NAME,
          now,
        }),
        providerName: provider ? `${provider.firstName} ${provider.lastName}` : "Unknown",
        payerName: payerById.get(c.payerId)?.name ?? "Unknown payer",
        statusLabel: status?.label ?? "No status",
        statusColor: status?.color ?? "var(--mp-neutral)",
        nextTaskTitle: openTasks[0]?.title ?? null,
        followUpDate: followUpsQ.data?.get(c.id)?.nextFollowUpDate ?? null,
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

  const needsAction = rows.filter((r) => r.state === "needs_action" || r.state === "blocked");

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
    !loading &&
    !failed &&
    needsAction.length === 0 &&
    followUps.length === 0 &&
    launchesAtRisk.length === 0;

  function caseRow(r: QueueCase, cta: string) {
    const open = () => navigate({ to: "/cases/$id", params: { id: r.case.id } });
    const overdueDays = r.followUpDate
      ? differenceInCalendarDays(now, parseISO(r.followUpDate))
      : null;
    return (
      <li
        key={r.case.id}
        role="link"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter") open();
        }}
        className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 px-4 py-3 cursor-pointer hover:bg-mp-muted/50 transition-colors"
      >
        <span className="flex-1 min-w-0 truncate text-[length:var(--mp-text-sm)] font-medium text-[color:var(--mp-ink)]">
          {r.providerName}
          <span className="text-[color:var(--mp-ink-faint)] font-normal"> · {r.payerName}</span>
        </span>
        {cta === "Log touch" && overdueDays !== null ? (
          <span
            className={`text-[length:var(--mp-text-xs)] ${
              overdueDays > 0
                ? "font-semibold text-[color:var(--mp-danger)]"
                : "text-[color:var(--mp-ink-secondary)]"
            }`}
          >
            Follow-up due {overdueDays === 0 ? "today" : `${overdueDays}d ago`}
          </span>
        ) : (
          <StatusPill label={r.statusLabel} color={r.statusColor} />
        )}
        <span onClick={(e) => e.stopPropagation()}>
          <RowCta
            label={cta === "Log touch" ? "Log touch" : (r.nextTaskTitle ?? "Open case")}
            onClick={open}
          />
        </span>
      </li>
    );
  }

  function section(title: string, count: number, viewAllTo: string, children: React.ReactNode) {
    if (count === 0) {
      return (
        <div className="px-4 py-2.5 text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)] border border-mp-border rounded-[var(--mp-radius-lg)] bg-mp-card">
          {title} — clear
        </div>
      );
    }
    return (
      <section className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-mp-border bg-mp-muted/60 px-4 py-2.5">
          <span className="text-[length:var(--mp-text-sm)] font-semibold text-[color:var(--mp-ink)]">
            {title}
            <span className="ml-2 tabular-nums text-[length:var(--mp-text-xs)] font-medium text-[color:var(--mp-ink-faint)]">
              {count}
            </span>
          </span>
          {count > SECTION_CAP ? (
            <Link
              to={viewAllTo}
              className="text-[length:var(--mp-text-xs)] font-medium text-[color:var(--mp-primary)] hover:underline"
            >
              View all
            </Link>
          ) : null}
        </div>
        {children}
      </section>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Home" description={format(now, "EEEE, MMMM d")} />
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-[var(--mp-radius-lg)] bg-mp-muted animate-pulse" />
          ))}
        </div>
      ) : failed ? (
        <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card px-6 py-12 text-center">
          <div className="text-[length:var(--mp-text-base)] font-semibold text-[color:var(--mp-ink)]">
            Couldn't load your day
          </div>
          <p className="mt-1 text-[length:var(--mp-text-sm)] text-[color:var(--mp-ink-secondary)]">
            Something went wrong reaching Minted Panel. Your work isn't lost — retry to load it.
          </p>
          <Button onClick={retry} className="mt-4 h-9">
            Retry
          </Button>
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
          {section(
            "Needs your action",
            needsAction.length,
            "/cases",
            <ul className="divide-y divide-[color:var(--mp-border)]">
              {needsAction.slice(0, SECTION_CAP).map((r) => caseRow(r, "next-task"))}
            </ul>,
          )}
          {section(
            "Follow-ups due",
            followUps.length,
            "/cases",
            <ul className="divide-y divide-[color:var(--mp-border)]">
              {followUps.slice(0, SECTION_CAP).map((r) => caseRow(r, "Log touch"))}
            </ul>,
          )}
          {section(
            "Launches at risk",
            launchesAtRisk.length,
            "/launches",
            <ul className="divide-y divide-[color:var(--mp-border)]">
              {launchesAtRisk.slice(0, SECTION_CAP).map(({ launch, readiness }) => (
                <li
                  key={launch.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate({ to: "/launches/$id", params: { id: launch.id } })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      navigate({ to: "/launches/$id", params: { id: launch.id } });
                  }}
                  className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 px-4 py-3 cursor-pointer hover:bg-mp-muted/50 transition-colors"
                >
                  <span className="flex-1 min-w-0 truncate text-[length:var(--mp-text-sm)] font-medium text-[color:var(--mp-ink)]">
                    {launch.name}
                  </span>
                  <span className="text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
                    Starts{" "}
                    {launch.effectiveDate
                      ? format(parseISO(launch.effectiveDate), "MMM d, yyyy")
                      : "—"}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="w-16">
                      <ProgressBar
                        value={readiness.inNetwork}
                        max={Math.max(readiness.denominator, 1)}
                      />
                    </span>
                    <span className="tabular-nums text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)] whitespace-nowrap">
                      {readiness.inNetwork} of {readiness.denominator} in-network
                    </span>
                  </span>
                </li>
              ))}
            </ul>,
          )}
        </div>
      )}
    </div>
  );
}
