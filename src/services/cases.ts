// Credential cases: list, detail (with joined provider/payer/mso/tasks/touches/
// notes/status history), create, and credentialing-track status changes that
// also append status_history and audit_log.

import { supabase } from '@/integrations/supabase/externalClient';
import { camelizeRow, snakeizeRow } from '@/lib/case';
import { currentUserId, requireActiveOrg, writeAudit } from '@/lib/audit';
import type {
  CaseDetail,
  Contract,
  CredentialCase,
  Note,
  StatusHistoryEntry,
  Task,
  Touch,
} from '@/types';

export interface CaseFilters {
  providerId?: string;
  payerId?: string;
  state?: string;
  statusId?: string;
  assignedTo?: string;
}

export interface CaseInput {
  providerId: string;
  payerId: string;
  state: string;
  groupId?: string | null;
  facilityId?: string | null;
  specialty?: string | null;
  credentialingStatusId?: string | null;
  msoId?: string | null;
  assignedTo?: string | null;
  submittedDate?: string | null;
  expectedEffectiveDate?: string | null;
}

export async function getCases(filters: CaseFilters = {}): Promise<CredentialCase[]> {
  const orgId = requireActiveOrg();
  let query = supabase
    .from('credential_cases')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (filters.providerId) query = query.eq('provider_id', filters.providerId);
  if (filters.payerId) query = query.eq('payer_id', filters.payerId);
  if (filters.state) query = query.eq('state', filters.state);
  if (filters.statusId) query = query.eq('credentialing_status_id', filters.statusId);
  if (filters.assignedTo) query = query.eq('assigned_to', filters.assignedTo);
  const { data, error } = await query;
  if (error) throw error;
  return camelizeRow<CredentialCase[]>(data ?? []);
}

export async function getCase(id: string): Promise<CaseDetail | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from('credential_cases')
    .select(
      `*,
       provider:providers(*),
       payer:payers(*),
       mso:msos(*),
       group:provider_groups(*),
       facility:facilities(*),
       credentialing_status:status_configs(*),
       tasks(*),
       touches(*),
       notes(*),
       status_history(*)`,
    )
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return camelizeRow<CaseDetail>(data);
}

export async function createCase(input: CaseInput): Promise<CredentialCase> {
  const orgId = requireActiveOrg();
  const payload = {
    ...snakeizeRow<Record<string, unknown>>(input),
    org_id: orgId,
    created_by: currentUserId(),
  };
  const { data, error } = await supabase
    .from('credential_cases')
    .insert(payload as never)
    .select('*')
    .single();
  if (error) throw error;
  const created = camelizeRow<CredentialCase>(data);
  await writeAudit({
    actionType: 'CREATE',
    entityType: 'credential_case',
    entityId: created.id,
    after: created,
    description: `Created credentialing case`,
  });
  return created;
}

export async function updateCaseStatus(
  caseId: string,
  statusId: string,
  metadata: Record<string, unknown> = {},
): Promise<CredentialCase> {
  const orgId = requireActiveOrg();

  const { data: existing, error: readErr } = await supabase
    .from('credential_cases')
    .select('*')
    .eq('id', caseId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!existing) throw new Error('Case not found');
  const fromStatusId = (existing.credentialing_status_id as string | null) ?? null;

  const patch: Record<string, unknown> = {
    credentialing_status_id: statusId,
    ...snakeizeRow<Record<string, unknown>>(metadata),
  };

  const { data: updated, error: updErr } = await supabase
    .from('credential_cases')
    .update(patch as never)
    .eq('id', caseId)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (updErr) throw updErr;

  await supabase.from('status_history').insert({
    org_id: orgId,
    case_id: caseId,
    contract_id: null,
    track: 'credentialing',
    from_status_id: fromStatusId,
    to_status_id: statusId,
    metadata: metadata as never,
    changed_by: currentUserId(),
  });

  await writeAudit({
    actionType: 'STATUS_CHANGE',
    entityType: 'credential_case',
    entityId: caseId,
    before: { credentialingStatusId: fromStatusId },
    after: { credentialingStatusId: statusId, ...metadata },
    description: `Credentialing status changed`,
  });

  return camelizeRow<CredentialCase>(updated);
}

export async function getContractFor(
  groupId: string,
  payerId: string,
  state: string,
): Promise<Contract | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('org_id', orgId)
    .eq('group_id', groupId)
    .eq('payer_id', payerId)
    .eq('state', state)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<Contract>(data) : null;
}

// Re-exports for convenience when a screen needs the joined child types
export type { Task, Touch, Note, StatusHistoryEntry };
