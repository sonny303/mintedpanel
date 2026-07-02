// Provider list screen at /providers. Shows per-payer credentialing status,
// CAQH age, and coordinator; supports search, filters, column sorting, and column visibility.
import React, { useDeferredValue, useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { differenceInDays, parseISO } from 'date-fns';
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Plus, Search } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TableSkeletonRows } from '@/components/TableSkeletonRows';
import { EmptyState } from '@/components/EmptyState';
import { StatusPill, hexToStatusColor } from '@/components/StatusPill';
import { useDebounced } from '@/hooks/useDebounced';
import { useProviders } from '@/hooks/useProviders';
import { useCases } from '@/hooks/useCases';
import { useStatusConfigs, usePayers } from '@/hooks/useAdmin';
import { useProviderGroups, useCoordinators } from '@/hooks/useLookups';
import { useCanWrite } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import type { CredentialCase, Payer, Profile, Provider, ProviderGroup, ProviderStatus, StatusConfig } from '@/types';

export const Route = createFileRoute('/providers/')({
  component: ProvidersListPage,
});

const ALL = '__all__';
const STATUS_OPTIONS: { value: ProviderStatus; label: string }[] = [
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'active', label: 'Active' },
  { value: 'terminated', label: 'Terminated' },
];

type SortKey = 'provider' | 'group' | 'status' | 'state' | 'coordinator';
type SortDir = 'asc' | 'desc';
interface SortState {
  key: SortKey;
  dir: SortDir;
}
const DEFAULT_SORT: SortState = { key: 'provider', dir: 'asc' };

type ColumnKey = 'provider' | 'group' | 'status' | 'state' | 'payerStatuses' | 'caqh' | 'coordinator';
const COLUMN_DEFS: { key: ColumnKey; label: string }[] = [
  { key: 'provider', label: 'Provider' },
  { key: 'group', label: 'Group' },
  { key: 'status', label: 'Status' },
  { key: 'state', label: 'State' },
  { key: 'payerStatuses', label: 'Payer Statuses' },
  { key: 'caqh', label: 'CAQH' },
  { key: 'coordinator', label: 'Coordinator' },
];
const DEFAULT_VISIBILITY: Record<ColumnKey, boolean> = {
  provider: true,
  group: true,
  status: true,
  state: true,
  payerStatuses: true,
  caqh: false,
  coordinator: true,
};

const STATUS_LABEL: Record<ProviderStatus, string> = {
  onboarding: 'Onboarding',
  active: 'Active',
  terminated: 'Terminated',
};
const STATUS_COLOR: Record<ProviderStatus, 'blue' | 'green' | 'gray'> = {
  onboarding: 'blue',
  active: 'green',
  terminated: 'gray',
};
const STATUS_SORT_RANK: Record<ProviderStatus, number> = {
  onboarding: 0,
  active: 1,
  terminated: 2,
};

