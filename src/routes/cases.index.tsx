// E6.1 F6.1.3 — ONE Cases surface with three pivots. "My Cases" (/work) and
// the payer-grouped work view merged here: the ranked to-do queue (the E2.3
// next-best-action derivation) is the DEFAULT pivot; "By provider" and
// "By payer" re-slice the SAME open cases. Pivot state rides the URL
// (?pivot=provider|payer, no param = to-do) so any slice is shareable.
// Back-compat: legacy /cases links carrying list params (?chip=, ?ids=,
// ?runId=) land on the payer pivot so their behavior is unchanged, and /work
// redirects here preserving ?run= (the post-generation batch banner).
import React, { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { SummaryChips } from "@/components/triage/SummaryChips";
import { GroupedList } from "@/components/triage/GroupedList";
import { CaseTable, type CaseTableRow } from "@/components/triage/CaseTable";
import { ActionBadge } from "@/components/triage/ActionBadge";
import { ProgressBar } from "@/components/triage/ProgressBar";
import { NextBestActionQueue } from "@/components/work/NextBestActionQueue";
import { useProviders } from "@/hooks/useProviders";
import { useCases } from "@/hooks/useCases";
import { useTasks } from "@/hooks/useTasks";
import { useLastTouchDates } from "@/hooks/useTouches";
import { usePayers, useSops } from "@/hooks/useAdmin";
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
  isOpenState,
  matchesChip,
  type ChipId,
} from "@/lib/workView";
import { caseIdsUsingGenericSop, fallbackTemplateIds } from "@/lib/sopStamp";
import { CASE_STATUS_BUCKETS, caseStatusLabel, type CaseStatus } from "@/lib/caseStatus";
import { PRE_CRED_PAYER_NAME } from "@/lib/statusLabels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageSquarePlus, Phone, Plus, Search, X } from "lucide-react";
import { useCanWrite } from "@/lib/permissions";
import { useTablePrefs } from "@/hooks/useTablePrefs";
import { BatchTouchpointDialog } from "@/components/cases/BatchTouchpointDialog";
import { BulkLogTouchDialog, type BulkCaseCandidate } from "@/components/cases/BulkLogTouchDialog";
import { ManualCaseModal } from "@/components/cases/ManualCaseModal";
import type { CredentialCase, Provider, Task } from "@/types";

// E2.1 F2.1.2 interim landing: ?runId=<uuid> filters the list to the cases a
// confirmed generation batch created (URL-state, sharable) — old links live.
// E2.2 F2.2.2: ?chip= is the deep-linkable filter-card state. F4.1.7: ?ids=
// pins the view to a bulk-touch confirmation set. E6.1: ?run= carries the
// /work post-generation banner onto the to-do pivot; ?pivot= selects a slice.
type CasesChipId = ChipId | "generic";
type CasesPivot = "todo" | "provider" | "payer";

interface CasesSearch {
  pivot?: Exclude<CasesPivot, "todo">;
  run?: string;
  runId?: string;
  chip?: Exclude<CasesChipId, "all">;
  ids?: string;
}

export const Route = createFileRoute("/cases/")({
  component: CasesWorkView,
  validateSearch: (search: Record<string, unknown>): CasesSearch => ({
    pivot: search.pivot === "provider" || search.pivot === "payer" ? search.pivot : undefined,
    run: typeof search.run === "string" && search.run ? search.run : undefined,
    runId: typeof search.runId === "string" && search.runId ? search.runId : undefined,
    chip:
      search.chip === "needs" ||
      search.chip === "inprog" ||
      search.chip === "awaiting" ||
      search.chip === "generic"
        ? search.chip
        : undefined,
    ids: typeof search.ids === "string" && search.ids.trim() ? search.ids : undefined,
  }),
});

interface CaseRow {
  case: CredentialCase;
  state: ActionState;
  /** E6.0 — THE unified case status the row renders. */
  caseStatus: CaseStatus;
  suffix: string | undefined;
  provider: Provider | null;
  payerId: string;
  payerName: string;
  isPreCred: boolean;
  lastTouchLabel: string;
  days: number | null;
  nextTask: Task | null;
}

interface CaseGroup {
  id: string;
  title: string;
  titleDetail: string | null;
  isPreCred: boolean;
  rows: CaseRow[];
  openRows: CaseRow[];
  worst: ActionState;
  worstCount: number;
  approved: number;
}

const severityRank = (s: ActionState) => ACTION_STATE_SEVERITY.indexOf(s);

function providerNameOf(row: CaseRow): string {
  return row.provider ? `${row.provider.firstName} ${row.provider.lastName}` : "Unknown provider";
}

