// Cases list at /cases. One row per credentialing case (provider + payer +
// state) with filters, sortable headers, column picker, persisted prefs,
// infinite scroll, and a summary strip.
import React, { useDeferredValue, useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { differenceInDays, parseISO } from 'date-fns';
import { Search } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TableSkeletonRows } from '@/components/TableSkeletonRows';
import { EmptyState } from '@/components/EmptyState';
import { StatusPill, hexToStatusColor } from '@/components/StatusPill';
import {
  ColumnPicker,
  InfiniteScrollSentinel,
  SortableTh,
  compareForSort,
  useInfiniteRows,
} from '@/components/shared/TableToolkit';
import { useTablePrefs } from '@/hooks/useTablePrefs';
import { useDebounced } from '@/hooks/useDebounced';
import { useCases } from '@/hooks/useCases';
import { useProviders } from '@/hooks/useProviders';
import { useContracts } from '@/hooks/useContracts';
import { useLastTouchDates } from '@/hooks/useTouches';
import { usePayers, useStatusConfigs } from '@/hooks/useAdmin';
import { useProviderGroups, useCoordinators } from '@/hooks/useLookups';
import type {
  Contract,
  CredentialCase,
  Payer,
  Profile,
  Provider,
  ProviderGroup,
  StatusConfig,
} from '@/types';

export const Route = createFileRoute('/cases/')({
  component: CasesListPage,
});

const ALL = '__all__';

type ColumnKey =
  | 'provider'
  | 'payer'
  | 'state'
  | 'credentialing'
  | 'groupContract'
  | 'lastTouch'
  | 'daysOpen'
  | 'coordinator';

const COLUMN_DEFS: { key: ColumnKey; label: string }[] = [
  { key: 'provider', label: 'Provider' },
  { key: 'payer', label: 'Payer' },
  { key: 'state', label: 'State' },
  { key: 'credentialing', label: 'Credentialing' },
  { key: 'groupContract', label: 'Group Contract' },
  { key: 'lastTouch', label: 'Last touch' },
  { key: 'daysOpen', label: 'Days open' },
  { key: 'coordinator', label: 'Coordinator' },
];
const ALL_KEYS = COLUMN_DEFS.map((c) => c.key);
const DEFAULT_VISIBILITY: Record<ColumnKey, boolean> = {
  provider: true,
  payer: true,
  state: true,
  credentialing: true,
  groupContract: true,
  lastTouch: true,
  daysOpen: true,
  coordinator: true,
};

interface EnrichedCase {
  c: CredentialCase;
  provider: Provider | null;
  group: ProviderGroup | null;
  payer: Payer | null;
  credStatus: StatusConfig | null;
  contractStatus: StatusConfig | null;
  coordinator: Profile | null;
  daysOpen: number | null;
  lastTouchDate: string | null;
  daysSinceTouch: number | null;
  isStalled: boolean;
}

