// Admin → MSO routing. Lists mso_routing_rules with payer/state filters,
// add/edit modal, plus an MSOs sub-section. Admin-write; specialist read.
import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  usePayers,
  useMsos,
  useCreateMso,
  useUpdateMso,
  useRoutingRules,
  useCreateRoutingRule,
  useUpdateRoutingRule,
} from '@/hooks/useAdmin';
import { useRole } from '@/lib/auth-store';
import type { Mso, MsoRoutingRule } from '@/types';
import type { RoutingRuleInput } from '@/services/msos';

export const Route = createFileRoute('/admin/mso-routing')({
  component: AdminMsoRoutingPage,
});

const ALL = '__all__';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
  'WI','WY','DC',
];


function AdminMsoRoutingPage() {
  const role = useRole();
  const canEdit = role === 'admin';

  const rulesQ = useRoutingRules();
  const payersQ = usePayers();
  const msosQ = useMsos();

  const [payerFilter, setPayerFilter] = useState<string>(ALL);
  const [stateFilter, setStateFilter] = useState<string>(ALL);
  const [ruleModal, setRuleModal] = useState<{ rule: MsoRoutingRule | null } | null>(
    null,
  );
  const [msoModal, setMsoModal] = useState<{ mso: Mso | null } | null>(null);

  const payerById = useMemo(
    () => new Map((payersQ.data ?? []).map((p) => [p.id, p])),
    [payersQ.data],
  );
  const msoById = useMemo(
    () => new Map((msosQ.data ?? []).map((m) => [m.id, m])),
    [msosQ.data],
  );

  const filtered = useMemo(() => {
    return (rulesQ.data ?? []).filter((r) => {
      if (payerFilter !== ALL && r.payerId !== payerFilter) return false;
      if (stateFilter !== ALL && r.state !== stateFilter) return false;
      return true;
    });
  }, [rulesQ.data, payerFilter, stateFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="MSO routing"
        description="Decide whether new cases route direct to the payer or through an MSO."
      />

      <div className="border border-[#E8E5E0] rounded-md bg-[#FAFAF9] px-4 py-3 text-[13px] text-muted-foreground">
        These rules drive case routing. New cases pick up changes immediately;
        existing cases keep their assigned MSO.
      </div>

      {!canEdit && (
        <div className="border border-[#E8E5E0] rounded-md bg-[#FAFAF9] px-4 py-3 text-[13px] text-muted-foreground">
          Read-only view. Only admins can edit routing rules.
        </div>
      )}

      {/* Filters + add */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={payerFilter} onValueChange={setPayerFilter}>
            <SelectTrigger className="h-9 w-[220px]">
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
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All states</SelectItem>
              <SelectItem value="All">All (wildcard)</SelectItem>
              {US_STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canEdit && (
          <Button
            onClick={() => setRuleModal({ rule: null })}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-9"
          >
            <Plus className="w-4 h-4 mr-1" /> Add rule
          </Button>
        )}
      </div>

      {/* Rules table */}
      <div className="border border-[#E8E5E0] rounded-md overflow-hidden bg-white">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#FAFAF9] border-b border-[#E8E5E0]">
              {['Payer', 'State', 'Specialty', 'Route', 'Notes', ''].map((h, i) => (
                <th
                  key={i}
                  className="text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rulesQ.isLoading ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : rulesQ.isError ? (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center">
                  <div className="text-[13px] text-foreground mb-3">Failed to load routing rules.</div>
                  <Button variant="outline" size="sm" onClick={() => rulesQ.refetch()}>
                    Retry
                  </Button>
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-muted-foreground">
                  No rules match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const payer = r.payerId ? payerById.get(r.payerId) : null;
                const mso = r.msoId ? msoById.get(r.msoId) : null;
                return (
                  <tr
                    key={r.id}
                    className="border-b border-[#E8E5E0] last:border-b-0 hover:bg-[#FAFAF9]"
                  >
                    <td className="px-3 h-10 align-middle">{payer?.name ?? '—'}</td>
                    <td className="px-3 h-10 align-middle">{r.state}</td>
                    <td className="px-3 h-10 align-middle">{r.specialty}</td>
                    <td className="px-3 h-10 align-middle">
                      {r.routeType === 'direct' ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-[20px] text-[12px] font-medium border bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]">
                          Direct
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-[20px] text-[12px] font-medium border bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]">
                          MSO · {mso?.name ?? '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 h-10 align-middle text-muted-foreground max-w-[280px] truncate">
                      {r.notes ?? '—'}
                    </td>
                    <td className="px-3 h-10 align-middle text-right">
                      {canEdit && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] px-2"
                          onClick={() => setRuleModal({ rule: r })}
                        >
                          Edit
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

      {/* MSOs sub-section */}
      <div className="border border-[#E8E5E0] rounded-md bg-white">
        <div className="flex items-start justify-between p-4 border-b border-[#E8E5E0]">
          <div>
            <h2 className="text-[14px] font-medium">MSOs</h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Management service organizations that can route cases.
            </p>
          </div>
          {canEdit && (
            <Button
              onClick={() => setMsoModal({ mso: null })}
              className="bg-[#1B4D3E] hover:bg-[#163E32] text-white h-9"
            >
              <Plus className="w-4 h-4 mr-1" /> Add MSO
            </Button>
          )}
        </div>
        {msosQ.isLoading ? (
          <div className="p-6 text-center text-muted-foreground text-[13px]">
            Loading…
          </div>
        ) : msosQ.isError ? (
          <div className="p-8 text-center">
            <div className="text-[13px] text-foreground mb-3">Failed to load MSOs.</div>
            <Button variant="outline" size="sm" onClick={() => msosQ.refetch()}>
              Retry
            </Button>
          </div>
        ) : (msosQ.data ?? []).length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-[13px]">
            No MSOs yet.
          </div>
        ) : (
          (msosQ.data ?? []).map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 px-4 h-12 border-b border-[#E8E5E0] last:border-b-0 hover:bg-[#FAFAF9]"
            >
              <span className="text-[13px] font-medium min-w-[200px]">{m.name}</span>
              <span className="text-[12px] text-muted-foreground flex-1 truncate">
                {m.portalUrl ? (
                  <a
                    href={m.portalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#1B4D3E] hover:underline"
                  >
                    {m.portalUrl}
                  </a>
                ) : (
                  '—'
                )}
              </span>
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] px-2"
                  onClick={() => setMsoModal({ mso: m })}
                >
                  Edit
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      <RuleModal
        open={ruleModal !== null}
        rule={ruleModal?.rule ?? null}
        payers={payersQ.data ?? []}
        msos={msosQ.data ?? []}
        onClose={() => setRuleModal(null)}
      />
      <MsoModal
        open={msoModal !== null}
        mso={msoModal?.mso ?? null}
        onClose={() => setMsoModal(null)}
      />
    </div>
  );
}

interface RuleModalProps {
  open: boolean;
  rule: MsoRoutingRule | null;
  payers: { id: string; name: string }[];
  msos: { id: string; name: string }[];
  onClose: () => void;
}

function RuleModal({ open, rule, payers, msos, onClose }: RuleModalProps) {
  const createM = useCreateRoutingRule();
  const updateM = useUpdateRoutingRule(rule?.id ?? '');
  const saving = createM.isPending || updateM.isPending;

  const [payerId, setPayerId] = useState('');
  const [state, setState] = useState('All');
  const [specialty, setSpecialty] = useState('All');
  const [routeType, setRouteType] = useState<'direct' | 'mso'>('direct');
  const [msoId, setMsoId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const key = rule?.id ?? (open ? 'new' : null);
  if (open && key !== hydratedFor) {
    setPayerId(rule?.payerId ?? '');
    setState(rule?.state ?? 'All');
    setSpecialty(rule?.specialty ?? 'All');
    setRouteType((rule?.routeType as 'direct' | 'mso') ?? 'direct');
    setMsoId(rule?.msoId ?? '');
    setNotes(rule?.notes ?? '');
    setSubmitError(null);
    setHydratedFor(key);
  }
  if (!open && hydratedFor !== null) setHydratedFor(null);

  async function handleSubmit() {
    setSubmitError(null);
    if (!payerId) {
      setSubmitError('Payer is required.');
      return;
    }
    if (!state.trim()) {
      setSubmitError('State is required.');
      return;
    }
    if (routeType === 'mso' && !msoId) {
      setSubmitError('MSO is required for MSO route type.');
      return;
    }
    try {
      const input: RoutingRuleInput = {
        payerId,
        state: state.trim(),
        specialty: specialty.trim() || 'All',
        routeType,
        msoId: routeType === 'mso' ? msoId : null,
        notes: notes.trim() || null,
      };
      if (rule?.id) {
        await updateM.mutateAsync(input);
      } else {
        await createM.mutateAsync(input);
      }
      toast.success(rule ? 'Rule updated.' : 'Rule added.');
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed.';
      setSubmitError(msg);
      toast.error(msg);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{rule ? 'Edit routing rule' : 'Add routing rule'}</DialogTitle>
          <DialogDescription>
            Use “All” as a wildcard for state or specialty.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              Payer <span className="text-[#DC2626]">*</span>
            </Label>
            <Select value={payerId} onValueChange={setPayerId}>
              <SelectTrigger>
                <SelectValue placeholder="Select payer" />
              </SelectTrigger>
              <SelectContent>
                {payers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>State</Label>
              <Select value={state} onValueChange={setState}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All</SelectItem>
                  {US_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Specialty</Label>
              <Input
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                placeholder="All"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Route type</Label>
            <Select
              value={routeType}
              onValueChange={(v) => setRouteType(v as 'direct' | 'mso')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">Direct to payer</SelectItem>
                <SelectItem value="mso">Through MSO</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {routeType === 'mso' && (
            <div className="space-y-1.5">
              <Label>
                MSO <span className="text-[#DC2626]">*</span>
              </Label>
              <Select value={msoId} onValueChange={setMsoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select MSO" />
                </SelectTrigger>
                <SelectContent>
                  {msos.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        {submitError && (
          <div className="border border-[#FECACA] bg-[#FEF2F2] text-[#DC2626] text-[13px] rounded-md px-3 py-2">
            {submitError}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
            disabled={saving}
          >
            {rule ? 'Save changes' : 'Add rule'}
          </Button>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}

interface MsoModalProps {
  open: boolean;
  mso: Mso | null;
  onClose: () => void;
}

function MsoModal({ open, mso, onClose }: MsoModalProps) {
  const createM = useCreateMso();
  const updateM = useUpdateMso(mso?.id ?? '');

  const [name, setName] = useState('');
  const [portalUrl, setPortalUrl] = useState('');
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  const key = mso?.id ?? (open ? 'new' : null);
  if (open && key !== hydratedFor) {
    setName(mso?.name ?? '');
    setPortalUrl(mso?.portalUrl ?? '');
    setHydratedFor(key);
  }
  if (!open && hydratedFor !== null) setHydratedFor(null);

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error('Name is required.');
      return;
    }
    try {
      if (mso) {
        await updateM.mutateAsync({
          name: name.trim(),
          portalUrl: portalUrl.trim() || null,
        });
        toast.success('MSO updated.');
      } else {
        await createM.mutateAsync({
          name: name.trim(),
          portalUrl: portalUrl.trim() || null,
        });
        toast.success('MSO added.');
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mso ? 'Edit MSO' : 'Add MSO'}</DialogTitle>
          <DialogDescription>MSOs are referenced by routing rules.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              Name <span className="text-[#DC2626]">*</span>
            </Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Portal URL</Label>
            <Input
              value={portalUrl}
              onChange={(e) => setPortalUrl(e.target.value)}
              placeholder="https://"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
            disabled={createM.isPending || updateM.isPending}
          >
            {mso ? 'Save changes' : 'Add MSO'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
