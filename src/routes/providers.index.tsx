// Provider-grouped work view at /providers (M2). Every case renders inline
// under its provider row; the action engine (src/lib/actionState.ts) drives
// card counts, row states, and worst-state rollups. Read-and-navigate only:
// name → legacy provider detail, row/CTA → case detail. No writes.
import React, { useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { fmtDate } from "@/lib/format";
import { Download, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/StatusPill";
import { SummaryChips } from "@/components/triage/SummaryChips";
import { GroupedList } from "@/components/triage/GroupedList";
import { CaseTable, type CaseTableRow } from "@/components/triage/CaseTable";
import { ActionBadge } from "@/components/triage/ActionBadge";
import { ProgressBar } from "@/components/triage/ProgressBar";
import { useProviders } from "@/hooks/useProviders";
import { useCases } from "@/hooks/useCases";
import { useTasks } from "@/hooks/useTasks";
import { useLastTouchDates } from "@/hooks/useTouches";
import { usePayers } from "@/hooks/useAdmin";
import { useCanWrite } from "@/lib/permissions";
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
import { CASE_STATUS_BUCKETS, caseStatusLabel, type CaseStatus } from "@/lib/caseStatus";
import { PRE_CRED_PAYER_NAME } from "@/lib/statusLabels";
import { buildRosterCsv, type RosterRowInput } from "@/lib/rosterExport";
import { downloadCsvText } from "@/lib/csv";
import type { CredentialCase, Provider, Task } from "@/types";

// The selected filter card lives in the URL (?chip=needs|inprog|awaiting; no
// param = all) so other pages — the Home queue's "view all" — can deep-link a
// filtered work view. Unknown values fall back to all.
export const Route = createFileRoute("/providers/")({
  validateSearch: (search: Record<string, unknown>): { chip?: Exclude<ChipId, "all"> } => {
    const chip = search.chip;
    return chip === "needs" || chip === "inprog" || chip === "awaiting" ? { chip } : {};
  },
  component: ProvidersWorkView,
});

interface WorkRow {
  case: CredentialCase;
  state: ActionState;
  /** E6.0 — THE unified case status the row renders (label reused by the
   * roster CSV export). */
  caseStatus: CaseStatus;
  statusLabel: string;
  suffix: string | undefined;
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
  approved: number;
  denominator: number;
  oldestDays: number | null;
  /** migrated/onboard-existing provider: listed for reference, never worked (Epic 2e) */
  isReference: boolean;
}

function initialsOf(p: Provider): string {
  return `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase();
}

// Roster CSV row from a work group. group/facility name is left empty here —
// the groups cache isn't loaded on this page and adding it would be a new
// query; the summary covers every case for the provider, not just the
// chip-filtered subset.
function toRosterRow(g: WorkGroup): RosterRowInput {
  return {
    firstName: g.provider.firstName,
    lastName: g.provider.lastName,
    credentials: g.provider.credentials,
    npi: g.provider.npi,
    specialty: g.provider.specialty,
    homeState: g.provider.homeState,
    groupOrFacility: null,
    cases: g.rows.map((r) => ({
      payerName: r.payerName,
      state: r.case.state,
      statusLabel: r.statusLabel,
    })),
  };
}

const severityRank = (s: ActionState) => ACTION_STATE_SEVERITY.indexOf(s);

function ProvidersWorkView() {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const providersQ = useProviders();
  const casesQ = useCases();
  const tasksQ = useTasks();
  const payersQ = usePayers();
  const lastTouchQ = useLastTouchDates();

  const { chip: chipParam } = Route.useSearch();
  const chip: ChipId = chipParam ?? "all";
  const setChip = (id: ChipId) =>
    navigate({
      to: "/providers",
      search: id === "all" ? {} : { chip: id },
      replace: true,
    });

  const loading = providersQ.isLoading || casesQ.isLoading || tasksQ.isLoading || payersQ.isLoading;

  const failed = providersQ.isError || casesQ.isError || payersQ.isError;

  const groups: WorkGroup[] = useMemo(() => {
    const providers = providersQ.data ?? [];
    const cases = casesQ.data ?? [];
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

    const now = new Date();
    const rowsByProvider = new Map<string, WorkRow[]>();

    for (const c of cases) {
      const openTasks = openTasksByCase.get(c.id) ?? [];
      const lastTouchDate = lastTouchByCase?.get(c.id) ?? null;

      // E6.0 — the action engine keys off the canonical status's label +
      // bucket (the same closed ActionBucket domain the legacy configs used).
      const state = getActionState({
        statusLabel: caseStatusLabel(c.caseStatus),
        actionBucket: CASE_STATUS_BUCKETS[c.caseStatus],
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
        caseStatus: c.caseStatus,
        statusLabel: caseStatusLabel(c.caseStatus),
        suffix,
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
        approved: nonPreCred.filter((r) => r.caseStatus === "approved").length,
        denominator: nonPreCred.length,
        oldestDays: openRows.reduce<number | null>(
          (max, r) => (r.days !== null && (max === null || r.days > max) ? r.days : max),
          null,
        ),
        isReference: provider.referenceOnly,
      });
    }
    built.sort(
      (a, b) =>
        severityRank(a.worst) - severityRank(b.worst) ||
        a.provider.lastName.localeCompare(b.provider.lastName),
    );
    return built;
  }, [providersQ.data, casesQ.data, tasksQ.data, payersQ.data, lastTouchQ.data]);

  // Reference-only providers are listed separately and never counted as work
  // (Epic 2e): the chips, the filtered list, and the totals derive from worked
  // providers only.
  const workedGroups = useMemo(() => groups.filter((g) => !g.isReference), [groups]);
  const referenceGroups = useMemo(() => groups.filter((g) => g.isReference), [groups]);
  const openRowsAll = useMemo(() => workedGroups.flatMap((g) => g.openRows), [workedGroups]);
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
      workedGroups
        .map((g) => ({ group: g, visibleRows: g.rows.filter((r) => matchesChip(chip, r.state)) }))
        .filter(({ visibleRows }) => visibleRows.length > 0),
    [workedGroups, chip],
  );

  const totalProviders = groups.length;
  const totalOpen = openRowsAll.length;

  // The roster exports exactly the providers on screen: the chip-filtered
  // worked groups plus the always-visible reference section.
  const exportGroups = useMemo(
    () => [...visibleGroups.map((v) => v.group), ...referenceGroups],
    [visibleGroups, referenceGroups],
  );
  function handleExportRoster() {
    if (exportGroups.length === 0) return;
    downloadCsvText(
      `roster-${format(new Date(), "yyyy-MM-dd")}.csv`,
      buildRosterCsv(exportGroups.map(toRosterRow)),
    );
  }

  function tableRow(row: WorkRow): CaseTableRow {
    const openCase = () => navigate({ to: "/cases/$id", params: { id: row.case.id } });
    const lead = row.isPreCred ? (
      <span className="text-[length:var(--mp-text-sm)] text-[color:var(--mp-ink-secondary)]">
        Pre-Credentialing
      </span>
    ) : (
      <span className="text-[length:var(--mp-text-sm)] font-medium text-[color:var(--mp-ink)]">
        {row.payerName}
      </span>
    );
    return {
      id: row.case.id,
      lead,
      status: { status: row.caseStatus, suffix: row.suffix },
      lastTouch: row.lastTouchLabel,
      days: row.days,
      daysStrong: isAlertState(row.state) || row.state === "stalled",
      action: row.nextTask ? { label: row.nextTask.title, onClick: openCase } : null,
      alert: isAlertState(row.state),
      onOpen: openCase,
    };
  }

  function groupHeader(g: WorkGroup) {
    const openProvider = () => navigate({ to: "/providers/$id", params: { id: g.provider.id } });
    return (
      <div className="flex flex-1 min-w-0 flex-col gap-2 md:flex-row md:items-center md:gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="w-9 h-9 rounded-full bg-mp-primary-tint flex items-center justify-center text-[length:var(--mp-text-xs)] font-semibold text-[color:var(--mp-primary)] flex-shrink-0">
            {initialsOf(g.provider)}
          </span>
          <span className="min-w-0 md:w-60">
            <span
              role="link"
              tabIndex={0}
              className="block truncate text-[length:var(--mp-text-sm)] font-semibold text-[color:var(--mp-ink)] hover:underline"
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
              {g.provider.credentials ? "," : ""}
              {g.provider.credentials ? (
                <span className="font-normal text-[color:var(--mp-ink-secondary)]">
                  {" "}
                  {g.provider.credentials}
                </span>
              ) : null}
            </span>
            <span className="block text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
              {g.rows.length} payer {g.rows.length === 1 ? "case" : "cases"}
              {g.oldestDays !== null ? (
                <span className="md:hidden"> · {g.oldestDays}d oldest</span>
              ) : null}
            </span>
          </span>
        </div>
        <span className="flex items-center gap-2 md:flex-1 md:min-w-0">
          <span className="w-full max-w-44 md:w-40 md:flex-shrink-0">
            <ProgressBar value={g.approved} max={g.denominator} />
          </span>
          <span className="tabular-nums whitespace-nowrap text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
            {g.approved} of {g.denominator} approved
          </span>
        </span>
        <span className="flex items-center gap-3">
          {g.worst !== "on_track" && g.worst !== "complete" ? (
            <ActionBadge
              tone={ACTION_BADGE_TONE[g.worst]}
              text={badgeLabel(g.worst, g.worstCount)}
            />
          ) : null}
          {g.oldestDays !== null ? (
            <span className="hidden md:inline tabular-nums whitespace-nowrap text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
              {g.oldestDays}d oldest
            </span>
          ) : null}
        </span>
      </div>
    );
  }

  function referenceRow(g: WorkGroup) {
    const openProvider = () => navigate({ to: "/providers/$id", params: { id: g.provider.id } });
    return (
      <div
        key={g.provider.id}
        role="link"
        tabIndex={0}
        onClick={openProvider}
        onKeyDown={(e) => {
          if (e.key === "Enter") openProvider();
        }}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-mp-muted/50 transition-colors"
      >
        <span className="w-9 h-9 rounded-full bg-mp-primary-tint flex items-center justify-center text-[length:var(--mp-text-xs)] font-semibold text-[color:var(--mp-primary)] flex-shrink-0">
          {initialsOf(g.provider)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[length:var(--mp-text-sm)] font-semibold text-[color:var(--mp-ink)]">
          {g.provider.firstName} {g.provider.lastName}
          {g.provider.credentials ? (
            <span className="font-normal text-[color:var(--mp-ink-secondary)]">
              {" "}
              {g.provider.credentials}
            </span>
          ) : null}
        </span>
        <span className="whitespace-nowrap text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
          {g.rows.length} payer {g.rows.length === 1 ? "case" : "cases"}
        </span>
        <StatusPill status="neutral" label="Reference" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Providers"
        description={`${totalProviders} providers · ${totalOpen} open cases`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-9 gap-2"
              onClick={handleExportRoster}
              disabled={exportGroups.length === 0}
            >
              <Download className="w-4 h-4" />
              Export roster
            </Button>
            {canWrite ? (
              <Button onClick={() => navigate({ to: "/providers/new" })} className="h-9 gap-2">
                <Plus className="w-4 h-4" />
                New Provider
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mb-6">
        <SummaryChips cards={cards} selected={chip} onSelect={(id) => setChip(id as ChipId)} />
      </div>

      {failed ? (
        <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-6 text-center text-[length:var(--mp-text-sm)] text-[color:var(--mp-danger)]">
          Couldn't load the work view. Refresh to retry.
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-[var(--mp-radius-lg)] bg-mp-muted animate-pulse" />
          ))}
        </div>
      ) : visibleGroups.length === 0 && referenceGroups.length === 0 ? (
        <EmptyState
          message={chip === "all" ? "No cases yet" : "Nothing in this bucket"}
          description={
            chip === "all"
              ? "Create a provider and open cases to start tracking."
              : "No open cases match this filter right now."
          }
        />
      ) : (
        <div className="space-y-6">
          {visibleGroups.length > 0 ? (
            <GroupedList
              groups={visibleGroups.map(({ group, visibleRows }) => ({
                id: group.provider.id,
                header: groupHeader(group),
                children: <CaseTable leadLabel="Payer" rows={visibleRows.map(tableRow)} />,
              }))}
            />
          ) : null}
          {referenceGroups.length > 0 ? (
            <section>
              <h2 className="mb-2 text-[length:var(--mp-text-xs)] font-semibold uppercase tracking-wider text-[color:var(--mp-ink-faint)]">
                Reference
              </h2>
              <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card divide-y divide-[color:var(--mp-border)]">
                {referenceGroups.map(referenceRow)}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