function finishGroup(g: CaseGroup): CaseGroup {
  g.rows.sort(
    (a, b) => severityRank(a.state) - severityRank(b.state) || (b.days ?? -1) - (a.days ?? -1),
  );
  g.openRows = g.rows.filter((r) => r.state !== "complete");
  g.worst = worstActionState(g.openRows.map((r) => r.state)) ?? "complete";
  g.worstCount = g.openRows.filter((r) => r.state === g.worst).length;
  g.approved = g.rows.filter((r) => r.caseStatus === "approved").length;
  return g;
}

function CasesWorkView() {
  const navigate = useNavigate();
  const { pivot: pivotParam, run, runId, chip: chipParam, ids: idsParam } = Route.useSearch();
  const providersQ = useProviders();
  const casesQ = useCases();
  const tasksQ = useTasks();
  const payersQ = usePayers();
  const templatesQ = useSops();
  const lastTouchQ = useLastTouchDates();
  const canWrite = useCanWrite();

  // Legacy /cases links carried list params with no pivot — keep them landing
  // on the list they always rendered (the payer slice), never the queue.
  const pivot: CasesPivot = pivotParam ?? (chipParam || idsParam || runId ? "payer" : "todo");

  const chip: CasesChipId = chipParam ?? "all";
  const listSearch = (over: Partial<CasesSearch>): CasesSearch => ({
    ...(pivot !== "todo" ? { pivot } : {}),
    ...(runId ? { runId } : {}),
    ...(chip !== "all" ? { chip } : {}),
    ...over,
  });
  const setChip = (id: CasesChipId) =>
    navigate({
      to: "/cases",
      search: listSearch({ chip: id === "all" ? undefined : id }),
    });
  const setPivot = (p: CasesPivot) =>
    navigate({
      to: "/cases",
      search:
        p === "todo"
          ? run
            ? { run }
            : {}
          : {
              pivot: p,
              ...(runId ? { runId } : {}),
              ...(chip !== "all" ? { chip } : {}),
              ...(idsParam ? { ids: idsParam } : {}),
            },
    });
  const [batchOpen, setBatchOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [newCaseOpen, setNewCaseOpen] = useState(false);

  // ?ids pins the view to exactly these cases (bulk-touch follow-up link).
  const idSet = useMemo(
    () => (idsParam ? new Set(idsParam.split(",").filter(Boolean)) : null),
    [idsParam],
  );
  // F4.0.2 — case search matches on the tracking ID (+ provider/payer/state).
  const [search, setSearch] = useState("");
  // F4.0.2 — the Tracking ID column is default-hidden, toggled via user prefs.
  const { prefs, savePrefs } = useTablePrefs("cases.list");
  const showTrackingId = prefs?.visibleCols?.trackingId ?? false;
  const toggleTrackingId = () =>
    savePrefs({
      visibleCols: { ...(prefs?.visibleCols ?? {}), trackingId: !showTrackingId },
    }).catch(() => undefined);

  // F2.2.2 — a case "uses the generic SOP" iff a task of it is stamped with a
  // fallback (global payerless) template id; both inputs are already-loaded
  // org caches (the tasks list projection carries the two stamp columns).
  const genericCaseIds = useMemo(
    () => caseIdsUsingGenericSop(tasksQ.data ?? [], fallbackTemplateIds(templatesQ.data ?? [])),
    [tasksQ.data, templatesQ.data],
  );

  const loading = providersQ.isLoading || casesQ.isLoading || tasksQ.isLoading || payersQ.isLoading;

  const failed = providersQ.isError || casesQ.isError || payersQ.isError;

  // One flat row per case; both list pivots group the SAME rows.
  const rows: CaseRow[] = useMemo(() => {
    const cases = (casesQ.data ?? []).filter(
      (c) => !runId || (c.generationRunId ?? null) === runId,
    );
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

    const now = new Date();
    const built: CaseRow[] = [];

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

      const rawPayerName = payerById.get(c.payerId)?.name ?? "Unknown payer";
      const isPreCred = rawPayerName === PRE_CRED_PAYER_NAME;
      built.push({
        case: c,
        state,
        caseStatus: c.caseStatus,
        suffix,
        provider: providerById.get(c.providerId) ?? null,
        payerId: c.payerId,
        payerName: isPreCred ? "Pre-Credentialing" : rawPayerName,
        isPreCred,
        lastTouchLabel: touchDays === null ? "—" : touchDays === 0 ? "today" : `${touchDays}d ago`,
        days,
        nextTask: openTasks[0] ?? null,
      });
    }
    return built;
  }, [providersQ.data, casesQ.data, tasksQ.data, payersQ.data, lastTouchQ.data, runId]);

  const groups: CaseGroup[] = useMemo(() => {
    const byKey = new Map<string, CaseGroup>();
    for (const r of rows) {
      const key = pivot === "provider" ? (r.provider?.id ?? "unknown-provider") : r.payerId;
      let g = byKey.get(key);
      if (!g) {
        g =
          pivot === "provider"
            ? {
                id: key,
                title: providerNameOf(r),
                titleDetail: r.provider?.credentials ?? null,
                isPreCred: false,
                rows: [],
                openRows: [],
                worst: "complete",
                worstCount: 0,
                approved: 0,
              }
            : {
                id: key,
                title: r.payerName,
                titleDetail: null,
                isPreCred: r.isPreCred,
                rows: [],
                openRows: [],
                worst: "complete",
                worstCount: 0,
                approved: 0,
              };
        byKey.set(key, g);
      }
      g.rows.push(r);
    }
    const built = [...byKey.values()].map(finishGroup);
    built.sort((a, b) => {
      // Pre-cred payer group pinned last, always (payer pivot only).
      if (a.isPreCred !== b.isPreCred) return a.isPreCred ? 1 : -1;
      return severityRank(a.worst) - severityRank(b.worst) || a.title.localeCompare(b.title);
    });
    return built;
  }, [rows, pivot]);

  const openRowsAll = useMemo(() => rows.filter((r) => r.state !== "complete"), [rows]);
  const counts = chipCounts(openRowsAll.map((r) => r.state));
  const genericCount = openRowsAll.filter((r) => genericCaseIds.has(r.case.id)).length;
  const cards = [
    { id: "all", label: "All open cases", n: counts.all },
    { id: "needs", label: "Needs your action", n: counts.needs },
    { id: "inprog", label: "In progress", n: counts.inprog },
    { id: "awaiting", label: "Awaiting effective date", n: counts.awaiting },
    { id: "generic", label: "Using generic SOP", n: genericCount },
  ];

  // Same predicate as the card counts (matchesChip / the generic derivation),
  // so a card that says N always leaves exactly N case rows on screen. The
  // free-text search (F4.0.2) additionally narrows by provider/payer/state and
  // — the point of the feature — the tracking ID.
  // Bulk-touch candidates: every open case, labelled provider · state · payer.
  const bulkCandidates: BulkCaseCandidate[] = useMemo(
    () =>
      openRowsAll.map((r) => ({
        caseId: r.case.id,
        label: `${providerNameOf(r)} · ${r.case.state} · ${r.payerName}`,
      })),
    [openRowsAll],
  );

  const q = search.trim().toLowerCase();
  const visibleGroups = useMemo(
    () =>
      groups
        .map((g) => ({
          group: g,
          visibleRows: g.rows.filter((r) => {
            // ids pinning takes precedence over chip/generic/search so the
            // bulk-touch link shows exactly the affected set.
            if (idSet) return idSet.has(r.case.id);
            const chipOk =
              chip === "generic"
                ? isOpenState(r.state) && genericCaseIds.has(r.case.id)
                : matchesChip(chip, r.state);
            if (!chipOk) return false;
            if (!q) return true;
            return [
              providerNameOf(r).toLowerCase(),
              r.payerName.toLowerCase(),
              r.case.state.toLowerCase(),
              (r.case.payerReferenceId ?? "").toLowerCase(),
            ].some((h) => h.includes(q));
          }),
        }))
        .filter(({ visibleRows }) => visibleRows.length > 0),
    [groups, chip, genericCaseIds, q, idSet],
  );
  const pinnedCount = visibleGroups.reduce((n, { visibleRows }) => n + visibleRows.length, 0);

  function tableRow(row: CaseRow): CaseTableRow {
    const openCase = () => navigate({ to: "/cases/$id", params: { id: row.case.id } });
    const lead =
      pivot === "provider" ? (
        <span className="text-[length:var(--mp-text-sm)] font-medium text-[color:var(--mp-ink)]">
          {row.payerName}
          <span className="font-normal text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
            {" "}
            · {row.case.state}
          </span>
        </span>
      ) : (
        <span className="text-[length:var(--mp-text-sm)] font-medium text-[color:var(--mp-ink)]">
          {providerNameOf(row)}
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
      status: { status: row.caseStatus, suffix: row.suffix },
      trackingId: row.case.payerReferenceId ?? null,
      lastTouch: row.lastTouchLabel,
      days: row.days,
      daysStrong: isAlertState(row.state) || row.state === "stalled",
      action: row.nextTask ? { label: row.nextTask.title, onClick: openCase } : null,
      alert: isAlertState(row.state),
      onOpen: openCase,
    };
  }

  function groupHeader(g: CaseGroup) {
    return (
      <div className="flex flex-1 min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="truncate text-[length:var(--mp-text-sm)] font-semibold text-[color:var(--mp-ink)]">
          {g.title}
          {g.titleDetail ? (
            <span className="font-normal text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
              {" "}
              {g.titleDetail}
            </span>
          ) : null}
        </span>
        <span className="tabular-nums text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)] whitespace-nowrap">
          {g.rows.length} {g.rows.length === 1 ? "case" : "cases"}
        </span>
        {!g.isPreCred ? (
          <span className="hidden sm:flex items-center gap-2 ml-auto">
            <span className="w-40">
              <ProgressBar value={g.approved} max={g.rows.length} />
            </span>
            <span className="tabular-nums whitespace-nowrap text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
              {g.approved} of {g.rows.length} approved
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

  const description =
    pivot === "todo"
      ? "Every open case, ordered by what to touch first — start at the top."
      : pivot === "provider"
        ? `${groups.length} providers · ${counts.all} open cases`
        : `${groups.length} payers · ${counts.all} open cases`;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Cases"
        description={description}
        actions={
          canWrite ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8" onClick={() => setBulkOpen(true)}>
                <MessageSquarePlus className="w-4 h-4 mr-1" /> Log touch
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setBatchOpen(true)}
              >
                <Phone className="w-4 h-4 mr-1" /> Log payer call
              </Button>
              <Button
                size="sm"
                className="h-8 bg-[#1B4D3E] text-white hover:bg-[#163F33]"
                onClick={() => setNewCaseOpen(true)}
              >
                <Plus className="w-4 h-4 mr-1" /> New case
              </Button>
            </div>
          ) : null
        }
      />
      {batchOpen ? (
        <BatchTouchpointDialog open={batchOpen} onClose={() => setBatchOpen(false)} />
      ) : null}
      {bulkOpen ? (
        <BulkLogTouchDialog
          open={bulkOpen}
          candidates={bulkCandidates}
          onClose={() => setBulkOpen(false)}
          onLogged={(caseIds) =>
            navigate({ to: "/cases", search: { pivot: "payer", ids: caseIds.join(",") } })
          }
        />
      ) : null}
      {newCaseOpen ? <ManualCaseModal onClose={() => setNewCaseOpen(false)} /> : null}

      {/* The pivot switcher — URL state, shareable (F6.1.3). */}
      <div className="mb-4">
        <Tabs value={pivot} onValueChange={(v) => setPivot(v as CasesPivot)}>
          <TabsList aria-label="Cases pivots">
            <TabsTrigger className="text-[12.5px]" value="todo">
              To-do
            </TabsTrigger>
            <TabsTrigger className="text-[12.5px]" value="provider">
              By provider
            </TabsTrigger>
            <TabsTrigger className="text-[12.5px]" value="payer">
              By payer
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {pivot === "todo" ? (
        <div className="max-w-4xl">
          <NextBestActionQueue run={run} />
        </div>
      ) : (
        <>
          {idSet ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-[#E8E5E0] p-3 text-[13px]">
              <span>
                Showing {pinnedCount} {pinnedCount === 1 ? "case" : "cases"} you just logged a touch
                on.
              </span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7"
                onClick={() => navigate({ to: "/cases", search: { pivot } })}
              >
                <X className="mr-1 h-4 w-4" /> Show all cases
              </Button>
            </div>
          ) : null}

          {runId ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-[#E8E5E0] p-3 text-[13px]">
              <span>
                Showing only the {rows.length} {rows.length === 1 ? "case" : "cases"} created by
                this generation run.
              </span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7"
                onClick={() => navigate({ to: "/cases", search: { pivot } })}
              >
                Show all cases
              </Button>
            </div>
          ) : null}

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search provider, payer, or tracking ID…"
                className="h-9 pl-8"
                aria-label="Search cases"
              />
            </div>
            <Button variant="outline" size="sm" className="h-9" onClick={toggleTrackingId}>
              {showTrackingId ? "Hide tracking ID" : "Show tracking ID"}
            </Button>
          </div>

          <div className="mb-6">
            <SummaryChips
              cards={cards}
              selected={chip}
              onSelect={(id) => setChip(id as CasesChipId)}
            />
          </div>

          {failed ? (
            <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-6 text-center text-[length:var(--mp-text-sm)] text-[color:var(--mp-danger)]">
              Couldn't load cases. Refresh to retry.
            </div>
          ) : loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-14 rounded-[var(--mp-radius-lg)] bg-mp-muted animate-pulse"
                />
              ))}
            </div>
          ) : visibleGroups.length === 0 ? (
            <EmptyState
              message={chip === "all" ? "No cases yet" : "Nothing in this bucket"}
              description={
                chip === "all"
                  ? "Use New case for a one-off case, or open a provider to start with context."
                  : "No open cases match this filter right now."
              }
            />
          ) : (
            <GroupedList
              groups={visibleGroups.map(({ group, visibleRows }) => ({
                id: group.id,
                header: groupHeader(group),
                children: (
                  <CaseTable
                    leadLabel={pivot === "provider" ? "Payer" : "Provider"}
                    rows={visibleRows.map(tableRow)}
                    showTrackingId={showTrackingId}
                  />
                ),
              }))}
            />
          )}
        </>
      )}
    </div>
  );
}
