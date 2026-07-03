// Provider-grouped work view at /providers (M2). Every case renders inline
// under its provider row; the action engine (src/lib/actionState.ts) drives
// chip counts, row states, and worst-state rollups. Read-and-navigate only:
// name → legacy provider detail, row/CTA → case detail. No writes.
import React, { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { SummaryChips } from "@/components/triage/SummaryChips";
import { GroupedList, type GroupedListDensity } from "@/components/triage/GroupedList";
import { StatusPill } from "@/components/triage/StatusPill";
import { ActionBadge, type ActionBadgeTone } from "@/components/triage/ActionBadge";
import { ProgressBar } from "@/components/triage/ProgressBar";
import { RowCta } from "@/components/triage/RowCta";
import { useProviders } from "@/hooks/useProviders";
import { useCases } from "@/hooks/useCases";
import { useTasks } from "@/hooks/useTasks";
import { useContracts } from "@/hooks/useContracts";
import { useLastTouchDates } from "@/hooks/useTouches";
import { usePayers, useStatusConfigs } from "@/hooks/useAdmin";
import { useCanWrite } from "@/lib/permissions";
import { getActionState, worstActionState, daysSilent, type ActionState } from "@/lib/actionState";
import { CHIP_STATES, chipCounts, type ChipId } from "@/lib/workView";
import type { CredentialCase, Provider, StatusConfig, Task } from "@/types";

export const Route = createFileRoute("/providers/")({
  component: ProvidersWorkView,
});

const PRE_CRED_PAYER_NAME = "Pre-Credentialing Setup";
const DENSITY_STORAGE_KEY = "mp.providers.density";

// Placeholder tone mapping pending the design sheet's badge treatments.
const BADGE_TONE: Record<ActionState, ActionBadgeTone> = {
  needs_action: "warn",
  blocked: "danger",
  stalled: "danger",
  awaiting_effective: "pending",
  on_track: "ok",
  complete: "neutral",
};

const BADGE_NOUN: Record<ActionState, string> = {
  needs_action: "needs action",
  blocked: "blocked",
  stalled: "stalled",
  awaiting_effective: "awaiting effective",
  on_track: "On track",
  complete: "Complete",
};

interface WorkRow {
  case: CredentialCase;
  state: ActionState;
  statusLabel: string;
  statusColor: string;
  suffix: string | undefined;
  contractStatus: StatusConfig | null;
  payerName: string;
  isPreCred: boolean;
  lastTouchLabel: string;
  days: number | null;
  nextTask: Task | null;
}

interface WorkGroup {
  provider: Provider;
  rows: WorkRow[];
  openRows: WorkRow[];
  worst: ActionState;
  worstCount: number;
  inNetwork: number;
  denominator: number;
  oldestDays: number | null;
}

function initialsOf(p: Provider): string {
  return `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase();
}

function loadDensity(): GroupedListDensity {
  if (typeof window === "undefined") return "comfortable";
  return window.localStorage.getItem(DENSITY_STORAGE_KEY) === "compact" ? "compact" : "comfortable";
}

const severityRank = (s: ActionState) =>
  ["needs_action", "blocked", "stalled", "awaiting_effective", "on_track", "complete"].indexOf(s);

function ProvidersWorkView() {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const providersQ = useProviders();
  const casesQ = useCases();
  const tasksQ = useTasks();
  const contractsQ = useContracts();
  const payersQ = usePayers();
  const statusConfigsQ = useStatusConfigs();
  const lastTouchQ = useLastTouchDates();

  const [chip, setChip] = useState<ChipId>("all");
  const [density, setDensityState] = useState<GroupedListDensity>(loadDensity);

  function setDensity(next: GroupedListDensity) {
    setDensityState(next);
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
    } catch {
      // storage unavailable (private mode) — session-local toggle still works
    }
  }

  const loading =
    providersQ.isLoading ||
    casesQ.isLoading ||
    tasksQ.isLoading ||
    contractsQ.isLoading ||
    payersQ.isLoading ||
    statusConfigsQ.isLoading;

  const failed = providersQ.isError || casesQ.isError || payersQ.isError || statusConfigsQ.isError;

  const groups: WorkGroup[] = useMemo(() => {
    const providers = providersQ.data ?? [];
    const cases = casesQ.data ?? [];
    const statusById = new Map((statusConfigsQ.data ?? []).map((s) => [s.id, s]));
    const payerById = new Map((payersQ.data ?? []).map((p) => [p.id, p]));
    const lastTouchByCase = lastTouchQ.data;

    const openTasksByCase = new Map<string, Task[]>();
    for (const t of tasksQ.data ?? []) {
      if (!t.caseId || t.status === "completed") continue;
      const list = openTasksByCase.get(t.caseId) ?? [];
      list.push(t);
      openTasksByCase.set(t.caseId, list);
    }
    for (const list of openTasksByCase.values()) {
      list.sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"),
      );
    }

    const contractByKey = new Map(
      (contractsQ.data ?? []).map((c) => [`${c.groupId}|${c.payerId}|${c.state}`, c]),
    );

    const now = new Date();
    const rowsByProvider = new Map<string, WorkRow[]>();

    for (const c of cases) {
      const status = c.credentialingStatusId
        ? (statusById.get(c.credentialingStatusId) ?? null)
        : null;
      const openTasks = openTasksByCase.get(c.id) ?? [];
      const lastTouchDate = lastTouchByCase?.get(c.id) ?? null;

      const state = getActionState({
        statusLabel: status?.label ?? null,
        actionBucket: status?.actionBucket ?? null,
        openTaskDueDates: openTasks.map((t) => t.dueDate),
        lastTouchDate,
        createdAt: c.createdAt,
        confirmedEffectiveDate: c.confirmedEffectiveDate,
        expectedEffectiveDate: c.expectedEffectiveDate,
        now,
      });

      const effective = c.confirmedEffectiveDate ?? c.expectedEffectiveDate;
      const suffix =
        state === "stalled"
          ? `${daysSilent({ lastTouchDate, createdAt: c.createdAt }, now)}d silent`
          : state === "awaiting_effective" && effective
            ? `eff ${format(parseISO(effective), "MMM d")}`
            : undefined;

      const contract = contractByKey.get(`${c.groupId}|${c.payerId}|${c.state}`);
      const contractStatus = contract?.contractingStatusId
        ? (statusById.get(contract.contractingStatusId) ?? null)
        : null;

      const touchDays = lastTouchDate
        ? differenceInCalendarDays(now, parseISO(lastTouchDate))
        : null;
      const days =
        state === "complete"
          ? null
          : differenceInCalendarDays(now, parseISO(c.submittedDate ?? c.createdAt));

      const row: WorkRow = {
        case: c,
        state,
        statusLabel: status?.label ?? "No status",
        statusColor: status?.color ?? "var(--mp-neutral)",
        suffix,
        contractStatus,
        payerName: payerById.get(c.payerId)?.name ?? "Unknown payer",
        isPreCred: payerById.get(c.payerId)?.name === PRE_CRED_PAYER_NAME,
        lastTouchLabel: touchDays === null ? "—" : touchDays === 0 ? "today" : `${touchDays}d ago`,
        days,
        nextTask: openTasks[0] ?? null,
      };
      const list = rowsByProvider.get(c.providerId) ?? [];
      list.push(row);
      rowsByProvider.set(c.providerId, list);
    }

    const built: WorkGroup[] = [];
    for (const provider of providers) {
      const rows = rowsByProvider.get(provider.id);
      if (!rows || rows.length === 0) continue;
      rows.sort((a, b) => {
        if (a.isPreCred !== b.isPreCred) return a.isPreCred ? 1 : -1;
        return severityRank(a.state) - severityRank(b.state) || (b.days ?? -1) - (a.days ?? -1);
      });
      const openRows = rows.filter((r) => r.state !== "complete");
      const nonPreCred = rows.filter((r) => !r.isPreCred);
      const worst = worstActionState(openRows.map((r) => r.state)) ?? "complete";
      built.push({
        provider,
        rows,
        openRows,
        worst,
        worstCount: openRows.filter((r) => r.state === worst).length,
        inNetwork: nonPreCred.filter((r) => r.statusLabel === "In-Network").length,
        denominator: nonPreCred.length,
        oldestDays: openRows.reduce<number | null>(
          (max, r) => (r.days !== null && (max === null || r.days > max) ? r.days : max),
          null,
        ),
      });
    }
    built.sort(
      (a, b) =>
        severityRank(a.worst) - severityRank(b.worst) ||
        a.provider.lastName.localeCompare(b.provider.lastName),
    );
    return built;
  }, [
    providersQ.data,
    casesQ.data,
    tasksQ.data,
    contractsQ.data,
    payersQ.data,
    statusConfigsQ.data,
    lastTouchQ.data,
  ]);

  const openRowsAll = useMemo(() => groups.flatMap((g) => g.openRows), [groups]);
  const counts = chipCounts(openRowsAll.map((r) => r.state));
  const chips = [
    { id: "all", label: "All open cases", n: counts.all },
    { id: "needs", label: "Needs your action", n: counts.needs, warn: true },
    { id: "inprog", label: "In progress", n: counts.inprog },
    { id: "awaiting", label: "Awaiting effective date", n: counts.awaiting },
  ];

  const visibleGroups = useMemo(() => {
    if (chip === "all") return groups;
    const states = CHIP_STATES[chip];
    return groups
      .map((g) => ({ ...g, rows: g.rows.filter((r) => states.includes(r.state)) }))
      .filter((g) => g.rows.length > 0);
  }, [groups, chip]);

  const totalProviders = groups.length;
  const totalOpen = openRowsAll.length;

  function caseRow(row: WorkRow) {
    const openCase = () => navigate({ to: "/cases/$id", params: { id: row.case.id } });
    const pills = (
      <>
        <StatusPill label={row.statusLabel} color={row.statusColor} suffix={row.suffix} />
        {row.contractStatus ? (
          <span title="Group contract">
            <StatusPill label={row.contractStatus.label} color={row.contractStatus.color} />
          </span>
        ) : null}
      </>
    );
    const daysCell =
      row.days === null ? null : (
        <span
          className={`tabular-nums text-[var(--mp-text-sm)] ${
            row.state === "stalled"
              ? "font-semibold text-[color:var(--mp-danger)]"
              : "text-[color:var(--mp-ink-secondary)]"
          }`}
        >
          {row.days}d
        </span>
      );
    const payerCell = row.isPreCred ? (
      <span className="flex items-center gap-2 min-w-0">
        <span className="inline-flex items-center rounded-[var(--mp-radius-pill)] bg-mp-muted px-2 py-0.5 text-[var(--mp-text-2xs)] font-semibold uppercase tracking-wide text-[color:var(--mp-ink-secondary)]">
          Pre-credentialing
        </span>
        <span className="truncate text-[var(--mp-text-sm)] text-[color:var(--mp-ink-secondary)]">
          {row.payerName}
        </span>
      </span>
    ) : (
      <span className="truncate text-[var(--mp-text-base)] font-medium text-[color:var(--mp-ink)]">
        {row.payerName}
      </span>
    );

    return (
      <div
        className="cursor-pointer"
        onClick={openCase}
        role="link"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") openCase();
        }}
      >
        {/* Desktop row */}
        <div className="hidden md:flex items-center gap-3">
          <div className="flex-1 min-w-0">{payerCell}</div>
          <div className="flex items-center gap-2">{pills}</div>
          <span className="w-16 text-right text-[var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
            {row.lastTouchLabel}
          </span>
          <span className="w-10 text-right">{daysCell}</span>
          <span className="w-32 flex justify-end" onClick={(e) => e.stopPropagation()}>
            {row.nextTask ? <RowCta label={row.nextTask.title} onClick={openCase} /> : null}
          </span>
        </div>
        {/* Mobile card */}
        <div className="md:hidden space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            {payerCell}
            {daysCell}
          </div>
          <div className="flex flex-wrap items-center gap-2">{pills}</div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
              Last touch {row.lastTouchLabel}
            </span>
            <span onClick={(e) => e.stopPropagation()}>
              {row.nextTask ? <RowCta label={row.nextTask.title} onClick={openCase} /> : null}
            </span>
          </div>
        </div>
      </div>
    );
  }

  function groupHeader(g: WorkGroup) {
    const badgeLabel =
      g.worst === "on_track" || g.worst === "complete"
        ? BADGE_NOUN[g.worst]
        : `${g.worstCount} ${BADGE_NOUN[g.worst]}`;
    const openProvider = () => navigate({ to: "/providers/$id", params: { id: g.provider.id } });
    return (
      <div className="flex flex-1 min-w-0 items-center gap-3">
        <span className="w-7 h-7 rounded-full bg-mp-primary-tint flex items-center justify-center text-[var(--mp-text-2xs)] font-bold text-[color:var(--mp-primary)] flex-shrink-0">
          {initialsOf(g.provider)}
        </span>
        <span className="min-w-0 flex items-baseline gap-1.5">
          <span
            role="link"
            tabIndex={0}
            className="truncate text-[var(--mp-text-base)] font-semibold text-[color:var(--mp-ink)] hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              openProvider();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                openProvider();
              }
            }}
          >
            {g.provider.firstName} {g.provider.lastName}
          </span>
          {g.provider.credentials ? (
            <span className="text-[var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
              {g.provider.credentials}
            </span>
          ) : null}
        </span>
        <span className="hidden lg:inline text-[var(--mp-text-xs)] text-[color:var(--mp-ink-faint)] whitespace-nowrap">
          {g.rows.length} payer {g.rows.length === 1 ? "case" : "cases"}
        </span>
        <span className="hidden sm:flex items-center gap-2 ml-auto">
          <span className="w-20">
            <ProgressBar value={g.inNetwork} max={g.denominator} />
          </span>
          <span className="tabular-nums whitespace-nowrap text-[var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
            {g.inNetwork} of {g.denominator} in-network
          </span>
        </span>
        <ActionBadge tone={BADGE_TONE[g.worst]} text={badgeLabel} />
        {g.oldestDays !== null ? (
          <span className="hidden sm:inline tabular-nums text-[var(--mp-text-xs)] text-[color:var(--mp-ink-faint)] whitespace-nowrap">
            {g.oldestDays}d oldest
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Providers"
        description={`${totalProviders} providers · ${totalOpen} open cases`}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-[var(--mp-radius-sm)] border border-mp-border bg-mp-card p-0.5">
              {(["comfortable", "compact"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={density === d}
                  onClick={() => setDensity(d)}
                  className={`rounded-[4px] px-2.5 py-1 text-[var(--mp-text-xs)] font-medium capitalize transition-colors ${
                    density === d
                      ? "bg-mp-primary text-white"
                      : "text-[color:var(--mp-ink-secondary)] hover:bg-mp-muted"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            {canWrite ? (
              <Button onClick={() => navigate({ to: "/providers/new" })} className="h-9 gap-2">
                <Plus className="w-4 h-4" />
                New Provider
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mb-4">
        <SummaryChips chips={chips} selected={chip} onSelect={(id) => setChip(id as ChipId)} />
      </div>

      {failed ? (
        <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-6 text-center text-[var(--mp-text-sm)] text-[color:var(--mp-danger)]">
          Couldn't load the work view. Refresh to retry.
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-[var(--mp-radius-lg)] bg-mp-muted animate-pulse" />
          ))}
        </div>
      ) : visibleGroups.length === 0 ? (
        <EmptyState
          message={chip === "all" ? "No cases yet" : "Nothing in this bucket"}
          description={
            chip === "all"
              ? "Create a provider and open cases to start tracking."
              : "No open cases match this filter right now."
          }
        />
      ) : (
        <GroupedList
          density={density}
          groups={visibleGroups.map((g) => ({
            id: g.provider.id,
            title: `${g.provider.firstName} ${g.provider.lastName}`,
            count: g.rows.length,
            headerContent: groupHeader(g),
            rows: g.rows.map((row) => caseRow(row)),
          }))}
        />
      )}
    </div>
  );
}
