-- Migration: 20261007120000_r1_database_schema_sanitization.sql
-- Description: Requirement R1 Database Schema Sanitization:
--   1. Drop session-variable triggers on portal_field_maps and portals
--   2. Drop trigger functions and session GUC assertion helpers
--   3. Strip set_config from all mapping RPCs (capture, propose, review, reset)
--      and decouple helper RPCs from dropped functions
--   4. Rename ticket-branded objects to clean domain names:
--      - validate_mint58_case_fill_context -> validate_case_fill_context
--      - trg_mint58_case_fill_context -> trg_validate_case_fill_context
--      - mint60_has_current_approved_web_map -> has_current_approved_web_map
--      - update record_typed_enrollment_submission to call has_current_approved_web_map
--   5. Simplify fill_sessions_contract_context_check constraint

-- ============================================================================
-- 1. DROP SESSION-VARIABLE TRIGGERS AND FUNCTIONS
-- ============================================================================

-- Drop triggers relying on Postgres session variables
DROP TRIGGER IF EXISTS portal_field_maps_generation_write_guard ON public.portal_field_maps;
DROP TRIGGER IF EXISTS portals_generation_write_guard ON public.portals;

-- Drop trigger execution functions
DROP FUNCTION IF EXISTS public.guard_portal_field_map_generation_write();
DROP FUNCTION IF EXISTS public.guard_portal_configuration_generation_write();

-- Sanitize generation write assertion helpers by stripping all session GUC mutations (set_config/current_setting)
CREATE OR REPLACE FUNCTION public.assert_portal_mapping_generation_for_write(
  p_portal_key text,
  p_org_id uuid,
  p_expected_mapping_generation integer
)
RETURNS public.portals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row public.portals%ROWTYPE;
  v_shared public.portals%ROWTYPE;
  v_key text := lower(btrim(coalesce(p_portal_key, '')));
