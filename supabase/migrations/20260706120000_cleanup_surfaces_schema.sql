-- Cleanup surfaces schema (Fix-it queue / Mapping review / Portals admin).
-- Additive only, fully idempotent (safe for a repo-only rebuild and for
-- re-application to the already-migrated hosted project).
--
-- Note: browser RLS on portal_field_maps and fill_sessions already exists on
-- the live DB (member/global SELECT, writer-only INSERT/UPDATE on own-org
-- rows) and is intentionally left untouched. This migration only adds the two
-- new tables and the three additive training columns.

-- ---------------------------------------------------------------------------
-- 1. portals — org-scoped registry of payer portals the extension can fill.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.portals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  portal_key text NOT NULL,
  name text NOT NULL,
  payer_id uuid REFERENCES public.payers(id) ON DELETE SET NULL,
  form_url text,
  is_verified boolean NOT NULL DEFAULT false,
  last_verified_at timestamptz,
  url_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portals_org_key_unique UNIQUE (org_id, portal_key)
);
CREATE INDEX IF NOT EXISTS portals_org_id_idx ON public.portals (org_id);

ALTER TABLE public.portals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portals_select_org ON public.portals;
CREATE POLICY portals_select_org ON public.portals
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids() AS user_org_ids));

DROP POLICY IF EXISTS portals_insert_writer ON public.portals;
CREATE POLICY portals_insert_writer ON public.portals
  FOR INSERT TO authenticated
  WITH CHECK ((org_id IN (SELECT user_org_ids() AS user_org_ids))
              AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])));

DROP POLICY IF EXISTS portals_update_writer ON public.portals;
CREATE POLICY portals_update_writer ON public.portals
  FOR UPDATE TO authenticated
  USING ((org_id IN (SELECT user_org_ids() AS user_org_ids))
         AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))
  WITH CHECK ((org_id IN (SELECT user_org_ids() AS user_org_ids))
              AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])));

GRANT SELECT, INSERT, UPDATE ON public.portals TO authenticated;

DROP TRIGGER IF EXISTS portals_set_updated_at ON public.portals;
CREATE TRIGGER portals_set_updated_at BEFORE UPDATE ON public.portals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. field_dictionary — org-scoped label -> token memory for the fill engine.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_dictionary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label_normalized text NOT NULL,
  token text NOT NULL,
  status text NOT NULL DEFAULT 'suggested'
    CHECK (status = ANY (ARRAY['suggested'::text, 'confirmed'::text, 'rejected'::text])),
  seen_count integer NOT NULL DEFAULT 1,
  decided_at timestamptz,
  decided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_dictionary_org_label_unique UNIQUE (org_id, label_normalized)
);
CREATE INDEX IF NOT EXISTS field_dictionary_org_id_idx ON public.field_dictionary (org_id);

ALTER TABLE public.field_dictionary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS field_dictionary_select_org ON public.field_dictionary;
CREATE POLICY field_dictionary_select_org ON public.field_dictionary
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids() AS user_org_ids));

DROP POLICY IF EXISTS field_dictionary_insert_writer ON public.field_dictionary;
CREATE POLICY field_dictionary_insert_writer ON public.field_dictionary
  FOR INSERT TO authenticated
  WITH CHECK ((org_id IN (SELECT user_org_ids() AS user_org_ids))
              AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])));

DROP POLICY IF EXISTS field_dictionary_update_writer ON public.field_dictionary;
CREATE POLICY field_dictionary_update_writer ON public.field_dictionary
  FOR UPDATE TO authenticated
  USING ((org_id IN (SELECT user_org_ids() AS user_org_ids))
         AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))
  WITH CHECK ((org_id IN (SELECT user_org_ids() AS user_org_ids))
              AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])));

GRANT SELECT, INSERT, UPDATE ON public.field_dictionary TO authenticated;

DROP TRIGGER IF EXISTS field_dictionary_set_updated_at ON public.field_dictionary;
CREATE TRIGGER field_dictionary_set_updated_at BEFORE UPDATE ON public.field_dictionary
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. portal_field_maps — additive training columns (captured per proposed row).
-- ---------------------------------------------------------------------------
ALTER TABLE public.portal_field_maps ADD COLUMN IF NOT EXISTS field_label text;
ALTER TABLE public.portal_field_maps ADD COLUMN IF NOT EXISTS form_section text;
ALTER TABLE public.portal_field_maps ADD COLUMN IF NOT EXISTS confidence smallint;
