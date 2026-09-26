-- Autonomous flywheel: value-free, post-submission promotion of local AI
-- suggestions. Existing mappings and their approval state are left untouched.

ALTER TABLE public.portal_field_maps
  ADD COLUMN IF NOT EXISTS learned_via text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS confidence_score numeric(3,2),
  ADD COLUMN IF NOT EXISTS auto_promoted_at timestamptz;

ALTER TABLE public.portal_field_maps
  DROP CONSTRAINT IF EXISTS portal_field_maps_learned_via_check,
  ADD CONSTRAINT portal_field_maps_learned_via_check
    CHECK (learned_via IN ('manual', 'nano')),
  DROP CONSTRAINT IF EXISTS portal_field_maps_confidence_score_check,
  ADD CONSTRAINT portal_field_maps_confidence_score_check
    CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
  DROP CONSTRAINT IF EXISTS portal_field_maps_auto_promoted_check,
  ADD CONSTRAINT portal_field_maps_auto_promoted_check
    CHECK (auto_promoted_at IS NULL OR learned_via = 'nano');

CREATE OR REPLACE FUNCTION public.learn_portal_field_maps_from_touch(
  p_org_id uuid,
  p_actor_id uuid,
  p_case_id uuid,
  p_provider_id uuid,
  p_fill_session_id uuid,
  p_portal_key text,
  p_url_pattern text,
  p_mappings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mapping jsonb;
  v_catalog jsonb;
  v_token text;
  v_selector text;
  v_field_type text;
  v_confidence numeric;
  v_seen_selectors text[] := ARRAY[]::text[];
  v_existing record;
  v_inserted integer := 0;
  v_confirmed integer := 0;
  v_preserved integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_map_id uuid;
BEGIN
  -- The service-role caller bypasses RLS, so this function repeats every
  -- authorization and ownership condition explicitly. Actor/org are passed
  -- only from the server's resolved AuthContext, never from the request body.
  IF p_org_id IS NULL OR p_actor_id IS NULL OR p_case_id IS NULL
     OR p_provider_id IS NULL OR p_fill_session_id IS NULL THEN
    RETURN jsonb_build_object('kind', 'rejected', 'reason', 'invalid_context');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.org_id = p_org_id AND m.user_id = p_actor_id
      AND m.role IN ('admin', 'specialist')
  ) THEN
    RETURN jsonb_build_object('kind', 'rejected', 'reason', 'not_authorized');
  END IF;

  IF p_portal_key IS NULL OR length(p_portal_key) > 100
     OR p_portal_key !~ '^[a-z0-9][a-z0-9_-]*$'
     OR p_url_pattern IS NULL OR length(p_url_pattern) > 2048
     OR p_url_pattern !~ '^https?://[^/?#]+(/[^?#]*)?$' THEN
    RETURN jsonb_build_object('kind', 'rejected', 'reason', 'invalid_scope');
  END IF;

  IF jsonb_typeof(p_mappings) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_mappings) < 1
     OR jsonb_array_length(p_mappings) > 32 THEN
    RETURN jsonb_build_object('kind', 'rejected', 'reason', 'invalid_batch');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.credential_cases c
    WHERE c.id = p_case_id AND c.org_id = p_org_id
      AND c.provider_id = p_provider_id
  ) THEN
    RETURN jsonb_build_object('kind', 'rejected', 'reason', 'case_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.fill_sessions f
    WHERE f.id = p_fill_session_id AND f.org_id = p_org_id
      AND f.case_id = p_case_id AND f.provider_id = p_provider_id
      AND f.portal_key = p_portal_key AND f.performed_by = p_actor_id
      AND f.fill_mode = 'web' AND COALESCE(f.is_test, false) = false
      AND f.completed_at IS NOT NULL AND f.fields_filled > 0
  ) THEN
    RETURN jsonb_build_object('kind', 'rejected', 'reason', 'fill_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.touches t
    JOIN public.audit_log a
      ON a.org_id = t.org_id AND a.entity_type = 'touch'
     AND a.entity_id = t.id AND a.user_id = p_actor_id
     AND a.action_type = 'TOUCH_LOGGED'
    WHERE t.org_id = p_org_id AND t.case_id = p_case_id
      AND t.coordinator_id = p_actor_id AND t.entry_type = 'touchpoint'
      AND t.touch_type = 'portal' AND t.outcome = 'submitted'
      AND t.source = 'extension'
      AND a.after @> jsonb_build_object(
        'caseId', p_case_id::text,
        'portalKey', p_portal_key,
        'fillSessionId', p_fill_session_id::text,
        'touchType', 'portal',
        'outcome', 'submitted',
        'source', 'extension'
      )
  ) THEN
    RETURN jsonb_build_object('kind', 'rejected', 'reason', 'submission_not_found');
  END IF;

  -- Take one bounded schema-derived snapshot; code-owned user/contact tokens
  -- are checked explicitly below because the catalog intentionally omits them.
  v_catalog := public.get_sop_field_tokens();
  IF jsonb_typeof(v_catalog) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('kind', 'rejected', 'reason', 'catalog_unavailable');
  END IF;

  FOR v_mapping IN SELECT value FROM jsonb_array_elements(p_mappings) AS item(value)
  LOOP
    IF jsonb_typeof(v_mapping) IS DISTINCT FROM 'object'
       OR (SELECT array_agg(k ORDER BY k)
           FROM jsonb_object_keys(v_mapping) AS keys(k))
          IS DISTINCT FROM ARRAY['confidence','field_type','selector','token']::text[] THEN
      RETURN jsonb_build_object('kind', 'rejected', 'reason', 'invalid_mapping_shape');
    END IF;

    IF jsonb_typeof(v_mapping->'selector') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_mapping->'token') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_mapping->'field_type') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_mapping->'confidence') IS DISTINCT FROM 'number' THEN
      RETURN jsonb_build_object('kind', 'rejected', 'reason', 'invalid_mapping_shape');
    END IF;

    v_selector := btrim(v_mapping->>'selector');
    v_token := v_mapping->>'token';
    v_field_type := v_mapping->>'field_type';
    v_confidence := (v_mapping->>'confidence')::numeric;

    IF v_selector = '' OR length(v_selector) > 500
       OR v_selector ~ '[[:cntrl:]]'
       OR v_selector ~* '\[\s*value\s*=' THEN
      RETURN jsonb_build_object('kind', 'rejected', 'reason', 'invalid_selector');
    END IF;
    IF v_selector = ANY(v_seen_selectors) THEN
      RETURN jsonb_build_object('kind', 'rejected', 'reason', 'duplicate_selector');
    END IF;
    v_seen_selectors := array_append(v_seen_selectors, v_selector);

    IF v_confidence < 0.85 OR v_confidence > 1 THEN
      RETURN jsonb_build_object('kind', 'rejected', 'reason', 'invalid_confidence');
    END IF;
    IF v_field_type NOT IN ('text', 'select', 'radio', 'checkbox', 'date') THEN
      RETURN jsonb_build_object('kind', 'rejected', 'reason', 'invalid_field_type');
    END IF;
    IF v_token ~* 'ssn' OR length(v_token) > 120
       OR v_token !~ '^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$' THEN
      RETURN jsonb_build_object('kind', 'rejected', 'reason', 'invalid_token');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_catalog) AS catalog(item)
      WHERE catalog.item->>'token' = v_token
    )
    AND v_token NOT IN ('user.name', 'user.firstName', 'user.lastName', 'user.title', 'user.email')
    AND v_token !~ '^(billingContact|credentialingContact|contractingSigner)\.(firstName|lastName|fullName|title|email|phoneOffice|phoneExtension|phoneMobile|fax|addressLine1|addressLine2|city|state|postalCode|country)$' THEN
      RETURN jsonb_build_object('kind', 'rejected', 'reason', 'invalid_token');
    END IF;
  END LOOP;

  -- Validate the entire batch before the first write. Returning a rejection
  -- after a partial insert would commit that earlier work even though the
  -- response claimed the batch failed.
  FOR v_mapping IN SELECT value FROM jsonb_array_elements(p_mappings) AS item(value)
  LOOP
    v_selector := btrim(v_mapping->>'selector');
    v_token := v_mapping->>'token';
    v_field_type := v_mapping->>'field_type';
    v_confidence := (v_mapping->>'confidence')::numeric;

    -- Preserve every existing tier and decision. An exact approved mapping is
    -- confirmed as present (including a replay); all other rows block promotion.
    SELECT m.id, m.status, m.token
      INTO v_existing
      FROM public.portal_field_maps m
     WHERE m.portal_key = p_portal_key AND m.selector = v_selector
       AND (m.org_id = p_org_id OR m.org_id IS NULL)
     ORDER BY (m.org_id = p_org_id) DESC NULLS LAST, m.id
     LIMIT 1;

    IF FOUND THEN
      IF v_existing.status = 'approved' AND v_existing.token = v_token THEN
        v_confirmed := v_confirmed + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'selector', v_selector, 'token', v_token, 'outcome', 'already_present'
        ));
      ELSE
        v_preserved := v_preserved + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'selector', v_selector, 'token', v_token, 'outcome', 'preserved'
        ));
      END IF;
      CONTINUE;
    END IF;

    v_map_id := NULL;
    INSERT INTO public.portal_field_maps (
      org_id, portal_key, url_pattern, map_type, selector, source, token,
      field_type, status, learned_via, confidence_score, auto_promoted_at,
      created_at, updated_at
    ) VALUES (
      p_org_id, p_portal_key, p_url_pattern, 'web', v_selector, 'token', v_token,
      v_field_type, 'approved', 'nano', v_confidence, now(), now(), now()
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_map_id;

    IF v_map_id IS NULL THEN
      -- A same-tier concurrent insert won the partial unique index. Re-read it
      -- and count only the now-persisted exact approved mapping as saved.
      SELECT m.id, m.status, m.token
        INTO v_existing
        FROM public.portal_field_maps m
       WHERE m.org_id = p_org_id AND m.portal_key = p_portal_key
         AND m.selector = v_selector
       LIMIT 1;
      IF FOUND AND v_existing.status = 'approved' AND v_existing.token = v_token THEN
        v_confirmed := v_confirmed + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'selector', v_selector, 'token', v_token, 'outcome', 'already_present'
        ));
      ELSE
        v_preserved := v_preserved + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'selector', v_selector, 'token', v_token, 'outcome', 'preserved'
        ));
      END IF;
      CONTINUE;
    END IF;

    v_inserted := v_inserted + 1;
    v_confirmed := v_confirmed + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'selector', v_selector, 'token', v_token, 'outcome', 'inserted'
    ));

    -- This append is in the same transaction as every map insert. The after
    -- payload contains identifiers and mapping metadata only, never values.
    INSERT INTO public.audit_log (
      org_id, user_id, action_type, entity_type, entity_id, after, description
    ) VALUES (
      p_org_id, p_actor_id, 'CREATE', 'portal_field_map', v_map_id,
      jsonb_build_object(
        'learnedVia', 'nano', 'portalKey', p_portal_key,
        'selector', v_selector, 'token', v_token,
        'confidence', v_confidence, 'fillSessionId', p_fill_session_id::text
      ),
      'AI field mapping saved after a logged portal submission'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'kind', 'ok', 'inserted_count', v_inserted,
    'confirmed_saved_count', v_confirmed, 'preserved_count', v_preserved,
    'results', v_results
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.learn_portal_field_maps_from_touch(uuid, uuid, uuid, uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.learn_portal_field_maps_from_touch(uuid, uuid, uuid, uuid, uuid, text, text, jsonb)
  TO service_role;
