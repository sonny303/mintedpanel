-- MINT-45 — storage foundation for typed portal configuration and mapping generations.
-- Additive only. This migration does not add reset behavior or change readers.

ALTER TABLE public.portals
  ADD COLUMN IF NOT EXISTS case_type text,
  ADD COLUMN IF NOT EXISTS requires_explicit_selection boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mapping_generation integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.portals'::regclass
      AND conname = 'portals_case_type_check'
  ) THEN
    ALTER TABLE public.portals
      ADD CONSTRAINT portals_case_type_check
      CHECK (case_type IS NULL OR case_type IN ('contract', 'enrollment', 'recredentialing'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.portals'::regclass
      AND conname = 'portals_mapping_generation_positive'
  ) THEN
    ALTER TABLE public.portals
      ADD CONSTRAINT portals_mapping_generation_positive CHECK (mapping_generation >= 1);
  END IF;
END;
$$;

COMMENT ON COLUMN public.portals.case_type IS
  'MINT-45: nullable closed-set business purpose (contract, enrollment, recredentialing); NULL keeps legacy rows unclassified.';
COMMENT ON COLUMN public.portals.requires_explicit_selection IS
  'MINT-45: whether a capable client must preserve explicit same-URL configuration selection; legacy rows default false.';
COMMENT ON COLUMN public.portals.mapping_generation IS
  'MINT-45: positive generation for this exact portal owner-scope + portal_key configuration; starts at 1.';

ALTER TABLE public.portal_field_maps
  ADD COLUMN IF NOT EXISTS mapping_generation integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS shared_base_generation integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.portal_field_maps'::regclass
      AND conname = 'portal_field_maps_mapping_generation_positive'
  ) THEN
    ALTER TABLE public.portal_field_maps
      ADD CONSTRAINT portal_field_maps_mapping_generation_positive
      CHECK (mapping_generation >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.portal_field_maps'::regclass
      AND conname = 'portal_field_maps_shared_base_generation_positive'
  ) THEN
    ALTER TABLE public.portal_field_maps
      ADD CONSTRAINT portal_field_maps_shared_base_generation_positive
      CHECK (shared_base_generation IS NULL OR shared_base_generation >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.portal_field_maps'::regclass
      AND conname = 'portal_field_maps_shared_base_org_only'
  ) THEN
    ALTER TABLE public.portal_field_maps
      ADD CONSTRAINT portal_field_maps_shared_base_org_only
      CHECK (org_id IS NOT NULL OR shared_base_generation IS NULL);
  END IF;
END;
$$;

-- Existing org rows linked to a shared portal are based on its current legacy
-- generation. NULL is deliberately ambiguous for legacy/org-only keys: it
-- means no shared generation was recorded, so a later consumer must treat the
-- row as unreviewed until MINT-52 establishes a review path.
UPDATE public.portal_field_maps AS field_map
   SET shared_base_generation = shared_portal.mapping_generation
  FROM public.portals AS shared_portal
 WHERE field_map.org_id IS NOT NULL
   AND shared_portal.org_id IS NULL
   AND shared_portal.portal_key = field_map.portal_key
   AND field_map.shared_base_generation IS NULL;

-- New org overrides are stamped against the current shared configuration by
-- trusted trigger code. This prevents callers from self-certifying an arbitrary
-- base generation while preserving legacy/org-only NULL rows for later review.
CREATE OR REPLACE FUNCTION public.stamp_portal_field_map_shared_base_generation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_shared_generation integer;
BEGIN
  IF NEW.org_id IS NULL THEN
    NEW.shared_base_generation := NULL;
    RETURN NEW;
  END IF;

  SELECT portal.mapping_generation
    INTO v_shared_generation
    FROM public.portals AS portal
   WHERE portal.org_id IS NULL
     AND portal.portal_key = NEW.portal_key;

  NEW.shared_base_generation := v_shared_generation;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_mapping_generation_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_table_owner name;
BEGIN
  SELECT pg_get_userbyid(relation.relowner)
    INTO v_table_owner
    FROM pg_class AS relation
   WHERE relation.oid = TG_RELID;

  IF NEW.mapping_generation IS DISTINCT FROM OLD.mapping_generation
     AND current_user <> v_table_owner THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'mapping_generation_change_requires_definer';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_shared_base_generation_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_table_owner name;
BEGIN
  SELECT pg_get_userbyid(relation.relowner)
    INTO v_table_owner
    FROM pg_class AS relation
   WHERE relation.oid = TG_RELID;

  IF NEW.shared_base_generation IS DISTINCT FROM OLD.shared_base_generation
     AND current_user <> v_table_owner THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'shared_base_generation_requires_review';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_portal_field_map_shared_base_generation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_mapping_generation_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_shared_base_generation_change() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS portal_field_maps_stamp_shared_base_generation ON public.portal_field_maps;
CREATE TRIGGER portal_field_maps_stamp_shared_base_generation
  BEFORE INSERT ON public.portal_field_maps
  FOR EACH ROW EXECUTE FUNCTION public.stamp_portal_field_map_shared_base_generation();

DROP TRIGGER IF EXISTS portals_mapping_generation_guard ON public.portals;
CREATE TRIGGER portals_mapping_generation_guard
  BEFORE UPDATE OF mapping_generation ON public.portals
  FOR EACH ROW EXECUTE FUNCTION public.guard_mapping_generation_change();

DROP TRIGGER IF EXISTS portal_field_maps_mapping_generation_guard ON public.portal_field_maps;
CREATE TRIGGER portal_field_maps_mapping_generation_guard
  BEFORE UPDATE OF mapping_generation ON public.portal_field_maps
  FOR EACH ROW EXECUTE FUNCTION public.guard_mapping_generation_change();