BEGIN
  IF v_key = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'portal_key_required';
  END IF;

  IF p_org_id IS NOT NULL THEN
    SELECT * INTO v_row
      FROM public.portals
     WHERE org_id = p_org_id AND portal_key = v_key
     FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    SELECT * INTO v_row
      FROM public.portals
     WHERE org_id IS NULL AND portal_key = v_key
     FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'portal_configuration_not_found';
  END IF;

  IF p_org_id IS NOT NULL THEN
    SELECT * INTO v_shared
      FROM public.portals
     WHERE org_id IS NULL AND portal_key = v_key
     FOR UPDATE;
  END IF;

  IF p_expected_mapping_generation IS NULL THEN
    IF v_row.mapping_generation <> 1
       OR v_row.requires_explicit_selection
       OR v_row.case_type IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM public.form_mapping_reset_events event
          WHERE event.portal_id = v_row.id
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_token_required';
    END IF;
  ELSIF p_expected_mapping_generation IS DISTINCT FROM v_row.mapping_generation THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_stale';
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_portal_mapping_generation_for_write(text, uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_portal_mapping_generation_for_write(text, uuid, integer)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_legacy_pdf_mapping_generation_for_write(
  p_portal_key text,
  p_expected_mapping_generation integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key text := lower(btrim(coalesce(p_portal_key, '')));
  v_family_text text;
  v_family_id uuid;
BEGIN
  IF v_key !~ '^payer-form:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'portal_configuration_not_found';
  END IF;
  IF p_expected_mapping_generation IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_token_required';
  ELSIF p_expected_mapping_generation <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_stale';
  END IF;

  v_family_text := substr(v_key, length('payer-form:') + 1);
  v_family_id := v_family_text::uuid;
  PERFORM 1 FROM public.payer_forms
   WHERE family_id = v_family_id AND retired_at IS NULL
   ORDER BY version DESC
   LIMIT 1
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'payer_form_configuration_not_found';
  END IF;

  RETURN 1;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_legacy_pdf_mapping_generation_for_write(text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_legacy_pdf_mapping_generation_for_write(text, integer)
  TO authenticated, service_role;


-- ============================================================================
-- 2. REDEFINE MAPPING RPCS TO STRIP set_config AND DECOUPLE FROM DROPPED HELPERS
-- ============================================================================

-- 2.1 capture_org_portal_field_map
CREATE OR REPLACE FUNCTION public.capture_org_portal_field_map(
  p_org_id uuid,
  p_expected_mapping_generation integer,
  p_capture jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key text := lower(btrim(coalesce(p_capture->>'portal_key', '')));
  v_selector text := btrim(coalesce(p_capture->>'selector', ''));
  v_portal public.portals%ROWTYPE;
  v_map public.portal_field_maps%ROWTYPE;
  v_shared_map public.portal_field_maps%ROWTYPE;
  v_kind text := 'created';
  v_options jsonb;
  v_shared_generation integer;
BEGIN
  IF p_org_id IS NULL OR v_key = '' OR v_selector = ''
     OR jsonb_typeof(p_capture) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_field_map_capture';
  END IF;

  -- Lock configuration row directly without assert_portal_mapping_generation_for_write
  IF p_org_id IS NOT NULL THEN
    SELECT * INTO v_portal
      FROM public.portals
     WHERE org_id = p_org_id AND portal_key = v_key
     FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    SELECT * INTO v_portal
      FROM public.portals
     WHERE org_id IS NULL AND portal_key = v_key
     FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'portal_configuration_not_found';
  END IF;

  IF p_expected_mapping_generation IS NULL THEN
    IF v_portal.mapping_generation <> 1
       OR v_portal.requires_explicit_selection
       OR v_portal.case_type IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM public.form_mapping_reset_events event
          WHERE event.portal_id = v_portal.id
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_token_required';
    END IF;
  ELSIF p_expected_mapping_generation IS DISTINCT FROM v_portal.mapping_generation THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_stale';
  END IF;

  SELECT mapping_generation INTO v_shared_generation
    FROM public.portals WHERE org_id IS NULL AND portal_key = v_key;
  v_options := CASE WHEN jsonb_typeof(p_capture->'control_options') = 'array'
                    AND jsonb_array_length(p_capture->'control_options') > 0
                    THEN p_capture->'control_options' ELSE NULL END;

  SELECT * INTO v_map
    FROM public.portal_field_maps
   WHERE org_id = p_org_id AND portal_key = v_key AND selector = v_selector
   FOR UPDATE;
  IF FOUND THEN
    v_kind := 'existing';
    IF v_map.mapping_generation IS DISTINCT FROM v_portal.mapping_generation THEN
      -- set_config('minted.mapping_recapture_refresh') stripped
      UPDATE public.portal_field_maps
         SET mapping_generation = v_portal.mapping_generation,
             field_label = nullif(btrim(coalesce(p_capture->>'field_label', '')), ''),
             form_section = nullif(btrim(coalesce(p_capture->>'form_section', '')), ''),
             page_step = nullif(btrim(coalesce(p_capture->>'page_step', '')), ''),
             url_pattern = nullif(btrim(coalesce(p_capture->>'url_pattern', '')), ''),
             field_type = coalesce(nullif(p_capture->>'field_type', ''), 'text'),
             control_options = v_options,
             token = NULL, hardcoded_value = NULL, transform = NULL,
             status = 'proposed', source = 'manual',
             notes = 'Proposed by the extension — seen on the form, not yet mapped to a token.',
             shared_base_generation = v_shared_generation,
             display_label = NULL, section = NULL, sort_order = NULL,
             updated_at = now()
       WHERE id = v_map.id
       RETURNING * INTO v_map;
    ELSIF v_options IS NOT NULL THEN
      UPDATE public.portal_field_maps
         SET control_options = v_options, updated_at = now()
       WHERE id = v_map.id
       RETURNING * INTO v_map;
    END IF;
  ELSE
    IF v_shared_generation IS NOT NULL THEN
      SELECT * INTO v_shared_map FROM public.portal_field_maps
       WHERE org_id IS NULL
         AND portal_key = v_key
         AND selector = v_selector
         AND map_type = 'web'
         AND mapping_generation = v_shared_generation
       FOR UPDATE;
      IF FOUND THEN
        RETURN jsonb_build_object('kind', 'existing', 'map', to_jsonb(v_shared_map));
      END IF;
    END IF;
    INSERT INTO public.portal_field_maps (
      org_id, portal_key, selector, field_label, form_section, page_step,
      url_pattern, field_type, map_type, status, source, notes, token,
      control_options
    ) VALUES (
      p_org_id, v_key, v_selector,
      nullif(btrim(coalesce(p_capture->>'field_label', '')), ''),
      nullif(btrim(coalesce(p_capture->>'form_section', '')), ''),
      nullif(btrim(coalesce(p_capture->>'page_step', '')), ''),
      nullif(btrim(coalesce(p_capture->>'url_pattern', '')), ''),
      coalesce(nullif(p_capture->>'field_type', ''), 'text'),
      'web', 'proposed', 'manual',
      'Proposed by the extension — seen on the form, not yet mapped to a token.',
      NULL, v_options
    ) RETURNING * INTO v_map;
  END IF;

  RETURN jsonb_build_object('kind', v_kind, 'map', to_jsonb(v_map));
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'portal_selector_collision: this selector already belongs to a different mapping; review the existing selector in the Form mapping trainer.';
END;
$$;

REVOKE ALL ON FUNCTION public.capture_org_portal_field_map(uuid, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_org_portal_field_map(uuid, integer, jsonb)
  TO service_role;


-- 2.2 propose_shared_field_map
CREATE OR REPLACE FUNCTION public.propose_shared_field_map(
  p_portal_key text, p_selector text, p_field_label text,
  p_form_section text, p_page_step text, p_field_type text,
  p_sort_order integer, p_notes text, p_control_options jsonb,
  p_map_type text, p_expected_mapping_generation integer
)
RETURNS public.portal_field_maps
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing public.portal_field_maps%ROWTYPE;
  v_portal public.portals%ROWTYPE;
  v_generation integer;
  v_key text := lower(btrim(coalesce(p_portal_key, '')));
  v_family_text text;
  v_family_id uuid;
BEGIN
  IF p_map_type = 'pdf' THEN
    IF v_key !~ '^payer-form:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'portal_configuration_not_found';
    END IF;
    IF p_expected_mapping_generation IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_token_required';
    ELSIF p_expected_mapping_generation <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_stale';
    END IF;
    v_family_text := substr(v_key, length('payer-form:') + 1);
    v_family_id := v_family_text::uuid;
    PERFORM 1 FROM public.payer_forms
     WHERE family_id = v_family_id AND retired_at IS NULL
     ORDER BY version DESC
     LIMIT 1
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'payer_form_configuration_not_found';
    END IF;
    v_generation := 1;
  ELSE
    IF v_key = '' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'portal_key_required';
    END IF;
    SELECT * INTO v_portal
      FROM public.portals
     WHERE org_id IS NULL AND portal_key = v_key
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'portal_configuration_not_found';
    END IF;
    IF p_expected_mapping_generation IS NULL THEN
      IF v_portal.mapping_generation <> 1
         OR v_portal.requires_explicit_selection
         OR v_portal.case_type IS NOT NULL
         OR EXISTS (
           SELECT 1 FROM public.form_mapping_reset_events event
            WHERE event.portal_id = v_portal.id
         ) THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_token_required';
      END IF;
    ELSIF p_expected_mapping_generation IS DISTINCT FROM v_portal.mapping_generation THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_stale';
    END IF;
    v_generation := v_portal.mapping_generation;
  END IF;

  SELECT * INTO v_existing FROM public.portal_field_maps
   WHERE org_id IS NULL AND portal_key = lower(btrim(p_portal_key))
     AND selector = btrim(p_selector) AND map_type = coalesce(p_map_type, 'web') FOR UPDATE;
  IF FOUND AND v_existing.mapping_generation IS DISTINCT FROM v_generation THEN
    -- set_config('minted.mapping_recapture_refresh') stripped
    UPDATE public.portal_field_maps
       SET mapping_generation = v_generation,
           field_label = nullif(btrim(coalesce(p_field_label, '')), ''),
           form_section = nullif(btrim(coalesce(p_form_section, '')), ''),
           page_step = nullif(btrim(coalesce(p_page_step, '')), ''),
           field_type = coalesce(nullif(p_field_type, ''), 'text'),
           token = NULL, hardcoded_value = NULL, transform = NULL,
           status = 'proposed', source = 'manual',
           notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'Captured for the shared form library'),
           display_label = NULL, section = NULL, sort_order = NULL,
           control_options = CASE WHEN jsonb_typeof(p_control_options) = 'array'
                                      AND jsonb_array_length(p_control_options) > 0
                                  THEN p_control_options ELSE NULL END,
           updated_at = now()
     WHERE id = v_existing.id
     RETURNING * INTO v_existing;
    RETURN v_existing;
  END IF;
  RETURN public.propose_shared_field_map(
    p_portal_key, p_selector, p_field_label, p_form_section, p_page_step,
    p_field_type, p_sort_order, p_notes, p_control_options, p_map_type
  );
END;
$$;

REVOKE ALL ON FUNCTION public.propose_shared_field_map(text, text, text, text, text, text, integer, text, jsonb, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_shared_field_map(text, text, text, text, text, text, integer, text, jsonb, text, integer)
  TO authenticated, service_role;


-- 2.3 review_org_portal_field_map_base
CREATE OR REPLACE FUNCTION public.review_org_portal_field_map_base(
  p_org_id uuid,
  p_id uuid,
  p_expected_mapping_generation integer,
  p_expected_shared_base_generation integer
)
RETURNS public.portal_field_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_map public.portal_field_maps%ROWTYPE;
  v_portal public.portals%ROWTYPE;
  v_shared public.portals%ROWTYPE;
  v_shared_generation integer;
  v_old_shared_generation integer;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.memberships membership
     WHERE membership.org_id = p_org_id
       AND membership.user_id = auth.uid()
       AND membership.role IN ('admin', 'specialist')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not_authorized';
  END IF;

  SELECT * INTO v_map FROM public.portal_field_maps
   WHERE id = p_id AND org_id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'field_map_not_found';
  END IF;

  -- Lock configuration rows without assert_portal_mapping_generation_for_write
  SELECT * INTO v_portal
    FROM public.portals
   WHERE org_id = p_org_id AND portal_key = v_map.portal_key
   FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_portal
      FROM public.portals
     WHERE org_id IS NULL AND portal_key = v_map.portal_key
     FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'portal_configuration_not_found';
  END IF;

  SELECT * INTO v_shared
    FROM public.portals
   WHERE org_id IS NULL AND portal_key = v_map.portal_key
   FOR UPDATE;

  IF p_expected_mapping_generation IS NULL THEN
    IF v_portal.mapping_generation <> 1
       OR v_portal.requires_explicit_selection
       OR v_portal.case_type IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM public.form_mapping_reset_events event
          WHERE event.portal_id = v_portal.id
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_token_required';
    END IF;
  ELSIF p_expected_mapping_generation IS DISTINCT FROM v_portal.mapping_generation THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_stale';
  END IF;

  IF v_map.mapping_generation IS DISTINCT FROM v_portal.mapping_generation THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_stale';
  END IF;

  SELECT mapping_generation INTO v_shared_generation
    FROM public.portals
   WHERE org_id IS NULL AND portal_key = v_map.portal_key;
  IF p_expected_shared_base_generation IS DISTINCT FROM v_shared_generation THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_shared_base_stale';
  END IF;
  IF v_map.shared_base_generation IS NOT DISTINCT FROM v_shared_generation THEN
    RETURN v_map;
  END IF;

  SELECT * INTO v_map FROM public.portal_field_maps
   WHERE id = p_id AND org_id = p_org_id AND portal_key = v_map.portal_key
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'field_map_not_found';
  END IF;
  IF v_map.mapping_generation IS DISTINCT FROM v_portal.mapping_generation THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_override_changed_during_review';
  END IF;
  IF v_map.shared_base_generation IS NOT DISTINCT FROM v_shared_generation THEN
    RETURN v_map;
  END IF;
  v_old_shared_generation := v_map.shared_base_generation;

  -- set_config('minted.mapping_base_review_id') stripped
  UPDATE public.portal_field_maps
     SET shared_base_generation = v_shared_generation,
         updated_at = now()
   WHERE id = p_id AND org_id = p_org_id
   RETURNING * INTO v_map;
  INSERT INTO public.audit_log(
    org_id, user_id, action_type, entity_type, entity_id, before, after, description
  ) VALUES (
    p_org_id, auth.uid(), 'UPDATE', 'portal_field_map', v_map.id,
    jsonb_build_object('sharedBaseGeneration', v_old_shared_generation),
    jsonb_build_object(
      'portalKey', v_map.portal_key,
      'selector', v_map.selector,
      'sharedBaseGeneration', v_shared_generation
    ),
    'Reviewed an organization field-map override against the current shared base'
  );
  RETURN v_map;
END;
$$;

REVOKE ALL ON FUNCTION public.review_org_portal_field_map_base(uuid, uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_org_portal_field_map_base(uuid, uuid, integer, integer)
  TO authenticated, service_role;


-- 2.4 reset_portal_mapping (atomic mapping reset)
CREATE OR REPLACE FUNCTION public.reset_portal_mapping(
  p_portal_id uuid,
  p_expected_mapping_generation integer,
  p_idempotency_key uuid
)
RETURNS public.form_mapping_reset_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_portal public.portals%ROWTYPE;
  v_receipt public.form_mapping_reset_events%ROWTYPE;
  v_owner_scope text;
  v_affected_field_count integer;
BEGIN
  IF v_actor_id IS NULL OR coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not_authorized';
  END IF;
  IF p_portal_id IS NULL
     OR p_expected_mapping_generation IS NULL
     OR p_expected_mapping_generation < 1
     OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_mapping_reset';
  END IF;

  SELECT * INTO v_portal
    FROM public.portals AS portal
   WHERE portal.id = p_portal_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'portal_not_found';
  END IF;
  v_owner_scope := CASE WHEN v_portal.org_id IS NULL THEN 'global' ELSE 'organization' END;

  IF v_portal.org_id IS NULL THEN
    IF app_authz.is_restricted_external() THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not_authorized';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
      FROM public.memberships AS membership
     WHERE membership.org_id = v_portal.org_id
       AND membership.user_id = v_actor_id
       AND membership.role IN ('admin', 'specialist')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not_authorized';
  END IF;

  SELECT * INTO v_receipt
    FROM public.form_mapping_reset_events AS event
   WHERE event.portal_id = v_portal.id
     AND event.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_receipt.actor_id IS DISTINCT FROM v_actor_id
       OR v_receipt.owner_scope IS DISTINCT FROM v_owner_scope
       OR v_receipt.org_id IS DISTINCT FROM v_portal.org_id
       OR v_receipt.old_mapping_generation IS DISTINCT FROM p_expected_mapping_generation THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'mapping_reset_idempotency_conflict';
    END IF;
    RETURN v_receipt;
  END IF;

  IF v_portal.mapping_generation IS DISTINCT FROM p_expected_mapping_generation THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_stale';
  END IF;
  IF v_portal.mapping_generation = 2147483647 THEN
    RAISE EXCEPTION USING ERRCODE = '22003', MESSAGE = 'mapping_generation_exhausted';
  END IF;

  IF v_portal.org_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.portals AS shared_portal
     WHERE shared_portal.org_id IS NULL
       AND shared_portal.portal_key = v_portal.portal_key
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'org_mapping_has_shared_fallback';
  END IF;

  SELECT count(*)::integer INTO v_affected_field_count
    FROM public.portal_field_maps AS field_map
   WHERE field_map.portal_key = v_portal.portal_key
     AND field_map.org_id IS NOT DISTINCT FROM v_portal.org_id
     AND field_map.mapping_generation = v_portal.mapping_generation;

  -- set_config('minted.expected_mapping_generation') and set_config('minted.mapping_reset') stripped

  UPDATE public.portals AS portal
     SET mapping_generation = v_portal.mapping_generation + 1,
         is_verified = false,
         last_verified_at = NULL,
         proven_at = NULL,
         updated_at = now()
   WHERE portal.id = v_portal.id
   RETURNING * INTO v_portal;

  INSERT INTO public.form_mapping_reset_events (
    portal_id, owner_scope, org_id, portal_key,
    old_mapping_generation, new_mapping_generation, actor_id,
    affected_field_count, idempotency_key
  ) VALUES (
    v_portal.id, v_owner_scope, v_portal.org_id, v_portal.portal_key,
    p_expected_mapping_generation, v_portal.mapping_generation, v_actor_id,
    v_affected_field_count, p_idempotency_key
  ) RETURNING * INTO v_receipt;

  RETURN v_receipt;
END;
$$;

DO $$
DECLARE
  v_owner name;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(relation.relowner)
    INTO v_owner
    FROM pg_catalog.pg_class AS relation
   WHERE relation.oid = 'public.portals'::regclass;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'could not resolve public.portals table owner';
  END IF;
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION public.reset_portal_mapping(uuid, integer, uuid) OWNER TO %I',
    v_owner
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reset_portal_mapping(uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_portal_mapping(uuid, integer, uuid)
  TO authenticated;


-- 2.5 update_org_portal_field_map (decouple from dropped assert helper)
CREATE OR REPLACE FUNCTION public.update_org_portal_field_map(
  p_org_id uuid,
  p_id uuid,
  p_expected_mapping_generation integer,
  p_patch jsonb
)
RETURNS public.portal_field_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_key text;
  v_map public.portal_field_maps%ROWTYPE;
  v_portal public.portals%ROWTYPE;
  v_shared_generation integer;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.memberships membership
     WHERE membership.org_id = p_org_id
       AND membership.user_id = auth.uid()
       AND membership.role IN ('admin', 'specialist')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not_authorized';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object'
     OR p_patch - ARRAY['status','source','token','hardcoded_value','transform','notes'] <> '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_field_map_patch';
  END IF;

  SELECT portal_key INTO v_key FROM public.portal_field_maps
   WHERE id = p_id AND org_id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'field_map_not_found';
  END IF;

  SELECT * INTO v_portal
    FROM public.portals
   WHERE org_id = p_org_id AND portal_key = v_key
   FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_portal
      FROM public.portals
     WHERE org_id IS NULL AND portal_key = v_key
     FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'portal_configuration_not_found';
  END IF;

  IF p_expected_mapping_generation IS NOT NULL AND p_expected_mapping_generation IS DISTINCT FROM v_portal.mapping_generation THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_stale';
  END IF;

  SELECT * INTO v_map FROM public.portal_field_maps
   WHERE id = p_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'field_map_not_found';
  END IF;

  IF p_org_id IS NOT NULL THEN
    SELECT mapping_generation INTO v_shared_generation
      FROM public.portals
     WHERE org_id IS NULL AND portal_key = v_key;
    IF FOUND AND v_map.shared_base_generation IS DISTINCT FROM v_shared_generation THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_override_base_review_required';
    END IF;
  END IF;

  UPDATE public.portal_field_maps
     SET status = CASE WHEN p_patch ? 'status' THEN p_patch->>'status' ELSE status END,
         source = CASE WHEN p_patch ? 'source' THEN p_patch->>'source' ELSE source END,
         token = CASE WHEN p_patch ? 'token' THEN p_patch->>'token' ELSE token END,
         hardcoded_value = CASE WHEN p_patch ? 'hardcoded_value' THEN p_patch->>'hardcoded_value' ELSE hardcoded_value END,
         transform = CASE WHEN p_patch ? 'transform' THEN p_patch->>'transform' ELSE transform END,
         notes = CASE WHEN p_patch ? 'notes' THEN p_patch->>'notes' ELSE notes END
   WHERE id = p_id AND org_id = p_org_id
   RETURNING * INTO v_map;
  RETURN v_map;
END;
$$;

REVOKE ALL ON FUNCTION public.update_org_portal_field_map(uuid, uuid, integer, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_org_portal_field_map(uuid, uuid, integer, jsonb)
  TO authenticated, service_role;


-- 2.6 update_org_portal_field_maps_batch (decouple from dropped assert helper)
CREATE OR REPLACE FUNCTION public.update_org_portal_field_maps_batch(
  p_org_id uuid,
  p_portal_key text,
  p_expected_mapping_generation integer,
  p_entries jsonb
)
RETURNS SETOF public.portal_field_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_entry jsonb;
  v_id uuid;
  v_key text := lower(btrim(coalesce(p_portal_key, '')));
  v_portal public.portals%ROWTYPE;
  v_shared_generation integer;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.memberships membership
     WHERE membership.org_id = p_org_id
       AND membership.user_id = auth.uid()
       AND membership.role IN ('admin', 'specialist')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not_authorized';
  END IF;
  IF jsonb_typeof(p_entries) <> 'array' OR v_key = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_field_map_batch';
  END IF;

  SELECT * INTO v_portal
    FROM public.portals
   WHERE org_id = p_org_id AND portal_key = v_key
   FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_portal
      FROM public.portals
     WHERE org_id IS NULL AND portal_key = v_key
     FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'portal_configuration_not_found';
  END IF;

  IF p_expected_mapping_generation IS NOT NULL AND p_expected_mapping_generation IS DISTINCT FROM v_portal.mapping_generation THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_stale';
  END IF;

  IF p_org_id IS NOT NULL THEN
    SELECT mapping_generation INTO v_shared_generation
      FROM public.portals
     WHERE org_id IS NULL AND portal_key = v_key;
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_entries)
  LOOP
    v_id := nullif(v_entry->>'id', '')::uuid;
    IF v_id IS NULL OR jsonb_typeof(v_entry->'patch') <> 'object'
       OR v_entry->'patch' - ARRAY['status','source','token','hardcoded_value','transform','notes'] <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_field_map_batch_entry';
    END IF;

    IF p_org_id IS NOT NULL AND v_shared_generation IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.portal_field_maps
         WHERE id = v_id AND org_id = p_org_id AND portal_key = v_key
           AND shared_base_generation IS DISTINCT FROM v_shared_generation
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_override_base_review_required';
      END IF;
    END IF;

    UPDATE public.portal_field_maps
       SET status = CASE WHEN v_entry->'patch' ? 'status' THEN v_entry->'patch'->>'status' ELSE status END,
           source = CASE WHEN v_entry->'patch' ? 'source' THEN v_entry->'patch'->>'source' ELSE source END,
           token = CASE WHEN v_entry->'patch' ? 'token' THEN v_entry->'patch'->>'token' ELSE token END,
           hardcoded_value = CASE WHEN v_entry->'patch' ? 'hardcoded_value' THEN v_entry->'patch'->>'hardcoded_value' ELSE hardcoded_value END,
           transform = CASE WHEN v_entry->'patch' ? 'transform' THEN v_entry->'patch'->>'transform' ELSE transform END,
           notes = CASE WHEN v_entry->'patch' ? 'notes' THEN v_entry->'patch'->>'notes' ELSE notes END
     WHERE id = v_id AND org_id = p_org_id AND portal_key = v_key;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'field_map_not_found';
    END IF;
  END LOOP;
  RETURN QUERY SELECT * FROM public.portal_field_maps
    WHERE org_id = p_org_id AND portal_key = v_key
      AND id IN (SELECT (entry->>'id')::uuid FROM jsonb_array_elements(p_entries) entry);
END;
$$;

REVOKE ALL ON FUNCTION public.update_org_portal_field_maps_batch(uuid, text, integer, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_org_portal_field_maps_batch(uuid, text, integer, jsonb)
  TO authenticated, service_role;


-- 2.7 train_global_field_map (8-arg overload decouple from dropped assert helpers)
CREATE OR REPLACE FUNCTION public.train_global_field_map(
  p_id uuid, p_status text, p_source text, p_token text,
  p_field_label text, p_hardcoded_value text, p_transform text,
  p_expected_mapping_generation integer
)
RETURNS public.portal_field_maps
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_map public.portal_field_maps%ROWTYPE;
  v_portal public.portals%ROWTYPE;
BEGIN
  SELECT * INTO v_map FROM public.portal_field_maps WHERE id = p_id AND org_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'field_map_not_found'; END IF;
  IF v_map.map_type <> 'pdf' THEN
    SELECT * INTO v_portal FROM public.portals WHERE org_id IS NULL AND portal_key = v_map.portal_key FOR UPDATE;
    IF FOUND AND p_expected_mapping_generation IS NOT NULL AND p_expected_mapping_generation IS DISTINCT FROM v_portal.mapping_generation THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_stale';
    END IF;
  END IF;
  RETURN public.train_global_field_map(
    p_id, p_status, p_source, p_token, p_field_label, p_hardcoded_value, p_transform
  );
END;
$$;

REVOKE ALL ON FUNCTION public.train_global_field_map(uuid, text, text, text, text, text, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.train_global_field_map(uuid, text, text, text, text, text, text, integer)
  TO authenticated, service_role;


-- 2.8 update_org_portal_configuration (decouple from dropped assert helper)
CREATE OR REPLACE FUNCTION public.update_org_portal_configuration(
  p_org_id uuid, p_id uuid, p_expected_mapping_generation integer, p_patch jsonb
)
RETURNS public.portals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_portal public.portals%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.memberships membership
     WHERE membership.org_id = p_org_id AND membership.user_id = auth.uid()
       AND membership.role IN ('admin', 'specialist')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not_authorized';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object'
     OR p_patch - ARRAY['name','form_url','payer_id','is_verified','last_verified_at','proven_at','url_changed_at'] <> '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_portal_patch';
  END IF;
  SELECT * INTO v_portal FROM public.portals WHERE id = p_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'portal_configuration_not_found'; END IF;

  PERFORM public.assert_portal_mapping_generation_for_write(
    v_portal.portal_key, p_org_id, p_expected_mapping_generation
  );

  UPDATE public.portals
     SET name = CASE WHEN p_patch ? 'name' THEN p_patch->>'name' ELSE name END,
         form_url = CASE WHEN p_patch ? 'form_url' THEN p_patch->>'form_url' ELSE form_url END,
         payer_id = CASE WHEN p_patch ? 'payer_id' THEN nullif(p_patch->>'payer_id', '')::uuid ELSE payer_id END,
         is_verified = CASE WHEN p_patch ? 'is_verified' THEN (p_patch->>'is_verified')::boolean ELSE is_verified END,
         last_verified_at = CASE WHEN p_patch ? 'last_verified_at' THEN (p_patch->>'last_verified_at')::timestamptz ELSE last_verified_at END,
         proven_at = CASE WHEN p_patch ? 'proven_at' THEN (p_patch->>'proven_at')::timestamptz ELSE proven_at END,
         url_changed_at = CASE WHEN p_patch ? 'url_changed_at' THEN (p_patch->>'url_changed_at')::timestamptz ELSE url_changed_at END
   WHERE id = p_id AND org_id = p_org_id
   RETURNING * INTO v_portal;
  RETURN v_portal;
END;
$$;

REVOKE ALL ON FUNCTION public.update_org_portal_configuration(uuid, uuid, integer, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_org_portal_configuration(uuid, uuid, integer, jsonb)
  TO authenticated, service_role;


-- ============================================================================
-- 3. RENAME TICKET-BRANDED DATABASE OBJECTS TO CLEAN DOMAIN NAMES
-- ============================================================================

-- 3.1 Drop ticket-branded trigger on fill_sessions
DROP TRIGGER IF EXISTS trg_mint58_case_fill_context ON public.fill_sessions;

-- 3.2 Drop ticket-branded function validate_mint58_case_fill_context
DROP FUNCTION IF EXISTS public.validate_mint58_case_fill_context();

-- 3.3 Create clean domain function validate_case_fill_context
CREATE OR REPLACE FUNCTION public.validate_case_fill_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_case public.credential_cases%ROWTYPE;
  v_task public.tasks%ROWTYPE;
  v_portal public.portals%ROWTYPE;
  v_shared_portal public.portals%ROWTYPE;
  v_step jsonb;
  v_step_order numeric;
  v_step_ordinality bigint;
  v_facility_count bigint;
  v_requested_shared_generation integer;
  v_has_shared_portal boolean := false;
  v_has_approved_map boolean := false;
BEGIN
  v_requested_shared_generation := NEW.shared_mapping_generation;
  NEW.shared_mapping_generation := NULL;
  NEW.did_auto_start_case := false;

  IF NEW.contract_id IS NOT NULL THEN
    IF NEW.case_id IS NOT NULL OR NEW.case_task_id IS NOT NULL OR NEW.case_step_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid mixed-owner fill receipt';
    END IF;
    IF NEW.event_schema_version = 2
       AND NEW.fill_mode = 'web'
       AND NOT NEW.is_test
       AND NEW.contract_sop_assignment_id IS NOT NULL
       AND NEW.task_index IS NOT NULL
       AND NEW.step_index IS NOT NULL
       AND NEW.step_identity IS NOT NULL
       AND NEW.launch_receipt_id IS NOT NULL THEN
      SELECT portal_row.* INTO v_portal
        FROM public.portals AS portal_row
       WHERE portal_row.id = NEW.portal_id
         AND (portal_row.org_id = NEW.org_id OR portal_row.org_id IS NULL)
         AND pg_catalog.lower(pg_catalog.btrim(portal_row.portal_key)) =
             pg_catalog.lower(pg_catalog.btrim(NEW.portal_key))
       FOR SHARE;
      IF NOT FOUND OR v_portal.mapping_generation IS DISTINCT FROM NEW.mapping_generation THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'shared_mapping_generation_stale';
      END IF;
      IF v_portal.org_id IS NULL THEN
        IF v_requested_shared_generation IS NOT NULL OR EXISTS (
          SELECT 1 FROM public.portals AS org_portal
           WHERE org_portal.org_id = NEW.org_id
             AND pg_catalog.lower(pg_catalog.btrim(org_portal.portal_key)) =
                 pg_catalog.lower(pg_catalog.btrim(v_portal.portal_key))
        ) THEN
          RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'shared_mapping_generation_stale';
        END IF;
      ELSE
        SELECT shared_portal.* INTO v_shared_portal
          FROM public.portals AS shared_portal
         WHERE shared_portal.org_id IS NULL
           AND pg_catalog.lower(pg_catalog.btrim(shared_portal.portal_key)) =
               pg_catalog.lower(pg_catalog.btrim(v_portal.portal_key))
         FOR SHARE;
        v_has_shared_portal := FOUND;
        IF v_has_shared_portal THEN
          IF v_requested_shared_generation IS DISTINCT FROM v_shared_portal.mapping_generation THEN
            RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'shared_mapping_generation_stale';
          END IF;
          SELECT EXISTS (
            SELECT 1 FROM (
              SELECT DISTINCT ON (field_map.selector) field_map.status
                FROM public.portal_field_maps AS field_map
               WHERE pg_catalog.lower(pg_catalog.btrim(field_map.portal_key)) =
                       pg_catalog.lower(pg_catalog.btrim(v_portal.portal_key))
                 AND field_map.map_type = 'web'
                 AND ((field_map.org_id IS NULL
                       AND field_map.mapping_generation = v_shared_portal.mapping_generation)
                   OR (field_map.org_id = NEW.org_id
                       AND field_map.mapping_generation = v_portal.mapping_generation
                       AND field_map.shared_base_generation = v_shared_portal.mapping_generation))
                ORDER BY field_map.selector, (field_map.org_id = NEW.org_id) DESC, field_map.id
            ) AS effective_map
           WHERE effective_map.status = 'approved'
          ) INTO v_has_approved_map;
          IF NOT v_has_approved_map THEN
            RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'shared_mapping_generation_stale';
          END IF;
          NEW.shared_mapping_generation := v_shared_portal.mapping_generation;
        ELSIF v_requested_shared_generation IS NOT NULL THEN
          RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'shared_mapping_generation_stale';
        END IF;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.case_task_id IS NULL AND NEW.case_step_id IS NULL AND NEW.step_identity IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.event_schema_version IS DISTINCT FROM 2
     OR NEW.contract_id IS NOT NULL
     OR NEW.case_id IS NULL
     OR NEW.case_task_id IS NULL
     OR NEW.case_step_id IS NULL
     OR NEW.step_identity IS NULL
     OR NEW.portal_id IS NULL
     OR NEW.is_test
     OR NEW.fill_mode IS DISTINCT FROM 'web' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid typed case fill receipt';
  END IF;

  SELECT task_row.*
    INTO v_task
    FROM public.tasks AS task_row
   WHERE task_row.id = NEW.case_task_id
     AND task_row.org_id = NEW.org_id
     AND task_row.case_id = NEW.case_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'case fill task is outside the receipt owner';
  END IF;

  SELECT case_row.*
    INTO v_case
    FROM public.credential_cases AS case_row
   WHERE case_row.id = NEW.case_id
     AND case_row.org_id = NEW.org_id
   FOR SHARE;
  IF NOT FOUND
     OR v_case.context_version IS DISTINCT FROM NEW.context_version
     OR v_case.provider_id IS DISTINCT FROM NEW.provider_id
     OR v_case.case_type NOT IN ('enrollment', 'recredentialing')
     OR v_case.case_type IS NULL
     OR v_case.case_status NOT IN ('not_started', 'in_progress', 'submitted', 'in_review', 'action_required')
     OR v_case.case_status IS NULL
     OR v_task.provider_id IS DISTINCT FROM NEW.provider_id
     OR v_task.sop_template_id IS DISTINCT FROM NEW.sop_template_id
     OR v_task.sop_version IS DISTINCT FROM NEW.sop_version
     OR v_task.execution_type IS DISTINCT FROM 'extension_fill' THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'case fill context is stale';
  END IF;

  NEW.did_auto_start_case := v_case.case_status = 'not_started';

  IF EXISTS (
    SELECT 1
      FROM public.tasks AS prior_task
     WHERE prior_task.org_id = NEW.org_id
       AND prior_task.case_id = NEW.case_id
       AND prior_task.status <> 'completed'
       AND prior_task.sort_order < v_task.sort_order
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_array_elements(
             CASE WHEN pg_catalog.jsonb_typeof(prior_task.sop_content) = 'array'
                  THEN prior_task.sop_content ELSE '[]'::jsonb END
           ) AS prior_step(step)
          WHERE prior_step.step->>'stepType' = 'pdf'
            AND nullif(pg_catalog.btrim(prior_step.step->'payerForm'->>'familyId'), '') IS NOT NULL
            AND nullif(pg_catalog.btrim(prior_step.step->'payerForm'->>'removedAt'), '') IS NOT NULL
       )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'case fill task is no longer current';
  END IF;

  SELECT count(*) INTO v_facility_count
    FROM public.case_facilities AS cf
   WHERE cf.case_id = NEW.case_id
     AND cf.org_id = NEW.org_id;
  IF (NEW.facility_id IS NULL AND v_facility_count <> 0)
     OR (NEW.facility_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.case_facilities AS cf
        WHERE cf.case_id = NEW.case_id
          AND cf.org_id = NEW.org_id
          AND cf.facility_id = NEW.facility_id
     )) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'case fill facility context is stale';
  END IF;

  SELECT item.step,
         CASE WHEN pg_catalog.jsonb_typeof(item.step->'order') = 'number'
              THEN (item.step->>'order')::numeric
              ELSE item.ordinality::numeric END,
         item.ordinality
    INTO v_step, v_step_order, v_step_ordinality
    FROM pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(v_task.sop_content) = 'array'
           THEN v_task.sop_content ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS item(step, ordinality)
   WHERE item.step->>'id' = NEW.case_step_id::text
   ORDER BY item.ordinality
   LIMIT 1;
  IF NOT FOUND
     OR v_step->>'stepType' IS DISTINCT FROM 'online_form'
     OR v_step->>'isCompleted' = 'true'
     OR pg_catalog.lower(pg_catalog.btrim(v_step->>'portalKey'))
          IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(NEW.portal_key))
     OR NEW.step_identity IS DISTINCT FROM (
       NEW.case_id::text || ':' || NEW.case_task_id::text || ':' ||
       NEW.sop_template_id::text || ':' || NEW.sop_version::text || ':' ||
       NEW.case_step_id::text
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.jsonb_array_elements(
           CASE WHEN pg_catalog.jsonb_typeof(v_task.sop_content) = 'array'
                THEN v_task.sop_content ELSE '[]'::jsonb END
         ) WITH ORDINALITY AS prior(step, ordinality)
        WHERE (
          (
            CASE WHEN pg_catalog.jsonb_typeof(prior.step->'order') = 'number'
                 THEN (prior.step->>'order')::numeric
                 ELSE prior.ordinality::numeric END
          ) < v_step_order
          OR (
            (
              CASE WHEN pg_catalog.jsonb_typeof(prior.step->'order') = 'number'
                   THEN (prior.step->>'order')::numeric
                   ELSE prior.ordinality::numeric END
            ) = v_step_order
            AND prior.ordinality < v_step_ordinality
          )
        )
        AND prior.step->>'isCompleted' IS DISTINCT FROM 'true'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'case fill step is stale';
  END IF;

  SELECT portal_row.*
    INTO v_portal
    FROM public.portals AS portal_row
   WHERE portal_row.id = NEW.portal_id
     AND (portal_row.org_id = NEW.org_id OR portal_row.org_id IS NULL)
   FOR SHARE;
  IF NOT FOUND
     OR pg_catalog.lower(pg_catalog.btrim(v_portal.portal_key))
          IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(NEW.portal_key))
     OR v_portal.case_type IS DISTINCT FROM v_case.case_type
     OR v_portal.payer_id IS DISTINCT FROM v_case.payer_id
     OR v_portal.mapping_generation IS DISTINCT FROM NEW.mapping_generation
     OR v_portal.form_url IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'case fill portal configuration is stale';
  END IF;

  IF v_portal.org_id IS NULL AND EXISTS (
    SELECT 1 FROM public.portals AS org_portal
     WHERE org_portal.org_id = NEW.org_id
       AND pg_catalog.lower(pg_catalog.btrim(org_portal.portal_key)) =
           pg_catalog.lower(pg_catalog.btrim(v_portal.portal_key))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'case fill portal configuration is stale';
  END IF;

  IF v_portal.org_id IS NULL THEN
    IF v_requested_shared_generation IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'shared_mapping_generation_stale';
    END IF;
  ELSE
    SELECT shared_portal.* INTO v_shared_portal
      FROM public.portals AS shared_portal
     WHERE shared_portal.org_id IS NULL
       AND pg_catalog.lower(pg_catalog.btrim(shared_portal.portal_key)) =
           pg_catalog.lower(pg_catalog.btrim(v_portal.portal_key))
     FOR SHARE;
    v_has_shared_portal := FOUND;
    IF v_has_shared_portal THEN
      IF v_requested_shared_generation IS DISTINCT FROM v_shared_portal.mapping_generation THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'shared_mapping_generation_stale';
      END IF;
      SELECT EXISTS (
        SELECT 1 FROM (
          SELECT DISTINCT ON (field_map.selector) field_map.status
            FROM public.portal_field_maps AS field_map
           WHERE pg_catalog.lower(pg_catalog.btrim(field_map.portal_key)) =
                   pg_catalog.lower(pg_catalog.btrim(v_portal.portal_key))
             AND field_map.map_type = 'web'
             AND ((field_map.org_id IS NULL
                   AND field_map.mapping_generation = v_shared_portal.mapping_generation)
               OR (field_map.org_id = NEW.org_id
                   AND field_map.mapping_generation = v_portal.mapping_generation
                   AND field_map.shared_base_generation = v_shared_portal.mapping_generation))
            ORDER BY field_map.selector, (field_map.org_id = NEW.org_id) DESC, field_map.id
        ) AS effective_map
       WHERE effective_map.status = 'approved'
      ) INTO v_has_approved_map;
      IF NOT v_has_approved_map THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'shared_mapping_generation_stale';
      END IF;
      NEW.shared_mapping_generation := v_shared_portal.mapping_generation;
    ELSIF v_requested_shared_generation IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'shared_mapping_generation_stale';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_case_fill_context()
  FROM PUBLIC, anon, authenticated, service_role;

-- 3.4 Create clean domain trigger trg_validate_case_fill_context
DROP TRIGGER IF EXISTS trg_validate_case_fill_context ON public.fill_sessions;
CREATE TRIGGER trg_validate_case_fill_context
  BEFORE INSERT ON public.fill_sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_case_fill_context();


-- 3.5 Drop ticket-branded mint60_has_current_approved_web_map
DROP FUNCTION IF EXISTS public.mint60_has_current_approved_web_map(uuid, text, integer, integer);

-- 3.6 Create clean domain function has_current_approved_web_map
CREATE OR REPLACE FUNCTION public.has_current_approved_web_map(
  p_org_id uuid,
  p_portal_key text,
  p_org_mapping_generation integer,
  p_shared_mapping_generation integer
)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM (
        SELECT DISTINCT ON (field_map.selector) field_map.status
          FROM public.portal_field_maps AS field_map
         WHERE pg_catalog.lower(pg_catalog.btrim(field_map.portal_key)) =
                 pg_catalog.lower(pg_catalog.btrim(p_portal_key))
           AND field_map.map_type = 'web'
           AND (
             (
               p_shared_mapping_generation IS NOT NULL
               AND field_map.org_id IS NULL
               AND field_map.mapping_generation = p_shared_mapping_generation
             )
             OR (
               field_map.org_id = p_org_id
               AND field_map.mapping_generation = p_org_mapping_generation
               AND field_map.shared_base_generation IS NOT DISTINCT FROM p_shared_mapping_generation
             )
           )
         ORDER BY field_map.selector,
                  (field_map.org_id = p_org_id) DESC,
                  field_map.id
      ) AS effective_map
     WHERE effective_map.status = 'approved'
  );
$function$;

REVOKE ALL ON FUNCTION public.has_current_approved_web_map(uuid, text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_current_approved_web_map(uuid, text, integer, integer)
  TO service_role;


-- 3.7 Update record_typed_enrollment_submission to call has_current_approved_web_map
CREATE OR REPLACE FUNCTION public.record_typed_enrollment_submission(
  p_org_id uuid,
  p_actor_id uuid,
  p_case_id uuid,
  p_touch_id uuid,
  p_fill_session_id uuid,
  p_work_context jsonb,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_existing public.touches%ROWTYPE;
  v_touch public.touches%ROWTYPE;
  v_session public.fill_sessions%ROWTYPE;
  v_case public.credential_cases%ROWTYPE;
  v_task public.tasks%ROWTYPE;
  v_portal public.portals%ROWTYPE;
  v_shared_portal public.portals%ROWTYPE;
  v_has_shared_portal boolean := false;
  v_step jsonb;
  v_step_order numeric;
  v_step_ordinality bigint;
  v_facility_count bigint;
  v_payer_label text;
  v_portal_key text;
  v_payload_fingerprint text;
  v_completion jsonb;
  v_now date := CURRENT_DATE;
  v_user_name text;
  v_note text;
  v_payer_reference text;
  v_wip_note text;
  v_pdf_filename text;
BEGIN
  IF p_org_id IS NULL OR p_actor_id IS NULL OR p_case_id IS NULL
     OR p_touch_id IS NULL OR p_fill_session_id IS NULL
     OR p_work_context IS NULL OR pg_catalog.jsonb_typeof(p_work_context) IS DISTINCT FROM 'object'
     OR p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 422, 'message', 'Typed submission is malformed');
  END IF;
  IF current_user = 'authenticated' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
      RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 403, 'message', 'Actor does not match the authenticated user');
    END IF;
  ELSIF current_user <> 'service_role' THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 403, 'message', 'Caller role cannot record typed submissions');
  ELSIF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_actor_id THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 403, 'message', 'Actor does not match the authenticated request');
  END IF;

  SELECT membership.role INTO v_role
    FROM public.memberships AS membership
   WHERE membership.org_id = p_org_id
     AND membership.user_id = p_actor_id
   FOR SHARE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 404, 'message', 'Case not found');
  END IF;
  IF v_role NOT IN ('specialist', 'admin') THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 403, 'message', 'Your role cannot submit portal work');
  END IF;

  IF p_work_context - ARRAY[
    'launchReceiptId', 'orgId', 'ownerKind', 'ownerId', 'contextVersion',
    'sopTemplateId', 'sopVersion', 'portalId', 'portalKey', 'mappingGeneration',
    'effectiveMappingFingerprint', 'providerId', 'facilityId', 'stepIdentity', 'taskId', 'stepId'
  ] <> '{}'::jsonb
     OR NOT (p_work_context ?& ARRAY[
       'launchReceiptId', 'orgId', 'ownerKind', 'ownerId', 'contextVersion',
       'sopTemplateId', 'sopVersion', 'portalId', 'portalKey', 'mappingGeneration',
       'effectiveMappingFingerprint', 'providerId', 'facilityId', 'stepIdentity', 'taskId', 'stepId'
     ])
     OR p_work_context->>'ownerKind' IS DISTINCT FROM 'case'
     OR p_work_context->>'orgId' IS DISTINCT FROM p_org_id::text
     OR p_work_context->>'ownerId' IS DISTINCT FROM p_case_id::text
     OR p_payload - ARRAY['note', 'payerReferenceId', 'wipNote', 'pdfFilename'] <> '{}'::jsonb
     OR NOT (p_payload ?& ARRAY['note', 'payerReferenceId', 'wipNote', 'pdfFilename']) THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 422, 'message', 'Typed submission tuple or payload is malformed');
  END IF;

  -- Validate the complete scalar tuple before any uuid/integer casts below.
  -- The extension parser is strict too, but this invoker RPC is an independent
  -- database boundary and malformed input must remain a typed 422, not a 22P02.
  IF p_work_context->>'ownerKind' IS DISTINCT FROM 'case'
     OR jsonb_typeof(p_work_context->'launchReceiptId') IS DISTINCT FROM 'string'
     OR (p_work_context->>'launchReceiptId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR jsonb_typeof(p_work_context->'orgId') IS DISTINCT FROM 'string'
     OR (p_work_context->>'orgId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR jsonb_typeof(p_work_context->'ownerId') IS DISTINCT FROM 'string'
     OR (p_work_context->>'ownerId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR jsonb_typeof(p_work_context->'sopTemplateId') IS DISTINCT FROM 'string'
     OR (p_work_context->>'sopTemplateId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR jsonb_typeof(p_work_context->'portalId') IS DISTINCT FROM 'string'
     OR (p_work_context->>'portalId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR jsonb_typeof(p_work_context->'providerId') IS DISTINCT FROM 'string'
     OR (p_work_context->>'providerId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR jsonb_typeof(p_work_context->'taskId') IS DISTINCT FROM 'string'
     OR (p_work_context->>'taskId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR jsonb_typeof(p_work_context->'stepId') IS DISTINCT FROM 'string'
     OR (p_work_context->>'stepId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR jsonb_typeof(p_work_context->'facilityId') NOT IN ('null', 'string')
     OR (jsonb_typeof(p_work_context->'facilityId') = 'string'
         AND (p_work_context->>'facilityId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     OR jsonb_typeof(p_work_context->'contextVersion') IS DISTINCT FROM 'number'
     OR (p_work_context->>'contextVersion') !~ '^[1-9][0-9]{0,9}$'
     OR (p_work_context->>'contextVersion')::numeric > 2147483647
     OR jsonb_typeof(p_work_context->'sopVersion') IS DISTINCT FROM 'number'
     OR (p_work_context->>'sopVersion') !~ '^[1-9][0-9]{0,9}$'
     OR (p_work_context->>'sopVersion')::numeric > 2147483647
     OR jsonb_typeof(p_work_context->'mappingGeneration') IS DISTINCT FROM 'number'
     OR (p_work_context->>'mappingGeneration') !~ '^[1-9][0-9]{0,9}$'
     OR (p_work_context->>'mappingGeneration')::numeric > 2147483647
     OR jsonb_typeof(p_work_context->'portalKey') IS DISTINCT FROM 'string'
     OR (p_work_context->>'portalKey') !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
     OR jsonb_typeof(p_work_context->'effectiveMappingFingerprint') IS DISTINCT FROM 'string'
     OR (p_work_context->>'effectiveMappingFingerprint') !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(p_work_context->'stepIdentity') IS DISTINCT FROM 'string'
     OR pg_catalog.char_length(p_work_context->>'stepIdentity') NOT BETWEEN 1 AND 512
     OR jsonb_typeof(p_payload->'note') NOT IN ('null', 'string')
     OR jsonb_typeof(p_payload->'payerReferenceId') NOT IN ('null', 'string')
     OR jsonb_typeof(p_payload->'wipNote') NOT IN ('null', 'string')
     OR jsonb_typeof(p_payload->'pdfFilename') NOT IN ('null', 'string') THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 422, 'message', 'Typed submission tuple or payload is invalid');
  END IF;

  v_portal_key := p_work_context->>'portalKey';
  v_note := NULLIF(pg_catalog.btrim(p_payload->>'note'), '');
  v_payer_reference := NULLIF(pg_catalog.btrim(p_payload->>'payerReferenceId'), '');
  v_wip_note := NULLIF(pg_catalog.btrim(p_payload->>'wipNote'), '');
  v_pdf_filename := NULLIF(pg_catalog.btrim(p_payload->>'pdfFilename'), '');
  IF pg_catalog.jsonb_typeof(p_work_context->'facilityId') NOT IN ('null', 'string')
     OR pg_catalog.jsonb_typeof(p_payload->'note') NOT IN ('null', 'string')
     OR pg_catalog.jsonb_typeof(p_payload->'payerReferenceId') NOT IN ('null', 'string')
     OR pg_catalog.jsonb_typeof(p_payload->'wipNote') NOT IN ('null', 'string')
     OR pg_catalog.jsonb_typeof(p_payload->'pdfFilename') NOT IN ('null', 'string')
     OR v_portal_key IS NULL OR pg_catalog.btrim(v_portal_key) = ''
     OR pg_catalog.char_length(v_note) > 2000
     OR pg_catalog.char_length(v_payer_reference) > 250
     OR pg_catalog.char_length(v_wip_note) > 2000
     OR pg_catalog.char_length(v_pdf_filename) > 250 THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 422, 'message', 'Typed submission payload is invalid');
  END IF;

  v_payload_fingerprint := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object('workContext', p_work_context, 'payload', p_payload)::text,
      'UTF8'
    )),
    'hex'
  );

  -- Serialize same-key requests before lookup. UUID hash collisions only add
  -- harmless waiting; the primary key remains the authoritative uniqueness.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_touch_id::text, 0)
  );
  SELECT touch.* INTO v_existing
    FROM public.touches AS touch
   WHERE touch.id = p_touch_id;
  IF FOUND THEN
    IF v_existing.org_id = p_org_id
       AND v_existing.case_id = p_case_id
       AND v_existing.task_id = (p_work_context->>'taskId')::uuid
       AND v_existing.fill_session_id = p_fill_session_id
       AND v_existing.submission_request_fingerprint = v_payload_fingerprint
       AND EXISTS (
         SELECT 1 FROM public.fill_sessions AS session
          WHERE session.id = v_existing.fill_session_id
            AND session.org_id = p_org_id
            AND session.case_id = p_case_id
            AND session.case_task_id = (p_work_context->>'taskId')::uuid
            AND session.case_step_id = (p_work_context->>'stepId')::uuid
            AND session.step_identity = p_work_context->>'stepIdentity'
            AND session.launch_receipt_id = (p_work_context->>'launchReceiptId')::uuid
            AND session.context_version = (p_work_context->>'contextVersion')::integer
            AND session.sop_template_id = (p_work_context->>'sopTemplateId')::uuid
            AND session.sop_version = (p_work_context->>'sopVersion')::integer
            AND session.portal_id = (p_work_context->>'portalId')::uuid
            AND session.portal_key = v_portal_key
            AND session.mapping_generation = (p_work_context->>'mappingGeneration')::integer
            AND session.effective_mapping_fingerprint = p_work_context->>'effectiveMappingFingerprint'
            AND session.provider_id = (p_work_context->>'providerId')::uuid
            AND session.facility_id IS NOT DISTINCT FROM NULLIF(p_work_context->>'facilityId', '')::uuid
       ) THEN
      RETURN pg_catalog.jsonb_build_object('kind', 'duplicate', 'touch', pg_catalog.to_jsonb(v_existing));
    END IF;
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 409, 'message', 'Idempotency id already used');
  END IF;

  -- New submissions must be current. Lock order is task → case → portal, the
  -- same order used by complete_sop_task_step and the fill-receipt guard.
  SELECT task_row.* INTO v_task
    FROM public.tasks AS task_row
   WHERE task_row.id = (p_work_context->>'taskId')::uuid
      AND task_row.org_id = p_org_id
      AND task_row.case_id = p_case_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 404, 'message', 'Case work task not found');
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.tasks AS prior_task
     WHERE prior_task.org_id = p_org_id
       AND prior_task.case_id = p_case_id
       AND prior_task.status <> 'completed'
       AND prior_task.sort_order < v_task.sort_order
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_array_elements(
             CASE WHEN pg_catalog.jsonb_typeof(prior_task.sop_content) = 'array'
                  THEN prior_task.sop_content ELSE '[]'::jsonb END
           ) AS prior_step(step)
          WHERE prior_step.step->>'stepType' = 'pdf'
            AND nullif(pg_catalog.btrim(prior_step.step->'payerForm'->>'familyId'), '') IS NOT NULL
            AND nullif(pg_catalog.btrim(prior_step.step->'payerForm'->>'removedAt'), '') IS NOT NULL
       )
  ) THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 409, 'message', 'Enrollment Work task is no longer current');
  END IF;

  SELECT case_row.* INTO v_case
    FROM public.credential_cases AS case_row
   WHERE case_row.id = p_case_id
     AND case_row.org_id = p_org_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 404, 'message', 'Case not found');
  END IF;

  IF v_case.case_type IS DISTINCT FROM 'enrollment'
     OR NOT (
       v_case.context_version::bigint = (p_work_context->>'contextVersion')::bigint
       OR (
         v_case.context_version::bigint = (p_work_context->>'contextVersion')::bigint + 1
         AND v_case.case_status = 'in_progress'
         AND EXISTS (
           SELECT 1 FROM public.fill_sessions AS started_fill
            WHERE started_fill.id = p_fill_session_id
              AND started_fill.org_id = p_org_id
              AND started_fill.case_id = p_case_id
              AND started_fill.case_task_id = (p_work_context->>'taskId')::uuid
              AND started_fill.case_step_id = (p_work_context->>'stepId')::uuid
              AND started_fill.context_version = (p_work_context->>'contextVersion')::integer
              AND started_fill.did_auto_start_case = true
         )
       )
     )
     OR v_case.provider_id IS DISTINCT FROM (p_work_context->>'providerId')::uuid
     OR v_case.case_status NOT IN ('not_started', 'in_progress', 'submitted', 'in_review', 'action_required')
     OR v_case.case_status IS NULL
     OR v_task.sop_template_id IS DISTINCT FROM (p_work_context->>'sopTemplateId')::uuid
     OR v_task.sop_version IS DISTINCT FROM (p_work_context->>'sopVersion')::integer
     OR v_task.execution_type IS DISTINCT FROM 'extension_fill'
     OR v_task.provider_id IS DISTINCT FROM v_case.provider_id THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 409, 'message', 'Enrollment Work context is stale or mismatched');
  END IF;

  SELECT count(*) INTO v_facility_count
    FROM public.case_facilities AS cf
   WHERE cf.case_id = p_case_id AND cf.org_id = p_org_id;
  IF (p_work_context->'facilityId' = 'null'::jsonb AND v_facility_count <> 0)
     OR (p_work_context->'facilityId' <> 'null'::jsonb AND NOT EXISTS (
       SELECT 1 FROM public.case_facilities AS cf
        WHERE cf.case_id = p_case_id
          AND cf.org_id = p_org_id
          AND cf.facility_id = (p_work_context->>'facilityId')::uuid
     )) THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 409, 'message', 'Enrollment facility context is stale');
  END IF;

  SELECT item.step,
         CASE WHEN pg_catalog.jsonb_typeof(item.step->'order') = 'number'
              THEN (item.step->>'order')::numeric
              ELSE item.ordinality::numeric END,
         item.ordinality
    INTO v_step, v_step_order, v_step_ordinality
    FROM pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(v_task.sop_content) = 'array'
           THEN v_task.sop_content ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS item(step, ordinality)
   WHERE item.step->>'id' = p_work_context->>'stepId'
   ORDER BY item.ordinality LIMIT 1;
  IF NOT FOUND OR v_step->>'stepType' IS DISTINCT FROM 'online_form'
     OR v_step->>'isCompleted' = 'true'
     OR pg_catalog.lower(pg_catalog.btrim(v_step->>'portalKey')) IS DISTINCT FROM v_portal_key
     OR p_work_context->>'stepIdentity' IS DISTINCT FROM (
       p_case_id::text || ':' || v_task.id::text || ':' ||
       v_task.sop_template_id::text || ':' || v_task.sop_version::text || ':' ||
       (p_work_context->>'stepId')
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.jsonb_array_elements(
           CASE WHEN pg_catalog.jsonb_typeof(v_task.sop_content) = 'array'
                THEN v_task.sop_content ELSE '[]'::jsonb END
         ) WITH ORDINALITY AS prior(step, ordinality)
        WHERE (
          (
            CASE WHEN pg_catalog.jsonb_typeof(prior.step->'order') = 'number'
                 THEN (prior.step->>'order')::numeric
                 ELSE prior.ordinality::numeric END
          ) < v_step_order
          OR (
            (
              CASE WHEN pg_catalog.jsonb_typeof(prior.step->'order') = 'number'
                   THEN (prior.step->>'order')::numeric
                   ELSE prior.ordinality::numeric END
            ) = v_step_order
            AND prior.ordinality < v_step_ordinality
          )
        )
        AND prior.step->>'isCompleted' IS DISTINCT FROM 'true'
     ) THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 409, 'message', 'Enrollment SOP step is stale or already complete');
  END IF;

  SELECT portal_row.* INTO v_portal
    FROM public.portals AS portal_row
   WHERE portal_row.id = (p_work_context->>'portalId')::uuid
     AND (portal_row.org_id = p_org_id OR portal_row.org_id IS NULL)
   FOR SHARE;
  IF NOT FOUND
     OR pg_catalog.lower(pg_catalog.btrim(v_portal.portal_key)) IS DISTINCT FROM v_portal_key
     OR v_portal.case_type IS DISTINCT FROM 'enrollment'
     OR v_portal.payer_id IS DISTINCT FROM v_case.payer_id
     OR v_portal.mapping_generation IS DISTINCT FROM (p_work_context->>'mappingGeneration')::integer
     OR v_portal.form_url IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 409, 'message', 'Enrollment portal configuration is stale');
  END IF;
  IF v_portal.org_id IS NULL AND EXISTS (
    SELECT 1 FROM public.portals AS org_portal
     WHERE org_portal.org_id = p_org_id
       AND pg_catalog.lower(pg_catalog.btrim(org_portal.portal_key)) = v_portal_key
  ) THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 409, 'message', 'Enrollment portal configuration is stale');
  END IF;

  -- The selected org config is already locked above. Lock its exact-key shared base
  -- before the receipt and MINT-19 completion, matching the M58 fill guard order.
  IF v_portal.org_id IS NOT NULL THEN
    SELECT shared_portal.* INTO v_shared_portal
      FROM public.portals AS shared_portal
     WHERE shared_portal.org_id IS NULL
       AND pg_catalog.lower(pg_catalog.btrim(shared_portal.portal_key)) = v_portal_key
     FOR SHARE;
    v_has_shared_portal := FOUND;
  END IF;

  SELECT session.* INTO v_session
    FROM public.fill_sessions AS session
   WHERE session.id = p_fill_session_id
     AND session.org_id = p_org_id
     AND session.case_id = p_case_id
     AND session.case_task_id = v_task.id
     AND session.case_step_id = (p_work_context->>'stepId')::uuid
     AND session.step_identity = p_work_context->>'stepIdentity'
     AND session.launch_receipt_id = (p_work_context->>'launchReceiptId')::uuid
     AND session.context_version = (p_work_context->>'contextVersion')::integer
     AND session.sop_template_id = (p_work_context->>'sopTemplateId')::uuid
     AND session.sop_version = (p_work_context->>'sopVersion')::integer
     AND session.portal_id = v_portal.id
     AND session.portal_key = v_portal_key
     AND session.mapping_generation = v_portal.mapping_generation
     AND session.mapping_generation = (p_work_context->>'mappingGeneration')::integer
     AND session.effective_mapping_fingerprint = p_work_context->>'effectiveMappingFingerprint'
     AND session.provider_id = v_case.provider_id
     AND session.facility_id IS NOT DISTINCT FROM NULLIF(p_work_context->>'facilityId', '')::uuid
     AND session.fill_mode = 'web'
     AND session.is_test = false
     AND session.event_schema_version = 2
   FOR SHARE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 409, 'message', 'The fill receipt does not match this Enrollment step');
  END IF;

  -- MINT-60: the immutable receipt pins the shared generation from the same
  -- M52 resolver snapshot used before insert. A reset that won the shared-row
  -- lock makes a new submission stale before MINT-19 can complete the step.
  IF v_portal.org_id IS NOT NULL THEN
    IF v_has_shared_portal THEN
      IF v_session.shared_mapping_generation IS DISTINCT FROM v_shared_portal.mapping_generation
         OR NOT public.has_current_approved_web_map(
           p_org_id,
           v_portal.portal_key,
           v_portal.mapping_generation,
           v_shared_portal.mapping_generation
         ) THEN
        RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 409, 'message', 'Enrollment shared mapping context is stale');
      END IF;
    -- Org-only configurations remain protected by the selected org
    -- generation lock/check; the shared pin applies only when a base exists.
    ELSIF v_session.shared_mapping_generation IS NOT NULL THEN
      RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 409, 'message', 'Enrollment shared mapping context is stale');
    END IF;
  ELSIF v_session.shared_mapping_generation IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'rejected', 'status', 409, 'message', 'Enrollment shared mapping context is stale');
  END IF;

  -- MINT-19 reports blocked/invalid steps as JSON instead of raising. Inspect
  -- that result before any submission touch or case-side effect is written.
  v_completion := public.complete_sop_task_step(
    p_org_id, v_task.id, (p_work_context->>'stepId'), p_actor_id, 'extension'
  );
  IF v_completion->>'kind' = 'rejected' THEN
    RETURN pg_catalog.jsonb_build_object(
      'kind', 'rejected',
      'status', COALESCE((v_completion->>'status')::integer, 409),
      'message', COALESCE(v_completion->>'message', 'SOP step completion was rejected')
    );
  END IF;
  IF v_completion->>'kind' IS DISTINCT FROM 'ok'
     OR v_completion->'task' IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid MINT-19 step completion result';
  END IF;

  SELECT payer.name INTO v_payer_label
    FROM public.payers AS payer WHERE payer.id = v_case.payer_id;
  v_payer_label := COALESCE(v_payer_label, initcap(pg_catalog.replace(v_portal_key, '_', ' ')));

  IF v_payer_reference IS NOT NULL THEN
    UPDATE public.credential_cases AS case_row
       SET payer_reference_id = v_payer_reference
     WHERE case_row.id = p_case_id AND case_row.org_id = p_org_id;
    SELECT COALESCE(NULLIF(pg_catalog.btrim(profile.full_name), ''), profile.email)
      INTO v_user_name FROM public.profiles AS profile WHERE profile.id = p_actor_id;
    INSERT INTO public.audit_log (
      org_id, user_id, user_name, action_type, entity_type, entity_id,
      after, description
    ) VALUES (
      p_org_id, p_actor_id, v_user_name, 'UPDATE', 'case', p_case_id,
      pg_catalog.jsonb_build_object('payerReferenceSet', true),
      'Payer reference set via typed Enrollment submission'
    );
  END IF;

  INSERT INTO public.touches (
    id, org_id, case_id, task_id, fill_session_id, submission_request_fingerprint,
    entry_type, touch_date, touch_type, outcome, coordinator_id, source, notes
  ) VALUES (
    p_touch_id, p_org_id, p_case_id, v_task.id, p_fill_session_id,
    v_payload_fingerprint, 'touchpoint', v_now, 'portal', 'submitted',
    p_actor_id, 'extension',
    'Application submitted via ' || pg_catalog.initcap(pg_catalog.replace(v_portal_key, '_', ' '))
      || CASE WHEN v_note IS NULL THEN '' ELSE ' — ' || v_note END
  ) RETURNING * INTO v_touch;

  INSERT INTO public.touches (
    org_id, case_id, entry_type, touch_date, notes, coordinator_id, source
  ) VALUES (
    p_org_id, p_case_id, 'system_event', v_now,
    'Form submitted to ' || v_payer_label, p_actor_id, 'extension'
  );
  IF v_wip_note IS NOT NULL THEN
    INSERT INTO public.touches (
      org_id, case_id, task_id, entry_type, touch_date, notes, coordinator_id, source
    ) VALUES (
      p_org_id, p_case_id, v_task.id, 'note', v_now, v_wip_note, p_actor_id, 'extension'
    );
  END IF;
  IF v_pdf_filename IS NOT NULL THEN
    INSERT INTO public.touches (
      org_id, case_id, entry_type, touch_date, notes, coordinator_id, source
    ) VALUES (
      p_org_id, p_case_id, 'system_event', v_now,
      'PDF attached: ' || v_pdf_filename, p_actor_id, 'extension'
    );
  END IF;

  SELECT COALESCE(NULLIF(pg_catalog.btrim(profile.full_name), ''), profile.email)
    INTO v_user_name FROM public.profiles AS profile WHERE profile.id = p_actor_id;
  INSERT INTO public.audit_log (
    org_id, user_id, user_name, action_type, entity_type, entity_id,
    after, description
  ) VALUES (
    p_org_id, p_actor_id, v_user_name, 'TOUCH_LOGGED', 'touch', p_touch_id,
    pg_catalog.jsonb_build_object(
      'caseId', p_case_id,
      'taskId', v_task.id,
      'stepId', (p_work_context->>'stepId')::uuid,
      'fillSessionId', p_fill_session_id,
      'portalKey', v_portal_key,
      'payerReferenceSet', v_payer_reference IS NOT NULL,
      'wipNoteAdded', v_wip_note IS NOT NULL,
      'pdfAttached', v_pdf_filename IS NOT NULL,
      'source', 'extension'
    ),
    'Enrollment Work step submitted via extension'
  );

  RETURN pg_catalog.jsonb_build_object('kind', 'created', 'touch', pg_catalog.to_jsonb(v_touch));
