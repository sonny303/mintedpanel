// Provider list screen at /providers. Shows per-payer credentialing status,
// CAQH age, and coordinator; supports search and Group/State/Payer/Status filters.
import React, { useDeferredValue, useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { differenceInDays, parseISO } from 'date-fns';
import { Plus, Search } from 'lucide-react';
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
import { StatusPill, hexToStatusColor, type StatusColor } from '@/components/StatusPill';
import { useDebounced } from '@/hooks/useDebounced';
import { useProviders } from '@/hooks/useProviders';
import { useCases } from '@/hooks/useCases';
import { useStatusConfigs, usePayers } from '@/hooks/useAdmin';
import { useProviderGroups, useCoordinators } from '@/hooks/useLookups';
import { useCanWrite } from '@/lib/permissions';
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

function ProvidersListPage() {
  const navigate = useNavigate();
  const canEdit = useCanWrite();

  const [search, setSearch] = useState('');
  const [groupId, setGroupId] = useState<string>(ALL);
  const [state, setState] = useState<string>(ALL);
  const [payerId, setPayerId] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);

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

  const providers = providersQ.data ?? [];

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

        <div className="ml-auto">
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
              <Th>Provider</Th>
              <Th>Group</Th>
              <Th>State</Th>
              <Th>Payer Statuses</Th>
              <Th className="text-right">CAQH</Th>
              <Th>Coordinator</Th>
            </tr>
          </thead>
          <tbody>
            {providersQ.isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-border h-10">
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-3"><Skeleton className="h-4 w-24" /></td>
                  ))}
                </tr>
              ))
            ) : providersQ.isError ? (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center">
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
                <td colSpan={6} className="px-3 py-12 text-center">
                  {hasActiveFilter ? (
                    <>
                      <div className="text-[13px] text-muted-foreground mb-3">
                        No providers match these filters.
                      </div>
                      <Button variant="outline" size="sm" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="text-[13px] text-muted-foreground mb-3">
                        No providers yet.
                      </div>
                      {canEdit ? (
                        <Button size="sm" onClick={() => navigate({ to: '/providers/new' })}>
                          Add provider
                        </Button>
                      ) : null}
                    </>
                  )}
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
                  coordinatorById={coordinatorById}
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

interface RowProps {
  provider: Provider;
  group: ProviderGroup | null;
  cases: CredentialCase[];
  payerById: Map<string, Payer>;
  statusById: Map<string, StatusConfig>;
  coordinatorById: Map<string, Profile>;
  onOpen: () => void;
}

function ProviderRow({ provider, group, cases, payerById, statusById, coordinatorById, onOpen }: RowProps) {
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

  const coordinatorName = (() => {
    const withCoord = cases
      .filter((c) => c.assignedTo)
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    const id = withCoord[0]?.assignedTo;
    if (!id) return '—';
    return coordinatorById.get(id)?.fullName ?? '—';
  })();

  return (
    <tr
      onClick={onOpen}
      className={`border-b border-border h-10 cursor-pointer hover:bg-muted/40 ${isTerminated ? 'opacity-60' : ''}`}
    >
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
      <td className="px-3 whitespace-nowrap">
        {group ? (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-[20px] text-[12px] font-medium border border-border bg-muted text-foreground">
            {group.name}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 text-foreground">{provider.homeState ?? '—'}</td>
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
      <td className="px-3 text-right">{caqh}</td>
      <td className="px-3 text-foreground">{coordinatorName}</td>
    </tr>
  );
}
