// Cases list at /cases. One row per credentialing case (provider + payer +
// state) with filters, a stalled quick filter, and a summary strip.
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
import { StatusPill, hexToStatusColor, type StatusColor } from '@/components/StatusPill';
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
      const isStalled = daysSinceTouch === null ? true : daysSinceTouch >= 14;
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

  // Summary counts (pre-filter, for the whole org)
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

  // Filter
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

  // Sort by days open desc default (null at the bottom)
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a.daysOpen ?? -Infinity;
      const bv = b.daysOpen ?? -Infinity;
      return bv - av;
    });
  }, [filtered]);

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

  return (
    <div>
      <PageHeader
        title="Cases"
        actions={
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {casesQ.isSuccess ? `${sorted.length} cases` : null}
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
          <SelectTrigger className="h-9 w-[160px]">
            <SelectValue placeholder="All Payers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Payers</SelectItem>
            {(payersQ.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={stateF} onValueChange={setStateF}>
          <SelectTrigger className="h-9 w-[140px]">
            <SelectValue placeholder="All States" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All States</SelectItem>
            {states.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={credStatusId} onValueChange={setCredStatusId}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="All Credentialing" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Credentialing</SelectItem>
            {(credStatusesQ.data ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={contractStatusId} onValueChange={setContractStatusId}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="All Group Contract" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Group Contract</SelectItem>
            {(contractStatusesQ.data ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={coordinatorId} onValueChange={setCoordinatorId}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="All Coordinators" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Coordinators</SelectItem>
            {(coordinatorsQ.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.fullName ?? p.email ?? p.id}
              </SelectItem>
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
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <Th>Provider</Th>
              <Th>Payer</Th>
              <Th>State</Th>
              <Th>Credentialing</Th>
              <Th>Group Contract</Th>
              <Th className="text-right">Last touch</Th>
              <Th className="text-right">Days open</Th>
              <Th>Coordinator</Th>
            </tr>
          </thead>
          <tbody>
            {casesQ.isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-border h-10">
                  {Array.from({ length: 8 }).map((__, j) => (
                    <td key={j} className="px-3">
                      <Skeleton className="h-4 w-20" />
                    </td>
                  ))}
                </tr>
              ))
            ) : casesQ.isError ? (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center">
                  <div className="text-[13px] text-foreground mb-3">
                    Failed to load cases.
                  </div>
                  <Button variant="outline" size="sm" onClick={() => casesQ.refetch()}>
                    Retry
                  </Button>
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-12 text-center text-[13px] text-muted-foreground"
                >
                  {hasActiveFilter ? (
                    <>
                      <div className="mb-3">No cases match these filters.</div>
                      <Button variant="outline" size="sm" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    </>
                  ) : (
                    <>No cases yet</>
                  )}
                </td>
              </tr>
            ) : (
              sorted.map((e) => (
                <CaseRow
                  key={e.c.id}
                  data={e}
                  onOpen={() =>
                    navigate({ to: '/cases/$id', params: { id: e.c.id } })
                  }
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground px-3 h-9 ${className}`}
    >
      {children}
    </th>
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
        <div
          key={it.label}
          className="border border-border rounded-md p-4 bg-background"
        >
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {it.label}
          </div>
          <div className="mt-1 text-[20px] font-semibold tabular-nums text-foreground">
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}

interface CaseRowProps {
  data: EnrichedCase;
  onOpen: () => void;
}

function CaseRow({ data, onOpen }: CaseRowProps) {
  const {
    c,
    provider,
    group,
    payer,
    credStatus,
    contractStatus,
    coordinator,
    daysOpen,
    daysSinceTouch,
  } = data;

  const providerName = provider
    ? `${provider.firstName} ${provider.lastName}${
        provider.credentials ? `, ${provider.credentials}` : ''
      }`
    : '—';

  const isTerminated = provider?.status === 'terminated';

  return (
    <tr
      onClick={onOpen}
      className={`border-b border-border h-10 cursor-pointer hover:bg-muted/40 ${isTerminated ? 'opacity-60' : ''}`}
    >
      <td className="px-3 py-1.5">
        <div className="font-medium text-foreground leading-tight">{providerName}</div>
        <div className="text-[12px] text-muted-foreground leading-tight">
          {group?.name ?? '—'}
        </div>
      </td>
      <td className="px-3 text-foreground">{payer?.name ?? '—'}</td>
      <td className="px-3 text-foreground">{c.state}</td>
      <td className="px-3 py-1.5">
        {credStatus ? (
          <StatusPill
            status={hexToStatusColor(credStatus.color)}
            label={credStatus.label}
          />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-1.5">
        {contractStatus ? (
          <StatusPill
            status={hexToStatusColor(contractStatus.color)}
            label={contractStatus.label}
          />
        ) : (
          <StatusPill status="gray" label="No contract" />
        )}
      </td>
      <td className="px-3 text-right tabular-nums">
        {daysSinceTouch === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span
            className={daysSinceTouch >= 14 ? 'text-[#DC2626] font-medium' : 'text-foreground'}
          >
            {daysSinceTouch}d
          </span>
        )}
      </td>
      <td className="px-3 text-right text-foreground tabular-nums">
        {daysOpen !== null ? `${daysOpen}d` : '—'}
      </td>
      <td className="px-3 text-foreground">{coordinator?.fullName ?? '—'}</td>
    </tr>
  );
}
