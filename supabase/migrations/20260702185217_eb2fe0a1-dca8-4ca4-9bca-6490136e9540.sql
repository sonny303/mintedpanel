
CREATE TABLE public.user_table_prefs (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_key TEXT NOT NULL,
  prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, page_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_table_prefs TO authenticated;
GRANT ALL ON public.user_table_prefs TO service_role;
ALTER TABLE public.user_table_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own table prefs" ON public.user_table_prefs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
