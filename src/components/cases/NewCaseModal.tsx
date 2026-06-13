// Modal that creates one credential case per selected payer for a provider,
// runs the new grad / license / duplicate gates, and seeds SOP tasks from
// matching sop_templates when one exists.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { supabase } from '@/integrations/supabase/externalClient';
import { getMsoRoutingRule } from '@/services/lookups';
import { useCases, useCreateCase } from '@/hooks/useCases';
import {
  useCoordinators,
  useFacilities,
  useMsoRoutingRule,
  useStateLicensesByProvider,
} from '@/hooks/useLookups';
import { useMsos, usePayers, useTemplates } from '@/hooks/useAdmin';
import { useActiveOrgId } from '@/lib/auth-store';
import type {
  Mso,
  Payer,
  Provider,
  ProviderGroup,
  SOPTemplate,
} from '@/types';

interface NewCaseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: Provider;
  group: ProviderGroup | null;
}

const NONE = '__none__';

interface ResolvedStep {
  id: string;
  order: number;
  instruction: string;
  isCompleted: false;
  dataFields: { label: string; value: string; copyable: boolean }[];
}

interface ResolvedTask {
  title: string;
  description: string | null;
  dueDate: string | null;
  sortOrder: number;
  steps: ResolvedStep[];
}

const TOKEN_RE = /{{\s*([a-zA-Z0-9_.]+)\s*}}/g;

function interpolate(input: string, tokens: Record<string, string>): string {
  return input.replace(TOKEN_RE, (_, k: string) => tokens[k] ?? '');
}

function offsetDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildTokenMap(
  provider: Provider,
  group: ProviderGroup | null,
  mso: Mso | null,
  licenseNumber: string | null,
): Record<string, string> {
  return {
    'provider.npi': provider.npi ?? '',
    'provider.caqhId': provider.caqhId ?? '',
    'provider.caqhLastAttestedDate': provider.caqhLastAttestedDate ?? '',
    'provider.taxonomyCode': provider.taxonomyCode ?? '',
    'provider.firstName': provider.firstName,
    'provider.lastName': provider.lastName,
    'provider.email': provider.email ?? '',
    'provider.licenseNumber': licenseNumber ?? '',
    'group.tin': group?.tin ?? '',
    'group.npiType2': group?.npiType2 ?? '',
    'group.name': group?.name ?? '',
    'mso.portalUrl': mso?.portalUrl ?? '',
  };
}

interface RawStep {
  step?: string;
  dataFieldTokens?: string[];
}
interface RawDef {
  title?: string;
  description?: string;
  dayOffset?: number;
  sortOrder?: number;
  sopStepTemplates?: RawStep[];
}

function resolveRawTemplate(
  template: SOPTemplate,
  tokens: Record<string, string>,
): ResolvedTask[] {
  const defs = (template.taskDefinitions ?? []) as unknown as RawDef[];
  return defs.map((def, idx) => {
    const rawSteps = def.sopStepTemplates ?? [];
    const steps: ResolvedStep[] = rawSteps.map((s, sIdx) => {
      const tokensList = s.dataFieldTokens ?? [];
      const dataFields = tokensList
        .map((tok) => ({
          label: tok,
          value: tokens[tok] ?? '',
          copyable: true,
        }))
        .filter((f) => f.label && f.value);
      return {
        id: `step-${sIdx}`,
        order: sIdx,
        instruction: interpolate(s.step ?? '', tokens),
        isCompleted: false,
        dataFields,
      };
    });
    return {
      title: interpolate(def.title ?? 'Task', tokens),
      description: def.description ? interpolate(def.description, tokens) : null,
      dueDate:
        typeof def.dayOffset === 'number' ? offsetDate(def.dayOffset) : null,
      sortOrder: def.sortOrder ?? idx,
      steps,
    };
  });
}

function pickTemplate(
  templates: SOPTemplate[],
  payerId: string,
  state: string,
  groupId: string | null,
): SOPTemplate | null {
  const active = templates.filter(
    (t) => !(t as SOPTemplate & { isArchived?: boolean }).isArchived,
  );
  const exact = active.find(
    (t) =>
      t.payerId === payerId &&
      t.state === state &&
      (t.groupId === groupId || t.groupId === null),
  );
  if (exact) return exact;
  return (
    active.find((t) => t.payerId === payerId && t.state === state) ?? null
  );
}

