// MSO CRUD (org-scoped) with audit on writes.
import { supabase } from '@/integrations/supabase/client';
import { camelizeRow, snakeizeRow } from '@/lib/case';
import { requireActiveOrg, writeAudit } from '@/lib/audit';
import type { Mso } from '@/types';

export interface MsoInput {
  name: string;
  portalUrl?: string | null;
}

export async function listMsos(): Promise<Mso[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from('msos')
    .select('*')
    .eq('org_id', orgId)
    .order('name');
  if (error) throw error;
  return camelizeRow<Mso[]>(data ?? []);
}

export async function getMso(id: string): Promise<Mso | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from('msos')
    .select('*')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<Mso>(data) : null;
}

export async function createMso(input: MsoInput): Promise<Mso> {
  const orgId = requireActiveOrg();
  const payload = { ...snakeizeRow<Record<string, unknown>>(input), org_id: orgId };
  const { data, error } = await supabase
    .from('msos')
    .insert(payload as never)
    .select('*')
    .single();
  if (error) throw error;
  const created = camelizeRow<Mso>(data);
  await writeAudit({
    actionType: 'CREATE',
    entityType: 'mso',
    entityId: created.id,
    after: created,
    description: `Created MSO ${created.name}`,
  });
  return created;
}

export async function updateMso(id: string, patch: Partial<MsoInput>): Promise<Mso> {
  const orgId = requireActiveOrg();
  const before = await getMso(id);
  const payload = snakeizeRow<Record<string, unknown>>(patch);
  const { data, error } = await supabase
    .from('msos')
    .update(payload as never)
    .eq('id', id)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (error) throw error;
  const after = camelizeRow<Mso>(data);
  await writeAudit({
    actionType: 'UPDATE',
    entityType: 'mso',
    entityId: id,
    before,
    after,
    description: `Updated MSO ${after.name}`,
  });
  return after;
}
