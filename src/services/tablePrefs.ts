// Read/write per-user table preferences (visible columns + sort) stored in
// public.user_table_prefs. Keyed by (user_id, page_key); prefs is JSONB.
import { supabase } from '@/integrations/supabase/externalClient';
import type { Json } from '@/integrations/supabase/types';

export interface TablePrefsPayload {
  visibleCols?: Record<string, boolean>;
  sortKey?: string | null;
  sortDir?: 'asc' | 'desc' | null;
}

export async function getTablePrefs(pageKey: string): Promise<TablePrefsPayload | null> {
  const { data, error } = await supabase
    .from('user_table_prefs')
    .select('prefs')
    .eq('page_key', pageKey)
    .maybeSingle();
  if (error) throw error;
  return (data?.prefs as TablePrefsPayload | null) ?? null;
}

export async function upsertTablePrefs(
  userId: string,
  pageKey: string,
  prefs: TablePrefsPayload,
): Promise<void> {
  const { error } = await supabase
    .from('user_table_prefs')
    .upsert(
      {
        user_id: userId,
        page_key: pageKey,
        prefs: prefs as unknown as Json,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,page_key' },
    );
  if (error) throw error;
}