export function NewCaseModal({
  open,
  onOpenChange,
  provider,
  group,
}: NewCaseModalProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const orgId = useActiveOrgId();

  const payersQ = usePayers();
  const msosQ = useMsos();
  const templatesQ = useTemplates();
  const licensesQ = useStateLicensesByProvider(provider.id);
  const facilitiesQ = useFacilities(provider.groupId ?? null);
  const coordinatorsQ = useCoordinators();
  const existingCasesQ = useCases({ providerId: provider.id });
  const createCase = useCreateCase();

  const [selectedPayerIds, setSelectedPayerIds] = useState<string[]>([]);
  const [state, setState] = useState<string>('');
  const [facilityId, setFacilityId] = useState<string>(NONE);
  const [coordinatorId, setCoordinatorId] = useState<string>(NONE);
  const [submitting, setSubmitting] = useState(false);

  const licenses = licensesQ.data ?? [];
  const activeLicenses = useMemo(
    () => licenses.filter((l) => (l.status ?? '').toLowerCase() === 'active'),
    [licenses],
  );
  const licensedStates = useMemo(
    () => Array.from(new Set(activeLicenses.map((l) => l.state))).sort(),
    [activeLicenses],
  );

  const providerLevelBlock: string | null = useMemo(() => {
    if (provider.isNewGrad && !provider.caqhId) {
      return 'CAQH profile required before cases can open. Add the CAQH ID to the provider record first.';
    }
    if (state && !activeLicenses.some((l) => l.state === state)) {
      return `No active ${state} license on file.`;
    }
    return null;
  }, [provider.isNewGrad, provider.caqhId, state, activeLicenses]);

  const payerById = useMemo(() => {
    const m = new Map<string, Payer>();
    (payersQ.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [payersQ.data]);

  const duplicatePayerIds = useMemo(() => {
    if (!state) return new Set<string>();
    const ec = existingCasesQ.data ?? [];
    return new Set(
      selectedPayerIds.filter((pid) =>
        ec.some((c) => c.payerId === pid && c.state === state),
      ),
    );
  }, [existingCasesQ.data, selectedPayerIds, state]);
  const creatableCount = selectedPayerIds.length - duplicatePayerIds.size;

  function togglePayer(id: string) {
    setSelectedPayerIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function reset() {
    setSelectedPayerIds([]);
    setState('');
    setFacilityId(NONE);
    setCoordinatorId(NONE);
    setSubmitting(false);
  }

  async function handleSave() {
    if (!orgId || providerLevelBlock || !state || selectedPayerIds.length === 0) return;

    setSubmitting(true);
    const templates = templatesQ.data ?? [];
    const existingCases = existingCasesQ.data ?? [];
    const licenseNumber =
      activeLicenses.find((l) => l.state === state)?.licenseNumber ?? null;
    const created: { id: string; payerName: string }[] = [];
    const skipped: { payerName: string; reason: string }[] = [];
    let templateMissingCount = 0;

    for (const payerId of selectedPayerIds) {
      const payer = payerById.get(payerId);
      if (!payer) continue;
      const dup = existingCases.find(
        (c) => c.payerId === payerId && c.state === state,
      );
      if (dup) {
        skipped.push({
          payerName: payer.name,
          reason: 'Duplicate case exists',
        });
        continue;
      }

      const rule = await getMsoRoutingRule(
        payerId,
        state,
        provider.specialty ?? null,
      );
      const msoId =
        rule?.routeType === 'mso' ? rule.msoId ?? null : null;
      const mso = msoId ? (msosQ.data ?? []).find((m) => m.id === msoId) ?? null : null;

      let caseRow;
      try {
        caseRow = await createCase.mutateAsync({
          providerId: provider.id,
          payerId,
          state,
          groupId: provider.groupId ?? null,
          facilityId: facilityId === NONE ? null : facilityId,
          specialty: provider.specialty ?? null,
          msoId,
          assignedTo: coordinatorId === NONE ? null : coordinatorId,
        });
      } catch {
        skipped.push({ payerName: payer.name, reason: 'Save failed' });
        continue;
      }

      const template = pickTemplate(
        templates,
        payerId,
        state,
        provider.groupId ?? null,
      );
      if (!template) {
        templateMissingCount += 1;
      } else {
        const tokens = buildTokenMap(provider, group, mso, licenseNumber);
        const tasks = resolveRawTemplate(template, tokens);
        if (tasks.length > 0) {
          const payload = tasks.map((t) => ({
            org_id: orgId,
            case_id: caseRow.id,
            provider_id: provider.id,
            title: t.title,
            description: t.description,
            sop_content: t.steps as unknown as never,
            status: 'not_started' as const,
            sort_order: t.sortOrder,
            due_date: t.dueDate,
            is_auto_generated: true,
          }));
          await supabase.from('tasks').insert(payload as never);
        }
      }

      created.push({ id: caseRow.id, payerName: payer.name });
    }

    qc.invalidateQueries({ queryKey: ['cases', orgId] });
    qc.invalidateQueries({ queryKey: ['tasks', orgId] });

    setSubmitting(false);

    if (created.length === 0) {
      const first = skipped[0];
      toast.error(first ? `${first.payerName}: ${first.reason}` : 'No cases created');
      return;
    }

    if (templateMissingCount > 0) {
      toast.message(
        'No SOP template found for this payer/state — tasks not generated.',
      );
    }
    if (skipped.length > 0) {
      toast.message(
        `${skipped.length} payer${skipped.length === 1 ? '' : 's'} skipped`,
      );
    }

    onOpenChange(false);
    reset();

    if (created.length === 1) {
      navigate({ to: '/cases/$id', params: { id: created[0].id } });
    } else {
      toast.success(`${created.length} cases created`);
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New case</DialogTitle>
        </DialogHeader>

        {providerLevelBlock ? (
          <div className="flex items-start gap-2 border border-[#FDE68A] bg-[#FEF3C7] text-[#92400E] rounded-md px-3 py-2 text-[13px]">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>{providerLevelBlock}</div>
          </div>
        ) : null}

        <div className="space-y-4">
          <div>
            <Label className="text-[12px]">State</Label>
            <Select value={state || NONE} onValueChange={(v) => setState(v === NONE ? '' : v)}>
              <SelectTrigger className="h-9 mt-1">
                <SelectValue placeholder="Select a licensed state" />
              </SelectTrigger>
              <SelectContent>
                {licensedStates.length === 0 ? (
                  <SelectItem value={NONE} disabled>
                    No active licenses
                  </SelectItem>
                ) : (
                  licensedStates.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-[12px]">Payers (one case per selected payer)</Label>
            <div className="mt-1 border border-border rounded-md max-h-48 overflow-y-auto">
              {(payersQ.data ?? []).filter((p) => p.isActive).map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 px-3 h-9 border-b border-border last:border-b-0 cursor-pointer hover:bg-muted/40"
                >
                  <Checkbox
                    checked={selectedPayerIds.includes(p.id)}
                    onCheckedChange={() => togglePayer(p.id)}
                  />
                  <span className="text-[13px]">{p.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-[12px]">Facility</Label>
              <Select value={facilityId} onValueChange={setFacilityId}>
                <SelectTrigger className="h-9 mt-1">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {(facilitiesQ.data ?? []).map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[12px]">Assigned coordinator</Label>
              <Select value={coordinatorId} onValueChange={setCoordinatorId}>
                <SelectTrigger className="h-9 mt-1">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {(coordinatorsQ.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.fullName ?? c.email ?? c.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {state && selectedPayerIds.length > 0 ? (
            <div className="border border-border rounded-md divide-y divide-border">
              {selectedPayerIds.map((pid) => {
                const payer = payerById.get(pid);
                if (!payer) return null;
                return (
                  <PayerPreviewRow
                    key={pid}
                    payer={payer}
                    state={state}
                    providerId={provider.id}
                    groupId={provider.groupId ?? null}
                    specialty={provider.specialty ?? null}
                    existingCases={existingCasesQ.data ?? []}
                  />
                );
              })}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              submitting ||
              !!providerLevelBlock ||
              !state ||
              creatableCount === 0
            }
          >
            {submitting
              ? 'Creating…'
              : `Create ${creatableCount} case${creatableCount === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PayerPreviewRowProps {
  payer: Payer;
  state: string;
  providerId: string;
  groupId: string | null;
  specialty: string | null;
  existingCases: { payerId: string; state: string; id: string }[];
}

function PayerPreviewRow({
  payer,
  state,
  groupId,
  specialty,
  existingCases,
}: PayerPreviewRowProps) {
  const navigate = useNavigate();
  const ruleQ = useMsoRoutingRule(payer.id, state, specialty);
  const msosQ = useMsos();
  const orgId = useActiveOrgId();

  const dup = existingCases.find(
    (c) => c.payerId === payer.id && c.state === state,
  );

  const rule = ruleQ.data ?? null;
  const mso =
    rule?.routeType === 'mso' && rule.msoId
      ? (msosQ.data ?? []).find((m) => m.id === rule.msoId) ?? null
      : null;

  // Inline contract lookup — show amber when missing.
  const [contractStatus, setContractStatus] = useState<'loading' | 'present' | 'missing'>(
    'loading',
  );
  useEffect(() => {
    if (!groupId || !orgId) {
      setContractStatus('missing');
      return;
    }
    setContractStatus('loading');
    void supabase
      .from('contracts')
      .select('id')
      .eq('org_id', orgId)
      .eq('group_id', groupId)
      .eq('payer_id', payer.id)
      .eq('state', state)
      .maybeSingle()
      .then(({ data }) => setContractStatus(data ? 'present' : 'missing'));
  }, [groupId, orgId, payer.id, state]);

  return (
    <div className="px-3 py-2 flex items-center justify-between gap-3 text-[13px]">
      <div className="min-w-0">
        <div className="font-medium text-foreground truncate">{payer.name}</div>
        <div className="text-[12px] text-muted-foreground mt-0.5">
          {mso ? (
            <>Routes through {mso.name}{rule?.notes ? ` — ${rule.notes}` : ''}</>
          ) : (
            <>Direct submission</>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {contractStatus === 'missing' ? (
          <StatusPill status="amber" label="No executed contract" />
        ) : null}
        {dup ? (
          <button
            type="button"
            onClick={() => navigate({ to: '/cases/$id', params: { id: dup.id } })}
            className="inline-flex items-center gap-1 text-[12px] text-[#DC2626] hover:underline"
          >
            Duplicate case <ExternalLink className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
