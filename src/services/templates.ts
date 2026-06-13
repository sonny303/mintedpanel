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
  isArchived?: boolean;
}

export async function listTemplates(): Promise<SOPTemplate[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from('sop_templates')
    .select('*')
    .eq('org_id', orgId)
    .order('name');
  if (error) throw error;
  return camelizeRow<SOPTemplate[]>(data ?? []);
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
  return data ? camelizeRow<SOPTemplate>(data) : null;
}

export async function createTemplate(input: TemplateInput): Promise<SOPTemplate> {
  const orgId = requireActiveOrg();
  const payload = { ...snakeizeRow<Record<string, unknown>>(input), org_id: orgId };
  const { data, error } = await supabase
    .from('sop_templates')
    .insert(payload as never)
    .select('*')
    .single();
  if (error) throw error;
  const created = camelizeRow<SOPTemplate>(data);
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
  const payload = { ...snakeizeRow<Record<string, unknown>>(patch), org_id: orgId };
  const { data, error } = await supabase
    .from('sop_templates')
    .update(payload as never)
    .eq('id', id)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (error) throw error;
  const after = camelizeRow<SOPTemplate>(data);
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
