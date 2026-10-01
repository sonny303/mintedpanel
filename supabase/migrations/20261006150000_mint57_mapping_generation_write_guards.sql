-- MINT-57: serialize every guarded configuration write on its exact portal
-- row and reject writes captured against an obsolete mapping generation.

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

  -- Organization configuration takes precedence; otherwise writes are bound
  -- to the shared configuration used by MINT-52's exact-key resolver.
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

  -- Org overrides are based on the shared configuration. Lock both identities
  -- in the same transaction so a shared reset cannot pass between a write's
  -- generation check and its map insert/update. The effective mapping token
  -- remains the org generation when an org configuration exists.
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

  PERFORM set_config('minted.expected_mapping_generation', v_row.mapping_generation::text, true);
  PERFORM set_config('minted.mapping_portal_id', v_row.id::text, true);
  PERFORM set_config('minted.mapping_portal_key', v_key, true);
  PERFORM set_config('minted.mapping_owner_org_id', coalesce(p_org_id::text, ''), true);
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_portal_mapping_generation_for_write(text, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- PDF maps use the stable payer-form family key and intentionally have no
-- `portals` row. Preserve their legacy generation-1 write path only when the
-- key names an active payer_forms family and the caller supplies generation 1.
-- Keep this separate from the generic portal lookup: arbitrary missing web
-- configurations still fail closed.
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

  PERFORM set_config('minted.expected_mapping_generation', '1', true);
  PERFORM set_config('minted.mapping_portal_id', '', true);
  PERFORM set_config('minted.mapping_portal_key', v_key, true);
  PERFORM set_config('minted.mapping_owner_org_id', '', true);
  RETURN 1;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_legacy_pdf_mapping_generation_for_write(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_portal_configuration_generation_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_expected integer;
  v_row public.portals%ROWTYPE;
BEGIN
  v_expected := nullif(current_setting('minted.expected_mapping_generation', true), '')::integer;
  v_row := public.assert_portal_mapping_generation_for_write(
    OLD.portal_key, OLD.org_id, v_expected
  );

  IF NEW.mapping_generation IS DISTINCT FROM OLD.mapping_generation
     AND current_setting('minted.mapping_reset', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'mapping_generation_change_requires_reset';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_portal_field_map_generation_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_expected integer;
  v_portal public.portals%ROWTYPE;
  v_map public.portal_field_maps%ROWTYPE;
  v_shared_generation integer;
  v_generation integer;
BEGIN
  v_map := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_expected := nullif(current_setting('minted.expected_mapping_generation', true), '')::integer;
  IF v_map.org_id IS NULL AND v_map.map_type = 'pdf' THEN
    v_generation := public.assert_legacy_pdf_mapping_generation_for_write(
      v_map.portal_key, v_expected
    );
  ELSE
    v_portal := public.assert_portal_mapping_generation_for_write(
      v_map.portal_key, v_map.org_id, v_expected
    );
    v_generation := v_portal.mapping_generation;
  END IF;

  IF TG_OP = 'UPDATE'
     AND (NEW.portal_key IS DISTINCT FROM OLD.portal_key OR NEW.map_type IS DISTINCT FROM OLD.map_type)
     AND (OLD.portal_key LIKE 'payer-form:%' OR NEW.portal_key LIKE 'payer-form:%') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'pdf_field_map_identity_immutable';
  END IF;

  IF TG_OP <> 'INSERT' AND v_map.org_id IS NOT NULL THEN
    SELECT mapping_generation INTO v_shared_generation
      FROM public.portals
     WHERE org_id IS NULL AND portal_key = v_map.portal_key;
    IF OLD.shared_base_generation IS DISTINCT FROM v_shared_generation
       AND NOT (
         TG_OP = 'UPDATE'
         AND (
           current_setting('minted.mapping_base_review_id', true) = OLD.id::text
           OR (
             current_setting('minted.mapping_recapture_refresh', true) = OLD.id::text
             AND NEW.mapping_generation = v_portal.mapping_generation
             AND NEW.status = 'proposed'
             AND NEW.source = 'manual'
             AND NEW.token IS NULL
           )
         )
         AND NEW.shared_base_generation IS NOT DISTINCT FROM v_shared_generation
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_override_base_review_required';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.mapping_generation := v_generation;
    RETURN NEW;
  END IF;

  IF OLD.mapping_generation IS DISTINCT FROM v_generation
     AND current_setting('minted.mapping_recapture_refresh', true) IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_stale';
  END IF;

  IF NEW.mapping_generation IS DISTINCT FROM v_generation
     AND current_setting('minted.mapping_recapture_refresh', true) IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_generation_stale';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF OLD.mapping_generation IS DISTINCT FROM v_generation THEN
    NEW.mapping_generation := v_generation;
    NEW.status := 'proposed';
    NEW.source := 'manual';
    NEW.token := NULL;
    NEW.hardcoded_value := NULL;
    NEW.transform := NULL;
    NEW.display_label := NULL;
    NEW.section := NULL;
    NEW.sort_order := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_portal_configuration_generation_write()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_portal_field_map_generation_write()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS portals_generation_write_guard ON public.portals;
CREATE TRIGGER portals_generation_write_guard
  BEFORE UPDATE ON public.portals
  FOR EACH ROW EXECUTE FUNCTION public.guard_portal_configuration_generation_write();

DROP TRIGGER IF EXISTS portal_field_maps_generation_write_guard ON public.portal_field_maps;
CREATE TRIGGER portal_field_maps_generation_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.portal_field_maps
  FOR EACH ROW EXECUTE FUNCTION public.guard_portal_field_map_generation_write();

COMMENT ON FUNCTION public.assert_portal_mapping_generation_for_write(text, uuid, integer) IS
  'MINT-57: lock the selected org-over-shared portal configuration and validate the caller generation in the same transaction as the write. Missing generation is limited to untouched legacy generation-1 rows.';
COMMENT ON TRIGGER portals_generation_write_guard ON public.portals IS
  'MINT-57: serialize metadata/proof writes with reset on the exact portal row; only the reset workflow may advance mapping_generation.';
COMMENT ON TRIGGER portal_field_maps_generation_write_guard ON public.portal_field_maps IS
  'MINT-57: serialize map writes with reset and reject stale generation rows; capture may explicitly refresh an old selector, which is reset to undecided state.';

-- A single guarded RPC backs the app's org-tier decision buttons. Direct RLS
-- table updates remain available only for untouched legacy generation 1 rows.
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
  v_map public.portal_field_maps%ROWTYPE;
  v_key text;
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
  PERFORM public.assert_portal_mapping_generation_for_write(
    v_key, p_org_id, p_expected_mapping_generation
  );
  SELECT * INTO v_map FROM public.portal_field_maps
   WHERE id = p_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'field_map_not_found';
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

-- Extension capture runs on the service role. The RPC, not the HTTP process,
-- owns the lock/check/DML transaction. A stale selector is reset in place so
-- the existing per-scope unique selector indexes remain authoritative.
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
  v_portal := public.assert_portal_mapping_generation_for_write(
    v_key, p_org_id, p_expected_mapping_generation
  );
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
      PERFORM set_config('minted.mapping_recapture_refresh', v_map.id::text, true);
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
    -- Shared current-generation mappings already cover this selector. Return
    -- the exact shared decision rather than creating an org proposal that
    -- shadows an approved shared mapping. Existing org rows above still take
    -- precedence, so org recapture continues to refresh its own selector.
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
  PERFORM public.assert_portal_mapping_generation_for_write(
    v_key, p_org_id, p_expected_mapping_generation
  );
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_entries)
  LOOP
    v_id := nullif(v_entry->>'id', '')::uuid;
    IF v_id IS NULL OR jsonb_typeof(v_entry->'patch') <> 'object'
       OR v_entry->'patch' - ARRAY['status','source','token','hardcoded_value','transform','notes'] <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_field_map_batch_entry';
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

-- Existing global/shared RPC contracts remain callable for old clients; their
-- writes are accepted without a token only while the exact config is legacy.
CREATE OR REPLACE FUNCTION public.train_global_field_map(
  p_id uuid, p_status text, p_source text, p_token text,
  p_field_label text, p_hardcoded_value text, p_transform text,
  p_expected_mapping_generation integer
)
RETURNS public.portal_field_maps
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_map public.portal_field_maps%ROWTYPE;
BEGIN
  SELECT * INTO v_map FROM public.portal_field_maps WHERE id = p_id AND org_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'field_map_not_found'; END IF;
  IF v_map.map_type = 'pdf' THEN
    PERFORM public.assert_legacy_pdf_mapping_generation_for_write(
      v_map.portal_key, p_expected_mapping_generation
    );
  ELSE
    PERFORM public.assert_portal_mapping_generation_for_write(
      v_map.portal_key, NULL, p_expected_mapping_generation
    );
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

CREATE OR REPLACE FUNCTION public.set_global_portal_flags(
  p_id uuid, p_verified boolean, p_proven boolean,
  p_expected_mapping_generation integer
)
RETURNS public.portals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_portal public.portals%ROWTYPE;
BEGIN
  SELECT * INTO v_portal FROM public.portals WHERE id = p_id AND org_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'portal_not_found'; END IF;
  PERFORM public.assert_portal_mapping_generation_for_write(
    v_portal.portal_key, NULL, p_expected_mapping_generation
  );
  RETURN public.set_global_portal_flags(p_id, p_verified, p_proven);
END;
$$;
REVOKE ALL ON FUNCTION public.set_global_portal_flags(uuid, boolean, boolean, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_global_portal_flags(uuid, boolean, boolean, integer)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upsert_global_portal(
  p_id uuid, p_name text, p_portal_key text, p_payer_id uuid,
  p_form_url text, p_case_type text, p_expected_mapping_generation integer
)
RETURNS public.portals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_portal public.portals%ROWTYPE;
BEGIN
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_portal FROM public.portals WHERE id = p_id AND org_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'portal_not_found'; END IF;
    PERFORM public.assert_portal_mapping_generation_for_write(
      v_portal.portal_key, NULL, p_expected_mapping_generation
    );
  END IF;
  RETURN public.upsert_global_portal(p_id, p_name, p_portal_key, p_payer_id, p_form_url, p_case_type);
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_global_portal(uuid, text, text, uuid, text, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_global_portal(uuid, text, text, uuid, text, text, integer)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.learn_portal_field_maps_from_touch(
  p_org_id uuid, p_actor_id uuid, p_case_id uuid, p_provider_id uuid,
  p_fill_session_id uuid, p_portal_key text, p_url_pattern text,
  p_mappings jsonb, p_expected_mapping_generation integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.assert_portal_mapping_generation_for_write(
    p_portal_key, p_org_id, p_expected_mapping_generation
  );
  RETURN public.learn_portal_field_maps_from_touch(
    p_org_id, p_actor_id, p_case_id, p_provider_id, p_fill_session_id,
    p_portal_key, p_url_pattern, p_mappings
  );
END;
$$;
REVOKE ALL ON FUNCTION public.learn_portal_field_maps_from_touch(uuid, uuid, uuid, uuid, uuid, text, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.learn_portal_field_maps_from_touch(uuid, uuid, uuid, uuid, uuid, text, text, jsonb, integer)
  TO service_role;

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
BEGIN
  IF p_map_type = 'pdf' THEN
    v_generation := public.assert_legacy_pdf_mapping_generation_for_write(
      p_portal_key, p_expected_mapping_generation
    );
  ELSE
    v_portal := public.assert_portal_mapping_generation_for_write(
      p_portal_key, NULL, p_expected_mapping_generation
    );
    v_generation := v_portal.mapping_generation;
  END IF;
  SELECT * INTO v_existing FROM public.portal_field_maps
   WHERE org_id IS NULL AND portal_key = lower(btrim(p_portal_key))
     AND selector = btrim(p_selector) AND map_type = coalesce(p_map_type, 'web') FOR UPDATE;
  IF FOUND AND v_existing.mapping_generation IS DISTINCT FROM v_generation THEN
    PERFORM set_config('minted.mapping_recapture_refresh', v_existing.id::text, true);
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

-- Shared registry metadata edits may span keys. Each entry carries the token
-- from the resolution used to render that row; each check/row update stays in
-- this one RPC transaction.
CREATE OR REPLACE FUNCTION public.update_shared_field_registry(p_entries jsonb)
RETURNS SETOF public.portal_field_maps
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_entry jsonb;
  v_id uuid;
  v_portal_key text;
  v_map_type text;
  v_expected_generation integer;
  v_map public.portal_field_maps%ROWTYPE;
BEGIN
  IF app_authz.is_restricted_external() OR coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not_authorized';
  END IF;
  IF jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'entries_must_be_array';
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_entries)
  LOOP
    v_id := nullif(v_entry->>'id', '')::uuid;
    v_expected_generation := nullif(v_entry->>'expected_mapping_generation', '')::integer;
    -- Read identity without locking, then acquire locks in reset order:
    -- portal configuration first, field-map row second.
    SELECT portal_key, map_type INTO v_portal_key, v_map_type FROM public.portal_field_maps
     WHERE id = v_id AND org_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'field_map_not_found'; END IF;
    IF v_map_type = 'pdf' THEN
      PERFORM public.assert_legacy_pdf_mapping_generation_for_write(
        v_portal_key, v_expected_generation
      );
    ELSE
      PERFORM public.assert_portal_mapping_generation_for_write(
        v_portal_key, NULL, v_expected_generation
      );
    END IF;
    SELECT * INTO v_map FROM public.portal_field_maps
     WHERE id = v_id AND org_id IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'field_map_not_found'; END IF;
    IF v_map.portal_key IS DISTINCT FROM v_portal_key
       OR v_map.map_type IS DISTINCT FROM v_map_type THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mapping_configuration_changed';
    END IF;
    UPDATE public.portal_field_maps
       SET display_label = CASE WHEN v_entry ? 'display_label'
                                THEN nullif(btrim(coalesce(v_entry->>'display_label', '')), '') ELSE display_label END,
           section = CASE WHEN v_entry ? 'section'
                          THEN nullif(btrim(coalesce(v_entry->>'section', '')), '') ELSE section END,
           sort_order = CASE WHEN v_entry ? 'sort_order'
                             THEN (v_entry->>'sort_order')::integer ELSE sort_order END,
           updated_at = now()
     WHERE id = v_id AND org_id IS NULL;
  END LOOP;
  RETURN QUERY SELECT * FROM public.portal_field_maps
    WHERE org_id IS NULL
      AND id IN (SELECT (entry->>'id')::uuid FROM jsonb_array_elements(p_entries) entry);
END;
$$;

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
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'portal_not_found'; END IF;
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

-- After a shared reset the resolver deliberately excludes org overrides from
-- execution. A specialist/admin may review one override against the current
-- shared base and explicitly restore it without changing its prior decision.
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

  -- Acquire the exact org-over-shared configuration lock before the mapping
  -- row, matching every other M57 write and the future reset lock contract.
  v_portal := public.assert_portal_mapping_generation_for_write(
    v_map.portal_key, p_org_id, p_expected_mapping_generation
  );
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

  PERFORM set_config('minted.mapping_base_review_id', v_map.id::text, true);
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
COMMENT ON FUNCTION public.review_org_portal_field_map_base(uuid, uuid, integer, integer) IS
  'MINT-57: explicitly revalidate one retained org override against the caller-observed current shared base after locking both exact portal configurations; does not alter the map decision.';
