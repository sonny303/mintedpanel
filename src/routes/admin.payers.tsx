// Admin → Payers list and edit. Every payer field exposed in modal because
// these values drive submission guidance and billing rules for coordinators.
import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Plus, Info } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { usePayers, useCreatePayer, useUpdatePayer } from '@/hooks/useAdmin';
import { useRole } from '@/lib/auth-store';
import type { Payer } from '@/types';
import type { PayerInput } from '@/services/payers';

export const Route = createFileRoute('/admin/payers')({
  component: AdminPayersPage,
});

const EMPTY: PayerInput = {
  name: '',
  isActive: true,
  avgDecisionDays: null,
  provisionalBillingAllowed: false,
  provisionalBillingNotes: null,
  retroBillingAllowed: false,
  retroBillingWindowDays: null,
  caqhPullDeadlineDays: null,
  providerTypePath: null,
  priorAuthVendor: null,
  payerBillingId: null,
  portalUrl: null,
};

function YesNoPill({ value }: { value: boolean }) {
  return value ? (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-[20px] text-[12px] font-medium border bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]">
      Yes
    </span>
  ) : (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-[20px] text-[12px] font-medium border bg-[#F5F5F4] text-[#57534E] border-[#E8E5E0]">
      No
    </span>
  );
}

function AdminPayersPage() {
  const role = useRole();
  const canEdit = role === 'admin';
  const payersQ = usePayers();
  const [editing, setEditing] = useState<{ payer: Payer | null } | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payers"
        description="Configure submission and billing rules used across cases."
        actions={
          canEdit ? (
            <Button
              onClick={() => setEditing({ payer: null })}
              className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-9"
            >
              <Plus className="w-4 h-4 mr-1" /> Add payer
            </Button>
          ) : null
        }
      />

      <div className="border border-[#E8E5E0] rounded-md bg-[#FAFAF9] px-4 py-3 text-[13px] text-foreground">
        Changes here affect submission guidance and billing rules immediately.
      </div>

      <div className="border border-[#E8E5E0] rounded-md overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[#FAFAF9] border-b border-[#E8E5E0]">
                {[
                  'Payer',
                  'Active',
                  'Avg decision',
                  'Provisional',
                  'Retro',
                  'CAQH deadline',
                  'Type path',
                  'Prior auth',
                  'Billing ID',
                  'Portal',
                  '',
                ].map((h, i) => (
                  <th
                    key={i}
                    className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payersQ.isLoading ? (
                <tr>
                  <td colSpan={11} className="p-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : (payersQ.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-10 text-center text-muted-foreground">
                    No payers yet.
                  </td>
                </tr>
              ) : (
                (payersQ.data ?? []).map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => canEdit && setEditing({ payer: p })}
                    className={`border-b border-[#E8E5E0] last:border-b-0 hover:bg-[#FAFAF9] ${canEdit ? 'cursor-pointer' : ''}`}
                  >
                    <td className="px-3 h-10 align-middle font-medium">{p.name}</td>
                    <td className="px-3 h-10 align-middle">
                      <YesNoPill value={p.isActive} />
                    </td>
                    <td className="px-3 h-10 align-middle text-muted-foreground">
                      {p.avgDecisionDays != null ? `${p.avgDecisionDays} d` : '—'}
                    </td>
                    <td className="px-3 h-10 align-middle">
                      <div className="flex items-center gap-1.5">
                        <YesNoPill value={p.provisionalBillingAllowed} />
                        {p.provisionalBillingNotes ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-4 w-4 text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                {p.provisionalBillingNotes}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 h-10 align-middle">
                      <div className="flex items-center gap-1.5">
                        <YesNoPill value={p.retroBillingAllowed} />
                        {p.retroBillingAllowed && p.retroBillingWindowDays != null ? (
                          <span className="text-[12px] text-muted-foreground">
                            {p.retroBillingWindowDays}d
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 h-10 align-middle text-muted-foreground">
                      {p.caqhPullDeadlineDays != null ? `${p.caqhPullDeadlineDays} d` : '—'}
                    </td>
                    <td className="px-3 h-10 align-middle text-muted-foreground">
                      {p.providerTypePath ?? '—'}
                    </td>
                    <td className="px-3 h-10 align-middle text-muted-foreground">
                      {p.priorAuthVendor ?? '—'}
                    </td>
                    <td className="px-3 h-10 align-middle text-muted-foreground">
                      {p.payerBillingId ?? '—'}
                    </td>
                    <td className="px-3 h-10 align-middle text-muted-foreground max-w-[180px] truncate">
                      {p.portalUrl ? (
                        <a
                          href={p.portalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#1B4D3E] hover:underline"
                        >
                          {p.portalUrl}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 h-10 align-middle text-right">
                      {canEdit && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] px-2"
                          onClick={() => setEditing({ payer: p })}
                        >
                          Edit
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing ? (
        <PayerEditModal
          payer={editing.payer}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function PayerEditModal({
  payer,
  onClose,
}: {
  payer: Payer | null;
  onClose: () => void;
}) {
  const createMut = useCreatePayer();
  const updateMut = useUpdatePayer(payer?.id ?? '');
  const [form, setForm] = useState<PayerInput>(() =>
    payer
      ? {
          name: payer.name,
          isActive: payer.isActive,
          avgDecisionDays: payer.avgDecisionDays,
          provisionalBillingAllowed: payer.provisionalBillingAllowed,
          provisionalBillingNotes: payer.provisionalBillingNotes,
          retroBillingAllowed: payer.retroBillingAllowed,
          retroBillingWindowDays: payer.retroBillingWindowDays,
          caqhPullDeadlineDays: payer.caqhPullDeadlineDays,
          providerTypePath: payer.providerTypePath,
          priorAuthVendor: payer.priorAuthVendor,
          payerBillingId: payer.payerBillingId,
          portalUrl: payer.portalUrl,
        }
      : EMPTY,
  );
  const [error, setError] = useState<string | null>(null);
  const pending = createMut.isPending || updateMut.isPending;

  function patch(p: Partial<PayerInput>) {
    setForm((f) => ({ ...f, ...p }));
  }

  function numOrNull(v: string): number | null {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  async function save() {
    setError(null);
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    try {
      if (payer) {
        await updateMut.mutateAsync(form);
        toast.success('Payer updated');
      } else {
        await createMut.mutateAsync(form);
        toast.success('Payer created');
      }
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setError(msg);
      toast.error(msg);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>{payer ? 'Edit payer' : 'Add payer'}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2">
            <Label className="text-[12px]">Name</Label>
            <Input
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              className="h-9"
            />
          </div>

          <div className="col-span-2 flex items-center justify-between border border-[#E8E5E0] rounded-md px-3 py-2">
            <div>
              <div className="text-[13px] font-medium">Active</div>
              <div className="text-[12px] text-muted-foreground">
                Inactive payers are hidden from case creation.
              </div>
            </div>
            <Switch
              checked={Boolean(form.isActive)}
              onCheckedChange={(v) => patch({ isActive: v })}
            />
          </div>

          <div>
            <Label className="text-[12px]">Avg decision days</Label>
            <Input
              type="number"
              value={form.avgDecisionDays ?? ''}
              onChange={(e) => patch({ avgDecisionDays: numOrNull(e.target.value) })}
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-[12px]">CAQH pull deadline (days)</Label>
            <Input
              type="number"
              value={form.caqhPullDeadlineDays ?? ''}
              onChange={(e) =>
                patch({ caqhPullDeadlineDays: numOrNull(e.target.value) })
              }
              className="h-9"
            />
          </div>

          <div>
            <Label className="text-[12px]">Provider type path</Label>
            <Select
              value={form.providerTypePath ?? '__none__'}
              onValueChange={(v) =>
                patch({
                  providerTypePath:
                    v === '__none__' ? null : (v as 'individual' | 'organizational'),
                })
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                <SelectItem value="individual">Individual</SelectItem>
                <SelectItem value="organizational">Organizational</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[12px]">Prior auth vendor</Label>
            <Input
              value={form.priorAuthVendor ?? ''}
              onChange={(e) =>
                patch({ priorAuthVendor: e.target.value || null })
              }
              className="h-9"
            />
          </div>

          <div>
            <Label className="text-[12px]">Payer billing ID</Label>
            <Input
              value={form.payerBillingId ?? ''}
              onChange={(e) => patch({ payerBillingId: e.target.value || null })}
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-[12px]">Portal URL</Label>
            <Input
              value={form.portalUrl ?? ''}
              onChange={(e) => patch({ portalUrl: e.target.value || null })}
              className="h-9"
              placeholder="https://"
            />
          </div>

          <div className="col-span-2 border-t border-[#E8E5E0] pt-3 mt-1">
            <div className="text-[12px] uppercase tracking-wider text-muted-foreground mb-2">
              Billing
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center justify-between border border-[#E8E5E0] rounded-md px-3 py-2">
                <div className="text-[13px] font-medium">Provisional billing allowed</div>
                <Switch
                  checked={Boolean(form.provisionalBillingAllowed)}
                  onCheckedChange={(v) => patch({ provisionalBillingAllowed: v })}
                />
              </div>
              <div className="flex items-center justify-between border border-[#E8E5E0] rounded-md px-3 py-2">
                <div className="text-[13px] font-medium">Retro billing allowed</div>
                <Switch
                  checked={Boolean(form.retroBillingAllowed)}
                  onCheckedChange={(v) => patch({ retroBillingAllowed: v })}
                />
              </div>
              <div className="col-span-2">
                <Label className="text-[12px]">Provisional billing notes</Label>
                <Textarea
                  rows={2}
                  value={form.provisionalBillingNotes ?? ''}
                  onChange={(e) =>
                    patch({ provisionalBillingNotes: e.target.value || null })
                  }
                />
              </div>
              <div>
                <Label className="text-[12px]">Retro billing window (days)</Label>
                <Input
                  type="number"
                  value={form.retroBillingWindowDays ?? ''}
                  onChange={(e) =>
                    patch({ retroBillingWindowDays: numOrNull(e.target.value) })
                  }
                  className="h-9"
                  disabled={!form.retroBillingAllowed}
                />
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <div className="text-[12px] text-[#B91C1C] border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-3 py-2">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={pending}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
          >
            {pending ? 'Saving…' : payer ? 'Save changes' : 'Create payer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
