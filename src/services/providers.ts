// Provider CRUD with org filtering and audit logging.
import { supabase } from '@/integrations/supabase/externalClient';
import { camelizeRow, snakeizeRow } from '@/lib/case';
import { requireActiveOrg, writeAudit } from '@/lib/audit';
import type { Provider, ProviderStatus } from '@/types';

export interface ProviderFilters {
  groupId?: string;
  state?: string;
  payerId?: string;
  status?: ProviderStatus;
  search?: string;
}

export interface ProviderInput {
  groupId?: string | null;
  firstName: string;
  lastName: string;
  credentials?: string | null;
  email?: string | null;
  phone?: string | null;
  npi?: string | null;
  caqhId?: string | null;
  caqhLastAttestedDate?: string | null;
  deaNumber?: string | null;
  taxonomyCode?: string | null;
  specialty?: string | null;
  startDate?: string | null;
  status?: ProviderStatus;
  isNewGrad?: boolean;
  dateOfBirth?: string | null;
  ssnLast4?: string | null;
  homeStreet?: string | null;
  homeCity?: string | null;
  homeState?: string | null;
  homeZip?: string | null;
  degree?: string | null;
  schoolName?: string | null;
  graduationDate?: string | null;
  malpracticeCarrier?: string | null;
  malpracticePolicyNumber?: string | null;
  malpracticeCoverageStart?: string | null;
  malpracticeCoverageEnd?: string | null;
}

export async function getProviders(filters: ProviderFilters = {}): Promise<Provider[]> {
  const orgId = requireActiveOrg();
  let query = supabase
    .from('providers')
    .select('*')
    .eq('org_id', orgId)
    .order('last_name', { ascending: true });

  if (filters.groupId) query = query.eq('group_id', filters.groupId);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.search) {
    const term = `%${filters.search}%`;
    query = query.or(
      `first_name.ilike.${term},last_name.ilike.${term},npi.ilike.${term},email.ilike.${term}`,
    );
  }

  if (filters.state) {
    const { data: lic } = await supabase
      .from('state_licenses')
      .select('provider_id')
      .eq('org_id', orgId)
      .eq('state', filters.state);
    const ids = (lic ?? []).map((r) => r.provider_id as string);
    query = query.in('id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']);
  }
  if (filters.payerId) {
    const { data: cases } = await supabase
      .from('credential_cases')
      .select('provider_id')
      .eq('org_id', orgId)
      .eq('payer_id', filters.payerId);
    const ids = (cases ?? []).map((r) => r.provider_id as string);
    query = query.in('id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']);
  }

  const { data, error } = await query;
  if (error) throw error;
  return camelizeRow<Provider[]>(data ?? []);
}

export async function getProvider(id: string): Promise<Provider | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from('providers')
    .select('*')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<Provider>(data) : null;
}

export async function createProvider(input: ProviderInput): Promise<Provider> {
  const orgId = requireActiveOrg();
  const payload = { ...snakeizeRow<Record<string, unknown>>(input), org_id: orgId };
  const { data, error } = await supabase
    .from('providers')
    .insert(payload as never)
    .select('*')
    .single();
  if (error) throw error;
  const created = camelizeRow<Provider>(data);
  await writeAudit({
    actionType: 'CREATE',
    entityType: 'provider',
    entityId: created.id,
    after: created,
    description: `Created provider ${created.firstName} ${created.lastName}`,
  });
  return created;
}

export async function updateProvider(
  id: string,
  patch: Partial<ProviderInput>,
): Promise<Provider> {
  const orgId = requireActiveOrg();
  const before = await getProvider(id);
  const payload = snakeizeRow<Record<string, unknown>>(patch);
  const { data, error } = await supabase
    .from('providers')
    .update(payload as never)
    .eq('id', id)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (error) throw error;
  const after = camelizeRow<Provider>(data);
  await writeAudit({
    actionType: 'UPDATE',
    entityType: 'provider',
    entityId: id,
    before,
    after,
    description: `Updated provider ${after.firstName} ${after.lastName}`,
  });
  return after;
}

