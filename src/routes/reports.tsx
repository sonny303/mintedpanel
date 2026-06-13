// Reports at /reports — three tabs: Summary (manager overview),
// Contracts (group + payer + state workflow), Enrollment Matrix (providers × payers).
import { useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { Download, Plus } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { StatusPill, type StatusColor } from '@/components/StatusPill';
import {
  useContracts,
  useCreateContract,
  useUpdateContractStatus,
} from '@/hooks/useContracts';
import { useCases } from '@/hooks/useCases';
import { useProviders } from '@/hooks/useProviders';
import { useTasks } from '@/hooks/useTasks';
import { usePayers, useStatusConfigs } from '@/hooks/useAdmin';
import { useProviderGroups, useCoordinators } from '@/hooks/useLookups';
import { useRole, useActiveOrgId } from '@/lib/auth-store';
import { supabase } from '@/integrations/supabase/externalClient';
import { camelizeRow } from '@/lib/case';
import type { Contract, CredentialCase, StatusConfig, Touch } from '@/types';


interface ReportsSearch {
  tab?: 'summary' | 'contracts' | 'matrix';
}

export const Route = createFileRoute('/reports')({
  validateSearch: (s: Record<string, unknown>): ReportsSearch => {
    const tab = s.tab;
    if (tab === 'contracts' || tab === 'matrix' || tab === 'summary') return { tab };
    return {};
  },
  component: ReportsPage,
});

const ALL = '__all__';

function hexToStatusColor(hex: string | null | undefined): StatusColor {
  switch ((hex ?? '').toUpperCase()) {
    case '#2563EB':
      return 'blue';
    case '#D97706':
      return 'amber';
    case '#DC2626':
    case '#991B1B':
      return 'red';
    case '#0891B2':
      return 'teal';
    case '#059669':
      return 'green';
    default:
      return 'gray';
  }
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return format(parseISO(value), 'MMM dd, yyyy');
  } catch {
    return value;
  }
}

function isExecutedLabel(label: string | undefined | null): boolean {
  return (label ?? '').toLowerCase().includes('execut');
}
function isTerminatedLabel(label: string | undefined | null): boolean {
  return (label ?? '').toLowerCase().includes('terminat');
}

function ReportsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const initialTab = search.tab ?? 'contracts';

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" />
      <Tabs
        value={initialTab}
        onValueChange={(v) =>
          navigate({ search: { tab: v as ReportsSearch['tab'] }, replace: true })
        }
      >
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
          <TabsTrigger value="matrix">Enrollment Matrix</TabsTrigger>
        </TabsList>
        <TabsContent value="summary" className="pt-4">
          <SummaryTab />
        </TabsContent>

        <TabsContent value="contracts" className="pt-4">
          <ContractsTab />
        </TabsContent>
        <TabsContent value="matrix" className="pt-4">
          <EnrollmentMatrixTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Contracts tab
// ──────────────────────────────────────────────────────────────────────────

