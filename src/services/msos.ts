// MSO CRUD (org-scoped) with audit on writes.
import { supabase } from '@/integrations/supabase/externalClient';
import { camelizeRow, snakeizeRow } from '@/lib/case';
import { requireActiveOrg, writeAudit } from '@/lib/audit';
import type { Mso, MsoRoutingRule } from '@/types';

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

// ---------------------------------------------------------------------------
// MSO routing rules
// ---------------------------------------------------------------------------

export interface RoutingRuleInput {
  payerId: string;
  state: string;
  specialty: string;
  routeType: 'direct' | 'mso';
  msoId: string | null;
  notes: string | null;
}

export async function listRoutingRules(): Promise<MsoRoutingRule[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from('mso_routing_rules')
    .select('*')
    .eq('org_id', orgId)
    .order('state', { ascending: true });
  if (error) throw error;
  return camelizeRow<MsoRoutingRule[]>(data ?? []);
}

async function getRoutingRule(id: string): Promise<MsoRoutingRule | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from('mso_routing_rules')
    .select('*')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<MsoRoutingRule>(data) : null;
}

export async function createRoutingRule(input: RoutingRuleInput): Promise<MsoRoutingRule> {
  const orgId = requireActiveOrg();
  const payload = {
    ...snakeizeRow<Record<string, unknown>>(input),
    mso_id: input.routeType === 'mso' ? input.msoId : null,
    org_id: orgId,
  };
  const { data, error } = await supabase
    .from('mso_routing_rules')
    .insert(payload as never)
    .select('*')
    .single();
  if (error) throw error;
  const created = camelizeRow<MsoRoutingRule>(data);
  await writeAudit({
    actionType: 'CREATE',
    entityType: 'mso_routing_rule',
    entityId: created.id,
    after: created,
    description: `Created routing rule for ${created.state}/${created.specialty}`,
  });
  return created;
}

export async function updateRoutingRule(
  id: string,
  input: RoutingRuleInput,
): Promise<MsoRoutingRule> {
  const orgId = requireActiveOrg();
  const before = await getRoutingRule(id);
  const payload = {
    ...snakeizeRow<Record<string, unknown>>(input),
    mso_id: input.routeType === 'mso' ? input.msoId : null,
  };
  const { data, error } = await supabase
    .from('mso_routing_rules')
    .update(payload as never)
    .eq('id', id)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (error) throw error;
  const after = camelizeRow<MsoRoutingRule>(data);
  await writeAudit({
    actionType: 'UPDATE',
    entityType: 'mso_routing_rule',
    entityId: id,
    before,
    after,
    description: `Updated routing rule for ${after.state}/${after.specialty}`,
  });
  return after;
}
