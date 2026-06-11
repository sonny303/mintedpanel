// Touches: append-only contact log per case. Reads filter by org; the insert
// also writes an audit_log row with action_type 'TOUCH_LOGGED'.
import { supabase } from '@/integrations/supabase/externalClient';
import { camelizeRow, snakeizeRow } from '@/lib/case';
import { currentUserId, requireActiveOrg, writeAudit } from '@/lib/audit';
import type { Touch, TouchOutcome, TouchType } from '@/types';

export interface TouchInput {
  touchDate: string;
  touchType: TouchType;
  outcome: TouchOutcome;
  nextFollowUpDate?: string | null;
  notes?: string | null;
}

export async function getTouches(caseId: string): Promise<Touch[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from('touches')
    .select('*')
    .eq('org_id', orgId)
    .eq('case_id', caseId)
    .order('touch_date', { ascending: false });
  if (error) throw error;
  return camelizeRow<Touch[]>(data ?? []);
}

export async function logTouch(caseId: string, input: TouchInput): Promise<Touch> {
  const orgId = requireActiveOrg();
  const source = 'manual' as const;
  const payload = {
    ...snakeizeRow<Record<string, unknown>>(input),
    org_id: orgId,
    case_id: caseId,
    coordinator_id: source === 'manual' ? currentUserId() : null,
    source,
  };
  const { data, error } = await supabase
    .from('touches')
    .insert(payload as never)
    .select('*')
    .single();
  if (error) throw error;
  const created = camelizeRow<Touch>(data);
  await writeAudit({
    actionType: 'TOUCH_LOGGED',
    entityType: 'touch',
    entityId: created.id,
    after: created,
    description: `Logged ${created.touchType} touch (${created.outcome})`,
  });
  return created;
}