function ContractsTab() {
  const role = useRole();
  const canEdit = role === 'specialist' || role === 'admin';

  const contractsQ = useContracts();
  const casesQ = useCases();
  const groupsQ = useProviderGroups();
  const payersQ = usePayers();
  const statusesQ = useStatusConfigs('contracting');

  const [groupFilter, setGroupFilter] = useState<string>(ALL);
  const [payerFilter, setPayerFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [statusModalContract, setStatusModalContract] = useState<Contract | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const groupById = useMemo(
    () => new Map((groupsQ.data ?? []).map((g) => [g.id, g])),
    [groupsQ.data],
  );
  const payerById = useMemo(
    () => new Map((payersQ.data ?? []).map((p) => [p.id, p])),
    [payersQ.data],
  );
  const statusById = useMemo(
    () => new Map((statusesQ.data ?? []).map((s) => [s.id, s])),
    [statusesQ.data],
  );
  const providerCountByKey = useMemo(() => {
    const m = new Map<string, number>();
    (casesQ.data ?? []).forEach((c) => {
      if (!c.groupId) return;
      const k = `${c.groupId}|${c.payerId}|${c.state}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return m;
  }, [casesQ.data]);

  const filtered = useMemo(() => {
    return (contractsQ.data ?? []).filter((c) => {
      if (groupFilter !== ALL && c.groupId !== groupFilter) return false;
      if (payerFilter !== ALL && c.payerId !== payerFilter) return false;
      if (statusFilter !== ALL && c.contractingStatusId !== statusFilter) return false;
      return true;
    });
  }, [contractsQ.data, groupFilter, payerFilter, statusFilter]);

  const loading = contractsQ.isLoading || groupsQ.isLoading || payersQ.isLoading;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger className="h-9 w-[200px]">
                <SelectValue placeholder="Group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All groups</SelectItem>
                {(groupsQ.data ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={payerFilter} onValueChange={setPayerFilter}>
              <SelectTrigger className="h-9 w-[200px]">
                <SelectValue placeholder="Payer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All payers</SelectItem>
                {(payersQ.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[200px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {(statusesQ.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canEdit && (
            <Button
              className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-9"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1" /> Add contract
            </Button>
          )}
        </div>

        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[#FAFAF9] border-b border-border">
                <th className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium">
                  Group
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium">
                  Payer
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium">
                  State
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium">
                  Status
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium">
                  Effective
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium">
                  Expiration
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium">
                  Providers
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium">
                  Notes
                </th>
                <th className="px-3 h-10" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="p-3">
                    <Skeleton className="h-8 w-full" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="text-center py-12 text-muted-foreground text-[13px]"
                  >
                    No contracts match these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((c) => {
                  const group = c.groupId ? groupById.get(c.groupId) : null;
                  const payer = c.payerId ? payerById.get(c.payerId) : null;
                  const status = c.contractingStatusId
                    ? statusById.get(c.contractingStatusId)
                    : null;
                  const key = `${c.groupId ?? ''}|${c.payerId ?? ''}|${c.state}`;
                  const providerCount = providerCountByKey.get(key) ?? 0;
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-border last:border-b-0 hover:bg-[#FAFAF9]"
                    >
                      <td className="px-3 h-10 align-middle">{group?.name ?? '—'}</td>
                      <td className="px-3 h-10 align-middle">{payer?.name ?? '—'}</td>
                      <td className="px-3 h-10 align-middle">{c.state}</td>
                      <td className="px-3 h-10 align-middle">
                        {status ? (
                          <StatusPill
                            status={hexToStatusColor(status.color)}
                            label={status.label}
                          />
                        ) : (
                          <StatusPill status="gray" label="—" />
                        )}
                      </td>
                      <td className="px-3 h-10 align-middle">{fmtDate(c.effectiveDate)}</td>
                      <td className="px-3 h-10 align-middle">{fmtDate(c.expirationDate)}</td>
                      <td className="px-3 h-10 align-middle text-right tabular-nums">
                        {providerCount > 0 ? (
                          <Link
                            to="/cases"
                            className="text-[#1B4D3E] hover:underline"
                          >
                            {providerCount}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-3 h-10 align-middle max-w-[240px] truncate text-muted-foreground">
                        {c.notes ?? '—'}
                      </td>
                      <td className="px-3 h-10 align-middle text-right">
                        {canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[11px] px-2"
                            onClick={() => setStatusModalContract(c)}
                          >
                            Change status
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <StatusChangeModal
          contract={statusModalContract}
          statuses={statusesQ.data ?? []}
          onClose={() => setStatusModalContract(null)}
        />
        <AddContractModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          statuses={statusesQ.data ?? []}
        />
      </div>
    </TooltipProvider>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Status change modal
// ──────────────────────────────────────────────────────────────────────────

function StatusChangeModal({
  contract,
  statuses,
  onClose,
}: {
  contract: Contract | null;
  statuses: StatusConfig[];
  onClose: () => void;
}) {
  const updateM = useUpdateContractStatus();
  const [statusId, setStatusId] = useState<string>('');
  const [effectiveDate, setEffectiveDate] = useState<string>('');
  const [terminationReason, setTerminationReason] = useState<string>('');

  const open = contract !== null;
  const selected = statuses.find((s) => s.id === statusId) ?? null;
  const requiresEffective = isExecutedLabel(selected?.label);
  const requiresReason = isTerminatedLabel(selected?.label);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setStatusId('');
      setEffectiveDate('');
      setTerminationReason('');
      onClose();
    }
  }

  async function handleSubmit() {
    if (!contract || !statusId) return;
    if (requiresEffective && !effectiveDate) {
      toast.error('Effective date is required.');
      return;
    }
    if (requiresReason && !terminationReason.trim()) {
      toast.error('Termination reason is required.');
      return;
    }
    const metadata: Record<string, unknown> = {};
    if (requiresEffective) metadata.effectiveDate = effectiveDate;
    if (requiresReason) {
      const stamp = format(new Date(), 'MMM dd, yyyy');
      const prefix = contract.notes ? `${contract.notes}\n` : '';
      metadata.notes = `${prefix}[${stamp}] Terminated: ${terminationReason.trim()}`;
    }
    try {
      await updateM.mutateAsync({ contractId: contract.id, statusId, metadata });
      toast.success('Contract status updated.');
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change contract status</DialogTitle>
          <DialogDescription>
            Writes to status history and audit log.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>New status</Label>
            <Select value={statusId} onValueChange={setStatusId}>
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {requiresEffective && (
            <div className="space-y-1.5">
              <Label>
                Effective date <span className="text-[#DC2626]">*</span>
              </Label>
              <Input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </div>
          )}
          {requiresReason && (
            <div className="space-y-1.5">
              <Label>
                Termination reason <span className="text-[#DC2626]">*</span>
              </Label>
              <Textarea
                value={terminationReason}
                onChange={(e) => setTerminationReason(e.target.value)}
                rows={3}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
            disabled={!statusId || updateM.isPending}
            onClick={handleSubmit}
          >
            {updateM.isPending ? 'Saving…' : 'Update status'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Add contract modal
// ──────────────────────────────────────────────────────────────────────────

function AddContractModal({
  open,
  onClose,
  statuses,
}: {
  open: boolean;
  onClose: () => void;
  statuses: StatusConfig[];
}) {
  const createM = useCreateContract();
  const groupsQ = useProviderGroups();
  const payersQ = usePayers();

  const [groupId, setGroupId] = useState<string>('');
  const [payerId, setPayerId] = useState<string>('');
  const [state, setState] = useState<string>('');
  const [statusId, setStatusId] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  function handleOpenChange(next: boolean) {
    if (!next) {
      setGroupId('');
      setPayerId('');
      setState('');
      setStatusId('');
      setNotes('');
      onClose();
    }
  }

  async function handleSubmit() {
    if (!groupId || !payerId || !state.trim()) {
      toast.error('Group, payer, and state are required.');
      return;
    }
    try {
      await createM.mutateAsync({
        groupId,
        payerId,
        state: state.trim().toUpperCase(),
        contractingStatusId: statusId || null,
        notes: notes.trim() || null,
      });
      toast.success('Contract created.');
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create contract.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add contract</DialogTitle>
          <DialogDescription>
            One contract per group + payer + state.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              Group <span className="text-[#DC2626]">*</span>
            </Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger>
                <SelectValue placeholder="Select group" />
              </SelectTrigger>
              <SelectContent>
                {(groupsQ.data ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>
              Payer <span className="text-[#DC2626]">*</span>
            </Label>
            <Select value={payerId} onValueChange={setPayerId}>
              <SelectTrigger>
                <SelectValue placeholder="Select payer" />
              </SelectTrigger>
              <SelectContent>
                {(payersQ.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>
              State <span className="text-[#DC2626]">*</span>
            </Label>
            <Input
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="e.g. CA"
              maxLength={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Initial status</Label>
            <Select value={statusId} onValueChange={setStatusId}>
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
            disabled={createM.isPending}
            onClick={handleSubmit}
          >
            {createM.isPending ? 'Saving…' : 'Add contract'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Enrollment Matrix tab
// ──────────────────────────────────────────────────────────────────────────

function EnrollmentMatrixTab() {
  const casesQ = useCases();
  const providersQ = useProviders();
  const payersQ = usePayers();
  const statusesQ = useStatusConfigs('credentialing');
  const groupsQ = useProviderGroups();

  const [groupFilter, setGroupFilter] = useState<string>(ALL);
  const [stateFilter, setStateFilter] = useState<string>(ALL);

  const statusById = useMemo(
    () => new Map((statusesQ.data ?? []).map((s) => [s.id, s])),
    [statusesQ.data],
  );

  const stateOptions = useMemo(() => {
    const set = new Set<string>();
    (casesQ.data ?? []).forEach((c) => set.add(c.state));
    return Array.from(set).sort();
  }, [casesQ.data]);

  const filteredProviders = useMemo(() => {
    return (providersQ.data ?? [])
      .filter((p) => groupFilter === ALL || p.groupId === groupFilter)
      .sort((a, b) =>
        `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`),
      );
  }, [providersQ.data, groupFilter]);

  const payers = useMemo(
    () => (payersQ.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [payersQ.data],
  );

  // providerId → payerId → cases[]
  const cellMap = useMemo(() => {
    const m = new Map<string, Map<string, CredentialCase[]>>();
    (casesQ.data ?? []).forEach((c) => {
      if (stateFilter !== ALL && c.state !== stateFilter) return;
      let inner = m.get(c.providerId);
      if (!inner) {
        inner = new Map<string, CredentialCase[]>();
        m.set(c.providerId, inner);
      }
      const arr = inner.get(c.payerId) ?? [];
      arr.push(c);
      inner.set(c.payerId, arr);
    });
    return m;
  }, [casesQ.data, stateFilter]);

  const loading =
    casesQ.isLoading ||
    providersQ.isLoading ||
    payersQ.isLoading ||
    statusesQ.isLoading;

  if (loading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue placeholder="Group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All groups</SelectItem>
              {(groupsQ.data ?? []).map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All states</SelectItem>
              {stateOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="border border-border rounded-md overflow-auto max-h-[calc(100vh-260px)]">
          <table className="text-[13px] border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 bg-[#FAFAF9] border-b border-r border-border text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium min-w-[220px]">
                  Provider
                </th>
                {payers.map((p) => (
                  <th
                    key={p.id}
                    className="sticky top-0 z-10 bg-[#FAFAF9] border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium min-w-[140px] whitespace-nowrap"
                  >
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredProviders.length === 0 ? (
                <tr>
                  <td
                    colSpan={payers.length + 1}
                    className="text-center py-12 text-muted-foreground text-[13px]"
                  >
                    No providers match these filters.
                  </td>
                </tr>
              ) : (
                filteredProviders.map((prov) => {
                  const row = cellMap.get(prov.id);
                  return (
                    <tr key={prov.id} className="border-b border-border last:border-b-0">
                      <td className="sticky left-0 z-10 bg-background border-r border-border px-3 h-10 align-middle whitespace-nowrap">
                        <Link
                          to="/providers/$id"
                          params={{ id: prov.id }}
                          className="hover:underline"
                        >
                          {prov.lastName}, {prov.firstName}
                          {prov.credentials ? `, ${prov.credentials}` : ''}
                        </Link>
                      </td>
                      {payers.map((p) => {
                        const list = row?.get(p.id) ?? [];
                        if (list.length === 0) {
                          return (
                            <td
                              key={p.id}
                              className="px-3 h-10 align-middle text-[#9CA3AF] text-center"
                            >
                              —
                            </td>
                          );
                        }
                        if (list.length === 1) {
                          const cs = list[0];
                          const st = cs.credentialingStatusId
                            ? statusById.get(cs.credentialingStatusId)
                            : null;
                          return (
                            <td key={p.id} className="px-3 h-10 align-middle">
                              <Link
                                to="/cases/$id"
                                params={{ id: cs.id }}
                                className="inline-flex"
                              >
                                <StatusPill
                                  status={hexToStatusColor(st?.color)}
                                  label={`${cs.state} · ${st?.label ?? '—'}`}
                                />
                              </Link>
                            </td>
                          );
                        }
                        return (
                          <td key={p.id} className="px-3 h-10 align-middle">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Link
                                  to="/providers/$id"
                                  params={{ id: prov.id }}
                                  className="inline-flex items-center gap-1 text-[12px] font-medium text-[#1B4D3E] hover:underline"
                                >
                                  {list.length} states
                                </Link>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="space-y-1">
                                  {list.map((cs) => {
                                    const st = cs.credentialingStatusId
                                      ? statusById.get(cs.credentialingStatusId)
                                      : null;
                                    return (
                                      <div key={cs.id} className="text-[12px]">
                                        {cs.state} · {st?.label ?? '—'}
                                      </div>
                                    );
                                  })}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Summary tab
// ──────────────────────────────────────────────────────────────────────────

function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const escape = (v: string | number | null | undefined): string => {
    const s = v === null || v === undefined ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = rows.map((r) => r.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function SummaryTab() {
  const orgId = useActiveOrgId() ?? 'no-org';
  const casesQ = useCases();
  const tasksQ = useTasks();
  const providersQ = useProviders();
  const payersQ = usePayers();
  const statusesQ = useStatusConfigs('credentialing');
  const groupsQ = useProviderGroups();
  const coordinatorsQ = useCoordinators();

  const touchesQ = useQuery({
    queryKey: ['reports-summary-touches', orgId],
    enabled: orgId !== 'no-org',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('touches')
        .select('*')
        .eq('org_id', orgId);
      if (error) throw error;
      return camelizeRow<Touch[]>(data ?? []);
    },
  });

  const [groupFilter, setGroupFilter] = useState<string>(ALL);
  const [stateFilter, setStateFilter] = useState<string>(ALL);
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');

  const payerById = useMemo(
    () => new Map((payersQ.data ?? []).map((p) => [p.id, p])),
    [payersQ.data],
  );
  const statusById = useMemo(
    () => new Map((statusesQ.data ?? []).map((s) => [s.id, s])),
    [statusesQ.data],
  );
  const providerById = useMemo(
    () => new Map((providersQ.data ?? []).map((p) => [p.id, p])),
    [providersQ.data],
  );
  const coordinatorById = useMemo(
    () => new Map((coordinatorsQ.data ?? []).map((c) => [c.id, c])),
    [coordinatorsQ.data],
  );

  const states = useMemo(() => {
    const s = new Set<string>();
    (casesQ.data ?? []).forEach((c) => c.state && s.add(c.state));
    return Array.from(s).sort();
  }, [casesQ.data]);

  const filteredCases = useMemo(() => {
    return (casesQ.data ?? []).filter((c) => {
      if (groupFilter !== ALL && c.groupId !== groupFilter) return false;
      if (stateFilter !== ALL && c.state !== stateFilter) return false;
      if (from && (!c.submittedDate || c.submittedDate < from)) return false;
      if (to && (!c.submittedDate || c.submittedDate > to)) return false;
      return true;
    });
  }, [casesQ.data, groupFilter, stateFilter, from, to]);

  // Cases by credentialing status
  const statusBars = useMemo(() => {
    const counts = new Map<string, number>();
    filteredCases.forEach((c) => {
      const id = c.credentialingStatusId ?? '__none__';
      counts.set(id, (counts.get(id) ?? 0) + 1);
    });
    const rows = (statusesQ.data ?? [])
      .map((s) => ({
        id: s.id,
        label: s.label,
        color: s.color || '#6B7280',
        count: counts.get(s.id) ?? 0,
      }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
    return rows;
  }, [filteredCases, statusesQ.data]);

  // Cases by payer
  const payerBars = useMemo(() => {
    const counts = new Map<string, number>();
    filteredCases.forEach((c) => {
      counts.set(c.payerId, (counts.get(c.payerId) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([payerId, count]) => ({
        payerId,
        label: payerById.get(payerId)?.name ?? '—',
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [filteredCases, payerById]);

  // Avg days to approval by payer
  const approvalRows = useMemo(() => {
    const map = new Map<string, { total: number; n: number }>();
    filteredCases.forEach((c) => {
      if (!c.submittedDate || !c.approvedDate) return;
      try {
        const days = differenceInCalendarDays(parseISO(c.approvedDate), parseISO(c.submittedDate));
        if (days < 0) return;
        const cur = map.get(c.payerId) ?? { total: 0, n: 0 };
        cur.total += days;
        cur.n += 1;
        map.set(c.payerId, cur);
      } catch {
        return;
      }
    });
    return Array.from(map.entries())
      .map(([payerId, { total, n }]) => {
        const payer = payerById.get(payerId);
        const avg = Math.round(total / n);
        const expected = payer?.avgDecisionDays ?? null;
        const variance = expected !== null ? avg - expected : null;
        return {
          payerId,
          payerName: payer?.name ?? '—',
          avg,
          count: n,
          expected,
          variance,
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [filteredCases, payerById]);

  // Coordinator workload
  const coordinatorRows = useMemo(() => {
    const filteredCaseIds = new Set(filteredCases.map((c) => c.id));
    const openByCoord = new Map<string, number>();
    const terminalLabels = new Set(['denied', 'expired', 'terminated', 'closed']);
    filteredCases.forEach((c) => {
      if (!c.assignedTo) return;
      const st = c.credentialingStatusId ? statusById.get(c.credentialingStatusId) : null;
      const label = (st?.label ?? '').toLowerCase();
      const closed = Array.from(terminalLabels).some((t) => label.includes(t));
      if (closed) return;
      openByCoord.set(c.assignedTo, (openByCoord.get(c.assignedTo) ?? 0) + 1);
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    const overdueByCoord = new Map<string, number>();
    const caseAssignee = new Map<string, string | null>();
    filteredCases.forEach((c) => caseAssignee.set(c.id, c.assignedTo));
    (tasksQ.data ?? []).forEach((t) => {
      if (!t.caseId || !filteredCaseIds.has(t.caseId)) return;
      if (t.status === 'completed') return;
      if (!t.dueDate || t.dueDate >= todayStr) return;
      const assignee = caseAssignee.get(t.caseId);
      if (!assignee) return;
      overdueByCoord.set(assignee, (overdueByCoord.get(assignee) ?? 0) + 1);
    });

    const since = new Date();
    since.setDate(since.getDate() - 30);
    const sinceStr = since.toISOString().slice(0, 10);
    const touchesByCoord = new Map<string, number>();
    (touchesQ.data ?? []).forEach((t) => {
      if (!t.coordinatorId) return;
      if (!t.touchDate || t.touchDate < sinceStr) return;
      touchesByCoord.set(t.coordinatorId, (touchesByCoord.get(t.coordinatorId) ?? 0) + 1);
    });

    const ids = new Set<string>([
      ...openByCoord.keys(),
      ...overdueByCoord.keys(),
      ...touchesByCoord.keys(),
    ]);
    return Array.from(ids)
      .map((id) => {
        const prof = coordinatorById.get(id);
        const name = prof?.fullName ?? prof?.email ?? '—';
        return {
          id,
          name,
          openCases: openByCoord.get(id) ?? 0,
          overdueTasks: overdueByCoord.get(id) ?? 0,
          touches30: touchesByCoord.get(id) ?? 0,
        };
      })
      .sort((a, b) => b.openCases - a.openCases);
  }, [filteredCases, tasksQ.data, touchesQ.data, statusById, coordinatorById]);

  const loading =
    casesQ.isLoading ||
    tasksQ.isLoading ||
    providersQ.isLoading ||
    payersQ.isLoading ||
    statusesQ.isLoading ||
    groupsQ.isLoading ||
    coordinatorsQ.isLoading ||
    touchesQ.isLoading;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Group</Label>
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue placeholder="Group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All groups</SelectItem>
              {(groupsQ.data ?? []).map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">State</Label>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="h-9 w-[140px]">
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All states</SelectItem>
              {states.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Submitted from
          </Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 w-[160px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Submitted to
          </Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 w-[160px]"
          />
        </div>
        {(groupFilter !== ALL || stateFilter !== ALL || from || to) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setGroupFilter(ALL);
              setStateFilter(ALL);
              setFrom('');
              setTo('');
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Status + payer charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-[#E8E5E0] rounded-md bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-medium">Cases by credentialing status</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                downloadCsv('cases-by-status.csv', [
                  ['Status', 'Cases'],
                  ...statusBars.map((r) => [r.label, r.count]),
                ])
              }
            >
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
          {statusBars.length === 0 ? (
            <div className="text-[13px] text-muted-foreground py-8 text-center">No data.</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusBars} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                  <CartesianGrid stroke="#F3F4F6" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#6B7280' }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <RTooltip cursor={{ fill: '#F9FAFB' }} />
                  <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                    {statusBars.map((r) => (
                      <Cell key={r.id} fill={r.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="border border-[#E8E5E0] rounded-md bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-medium">Cases by payer</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                downloadCsv('cases-by-payer.csv', [
                  ['Payer', 'Cases'],
                  ...payerBars.map((r) => [r.label, r.count]),
                ])
              }
            >
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
          {payerBars.length === 0 ? (
            <div className="text-[13px] text-muted-foreground py-8 text-center">No data.</div>
          ) : (
            <div style={{ height: Math.max(payerBars.length * 28 + 40, 200) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={payerBars}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                >
                  <CartesianGrid stroke="#F3F4F6" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={140}
                    tick={{ fontSize: 11, fill: '#374151' }}
                  />
                  <RTooltip cursor={{ fill: '#F9FAFB' }} />
                  <Bar dataKey="count" fill="#1B4D3E" radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Avg approval table */}
      <div className="border border-[#E8E5E0] rounded-md bg-white">
        <div className="flex items-center justify-between p-4">
          <h3 className="text-[13px] font-medium">Avg days to approval by payer</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              downloadCsv('avg-approval-by-payer.csv', [
                ['Payer', 'Avg days', 'Cases', 'Expected (avg_decision_days)', 'Variance'],
                ...approvalRows.map((r) => [
                  r.payerName,
                  r.avg,
                  r.count,
                  r.expected ?? '',
                  r.variance ?? '',
                ]),
              ])
            }
          >
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-t border-[#E8E5E0] text-xs uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 h-9 font-medium">Payer</th>
              <th className="text-right px-4 h-9 font-medium">Avg days</th>
              <th className="text-right px-4 h-9 font-medium">Cases</th>
              <th className="text-right px-4 h-9 font-medium">Expected</th>
              <th className="text-right px-4 h-9 font-medium">Variance</th>
            </tr>
          </thead>
          <tbody>
            {approvalRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground">
                  No approved cases in range.
                </td>
              </tr>
            ) : (
              approvalRows.map((r) => {
                const varClass =
                  r.variance === null
                    ? 'text-muted-foreground'
                    : r.variance <= 0
                      ? 'text-[#059669]'
                      : 'text-[#DC2626]';
                const varText =
                  r.variance === null
                    ? '—'
                    : r.variance === 0
                      ? 'on target'
                      : r.variance < 0
                        ? `${r.variance} d faster`
                        : `+${r.variance} d slower`;
                return (
                  <tr
                    key={r.payerId}
                    className="border-t border-[#E8E5E0] h-10 hover:bg-[#F9FAFB]"
                  >
                    <td className="px-4">{r.payerName}</td>
                    <td className="px-4 text-right tabular-nums">{r.avg}</td>
                    <td className="px-4 text-right tabular-nums">{r.count}</td>
                    <td className="px-4 text-right tabular-nums">
                      {r.expected ?? '—'}
                    </td>
                    <td className={`px-4 text-right tabular-nums ${varClass}`}>{varText}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Coordinator workload */}
      <div className="border border-[#E8E5E0] rounded-md bg-white">
        <div className="flex items-center justify-between p-4">
          <h3 className="text-[13px] font-medium">Coordinator workload</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              downloadCsv('coordinator-workload.csv', [
                ['Coordinator', 'Open cases', 'Overdue tasks', 'Touches (30d)'],
                ...coordinatorRows.map((r) => [r.name, r.openCases, r.overdueTasks, r.touches30]),
              ])
            }
          >
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-t border-[#E8E5E0] text-xs uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 h-9 font-medium">Coordinator</th>
              <th className="text-right px-4 h-9 font-medium">Open cases</th>
              <th className="text-right px-4 h-9 font-medium">Overdue tasks</th>
              <th className="text-right px-4 h-9 font-medium">Touches (30d)</th>
            </tr>
          </thead>
          <tbody>
            {coordinatorRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-8 text-muted-foreground">
                  No coordinator activity in range.
                </td>
              </tr>
            ) : (
              coordinatorRows.map((r) => (
                <tr key={r.id} className="border-t border-[#E8E5E0] h-10 hover:bg-[#F9FAFB]">
                  <td className="px-4">{r.name}</td>
                  <td className="px-4 text-right tabular-nums">{r.openCases}</td>
                  <td className="px-4 text-right tabular-nums">{r.overdueTasks}</td>
                  <td className="px-4 text-right tabular-nums">{r.touches30}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