DROP TRIGGER IF EXISTS portal_field_maps_shared_base_generation_guard ON public.portal_field_maps;
CREATE TRIGGER portal_field_maps_shared_base_generation_guard
  BEFORE UPDATE OF shared_base_generation ON public.portal_field_maps
  FOR EACH ROW EXECUTE FUNCTION public.guard_shared_base_generation_change();

COMMENT ON COLUMN public.portal_field_maps.mapping_generation IS
  'MINT-45: positive generation of this map row within its exact owner-scope + portal_key configuration; legacy rows start at 1.';
COMMENT ON COLUMN public.portal_field_maps.shared_base_generation IS
  'MINT-45 stores org-override base generation: matching legacy rows are backfilled and every new org row is stamped from its matching shared portal, overriding caller input. NULL means no base generation was recorded (legacy or no parent) and is unreviewed. MINT-45 does not change reader eligibility. MINT-52 handoff: retain prior-base overrides after a shared reset, but exclude them from fill eligibility until explicit review updates their base generation. Non-owner direct updates are blocked.';

COMMENT ON FUNCTION public.guard_mapping_generation_change() IS
  'MINT-45: only the table-owner SECURITY DEFINER workflow may change a portal/map generation; ordinary direct changes are blocked. Reset behavior is deferred.';
COMMENT ON FUNCTION public.guard_shared_base_generation_change() IS
  'MINT-45: prevents ordinary writers from self-certifying an org override base; MINT-52 owns any explicit review/update path.';

CREATE TABLE IF NOT EXISTS public.form_mapping_reset_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id uuid NOT NULL REFERENCES public.portals(id) ON DELETE RESTRICT,
  owner_scope text NOT NULL CHECK (owner_scope IN ('global', 'organization')),
  org_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  portal_key text NOT NULL,
  old_mapping_generation integer NOT NULL CHECK (old_mapping_generation >= 1),
  new_mapping_generation integer NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  affected_field_count integer NOT NULL CHECK (affected_field_count >= 0),
  idempotency_key uuid NOT NULL,
  CONSTRAINT form_mapping_reset_events_scope_consistent CHECK (
    (owner_scope = 'global' AND org_id IS NULL)
    OR (owner_scope = 'organization' AND org_id IS NOT NULL)
  ),
  CONSTRAINT form_mapping_reset_events_generation_increments CHECK (
    new_mapping_generation = old_mapping_generation + 1
  )
);

COMMENT ON TABLE public.form_mapping_reset_events IS
  'MINT-45 append-only reset receipts. Global scope stores org_id NULL; future reset RPC must check actor, exact portal scope/key, and expected mapping generation before changing data.';
COMMENT ON COLUMN public.form_mapping_reset_events.portal_key IS
  'Immutable configuration-key snapshot paired with owner_scope/org_id; not a URL identity.';
COMMENT ON COLUMN public.form_mapping_reset_events.idempotency_key IS
  'Caller-supplied retry key unique within this exact global or organization configuration scope.';

CREATE OR REPLACE FUNCTION public.validate_form_mapping_reset_event_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_portal_org_id uuid;
  v_portal_key text;
BEGIN
  SELECT portal.org_id, portal.portal_key
    INTO v_portal_org_id, v_portal_key
    FROM public.portals AS portal
   WHERE portal.id = NEW.portal_id;

  IF NOT FOUND
     OR v_portal_key IS DISTINCT FROM NEW.portal_key
     OR v_portal_org_id IS DISTINCT FROM NEW.org_id
     OR (NEW.owner_scope = 'global' AND v_portal_org_id IS NOT NULL)
     OR (NEW.owner_scope = 'organization' AND v_portal_org_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'form_mapping_reset_scope_mismatch';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_form_mapping_reset_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'form_mapping_reset_events_are_append_only';
END;
$$;

REVOKE ALL ON FUNCTION public.validate_form_mapping_reset_event_scope() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_form_mapping_reset_event_mutation() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS form_mapping_reset_events_validate_scope ON public.form_mapping_reset_events;
CREATE TRIGGER form_mapping_reset_events_validate_scope
  BEFORE INSERT ON public.form_mapping_reset_events
  FOR EACH ROW EXECUTE FUNCTION public.validate_form_mapping_reset_event_scope();

DROP TRIGGER IF EXISTS form_mapping_reset_events_append_only ON public.form_mapping_reset_events;
CREATE TRIGGER form_mapping_reset_events_append_only
  BEFORE UPDATE OR DELETE ON public.form_mapping_reset_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_form_mapping_reset_event_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS form_mapping_reset_events_global_idempotency
  ON public.form_mapping_reset_events (portal_key, idempotency_key)
  WHERE owner_scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS form_mapping_reset_events_org_idempotency
  ON public.form_mapping_reset_events (org_id, portal_key, idempotency_key)
  WHERE owner_scope = 'organization';

ALTER TABLE public.form_mapping_reset_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS form_mapping_reset_events_select ON public.form_mapping_reset_events;
CREATE POLICY form_mapping_reset_events_select
  ON public.form_mapping_reset_events
  FOR SELECT TO authenticated
  USING (
    (owner_scope = 'global' AND NOT app_authz.is_restricted_external())
    OR org_id IN (SELECT public.user_org_ids() AS user_org_ids)
  );

-- Authenticated clients may inspect global receipts and their own org receipts,
-- but only the future SECURITY DEFINER reset RPC may write on their behalf.
-- Service role can append for trusted server workflows, never revise history.
REVOKE ALL ON TABLE public.form_mapping_reset_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.form_mapping_reset_events TO authenticated;
GRANT SELECT, INSERT ON TABLE public.form_mapping_reset_events TO service_role;
