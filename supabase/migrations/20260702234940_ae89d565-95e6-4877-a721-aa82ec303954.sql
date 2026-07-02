-- Per-user table preferences (visible columns + sort), keyed by (user_id, page_key).
-- Already consumed by src/services/tablePrefs.ts; this migration creates the missing table.
-- Applied to the dev project via MCP as migration "create_user_table_prefs".

CREATE TABLE public.user_table_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_key text NOT NULL,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, page_key)
);

ALTER TABLE public.user_table_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_table_prefs_select ON public.user_table_prefs
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY user_table_prefs_insert ON public.user_table_prefs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY user_table_prefs_update ON public.user_table_prefs
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Tight grants: strip the Supabase default-privilege grants (incl. anon),
-- leave only what the app needs. service_role keeps its defaults.
REVOKE ALL ON public.user_table_prefs FROM anon;
REVOKE ALL ON public.user_table_prefs FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_table_prefs TO authenticated;
