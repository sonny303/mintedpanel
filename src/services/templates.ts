// SOP template CRUD (org-scoped, admin-write enforced by RLS) with audit.
import { supabase } from '@/integrations/supabase/externalClient';
import { camelizeRow, snakeizeRow } from '@/lib/case';
import { requireActiveOrg, writeAudit } from '@/lib/audit';
import type { SOPTaskDefinition, SOPTemplate } from '@/types';

export interface TemplateInput {
  name: string;
  groupId?: string | null;
  state?: string | null;
  specialty?: string | null;
  payerId?: string | null;
  taskDefinitions: SOPTaskDefinition[];
  archived?: boolean;
  isArchived?: boolean;
}

type TemplateWithArchive = SOPTemplate & { archived?: boolean; isArchived?: boolean };

function normalizeTemplate(row: SOPTemplate): SOPTemplate {
  const source = row as TemplateWithArchive;
  const archived = Boolean(source.archived ?? source.isArchived ?? false);
  return { ...row, archived, isArchived: archived } as TemplateWithArchive;
}

function templatePayload(
  input: Partial<TemplateInput>,
  orgId: string,
  archiveColumn: 'archived' | 'is_archived' = 'archived',
): Record<string, unknown> {
  const { archived, isArchived, ...rest } = input;
  const payload = snakeizeRow<Record<string, unknown>>(rest);
  payload.org_id = orgId;
  const archiveValue = archived ?? isArchived;
  if (archiveValue !== undefined) payload[archiveColumn] = archiveValue;
  return payload;
}

function shouldRetryArchivedColumn(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('archived') && message.includes('column');
}

export async function listTemplates(): Promise<SOPTemplate[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from('sop_templates')
    .select('*')
    .eq('org_id', orgId)
    .order('name');
  if (error) throw error;
  return camelizeRow<SOPTemplate[]>(data ?? []).map(normalizeTemplate);
}

export async function getTemplate(id: string): Promise<SOPTemplate | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from('sop_templates')
    .select('*')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeTemplate(camelizeRow<SOPTemplate>(data)) : null;
}

export async function createTemplate(input: TemplateInput): Promise<SOPTemplate> {
  const orgId = requireActiveOrg();
  let result = await supabase
    .from('sop_templates')
    .insert(templatePayload(input, orgId) as never)
    .select('*')
    .single();
  if (result.error && shouldRetryArchivedColumn(result.error)) {
    result = await supabase
      .from('sop_templates')
      .insert(templatePayload(input, orgId, 'is_archived') as never)
      .select('*')
      .single();
  }
  const { data, error } = result;
  if (error) throw error;
  const created = normalizeTemplate(camelizeRow<SOPTemplate>(data));
  await writeAudit({
    actionType: 'CREATE',
    entityType: 'sop_template',
    entityId: created.id,
    after: created,
    description: `Created SOP template ${created.name}`,
  });
  return created;
}

export async function updateTemplate(
  id: string,
  patch: Partial<TemplateInput>,
): Promise<SOPTemplate> {
  const orgId = requireActiveOrg();
  const before = await getTemplate(id);
  let result = await supabase
    .from('sop_templates')
    .update(templatePayload(patch, orgId) as never)
    .eq('id', id)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (result.error && shouldRetryArchivedColumn(result.error)) {
    result = await supabase
      .from('sop_templates')
      .update(templatePayload(patch, orgId, 'is_archived') as never)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
  }
  const { data, error } = result;
  if (error) throw error;
  const after = normalizeTemplate(camelizeRow<SOPTemplate>(data));
  await writeAudit({
    actionType: 'UPDATE',
    entityType: 'sop_template',
    entityId: id,
    before,
    after,
    description: `Updated SOP template ${after.name}`,
  });
  return after;
}
