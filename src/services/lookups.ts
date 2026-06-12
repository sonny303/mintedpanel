// Read-only lookup queries used by list screens: provider groups for the
// active org, coordinators, state licenses, mso routing rules, plus notes.
import { supabase } from '@/integrations/supabase/externalClient';
import { camelizeRow, snakeizeRow } from '@/lib/case';
import { currentUserId, requireActiveOrg, writeAudit } from '@/lib/audit';
import type { Facility, MsoRoutingRule, Note, NoteEntityType, Profile, ProviderGroup } from '@/types';

export interface StateLicense {
  id: string;
  orgId: string;
  providerId: string | null;
  state: string;
  licenseNumber: string | null;
  licenseType: string | null;
  issueDate: string | null;
  expirationDate: string | null;
  status: string | null;
  createdAt: string | null;
}

export async function getStateLicensesByProvider(providerId: string): Promise<StateLicense[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from('state_licenses')
    .select('*')
    .eq('org_id', orgId)
    .eq('provider_id', providerId)
    .order('state', { ascending: true });
  if (error) throw error;
  return camelizeRow<StateLicense[]>(data ?? []);
}

export async function getFacilities(groupId?: string | null): Promise<Facility[]> {
  const orgId = requireActiveOrg();
  let query = supabase
    .from('facilities')
    .select('*')
    .eq('org_id', orgId)
    .order('name', { ascending: true });
  if (groupId) query = query.eq('group_id', groupId);
  const { data, error } = await query;
  if (error) throw error;
  return camelizeRow<Facility[]>(data ?? []);
}

export async function getProviderGroups(): Promise<ProviderGroup[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from('provider_groups')
    .select('*')
    .eq('org_id', orgId)
    .order('name', { ascending: true });
  if (error) throw error;
  return camelizeRow<ProviderGroup[]>(data ?? []);
}

export async function getCoordinators(): Promise<Profile[]> {
  const orgId = requireActiveOrg();
  const { data: caseRows, error: caseErr } = await supabase
    .from('credential_cases')
    .select('assigned_to')
    .eq('org_id', orgId)
    .not('assigned_to', 'is', null);
  if (caseErr) throw caseErr;
  const ids = Array.from(
    new Set((caseRows ?? []).map((r) => r.assigned_to as string).filter(Boolean)),
  );
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, created_at')
    .in('id', ids);
  if (error) throw error;
  return camelizeRow<Profile[]>(data ?? []);
}

export async function getMsoRoutingRule(
  payerId: string,
  state: string,
  specialty: string | null,
): Promise<MsoRoutingRule | null> {
  const orgId = requireActiveOrg();
  // mso_routing_rules stores 'All' as a wildcard for both state and specialty.
  // Pull rows for the exact state OR the wildcard, then rank in JS.
  const { data, error } = await supabase
    .from('mso_routing_rules')
    .select('*')
    .eq('org_id', orgId)
    .eq('payer_id', payerId)
    .in('state', [state, 'All']);
  if (error) throw error;
  const rows = camelizeRow<MsoRoutingRule[]>(data ?? []);
  const isAll = (v: string | null | undefined): boolean =>
    !v || v.toLowerCase() === 'all';
  const eq = (a: string | null | undefined, b: string | null | undefined): boolean =>
    (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
  const score = (r: MsoRoutingRule): number => {
    const stateExact = eq(r.state, state);
    const stateWild = isAll(r.state);
    const specExact = specialty ? eq(r.specialty, specialty) : false;
    const specWild = isAll(r.specialty);
    if (stateExact && specExact) return 4;
    if (stateExact && specWild) return 3;
    if (stateWild && specExact) return 2;
    if (stateWild && specWild) return 1;
    return 0;
  };
  const ranked = rows
    .map((r) => ({ r, s: score(r) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return ranked[0]?.r ?? null;
}

export interface CreateNoteInput {
  entityType: NoteEntityType;
  entityId: string;
  content: string;
}

export async function createNote(input: CreateNoteInput): Promise<Note> {
  const orgId = requireActiveOrg();
  const payload = {
    ...snakeizeRow<Record<string, unknown>>(input),
    org_id: orgId,
    author_id: currentUserId(),
  };
  const { data, error } = await supabase
    .from('notes')
    .insert(payload as never)
    .select('*')
    .single();
  if (error) throw error;
  const created = camelizeRow<Note>(data);
  await writeAudit({
    actionType: 'CREATE',
    entityType: 'note',
    entityId: created.id,
    after: created,
    description: `Added note to ${created.entityType}`,
  });
  return created;
}
