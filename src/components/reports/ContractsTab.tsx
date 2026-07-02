// Contracts tab of the Reports page. Shows one row per group + payer + state
// contract with providers count (cases) and status change controls.
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TableSkeletonRows } from '@/components/TableSkeletonRows';
import { EmptyState } from '@/components/EmptyState';
import { StatusPill, hexToStatusColor } from '@/components/StatusPill';
import { fmtDate } from '@/lib/format';
import { useContracts } from '@/hooks/useContracts';
import { useCases } from '@/hooks/useCases';
import { usePayers, useStatusConfigs } from '@/hooks/useAdmin';
import { useProviderGroups } from '@/hooks/useLookups';
import { useCanWrite } from '@/lib/permissions';
import type { Contract } from '@/types';
import { StatusChangeContractDialog } from './StatusChangeContractDialog';
import { AddContractDialog } from './AddContractDialog';

const ALL = '__all__';

export function ContractsTab() {
  const canEdit = useCanWrite();

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
  const isError =
    contractsQ.isError || groupsQ.isError || payersQ.isError || casesQ.isError || statusesQ.isError;
  const retry = () => {
    if (contractsQ.isError) contractsQ.refetch();
    if (groupsQ.isError) groupsQ.refetch();
    if (payersQ.isError) payersQ.refetch();
    if (casesQ.isError) casesQ.refetch();
    if (statusesQ.isError) statusesQ.refetch();
  };

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
                <TableSkeletonRows rows={6} cols={9} />
              ) : isError ? (
                <tr>
                  <td colSpan={9} className="px-3 py-12 text-center">
                    <EmptyState
                      message="Failed to load contracts"
                      action={
                        <Button variant="outline" size="sm" onClick={retry}>
                          Retry
                        </Button>
                      }
                    />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-12 text-center">
                    <EmptyState message="No contracts match these filters" />
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

        <StatusChangeContractDialog
          contract={statusModalContract}
          statuses={statusesQ.data ?? []}
          onClose={() => setStatusModalContract(null)}
        />
        <AddContractDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          statuses={statusesQ.data ?? []}
        />
      </div>
    </TooltipProvider>
  );
}
