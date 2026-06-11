// Provider CRUD with org filtering and audit logging.
import { supabase } from '@/integrations/supabase/client';
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
