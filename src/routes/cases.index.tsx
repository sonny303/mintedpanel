// 2026-07-22 Cases page redesign — ONE Cases surface with three VIEWS via a
// segmented control: Flat (default) · By provider · By payer. The former
// "to-do" pivot is retired AS A TAB, but its ranked ordering is not: Flat's
// DEFAULT sort is the E2.3 next-best-action deadline ranking (reused via
// useNextBestActions); clicking a column header switches to that column's sort
// (Case Status sorts in spine order). Four KPI cards at the top are DERIVED
// FILTERS (Total · In progress · Awaiting effective date · Denied/appeal), not
// statuses — the canonical 8-state machine (src/lib/caseStatus.ts) is the only
// status vocabulary and CaseStatusPill renders it.
//
// Case# is the NEW globally-sequential immutable case number (C-<n>, Geist
// Mono) and IS the row's click-through — there is no separate Open-case action.
//
// Back-compat: ?pivot=provider|payer selects a view (no param = Flat); ?chip=
// maps to the KPI quick-filter (legacy needs/generic land on Total); ?ids= pins
// a bulk-touch set; ?runId=/?run= filter to a generation run's cases + banner;
// /work still redirects here.
import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { ArrowDown, ArrowUp, MessageSquarePlus, Plus, Search, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { GroupedList } from "@/components/triage/GroupedList";
import { ProgressBar } from "@/components/triage/ProgressBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CaseStatusPill } from "@/components/cases/CaseStatusPill";
import { AddTouchDialog, type TouchCaseCandidate } from "@/components/cases/AddTouchDialog";
import { ManualCaseModal } from "@/components/cases/ManualCaseModal";
import { useProviders, useProviderAssignments } from "@/hooks/useProviders";
import { useCases } from "@/hooks/useCases";
import { useLastTouchDates } from "@/hooks/useTouches";
import { useFacilities } from "@/hooks/useLookups";
import { usePayers } from "@/hooks/useAdmin";
import { useNextBestActions } from "@/hooks/useNextBestActions";
import { useCanWrite } from "@/lib/permissions";
import { CASE_STATUSES, caseStatusLabel, type CaseStatus } from "@/lib/caseStatus";
import { PRE_CRED_PAYER_NAME } from "@/lib/statusLabels";
import {
  CASES_KPIS,
  filterRows,
  groupRows,
  kpiCounts,
  needsAction,
  pageCount,
  paginate,
  sortFlatRows,
  statesInRows,
  type CasesKpi,
  type CaseViewRow,
  type FlatSortKey,
  type SortDir,
} from "@/lib/casesView";

type CasesView = "flat" | "provider" | "payer";

// The KPI quick-filter rides ?chip (kept for back-compat); the new values are
// inprog/awaiting/denied. Legacy needs/generic land on Total (all).
const CHIP_TO_KPI: Record<string, CasesKpi> = {
  inprog: "inprog",
  awaiting: "awaiting",
  denied: "denied",
  needs: "total",
  generic: "total",
};

interface CasesSearch {
  pivot?: "provider" | "payer";
  chip?: string;
  ids?: string;
  runId?: string;
  run?: string;
}

export const Route = createFileRoute("/cases/")({
  component: CasesPage,
  validateSearch: (search: Record<string, unknown>): CasesSearch => ({
    pivot: search.pivot === "provider" || search.pivot === "payer" ? search.pivot : undefined,
    chip: typeof search.chip === "string" && search.chip in CHIP_TO_KPI ? search.chip : undefined,
    ids: typeof search.ids === "string" && search.ids.trim() ? search.ids : undefined,
    runId: typeof search.runId === "string" && search.runId ? search.runId : undefined,
    run: typeof search.run === "string" && search.run ? search.run : undefined,
  }),
});

const KPI_LABELS: Record<CasesKpi, string> = {
  total: "Total cases",
  inprog: "In progress",
  awaiting: "Awaiting effective date",
  denied: "Denied / appeal",
};

const PAGE_SIZES = [10, 25, 50];

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function CasesPage() {
  const navigate = useNavigate();
  const { pivot: pivotParam, chip: chipParam, ids: idsParam, runId, run } = Route.useSearch();

  const providersQ = useProviders();
  const casesQ = useCases();
  const payersQ = usePayers();
  const lastTouchQ = useLastTouchDates();
  const assignmentsQ = useProviderAssignments();
  const facilitiesQ = useFacilities();
  const queue = useNextBestActions();
  const canWrite = useCanWrite();

  const view: CasesView = pivotParam ?? "flat";
  const kpi: CasesKpi = chipParam ? (CHIP_TO_KPI[chipParam] ?? "total") : "total";

  const runFilter = runId ?? run ?? null;

  // Local filter + pagination state (search/state/status/pagination live in
  // component state; view + KPI ride the URL so they stay shareable).
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<CaseStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortKey, setSortKey] = useState<FlatSortKey>("default");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [newCaseOpen, setNewCaseOpen] = useState(false);

  const loading = providersQ.isLoading || casesQ.isLoading || payersQ.isLoading;
  const failed = providersQ.isError || casesQ.isError || payersQ.isError;

  const idSet = useMemo(
    () => (idsParam ? new Set(idsParam.split(",").filter(Boolean)) : null),
    [idsParam],
  );

  // The E2.3 deadline rank: one entry per OPEN case, in queue order.
  const rankByCaseId = useMemo(() => {
    const m = new Map<string, number>();
    (queue.entries ?? []).forEach((e, i) => m.set(e.caseId, i));
    return m;
  }, [queue.entries]);

  const allRows: CaseViewRow[] = useMemo(() => {
    const providerById = new Map((providersQ.data ?? []).map((p) => [p.id, p]));
    const payerById = new Map((payersQ.data ?? []).map((p) => [p.id, p]));
    const lastTouchByCase = lastTouchQ.data;
    const now = new Date();

    return (casesQ.data ?? [])
      .filter((c) => !runFilter || (c.generationRunId ?? null) === runFilter)
      .filter((c) => !idSet || idSet.has(c.id))
      .map((c) => {
        const provider = providerById.get(c.providerId) ?? null;
        const rawPayerName = payerById.get(c.payerId)?.name ?? "Unknown payer";
        const isPreCred = rawPayerName === PRE_CRED_PAYER_NAME;
        const lastTouchDate = lastTouchByCase?.get(c.id) ?? null;
        const lastTouchDays = lastTouchDate
          ? differenceInCalendarDays(now, parseISO(lastTouchDate))
          : null;
        return {
          caseId: c.id,
          caseNumber: c.caseNumber ?? null,
          providerId: provider?.id ?? null,
          providerName: provider
            ? `${provider.firstName} ${provider.lastName}`
            : "Unknown provider",
          providerCredentials: provider?.credentials ?? null,
          payerId: c.payerId,
          payerName: isPreCred ? "Pre-Credentialing" : rawPayerName,
          isPreCred,
          state: c.state,
          caseStatus: c.caseStatus,
          confirmedEffectiveDate: c.confirmedEffectiveDate,
          lastTouchLabel:
            lastTouchDays === null ? "—" : lastTouchDays === 0 ? "today" : `${lastTouchDays}d ago`,
          lastTouchDays,
          daysOpen: Math.max(0, differenceInCalendarDays(now, parseISO(c.createdAt))),
          createdAt: c.createdAt,
        };
      });
  }, [providersQ.data, casesQ.data, payersQ.data, lastTouchQ.data, runFilter, idSet]);

  // KPI counts always reflect the full (pre-filter) set so the cards are stable.
  const counts = useMemo(() => kpiCounts(allRows), [allRows]);
  const states = useMemo(() => statesInRows(allRows), [allRows]);

  const filtered = useMemo(
    () => filterRows(allRows, { kpi, state: stateFilter, status: statusFilter, search }),
    [allRows, kpi, stateFilter, statusFilter, search],
  );

  // Subtitle metadata: providers → NPI + primary facility; payers → kind + states.
  const providerSubtitle = useMemo(() => {
    const facilityName = new Map((facilitiesQ.data ?? []).map((f) => [f.id, f.name]));
    const primaryByProvider = new Map<string, string>();
    for (const a of assignmentsQ.data ?? []) {
      if (a.isPrimary && a.providerId && a.facilityId) {
        primaryByProvider.set(a.providerId, facilityName.get(a.facilityId) ?? "");
      }
    }
    const npiByProvider = new Map((providersQ.data ?? []).map((p) => [p.id, p.npi]));
    return (providerId: string): string | null => {
      const parts: string[] = [];
      const npi = npiByProvider.get(providerId);
      if (npi) parts.push(`NPI ${npi}`);
      const fac = primaryByProvider.get(providerId);
      if (fac) parts.push(fac);
      return parts.length ? parts.join(" · ") : null;
    };
  }, [assignmentsQ.data, facilitiesQ.data, providersQ.data]);

  const payerSubtitle = useMemo(() => {
    const payerById = new Map((payersQ.data ?? []).map((p) => [p.id, p]));
    const statesByPayer = new Map<string, Set<string>>();
    for (const r of allRows) {
      const set = statesByPayer.get(r.payerId) ?? new Set<string>();
      set.add(r.state);
      statesByPayer.set(r.payerId, set);
    }
    return (payerId: string): string | null => {
      const payer = payerById.get(payerId);
      const parts: string[] = [];
      if (payer?.payerKind) parts.push(capitalize(payer.payerKind));
      const set = statesByPayer.get(payerId);
      if (set && set.size) parts.push([...set].sort().join(", "));
      return parts.length ? parts.join(" · ") : null;
    };
  }, [payersQ.data, allRows]);

  const groups = useMemo(() => {
    if (view === "flat") return [];
    return groupRows(filtered, view, {
      subtitleFor: view === "provider" ? providerSubtitle : payerSubtitle,
    });
  }, [filtered, view, providerSubtitle, payerSubtitle]);

  const sortedFlat = useMemo(
    () => sortFlatRows(filtered, sortKey, sortDir, rankByCaseId),
    [filtered, sortKey, sortDir, rankByCaseId],
  );

  // Pagination applies to rows (Flat) or groups (grouped views).
  const totalItems = view === "flat" ? sortedFlat.length : groups.length;
  const pages = pageCount(totalItems, pageSize);
  const safePage = Math.min(page, pages);
  const pagedFlat = view === "flat" ? paginate(sortedFlat, safePage, pageSize) : [];
  const pagedGroups = view === "flat" ? [] : paginate(groups, safePage, pageSize);

  const setView = (v: CasesView) => {
    setPage(1);
    navigate({
      to: "/cases",
      search: {
        ...(v === "flat" ? {} : { pivot: v }),
        ...(chipParam ? { chip: chipParam } : {}),
        ...(runFilter ? { runId: runFilter } : {}),
      },
    });
  };
  const setKpi = (k: CasesKpi) => {
    setPage(1);
    navigate({
      to: "/cases",
      search: {
        ...(view === "flat" ? {} : { pivot: view }),
        ...(k === "total" ? {} : { chip: k }),
        ...(runFilter ? { runId: runFilter } : {}),
      },
    });
  };
  const onSort = (key: Exclude<FlatSortKey, "default">) => {
    setPage(1);
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const resetFilter =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setPage(1);
      setter(v);
    };

  const bulkCandidates: TouchCaseCandidate[] = useMemo(
    () =>
      allRows
        .filter(
          (r) => needsAction(r) || r.caseStatus === "submitted" || r.caseStatus === "in_review",
        )
        .map((r) => ({
          id: r.caseId,
          label: `${r.providerName} · ${r.state} · ${r.payerName}`,
          currentStatus: r.caseStatus,
        })),
    [allRows],
  );

  const subtitle =
    view === "flat"
      ? `${counts.total} ${counts.total === 1 ? "case" : "cases"}`
      : view === "provider"
        ? `${groups.length} ${groups.length === 1 ? "provider" : "providers"} · ${counts.total} cases`
        : `${groups.length} ${groups.length === 1 ? "payer" : "payers"} · ${counts.total} cases`;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Cases"
        description={subtitle}
        actions={
          canWrite ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8" onClick={() => setBulkOpen(true)}>
                <MessageSquarePlus className="mr-1 h-4 w-4" /> Add touch
              </Button>
              <Button
                size="sm"
                className="h-8 bg-[#1B4D3E] text-white hover:bg-[#163F33]"
                onClick={() => setNewCaseOpen(true)}
              >
                <Plus className="mr-1 h-4 w-4" /> New case
              </Button>
            </div>
          ) : null
        }
      />

      {bulkOpen ? (
        <AddTouchDialog
          open={bulkOpen}
          candidates={bulkCandidates}
          onClose={() => setBulkOpen(false)}
          onLogged={(caseIds) =>
            navigate({ to: "/cases", search: { pivot: "payer", ids: caseIds.join(",") } })
          }
        />
      ) : null}
      {newCaseOpen ? <ManualCaseModal onClose={() => setNewCaseOpen(false)} /> : null}

      {/* KPI cards — derived filters (Total is the default / no filter). */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {CASES_KPIS.map((k) => {
          const selected = kpi === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKpi(k)}
              aria-pressed={selected}
              className={
                "rounded-md border px-4 py-3 text-left transition-colors " +
                (selected
                  ? "border-[#1B4D3E] bg-[#1B4D3E] text-white"
                  : "border-[#E8E5E0] bg-white hover:bg-[#F5F4F1]")
              }
            >
              <div
                className={
                  "text-[11px] font-semibold uppercase tracking-[0.05em] " +
                  (selected ? "text-white/80" : "text-[#6B7280]")
                }
              >
                {KPI_LABELS[k]}
              </div>
              <div className="mt-1 text-[26px] font-semibold tabular-nums leading-none">
                {counts[k]}
              </div>
            </button>
          );
        })}
      </div>

      {/* Segmented control + search + State/Case Status filters. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs value={view} onValueChange={(v) => setView(v as CasesView)}>
          <TabsList aria-label="Cases views">
            <TabsTrigger className="text-[12.5px]" value="flat">
              Flat
            </TabsTrigger>
            <TabsTrigger className="text-[12.5px]" value="provider">
              By provider
            </TabsTrigger>
            <TabsTrigger className="text-[12.5px]" value="payer">
              By payer
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => resetFilter(setSearch)(e.target.value)}
            placeholder="Search provider or payer…"
            className="h-9 pl-8"
            aria-label="Search cases"
          />
        </div>

        <Select value={stateFilter} onValueChange={resetFilter(setStateFilter)}>
          <SelectTrigger className="h-9 w-[130px]" aria-label="Filter by state">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            {states.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={resetFilter((v: string) => setStatusFilter(v as CaseStatus | "all"))}
        >
          <SelectTrigger className="h-9 w-[160px]" aria-label="Filter by case status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {CASE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {caseStatusLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {runFilter ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-[#E8E5E0] p-3 text-[13px]">
          <span>
            Showing only the {allRows.length} {allRows.length === 1 ? "case" : "cases"} created by
            this generation run.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-7"
            onClick={() =>
              navigate({ to: "/cases", search: view === "flat" ? {} : { pivot: view } })
            }
          >
            Show all cases
          </Button>
        </div>
      ) : null}
      {idSet ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-[#E8E5E0] p-3 text-[13px]">
          <span>
            Showing {allRows.length} {allRows.length === 1 ? "case" : "cases"} you just logged a
            touch on.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-7"
            onClick={() =>
              navigate({ to: "/cases", search: view === "flat" ? {} : { pivot: view } })
            }
          >
            <X className="mr-1 h-4 w-4" /> Show all cases
          </Button>
        </div>
      ) : null}

      {failed ? (
        <div className="rounded-md border border-mp-border bg-mp-card p-6 text-center text-[13px] text-[color:var(--mp-danger)]">
          Couldn&apos;t load cases. Refresh to retry.
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-md bg-mp-muted" />
          ))}
        </div>
      ) : totalItems === 0 ? (
        <EmptyState
          message={
            kpi === "total" && !search && stateFilter === "all" && statusFilter === "all"
              ? "No cases yet"
              : "Nothing matches these filters"
          }
          description={
            kpi === "total" && !search && stateFilter === "all" && statusFilter === "all"
              ? "Use New case for a one-off case, or open a provider to generate cases."
              : "Adjust the KPI card, view, or filters to see cases."
          }
        />
      ) : view === "flat" ? (
        <FlatCaseTable
          rows={pagedFlat}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          showProvider
          showPayer
        />
      ) : (
        <GroupedList
          defaultCollapsed
          groups={pagedGroups.map((g) => ({
            id: g.id,
            header: (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="truncate text-[13px] font-semibold text-foreground">
                  {g.title}
                </span>
                {g.subtitle ? (
                  <span className="truncate text-[12px] text-muted-foreground">{g.subtitle}</span>
                ) : null}
                <span className="whitespace-nowrap text-[12px] tabular-nums text-muted-foreground">
                  {g.total} {g.total === 1 ? "case" : "cases"}
                </span>
                {!g.isPreCred ? (
                  <span className="ml-auto hidden items-center gap-2 sm:flex">
                    <span className="w-32">
                      <ProgressBar value={g.approved} max={g.total} />
                    </span>
                    <span className="whitespace-nowrap text-[12px] tabular-nums text-muted-foreground">
                      {g.approved} of {g.total} approved
                    </span>
                  </span>
                ) : (
                  <span className="ml-auto" />
                )}
                {g.needsAction > 0 ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FBEAEA] px-2.5 py-0.5 text-[12px] font-medium text-[#B91C1C]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#DC2626]" aria-hidden />
                    {g.needsAction} needs action
                  </span>
                ) : null}
              </div>
            ),
            children: (
              <FlatCaseTable
                rows={g.rows}
                showProvider={view === "payer"}
                showPayer={view === "provider"}
              />
            ),
          }))}
        />
      )}

      {!loading && !failed && totalItems > 0 ? (
        <Pagination
          page={safePage}
          pages={pages}
          pageSize={pageSize}
          total={totalItems}
          unit={view === "flat" ? "cases" : view === "provider" ? "providers" : "payers"}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The shared case table — consistent column vocabulary across all three views.
// Case# is the click-through (no separate Open-case action). Only the Flat view
// passes sort handlers; grouped expansions render the same columns unsorted.
// ---------------------------------------------------------------------------

const HEADER_CELL =
  "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground";

function SortHeader({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string;
  col: Exclude<FlatSortKey, "default">;
  sortKey?: FlatSortKey;
  sortDir?: SortDir;
  onSort?: (col: Exclude<FlatSortKey, "default">) => void;
  align?: "left" | "right";
}) {
  if (!onSort) {
    return <th className={`${HEADER_CELL} ${align === "right" ? "text-right" : ""}`}>{label}</th>;
  }
  const active = sortKey === col;
  return (
    <th className={`${HEADER_CELL} ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
        className={
          "inline-flex items-center gap-1 uppercase tracking-[0.04em] hover:text-foreground " +
          (active ? "text-foreground" : "")
        }
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-3 w-3" aria-hidden />
          ) : (
            <ArrowDown className="h-3 w-3" aria-hidden />
          )
        ) : null}
      </button>
    </th>
  );
}

function FlatCaseTable({
  rows,
  showProvider,
  showPayer,
  sortKey,
  sortDir,
  onSort,
}: {
  rows: CaseViewRow[];
  showProvider: boolean;
  showPayer: boolean;
  sortKey?: FlatSortKey;
  sortDir?: SortDir;
  onSort?: (col: Exclude<FlatSortKey, "default">) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-[#E8E5E0] bg-white">
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[#E8E5E0]">
            <SortHeader
              label="Case#"
              col="caseNumber"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            {showProvider ? (
              <SortHeader
                label="Provider"
                col="provider"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
              />
            ) : null}
            {showPayer ? (
              <SortHeader
                label="Payer"
                col="payer"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
              />
            ) : null}
            <SortHeader
              label="State"
              col="state"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortHeader
              label="Case Status"
              col="status"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortHeader
              label="Last touch"
              col="lastTouch"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortHeader
              label="Days open"
              col="daysOpen"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
            />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.caseId}
              className="border-b border-[#F0EEE9] last:border-0 hover:bg-[#FAFAF9]"
            >
              <td className="px-3 py-2.5">
                <Link
                  to="/cases/$id"
                  params={{ id: r.caseId }}
                  className="font-mono text-[13px] font-medium text-[#1B4D3E] hover:underline"
                >
                  {r.caseNumber != null ? `C-${r.caseNumber}` : "—"}
                </Link>
              </td>
              {showProvider ? (
                <td className="px-3 py-2.5">
                  <span className="font-medium text-foreground">{r.providerName}</span>
                  {r.providerCredentials ? (
                    <span className="text-muted-foreground"> {r.providerCredentials}</span>
                  ) : null}
                </td>
              ) : null}
              {showPayer ? <td className="px-3 py-2.5 text-foreground">{r.payerName}</td> : null}
              <td className="px-3 py-2.5 text-muted-foreground">{r.state}</td>
              <td className="px-3 py-2.5">
                <CaseStatusPill status={r.caseStatus} />
              </td>
              <td className="px-3 py-2.5 text-muted-foreground">{r.lastTouchLabel}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                {r.daysOpen}d
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({
  page,
  pages,
  pageSize,
  total,
  unit,
  onPage,
  onPageSize,
}: {
  page: number;
  pages: number;
  pageSize: number;
  total: number;
  unit: string;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pageNums = Array.from({ length: pages }, (_, i) => i + 1);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
      <span>Rows per page</span>
      <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
        <SelectTrigger className="h-8 w-[72px]" aria-label="Rows per page">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZES.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="tabular-nums">
        Showing {from}–{to} of {total} {unit}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Prev
        </Button>
        {pageNums.map((n) => (
          <Button
            key={n}
            variant={n === page ? "default" : "outline"}
            size="sm"
            className={
              "h-8 w-8 p-0 " + (n === page ? "bg-[#1B4D3E] text-white hover:bg-[#163F33]" : "")
            }
            onClick={() => onPage(n)}
            aria-current={n === page ? "page" : undefined}
          >
            {n}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
