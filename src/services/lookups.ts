// Read-only lookup queries used by list screens: provider groups for the
// active org, and a coordinator (profile) map keyed by user id.
import { supabase } from '@/integrations/supabase/client';
import { camelizeRow } from '@/lib/case';
import { requireActiveOrg } from '@/lib/audit';
import type { Facility, Profile, ProviderGroup } from '@/types';

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
