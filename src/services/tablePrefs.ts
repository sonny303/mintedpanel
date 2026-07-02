// Read/write per-user table preferences (visible columns + sort) stored in
// public.user_table_prefs. Keyed by (user_id, page_key); prefs is JSONB.
import { supabase } from '@/integrations/supabase/externalClient';

export interface TablePrefsPayload {
  visibleCols?: Record<string, boolean>;
  sortKey?: string | null;
  sortDir?: 'asc' | 'desc' | null;
}

export async function getTablePrefs(pageKey: string): Promise<TablePrefsPayload | null> {
  const { data, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('user_table_prefs' as any)
    .select('prefs')
    .eq('page_key', pageKey)
    .maybeSingle();
  if (error) throw error;
  const row = data as { prefs: TablePrefsPayload } | null;
  return row?.prefs ?? null;
}

export async function upsertTablePrefs(
  userId: string,
  pageKey: string,
  prefs: TablePrefsPayload,
): Promise<void> {
  const { error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('user_table_prefs' as any)
    .upsert(
      { user_id: userId, page_key: pageKey, prefs, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,page_key' },
    );
  if (error) throw error;
}