function CasesListPage() {
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [payerId, setPayerId] = useState<string>(ALL);
  const [stateF, setStateF] = useState<string>(ALL);
  const [credStatusId, setCredStatusId] = useState<string>(ALL);
  const [contractStatusId, setContractStatusId] = useState<string>(ALL);
  const [coordinatorId, setCoordinatorId] = useState<string>(ALL);
  const [stalled, setStalled] = useState(false);

  const { state: prefs, setVisible, cycleSort } = useTablePrefs<ColumnKey>({
    pageKey: 'cases',
    defaults: { visibleCols: DEFAULT_VISIBILITY, sort: { key: 'provider', dir: 'asc' } },
    allKeys: ALL_KEYS,
  });
  const visibleCols = prefs.visibleCols;
  // Local override so header clicks always reorder immediately, even before the
  // persisted prefs row loads. Persistence still runs via cycleSort in useTablePrefs.
  const [localSort, setLocalSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const effectiveSort =
    localSort ?? prefs.sort ?? { key: 'provider', dir: 'asc' as const };

  const handleSort = (key: string) => {
    setLocalSort((cur) => {
      const active = cur ?? prefs.sort ?? { key: 'provider', dir: 'asc' as const };
      const nextDir: 'asc' | 'desc' =
        active.key === key && active.dir === 'asc' ? 'desc' : 'asc';
      return { key, dir: nextDir };
    });
    cycleSort(key);
  };

  const debouncedSearch = useDebounced(search, 300);
  const deferredSearch = useDeferredValue(debouncedSearch);

  const casesQ = useCases({});
  const providersQ = useProviders({});
  const contractsQ = useContracts();
  const payersQ = usePayers();
  const credStatusesQ = useStatusConfigs('credentialing');
  const contractStatusesQ = useStatusConfigs('contracting');
  const groupsQ = useProviderGroups();
  const coordinatorsQ = useCoordinators();
  const lastTouchesQ = useLastTouchDates();

  const providerById = useMemo(() => {
    const m = new Map<string, Provider>();
    (providersQ.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [providersQ.data]);

  const groupById = useMemo(() => {
    const m = new Map<string, ProviderGroup>();
    (groupsQ.data ?? []).forEach((g) => m.set(g.id, g));
    return m;
  }, [groupsQ.data]);

  const payerById = useMemo(() => {
    const m = new Map<string, Payer>();
    (payersQ.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [payersQ.data]);

  const statusById = useMemo(() => {
    const m = new Map<string, StatusConfig>();
    [...(credStatusesQ.data ?? []), ...(contractStatusesQ.data ?? [])].forEach((s) =>
      m.set(s.id, s),
    );
    return m;
  }, [credStatusesQ.data, contractStatusesQ.data]);

  const coordinatorById = useMemo(() => {
    const m = new Map<string, Profile>();
    (coordinatorsQ.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [coordinatorsQ.data]);

  const contractByKey = useMemo(() => {
    const m = new Map<string, Contract>();
    (contractsQ.data ?? []).forEach((ct) => {
      if (!ct.payerId) return;
      m.set(`${ct.groupId ?? ''}|${ct.payerId}|${ct.state}`, ct);
    });
    return m;
  }, [contractsQ.data]);

  const lastTouchByCase = lastTouchesQ.data;

  const enriched: EnrichedCase[] = useMemo(() => {
    return (casesQ.data ?? []).map((c) => {
      const provider = providerById.get(c.providerId) ?? null;
      const group = c.groupId ? groupById.get(c.groupId) ?? null : null;
      const payer = payerById.get(c.payerId) ?? null;
      const credStatus = c.credentialingStatusId
        ? statusById.get(c.credentialingStatusId) ?? null
        : null;
      const contract = contractByKey.get(`${c.groupId ?? ''}|${c.payerId}|${c.state}`);
      const contractStatus = contract?.contractingStatusId
        ? statusById.get(contract.contractingStatusId) ?? null
        : null;
      const coordinator = c.assignedTo ? coordinatorById.get(c.assignedTo) ?? null : null;
      const daysOpen = c.submittedDate
        ? differenceInDays(new Date(), parseISO(c.submittedDate))
        : null;
      const lastTouchDate = lastTouchByCase?.get(c.id) ?? null;
      const daysSinceTouch = lastTouchDate
        ? differenceInDays(new Date(), parseISO(lastTouchDate))
        : null;
      const stalledAnchor = lastTouchDate ?? c.createdAt ?? null;
      const daysSinceAnchor = stalledAnchor
        ? differenceInDays(new Date(), parseISO(stalledAnchor))
        : null;
      const isStalled = daysSinceAnchor === null ? false : daysSinceAnchor >= 14;
      return {
        c,
        provider,
        group,
        payer,
        credStatus,
        contractStatus,
        coordinator,
        daysOpen,
        lastTouchDate,
        daysSinceTouch,
        isStalled,
      };
    });
  }, [
    casesQ.data,
    providerById,
    groupById,
    payerById,
    statusById,
    contractByKey,
    coordinatorById,
    lastTouchByCase,
  ]);

  const states = useMemo(() => {
    const set = new Set<string>();
    enriched.forEach((e) => e.c.state && set.add(e.c.state));
    return Array.from(set).sort();
  }, [enriched]);

  const summary = useMemo(() => {
    let total = enriched.length;
    let inProgress = 0;
    let awaiting = 0;
    let denied = 0;
    for (const e of enriched) {
      const label = (e.credStatus?.label ?? '').toLowerCase();
      if (
        label.includes('progress') ||
        label.includes('submitted') ||
        label.includes('review') ||
        label.includes('pending')
      ) {
        inProgress += 1;
      }
      if (label.includes('approved') || label.includes('await') || label.includes('effective')) {
        awaiting += 1;
      }
      if (label.includes('denied') || label.includes('appeal') || label.includes('reject')) {
        denied += 1;
      }
    }
    return { total, inProgress, awaiting, denied };
  }, [enriched]);

  const queryStr = deferredSearch.trim().toLowerCase();
  const filtered = useMemo(() => {
    return enriched.filter((e) => {
      if (queryStr) {
        const name = e.provider
          ? `${e.provider.firstName} ${e.provider.lastName}`.toLowerCase()
          : '';
        if (!name.includes(queryStr)) return false;
      }
      if (payerId !== ALL && e.c.payerId !== payerId) return false;
      if (stateF !== ALL && e.c.state !== stateF) return false;
      if (credStatusId !== ALL && e.c.credentialingStatusId !== credStatusId) return false;
      if (contractStatusId !== ALL) {
        if (!e.contractStatus || e.contractStatus.id !== contractStatusId) return false;
      }
      if (coordinatorId !== ALL && e.c.assignedTo !== coordinatorId) return false;
      if (stalled && !e.isStalled) return false;
      return true;
    });
  }, [enriched, queryStr, payerId, stateF, credStatusId, contractStatusId, coordinatorId, stalled]);

  function sortValueFor(e: EnrichedCase, key: string): string | number | null {
    switch (key) {
      case 'provider':
        return e.provider ? (e.provider.lastName || e.provider.firstName || '').trim() || null : null;
      case 'payer':
        return e.payer?.name ?? null;
      case 'state':
        return e.c.state ?? null;
      case 'credentialing':
        return e.credStatus?.label ?? null;
      case 'groupContract':
        return e.contractStatus?.label ?? null;
      case 'lastTouch':
        return e.daysSinceTouch;
      case 'daysOpen':
        return e.daysOpen;
      case 'coordinator':
        return e.coordinator?.fullName ?? null;
      default:
        return null;
    }
  }

  const sorted = useMemo(() => {
    const rows = [...filtered];
    const { key, dir } = effectiveSort;
    rows.sort((a, b) => compareForSort(sortValueFor(a, key), sortValueFor(b, key), dir));
    return rows;
  }, [filtered, effectiveSort.key, effectiveSort.dir]);

  const resetKey = `${effectiveSort.key}|${effectiveSort.dir}|${queryStr}|${payerId}|${stateF}|${credStatusId}|${contractStatusId}|${coordinatorId}|${stalled}`;
  const { visible, hasMore, loadingMore, sentinelRef, total } = useInfiniteRows({
    items: sorted,
    resetKey,
  });

  function clearFilters() {
    setSearch('');
    setPayerId(ALL);
    setStateF(ALL);
    setCredStatusId(ALL);
    setContractStatusId(ALL);
    setCoordinatorId(ALL);
    setStalled(false);
  }

  const hasActiveFilter =
    Boolean(queryStr) ||
    payerId !== ALL ||
    stateF !== ALL ||
    credStatusId !== ALL ||
    contractStatusId !== ALL ||
    coordinatorId !== ALL ||
    stalled;

  const visibleCount = COLUMN_DEFS.filter((c) => visibleCols[c.key]).length;

  return (
    <div>
      <PageHeader
        title="Cases"
        actions={
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {casesQ.isSuccess ? `${total} cases` : null}
          </span>
        }
      />

      <SummaryStrip
        total={summary.total}
        inProgress={summary.inProgress}
        awaiting={summary.awaiting}
        denied={summary.denied}
      />

      <div className="flex items-center gap-3 mb-4 mt-4 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search provider name..."
            className="pl-9 h-9"
          />
        </div>

        <Select value={payerId} onValueChange={setPayerId}>
          <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="All Payers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Payers</SelectItem>
            {(payersQ.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={stateF} onValueChange={setStateF}>
          <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="All States" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All States</SelectItem>
            {states.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={credStatusId} onValueChange={setCredStatusId}>
          <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="All Credentialing" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Credentialing</SelectItem>
            {(credStatusesQ.data ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={contractStatusId} onValueChange={setContractStatusId}>
          <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="All Group Contract" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Group Contract</SelectItem>
            {(contractStatusesQ.data ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={coordinatorId} onValueChange={setCoordinatorId}>
          <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="All Coordinators" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Coordinators</SelectItem>
            {(coordinatorsQ.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.fullName ?? p.email ?? p.id}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant={stalled ? 'default' : 'outline'}
          size="sm"
          className="h-9"
          onClick={() => setStalled((v) => !v)}
        >
          Stalled
        </Button>

        {hasActiveFilter ? (
          <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
            Clear
          </Button>
        ) : null}

        <div className="ml-auto">
          <ColumnPicker
            columns={COLUMN_DEFS}
            visible={visibleCols}
            onChange={setVisible}
            lockedKeys={['provider']}
          />
        </div>
      </div>

      <div className="border border-border rounded-md">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-10 bg-muted/30 backdrop-blur">
            <tr className="border-b border-border">
              {visibleCols.provider && <SortableTh label="Provider" sortKey="provider" sort={effectiveSort} onSort={handleSort} />}
              {visibleCols.payer && <SortableTh label="Payer" sortKey="payer" sort={effectiveSort} onSort={handleSort} />}
              {visibleCols.state && <SortableTh label="State" sortKey="state" sort={effectiveSort} onSort={handleSort} />}
              {visibleCols.credentialing && <SortableTh label="Credentialing" sortKey="credentialing" sort={effectiveSort} onSort={handleSort} />}
              {visibleCols.groupContract && <SortableTh label="Group Contract" sortKey="groupContract" sort={effectiveSort} onSort={handleSort} />}
              {visibleCols.lastTouch && <SortableTh label="Last touch" sortKey="lastTouch" sort={effectiveSort} onSort={handleSort} align="right" />}
              {visibleCols.daysOpen && <SortableTh label="Days open" sortKey="daysOpen" sort={effectiveSort} onSort={handleSort} align="right" />}
              {visibleCols.coordinator && <SortableTh label="Coordinator" sortKey="coordinator" sort={effectiveSort} onSort={handleSort} />}
            </tr>
          </thead>
          <tbody>
            {casesQ.isLoading ? (
              <TableSkeletonRows rows={8} cols={visibleCount} />
            ) : casesQ.isError ? (
              <tr>
                <td colSpan={visibleCount} className="px-3 py-12 text-center">
                  <div className="text-[13px] text-foreground mb-3">Failed to load cases.</div>
                  <Button variant="outline" size="sm" onClick={() => casesQ.refetch()}>Retry</Button>
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={visibleCount} className="px-3 py-12 text-center">
                  <EmptyState
                    message={hasActiveFilter ? 'No cases match these filters' : 'No cases yet'}
                    action={hasActiveFilter ? (
                      <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>
                    ) : undefined}
                  />
                </td>
              </tr>
            ) : (
              visible.map((e) => (
                <CaseRow
                  key={e.c.id}
                  data={e}
                  visibleCols={visibleCols}
                  onOpen={() => navigate({ to: '/cases/$id', params: { id: e.c.id } })}
                />
              ))
            )}
          </tbody>
        </table>
        <InfiniteScrollSentinel sentinelRef={sentinelRef} hasMore={hasMore} loadingMore={loadingMore} />
      </div>
    </div>
  );
}

interface SummaryStripProps {
  total: number;
  inProgress: number;
  awaiting: number;
  denied: number;
}

function SummaryStrip({ total, inProgress, awaiting, denied }: SummaryStripProps) {
  const items: { label: string; value: number }[] = [
    { label: 'Total cases', value: total },
    { label: 'In progress', value: inProgress },
    { label: 'Awaiting effective date', value: awaiting },
    { label: 'Denied / Appeal', value: denied },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((it) => (
        <div key={it.label} className="border border-border rounded-md p-4 bg-background">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{it.label}</div>
          <div className="mt-1 text-[20px] font-semibold tabular-nums text-foreground">{it.value}</div>
        </div>
      ))}
    </div>
  );
}

interface CaseRowProps {
  data: EnrichedCase;
  visibleCols: Record<ColumnKey, boolean>;
  onOpen: () => void;
}

function CaseRow({ data, visibleCols, onOpen }: CaseRowProps) {
  const { c, provider, group, payer, credStatus, contractStatus, coordinator, daysOpen, daysSinceTouch } = data;

  const providerName = provider
    ? `${provider.firstName} ${provider.lastName}${provider.credentials ? `, ${provider.credentials}` : ''}`
    : '—';
  const isTerminated = provider?.status === 'terminated';

  return (
    <tr
      onClick={onOpen}
      className={`border-b border-border h-10 cursor-pointer hover:bg-muted/40 ${isTerminated ? 'opacity-60' : ''}`}
    >
      {visibleCols.provider && (
        <td className="px-3 py-1.5">
          <div className="font-medium text-foreground leading-tight">{providerName}</div>
          <div className="text-[12px] text-muted-foreground leading-tight">{group?.name ?? '—'}</div>
        </td>
      )}
      {visibleCols.payer && <td className="px-3 text-foreground">{payer?.name ?? '—'}</td>}
      {visibleCols.state && <td className="px-3 text-foreground">{c.state}</td>}
      {visibleCols.credentialing && (
        <td className="px-3 py-1.5">
          {credStatus ? (
            <StatusPill status={hexToStatusColor(credStatus.color)} label={credStatus.label} />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      )}
      {visibleCols.groupContract && (
        <td className="px-3 py-1.5">
          {contractStatus ? (
            <StatusPill status={hexToStatusColor(contractStatus.color)} label={contractStatus.label} />
          ) : (
            <StatusPill status="gray" label="No contract" />
          )}
        </td>
      )}
      {visibleCols.lastTouch && (
        <td className="px-3 text-right tabular-nums">
          {daysSinceTouch === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className={daysSinceTouch >= 14 ? 'text-[#DC2626] font-medium' : 'text-foreground'}>
              {daysSinceTouch}d
            </span>
          )}
        </td>
      )}
      {visibleCols.daysOpen && (
        <td className="px-3 text-right text-foreground tabular-nums">
          {daysOpen !== null ? `${daysOpen}d` : '—'}
        </td>
      )}
      {visibleCols.coordinator && <td className="px-3 text-foreground">{coordinator?.fullName ?? '—'}</td>}
    </tr>
  );
}
