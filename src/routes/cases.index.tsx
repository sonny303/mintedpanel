// Payer-grouped work view at /cases (M3). Same data and engine as the M2
// Providers view, pivoted: one group per payer, provider rows inside. Card
// counts and list filters flow through the shared workView helpers so the
// two pages can never disagree. Read-and-navigate only; the case detail page
// is untouched.
import React, { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { FilterCards } from "@/components/triage/FilterCards";
import { GroupedList } from "@/components/triage/GroupedList";
import { CaseTable, type CaseTableRow } from "@/components/triage/CaseTable";
import { ActionBadge } from "@/components/triage/ActionBadge";
import { ProgressBar } from "@/components/triage/ProgressBar";
import { useProviders } from "@/hooks/useProviders";
import { useCases } from "@/hooks/useCases";
import { useTasks } from "@/hooks/useTasks";
import { useContracts } from "@/hooks/useContracts";
import { useLastTouchDates } from "@/hooks/useTouches";
import { usePayers, useStatusConfigs } from "@/hooks/useAdmin";
import {
  getActionState,
  worstActionState,
  daysSilent,
  ACTION_STATE_SEVERITY,
  type ActionState,
} from "@/lib/actionState";
import {
  ACTION_BADGE_TONE,
  badgeLabel,
  chipCounts,
  isAlertState,
  matchesChip,
  type ChipId,
} from "@/lib/workView";
import { IN_NETWORK_LABEL, PRE_CRED_PAYER_NAME } from "@/lib/statusLabels";
import type { CredentialCase, Provider, StatusConfig, Task } from "@/types";

export const Route = createFileRoute("/cases/")({
  component: CasesWorkView,
});

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

const severityRank = (s: ActionState) => ACTION_STATE_SEVERITY.indexOf(s);

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
            ? `eff ${fmtDate(effective)}`
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
        payerName: isPreCred ? "Pre-Credentialing" : payerName,
        isPreCred,
        rows,
        openRows,
        worst: worstActionState(openRows.map((r) => r.state)) ?? "complete",
        worstCount: 0,
        inNetwork: rows.filter((r) => r.statusLabel === IN_NETWORK_LABEL).length,
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
  const cards = [
    { id: "all", label: "All open cases", n: counts.all },
    { id: "needs", label: "Needs your action", n: counts.needs },
    { id: "inprog", label: "In progress", n: counts.inprog },
    { id: "awaiting", label: "Awaiting effective date", n: counts.awaiting },
  ];

  // Same predicate as the card counts (matchesChip), so a card that says N
  // always leaves exactly N case rows on screen.
  const visibleGroups = useMemo(
    () =>
      groups
        .map((g) => ({ group: g, visibleRows: g.rows.filter((r) => matchesChip(chip, r.state)) }))
        .filter(({ visibleRows }) => visibleRows.length > 0),
    [groups, chip],
  );

  function tableRow(row: CaseRow): CaseTableRow {
    const openCase = () => navigate({ to: "/cases/$id", params: { id: row.case.id } });
    const providerName = row.provider
      ? `${row.provider.firstName} ${row.provider.lastName}`
      : "Unknown provider";
    const lead = (
      <span className="text-[length:var(--mp-text-sm)] font-medium text-[color:var(--mp-ink)]">
        {providerName}
        {row.provider?.credentials ? (
          <span className="font-normal text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
            {" "}
            {row.provider.credentials}
          </span>
        ) : null}
        <span className="font-normal text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
          {" "}
          · {row.case.state}
        </span>
      </span>
    );
    return {
      id: row.case.id,
      lead,
      status: { label: row.statusLabel, color: row.statusColor, suffix: row.suffix },
      contract: row.contractStatus
        ? { label: row.contractStatus.label, color: row.contractStatus.color }
        : null,
      lastTouch: row.lastTouchLabel,
      days: row.days,
      daysStrong: isAlertState(row.state) || row.state === "stalled",
      action: row.nextTask ? { label: row.nextTask.title, onClick: openCase } : null,
      alert: isAlertState(row.state),
      onOpen: openCase,
    };
  }

  function groupHeader(g: PayerGroup) {
    return (
      <div className="flex flex-1 min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="truncate text-[length:var(--mp-text-sm)] font-semibold text-[color:var(--mp-ink)]">
          {g.payerName}
        </span>
        <span className="tabular-nums text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)] whitespace-nowrap">
          {g.rows.length} {g.rows.length === 1 ? "case" : "cases"}
        </span>
        {!g.isPreCred ? (
          <span className="hidden sm:flex items-center gap-2 ml-auto">
            <span className="w-40">
              <ProgressBar value={g.inNetwork} max={g.rows.length} />
            </span>
            <span className="tabular-nums whitespace-nowrap text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
              {g.inNetwork} of {g.rows.length} in-network
            </span>
          </span>
        ) : (
          <span className="ml-auto" />
        )}
        {g.worst !== "on_track" && g.worst !== "complete" ? (
          <ActionBadge tone={ACTION_BADGE_TONE[g.worst]} text={badgeLabel(g.worst, g.worstCount)} />
        ) : null}
      </div>
    );
  }

  const totalPayers = groups.length;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title="Cases" description={`${totalPayers} payers · ${counts.all} open cases`} />

      <div className="mb-6">
        <FilterCards cards={cards} selected={chip} onSelect={(id) => setChip(id as ChipId)} />
      </div>

      {failed ? (
        <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-6 text-center text-[length:var(--mp-text-sm)] text-[color:var(--mp-danger)]">
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
          groups={visibleGroups.map(({ group, visibleRows }) => ({
            id: group.payerId,
            header: groupHeader(group),
            children: <CaseTable leadLabel="Provider" rows={visibleRows.map(tableRow)} />,
          }))}
        />
      )}
    </div>
  );
}
