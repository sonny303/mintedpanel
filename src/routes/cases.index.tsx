// Payer-grouped work view at /cases (M3). Same data and engine as the M2
// Providers view, pivoted: one group per payer, provider rows inside. Chip
// counts flow through the shared workView helpers so the two pages can never
// disagree. Read-and-navigate only; the case detail page is untouched.
import React, { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { PageHeader } from "@/components/layout/PageHeader";
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
import { getActionState, worstActionState, daysSilent, type ActionState } from "@/lib/actionState";
import { CHIP_STATES, chipCounts, type ChipId } from "@/lib/workView";
import type { CredentialCase, Provider, StatusConfig, Task } from "@/types";

export const Route = createFileRoute("/cases/")({
  component: CasesWorkView,
});

const PRE_CRED_PAYER_NAME = "Pre-Credentialing Setup";
const DENSITY_STORAGE_KEY = "mp.cases.density";

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

interface CaseRow {
  case: CredentialCase;
  state: ActionState;
  statusLabel: string;
  statusColor: string;
  suffix: string | undefined;
  contractStatus: StatusConfig | null;
  provider: Provider | null;
  lastTouchLabel: string;
  days: number | null;
  nextTask: Task | null;
}

interface PayerGroup {
  payerId: string;
  payerName: string;
  isPreCred: boolean;
  rows: CaseRow[];
  openRows: CaseRow[];
  worst: ActionState;
  worstCount: number;
  inNetwork: number;
}

function loadDensity(): GroupedListDensity {
  if (typeof window === "undefined") return "comfortable";
  return window.localStorage.getItem(DENSITY_STORAGE_KEY) === "compact" ? "compact" : "comfortable";
}

const severityRank = (s: ActionState) =>
  ["needs_action", "blocked", "stalled", "awaiting_effective", "on_track", "complete"].indexOf(s);

function CasesWorkView() {
  const navigate = useNavigate();
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
      // storage unavailable — session-local toggle still works
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

  const groups: PayerGroup[] = useMemo(() => {
    const cases = casesQ.data ?? [];
    const statusById = new Map((statusConfigsQ.data ?? []).map((s) => [s.id, s]));
    const providerById = new Map((providersQ.data ?? []).map((p) => [p.id, p]));
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
    const rowsByPayer = new Map<string, CaseRow[]>();

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

      const row: CaseRow = {
        case: c,
        state,
        statusLabel: status?.label ?? "No status",
        statusColor: status?.color ?? "var(--mp-neutral)",
        suffix,
        contractStatus,
        provider: providerById.get(c.providerId) ?? null,
        lastTouchLabel: touchDays === null ? "—" : touchDays === 0 ? "today" : `${touchDays}d ago`,
        days,
        nextTask: openTasks[0] ?? null,
      };
      const list = rowsByPayer.get(c.payerId) ?? [];
      list.push(row);
      rowsByPayer.set(c.payerId, list);
    }

    const built: PayerGroup[] = [];
    for (const [payerId, rows] of rowsByPayer) {
      const payerName = payerById.get(payerId)?.name ?? "Unknown payer";
      const isPreCred = payerName === PRE_CRED_PAYER_NAME;
      rows.sort(
        (a, b) => severityRank(a.state) - severityRank(b.state) || (b.days ?? -1) - (a.days ?? -1),
      );
      const openRows = rows.filter((r) => r.state !== "complete");
      built.push({
        payerId,
        payerName: isPreCred ? "Pre-credentialing" : payerName,
        isPreCred,
        rows,
        openRows,
        worst: worstActionState(openRows.map((r) => r.state)) ?? "complete",
        worstCount: 0,
        inNetwork: rows.filter((r) => r.statusLabel === "In-Network").length,
      });
    }
    for (const g of built) {
      g.worstCount = g.openRows.filter((r) => r.state === g.worst).length;
    }
    built.sort((a, b) => {
      // Pre-cred group pinned last, always.
      if (a.isPreCred !== b.isPreCred) return a.isPreCred ? 1 : -1;
      return (
        severityRank(a.worst) - severityRank(b.worst) || a.payerName.localeCompare(b.payerName)
      );
    });
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

  function caseRow(row: CaseRow) {
    const openCase = () => navigate({ to: "/cases/$id", params: { id: row.case.id } });
    const providerName = row.provider
      ? `${row.provider.firstName} ${row.provider.lastName}`
      : "Unknown provider";
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
    const nameCell = (
      <span className="min-w-0 flex items-baseline gap-1.5">
        <span className="truncate text-[var(--mp-text-base)] font-medium text-[color:var(--mp-ink)]">
          {providerName}
        </span>
        {row.provider?.credentials ? (
          <span className="text-[var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
            {row.provider.credentials}
          </span>
        ) : null}
        <span className="text-[var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
          · {row.case.state}
        </span>
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
          <div className="flex-1 min-w-0">{nameCell}</div>
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
            {nameCell}
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

  function groupHeader(g: PayerGroup) {
    const badgeLabel =
      g.worst === "on_track" || g.worst === "complete"
        ? BADGE_NOUN[g.worst]
        : `${g.worstCount} ${BADGE_NOUN[g.worst]}`;
    return (
      <div className="flex flex-1 min-w-0 items-center gap-3">
        <span className="truncate text-[var(--mp-text-base)] font-semibold text-[color:var(--mp-ink)]">
          {g.payerName}
        </span>
        <span className="tabular-nums text-[var(--mp-text-xs)] text-[color:var(--mp-ink-faint)] whitespace-nowrap">
          {g.rows.length} {g.rows.length === 1 ? "case" : "cases"}
        </span>
        {!g.isPreCred ? (
          <span className="hidden sm:flex items-center gap-2 ml-auto">
            <span className="w-20">
              <ProgressBar value={g.inNetwork} max={g.rows.length} />
            </span>
            <span className="tabular-nums whitespace-nowrap text-[var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
              {g.inNetwork} of {g.rows.length} in-network
            </span>
          </span>
        ) : (
          <span className="ml-auto" />
        )}
        <ActionBadge tone={BADGE_TONE[g.worst]} text={badgeLabel} />
      </div>
    );
  }

  const totalPayers = groups.length;

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Cases"
        description={`${totalPayers} payers · ${counts.all} open cases`}
        actions={
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
        }
      />

      <div className="mb-4">
        <SummaryChips chips={chips} selected={chip} onSelect={(id) => setChip(id as ChipId)} />
      </div>

      {failed ? (
        <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-6 text-center text-[var(--mp-text-sm)] text-[color:var(--mp-danger)]">
          Couldn't load cases. Refresh to retry.
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
              ? "Open cases from a provider's detail page to start tracking."
              : "No open cases match this filter right now."
          }
        />
      ) : (
        <GroupedList
          density={density}
          groups={visibleGroups.map((g) => ({
            id: g.payerId,
            title: g.payerName,
            count: g.rows.length,
            headerContent: groupHeader(g),
            rows: g.rows.map((row) => caseRow(row)),
          }))}
        />
      )}
    </div>
  );
}