const TERMINATION_ACTIVE_LABELS = ['active', 'approved, pending effective date'];

function buildTerminationSteps(): {
  id: string;
  order: number;
  label: string;
  isCompleted: boolean;
}[] {
  const mkId = (): string =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return [
    { id: mkId(), order: 1, label: 'Notify payer of termination date', isCompleted: false },
    { id: mkId(), order: 2, label: 'Confirm removal from payer directory', isCompleted: false },
    { id: mkId(), order: 3, label: 'Log confirmation in touch log', isCompleted: false },
  ];
}

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface TerminateProviderInput {
  providerId: string;
  terminationDate: string;
  reason: string | null;
}

export interface TerminateProviderResult {
  provider: Provider;
  tasksCreated: number;
}

export async function terminateProvider(
  input: TerminateProviderInput,
): Promise<TerminateProviderResult> {
  const orgId = requireActiveOrg();
  const before = await getProvider(input.providerId);
  if (!before) throw new Error('Provider not found');

  const { data: statusRows, error: statusErr } = await supabase
    .from('status_configs')
    .select('id, label')
    .eq('org_id', orgId)
    .eq('track', 'credentialing');
  if (statusErr) throw statusErr;
  const activeStatusIds = (statusRows ?? [])
    .filter((s) => TERMINATION_ACTIVE_LABELS.includes((s.label as string).toLowerCase()))
    .map((s) => s.id as string);

  let activeCases: { id: string; payer_id: string; state: string }[] = [];
  if (activeStatusIds.length > 0) {
    const { data: caseRows, error: caseErr } = await supabase
      .from('credential_cases')
      .select('id, payer_id, state')
      .eq('org_id', orgId)
      .eq('provider_id', input.providerId)
      .in('credentialing_status_id', activeStatusIds);
    if (caseErr) throw caseErr;
    activeCases = (caseRows ?? []) as typeof activeCases;
  }

  const payerIds = Array.from(new Set(activeCases.map((c) => c.payer_id)));
  const payerNameById = new Map<string, string>();
  if (payerIds.length > 0) {
    const { data: payers, error: payersErr } = await supabase
      .from('payers')
      .select('id, name')
      .in('id', payerIds);
    if (payersErr) throw payersErr;
    for (const p of payers ?? []) payerNameById.set(p.id as string, p.name as string);
  }

  const dueDate = addDaysISO(input.terminationDate, 14);
  const taskRows = activeCases.map((cs) => ({
    org_id: orgId,
    case_id: cs.id,
    provider_id: input.providerId,
    title: `Submit termination to ${payerNameById.get(cs.payer_id) ?? 'payer'} — ${cs.state}`,
    description: input.reason ?? null,
    sop_content: buildTerminationSteps() as never,
    status: 'not_started',
    sort_order: 999,
    due_date: dueDate,
    is_auto_generated: true,
  }));

  if (taskRows.length > 0) {
    const { error: insErr } = await supabase.from('tasks').insert(taskRows as never);
    if (insErr) throw insErr;
  }

  const { data: updated, error: updErr } = await supabase
    .from('providers')
    .update({ status: 'terminated', terminated_date: input.terminationDate } as never)
    .eq('id', input.providerId)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (updErr) throw updErr;
  const after = camelizeRow<Provider>(updated);

  await writeAudit({
    actionType: 'TERMINATION',
    entityType: 'provider',
    entityId: input.providerId,
    before: { status: before.status, terminatedDate: before.terminatedDate },
    after: {
      status: after.status,
      terminatedDate: after.terminatedDate,
      reason: input.reason,
      terminationTasksCreated: taskRows.length,
      affectedCaseIds: activeCases.map((c) => c.id),
    },
    description: `Terminated provider ${after.firstName} ${after.lastName} (${taskRows.length} task${taskRows.length === 1 ? '' : 's'} created)`,
  });

  return { provider: after, tasksCreated: taskRows.length };
}