function ProvidersListPage() {
  const navigate = useNavigate();
  const canEdit = useCanWrite();

  const [search, setSearch] = useState('');
  const [groupId, setGroupId] = useState<string>(ALL);
  const [state, setState] = useState<string>(ALL);
  const [payerId, setPayerId] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [sort, setSort] = useState<SortState | null>(null);
  const [visibleCols, setVisibleCols] = useState<Record<ColumnKey, boolean>>(DEFAULT_VISIBILITY);

  const debouncedSearch = useDebounced(search, 300);
  const deferredSearch = useDeferredValue(debouncedSearch);

  const filters = useMemo(
    () => ({
      search: deferredSearch.trim() || undefined,
      groupId: groupId === ALL ? undefined : groupId,
      state: state === ALL ? undefined : state,
      payerId: payerId === ALL ? undefined : payerId,
      status: status === ALL ? undefined : (status as ProviderStatus),
    }),
    [deferredSearch, groupId, state, payerId, status],
  );

  const providersQ = useProviders(filters);
  const casesQ = useCases({});
  const payersQ = usePayers();
  const groupsQ = useProviderGroups();
  const statusesQ = useStatusConfigs('credentialing');
  const coordinatorsQ = useCoordinators();

  const payerById = useMemo(() => {
    const m = new Map<string, Payer>();
    (payersQ.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [payersQ.data]);

  const groupById = useMemo(() => {
    const m = new Map<string, ProviderGroup>();
    (groupsQ.data ?? []).forEach((g) => m.set(g.id, g));
    return m;
  }, [groupsQ.data]);

  const statusById = useMemo(() => {
    const m = new Map<string, StatusConfig>();
    (statusesQ.data ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [statusesQ.data]);

  const coordinatorById = useMemo(() => {
    const m = new Map<string, Profile>();
    (coordinatorsQ.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [coordinatorsQ.data]);

  const casesByProvider = useMemo(() => {
    const m = new Map<string, CredentialCase[]>();
    (casesQ.data ?? []).forEach((c) => {
      const arr = m.get(c.providerId) ?? [];
      arr.push(c);
      m.set(c.providerId, arr);
    });
    return m;
  }, [casesQ.data]);

  const states = useMemo(() => {
    const set = new Set<string>();
    (providersQ.data ?? []).forEach((p) => p.homeState && set.add(p.homeState));
    return Array.from(set).sort();
  }, [providersQ.data]);

  function clearFilters() {
    setSearch('');
    setGroupId(ALL);
    setState(ALL);
    setPayerId(ALL);
    setStatus(ALL);
  }

  const hasActiveFilter =
    Boolean(deferredSearch.trim()) ||
    groupId !== ALL ||
    state !== ALL ||
    payerId !== ALL ||
    status !== ALL;

  function coordinatorNameFor(p: Provider): string | null {
    const cases = casesByProvider.get(p.id) ?? [];
    const withCoord = cases
      .filter((c) => c.assignedTo)
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    const id = withCoord[0]?.assignedTo;
    if (!id) return null;
    return coordinatorById.get(id)?.fullName ?? null;
  }

  function sortValueFor(p: Provider, key: SortKey): string | null {
    switch (key) {
      case 'provider':
        return (p.lastName || p.firstName || '').trim() || null;
      case 'group':
        return p.groupId ? groupById.get(p.groupId)?.name ?? null : null;
      case 'status':
        return p.status ? String(STATUS_SORT_RANK[p.status]) : null;
      case 'state':
        return p.homeState ?? null;
      case 'coordinator':
        return coordinatorNameFor(p);
    }
  }

  const effectiveSort = sort ?? DEFAULT_SORT;

  const providers = useMemo(() => {
    const rows = [...(providersQ.data ?? [])];
    const { key, dir } = effectiveSort;
    const mult = dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const av = sortValueFor(a, key);
      const bv = sortValueFor(b, key);
      const aEmpty = !av;
      const bEmpty = !bv;
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      const cmp = av.localeCompare(bv, undefined, { sensitivity: 'base', numeric: true });
      if (cmp !== 0) return cmp * mult;
      const at = `${a.lastName} ${a.firstName}`.trim();
      const bt = `${b.lastName} ${b.firstName}`.trim();
      return at.localeCompare(bt, undefined, { sensitivity: 'base' });
    });
    return rows;
  }, [providersQ.data, effectiveSort, groupById, coordinatorById, casesByProvider]);

  function onSort(key: SortKey) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }

  const visibleCount = COLUMN_DEFS.filter((c) => visibleCols[c.key]).length;

  return (
    <div>
      <PageHeader
        title="Providers"
        actions={
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {providersQ.isSuccess ? `${providers.length} providers` : null}
          </span>
        }
      />

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or NPI..."
            className="pl-9 h-9"
          />
        </div>

        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="All Groups" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Groups</SelectItem>
            {(groupsQ.data ?? []).map((g) => (
              <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={state} onValueChange={setState}>
          <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="All States" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All States</SelectItem>
            {states.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={payerId} onValueChange={setPayerId}>
          <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="All Payers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Payers</SelectItem>
            {(payersQ.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Statuses</SelectItem>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-9 gap-2">
                <Columns3 className="h-4 w-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {COLUMN_DEFS.map((c) => {
                const locked = c.key === 'provider';
                return (
                  <DropdownMenuCheckboxItem
                    key={c.key}
                    checked={visibleCols[c.key]}
                    disabled={locked}
                    onCheckedChange={(v) =>
                      setVisibleCols((prev) => ({ ...prev, [c.key]: Boolean(v) }))
                    }
                    onSelect={(e) => e.preventDefault()}
                  >
                    {c.label}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {canEdit ? (
            <Button
              onClick={() => navigate({ to: '/providers/new' })}
              className="h-9 gap-2"
            >
              <Plus className="h-4 w-4" />
              Add provider
            </Button>
          ) : null}
        </div>
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {visibleCols.provider && (
                <SortableTh label="Provider" sortKey="provider" sort={effectiveSort} onSort={onSort} />
              )}
              {visibleCols.group && (
                <SortableTh label="Group" sortKey="group" sort={effectiveSort} onSort={onSort} />
              )}
              {visibleCols.status && (
                <SortableTh label="Status" sortKey="status" sort={effectiveSort} onSort={onSort} />
              )}
              {visibleCols.state && (
                <SortableTh label="State" sortKey="state" sort={effectiveSort} onSort={onSort} />
              )}
              {visibleCols.payerStatuses && <Th>Payer Statuses</Th>}
              {visibleCols.caqh && <Th className="text-right">CAQH</Th>}
              {visibleCols.coordinator && (
                <SortableTh label="Coordinator" sortKey="coordinator" sort={effectiveSort} onSort={onSort} />
              )}
            </tr>
          </thead>
          <tbody>
            {providersQ.isLoading ? (
              <TableSkeletonRows rows={8} cols={visibleCount} />
            ) : providersQ.isError ? (
              <tr>
                <td colSpan={visibleCount} className="px-3 py-12 text-center">
                  <div className="text-[13px] text-foreground mb-3">
                    Failed to load providers.
                  </div>
                  <Button variant="outline" size="sm" onClick={() => providersQ.refetch()}>
                    Retry
                  </Button>
                </td>
              </tr>
            ) : providers.length === 0 ? (
              <tr>
                <td colSpan={visibleCount} className="px-3 py-12 text-center">
                  <EmptyState
                    message={hasActiveFilter ? 'No providers match these filters' : 'No providers yet'}
                    action={
                      hasActiveFilter ? (
                        <Button variant="outline" size="sm" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      ) : canEdit ? (
                        <Button size="sm" onClick={() => navigate({ to: '/providers/new' })}>
                          Add provider
                        </Button>
                      ) : undefined
                    }
                  />
                </td>
              </tr>
            ) : (
              providers.map((p) => (
                <ProviderRow
                  key={p.id}
                  provider={p}
                  group={p.groupId ? groupById.get(p.groupId) ?? null : null}
                  cases={casesByProvider.get(p.id) ?? []}
                  payerById={payerById}
                  statusById={statusById}
                  coordinatorName={coordinatorNameFor(p)}
                  visibleCols={visibleCols}
                  onOpen={() => navigate({ to: '/providers/$id', params: { id: p.id } })}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground px-3 h-9 ${className}`}
    >
      {children}
    </th>
  );
}

interface SortableThProps {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
}

function SortableTh({ label, sortKey, sort, onSort }: SortableThProps) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className="text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground px-3 h-9">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="group inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground"
      >
        <span>{label}</span>
        <Icon
          className={cn(
            'h-3 w-3',
            active ? 'text-foreground opacity-100' : 'opacity-0 group-hover:opacity-60',
          )}
        />
      </button>
    </th>
  );
}

interface RowProps {
  provider: Provider;
  group: ProviderGroup | null;
  cases: CredentialCase[];
  payerById: Map<string, Payer>;
  statusById: Map<string, StatusConfig>;
  coordinatorName: string | null;
  visibleCols: Record<ColumnKey, boolean>;
  onOpen: () => void;
}

function ProviderRow({ provider, group, cases, payerById, statusById, coordinatorName, visibleCols, onOpen }: RowProps) {
  const isTerminated = provider.status === 'terminated';

  const caqh = (() => {
    if (!provider.caqhLastAttestedDate) {
      return <span className="text-muted-foreground">—</span>;
    }
    const days = differenceInDays(new Date(), parseISO(provider.caqhLastAttestedDate));
    const cls =
      days >= 110 ? 'text-[#DC2626] font-medium'
      : days >= 90 ? 'text-[#D97706] font-medium'
      : 'text-foreground';
    return <span className={`${cls} tabular-nums`}>{days}d</span>;
  })();

  return (
    <tr
      onClick={onOpen}
      className={`border-b border-border h-10 cursor-pointer hover:bg-muted/40 ${isTerminated ? 'opacity-60' : ''}`}
    >
      {visibleCols.provider && (
        <td className="px-3 py-1.5">
          <div className="font-medium text-foreground leading-tight">
            {provider.firstName} {provider.lastName}
            {provider.credentials ? (
              <span className="text-muted-foreground font-normal">, {provider.credentials}</span>
            ) : null}
          </div>
          <div className="text-[12px] text-muted-foreground tabular-nums leading-tight">
            {provider.npi ?? '—'}
          </div>
        </td>
      )}
      {visibleCols.group && (
        <td className="px-3 whitespace-nowrap">
          {group ? (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-[20px] text-[12px] font-medium border border-border bg-muted text-foreground">
              {group.name}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      )}
      {visibleCols.status && (
        <td className="px-3 py-1.5">
          {provider.status ? (
            <StatusPill status={STATUS_COLOR[provider.status]} label={STATUS_LABEL[provider.status]} />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      )}
      {visibleCols.state && (
        <td className="px-3 text-foreground">{provider.homeState ?? '—'}</td>
      )}
      {visibleCols.payerStatuses && (
        <td className="px-3 py-1.5">
          {isTerminated ? (
            <StatusPill status="gray" label="Terminated" />
          ) : cases.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {cases.map((c) => {
                const payer = payerById.get(c.payerId);
                const sc = c.credentialingStatusId ? statusById.get(c.credentialingStatusId) : null;
                return (
                  <StatusPill
                    key={c.id}
                    status={hexToStatusColor(sc?.color)}
                    label={payer?.name ?? 'Payer'}
                  />
                );
              })}
            </div>
          )}
        </td>
      )}
      {visibleCols.caqh && (
        <td className="px-3 text-right">{caqh}</td>
      )}
      {visibleCols.coordinator && (
        <td className="px-3 text-foreground">{coordinatorName ?? '—'}</td>
      )}
    </tr>
  );
}