END;
$function$;

REVOKE ALL ON FUNCTION public.record_typed_enrollment_submission(
  uuid, uuid, uuid, uuid, uuid, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_typed_enrollment_submission(
  uuid, uuid, uuid, uuid, uuid, jsonb, jsonb
) TO service_role;


-- ============================================================================
-- 4. SIMPLIFY fill_sessions_contract_context_check CONSTRAINT
-- ============================================================================

ALTER TABLE public.fill_sessions
  DROP CONSTRAINT IF EXISTS fill_sessions_contract_context_check,
  ADD CONSTRAINT fill_sessions_contract_context_check CHECK (
    -- Branch 1: Unclassified legacy
    (
      case_id IS NULL
      AND contract_id IS NULL
      AND contract_sop_assignment_id IS NULL
      AND sop_template_id IS NULL
      AND sop_version IS NULL
      AND task_index IS NULL
      AND step_index IS NULL
      AND case_task_id IS NULL
      AND case_step_id IS NULL
      AND step_identity IS NULL
      AND did_auto_start_case = false
      AND facility_id IS NULL
      AND portal_id IS NULL
      AND context_version IS NULL
      AND launch_receipt_id IS NULL
      AND mapping_generation IS NULL
      AND effective_mapping_fingerprint IS NULL
    )
    -- Branch 2: Legacy case fill
    OR (
      case_id IS NOT NULL
      AND contract_id IS NULL
      AND contract_sop_assignment_id IS NULL
      AND case_task_id IS NULL
      AND case_step_id IS NULL
      AND step_identity IS NULL
      AND did_auto_start_case = false
      AND (
        (
          sop_template_id IS NULL
          AND sop_version IS NULL
          AND task_index IS NULL
          AND step_index IS NULL
          AND facility_id IS NULL
          AND portal_id IS NULL
          AND context_version IS NULL
          AND launch_receipt_id IS NULL
          AND mapping_generation IS NULL
          AND effective_mapping_fingerprint IS NULL
        )
        OR (
          sop_template_id IS NOT NULL
          AND sop_version IS NOT NULL
          AND sop_version > 0
          AND task_index IS NOT NULL
          AND task_index >= 0
          AND step_index IS NOT NULL
          AND step_index >= 0
          AND context_version IS NOT NULL
          AND context_version > 0
          AND portal_id IS NULL
          AND launch_receipt_id IS NOT NULL
          AND mapping_generation IS NOT NULL
          AND mapping_generation > 0
          AND effective_mapping_fingerprint IS NOT NULL
          AND nullif(btrim(effective_mapping_fingerprint), '') IS NOT NULL
          AND provider_id IS NOT NULL
          AND fill_mode = 'web'
          AND is_test = false
          AND event_schema_version = 2
        )
      )
    )
    -- Branch 3: Typed case fill (Simplified: regex replaced by nullif/btrim check)
    OR (
      case_id IS NOT NULL
      AND contract_id IS NULL
      AND contract_sop_assignment_id IS NULL
      AND sop_template_id IS NOT NULL
      AND sop_version IS NOT NULL
      AND sop_version > 0
      AND task_index IS NULL
      AND step_index IS NULL
      AND case_task_id IS NOT NULL
      AND case_step_id IS NOT NULL
      AND step_identity IS NOT NULL
      AND length(btrim(step_identity)) BETWEEN 1 AND 512
      AND portal_id IS NOT NULL
      AND context_version IS NOT NULL
      AND context_version > 0
      AND launch_receipt_id IS NOT NULL
      AND mapping_generation IS NOT NULL
      AND mapping_generation > 0
      AND effective_mapping_fingerprint IS NOT NULL
      AND nullif(btrim(effective_mapping_fingerprint), '') IS NOT NULL
      AND provider_id IS NOT NULL
      AND fill_mode = 'web'
      AND is_test = false
      AND event_schema_version = 2
    )
    -- Branch 4: Contract fill
    OR (
      contract_id IS NOT NULL
      AND case_id IS NULL
      AND contract_sop_assignment_id IS NOT NULL
      AND sop_template_id IS NOT NULL
      AND sop_version IS NOT NULL
      AND sop_version > 0
      AND task_index IS NOT NULL
      AND task_index >= 0
      AND step_index IS NOT NULL
      AND step_index >= 0
      AND case_task_id IS NULL
      AND case_step_id IS NULL
      AND did_auto_start_case = false
      AND (step_identity IS NULL OR length(btrim(step_identity)) BETWEEN 1 AND 512)
      AND context_version IS NOT NULL
      AND context_version > 0
      AND portal_id IS NOT NULL
      AND launch_receipt_id IS NOT NULL
      AND mapping_generation IS NOT NULL
      AND mapping_generation > 0
      AND effective_mapping_fingerprint IS NOT NULL
      AND nullif(btrim(effective_mapping_fingerprint), '') IS NOT NULL
      AND provider_id IS NOT NULL
      AND fill_mode = 'web'
      AND is_test = false
      AND event_schema_version = 2
    )
  );

NOTIFY pgrst, 'reload schema';
