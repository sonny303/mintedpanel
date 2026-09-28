-- Portal/PDF fill outcome events are value-free, append-only records. Legacy
-- rows keep all five new columns NULL; only schema version 2 is accepted for
-- new structured metadata.
ALTER TABLE public.fill_sessions
  ADD COLUMN event_schema_version smallint,
  ADD COLUMN fields_attempted integer,
  ADD COLUMN fields_verified integer,
  ADD COLUMN fields_rejected integer,
  ADD COLUMN field_outcomes jsonb;

ALTER TABLE public.fill_sessions
  ADD CONSTRAINT fill_sessions_event_v2_columns_check
  CHECK (
    (
      (event_schema_version IS NULL OR event_schema_version = 1)
      AND fields_attempted IS NULL
      AND fields_verified IS NULL
      AND fields_rejected IS NULL
      AND field_outcomes IS NULL
    )
    OR (
      event_schema_version IS NOT DISTINCT FROM 2
      AND fields_attempted IS NOT NULL
      AND fields_attempted >= 0
      AND fields_verified IS NOT NULL
      AND fields_verified >= 0
      AND fields_rejected IS NOT NULL
      AND fields_rejected >= 0
      AND field_outcomes IS NOT NULL
      AND jsonb_typeof(field_outcomes) = 'array'
    )
  );

-- Do not let table-level TRUNCATE grants bypass the row guards below. The
-- pre-existing UPDATE/DELETE grants remain usable for legacy rows under their
-- existing policies; V2 rows are rejected by the row trigger.
REVOKE TRUNCATE ON TABLE public.fill_sessions FROM anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._fill_sessions_validate_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  v_role text;
  v_actor uuid;
  v_item jsonb;
  v_evidence jsonb;
  v_map_id uuid;
  v_frame_key text;
  v_step_key text;
  v_target_key text;
  v_outcome text;
  v_reason text;
  v_attempted integer := 0;
  v_verified integer := 0;
  v_rejected integer := 0;
  v_expected_skipped jsonb;
  v_expected_keys text[];
  v_has_evidence boolean;
BEGIN
  IF NEW.event_schema_version IS NULL OR NEW.event_schema_version = 1 THEN
    IF NEW.fields_attempted IS NOT NULL
       OR NEW.fields_verified IS NOT NULL
       OR NEW.fields_rejected IS NOT NULL
       OR NEW.field_outcomes IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid fill outcome event';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.event_schema_version <> 2
     OR NEW.fields_attempted IS NULL
     OR NEW.fields_verified IS NULL
     OR NEW.fields_rejected IS NULL
     OR NEW.field_outcomes IS NULL
     OR jsonb_typeof(NEW.field_outcomes) IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.field_outcomes) > 250 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid fill outcome event';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(NEW.field_outcomes) AS outcome(value)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR NOT (v_item ?& ARRAY[
         'mapId', 'targetKey', 'frameKey', 'stepKey', 'attempted', 'outcome', 'reasonCode'
       ]) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid fill outcome event';
    END IF;

    v_has_evidence := v_item ? 'notFoundEvidence';
    IF v_has_evidence THEN
      v_expected_keys := ARRAY[
        'mapId', 'targetKey', 'frameKey', 'stepKey', 'attempted', 'outcome', 'reasonCode', 'notFoundEvidence'
      ];
    ELSE
      v_expected_keys := ARRAY[
        'mapId', 'targetKey', 'frameKey', 'stepKey', 'attempted', 'outcome', 'reasonCode'
      ];
    END IF;
    IF (v_item - v_expected_keys) <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid fill outcome event';
    END IF;

    IF jsonb_typeof(v_item->'mapId') IS DISTINCT FROM 'null' THEN
      IF jsonb_typeof(v_item->'mapId') IS DISTINCT FROM 'string'
         OR (v_item->>'mapId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid fill outcome event';
      END IF;
      v_map_id := (v_item->>'mapId')::uuid;
    ELSE
      v_map_id := NULL;
    END IF;

    IF jsonb_typeof(v_item->'targetKey') IS DISTINCT FROM 'string'
       OR (v_item->>'targetKey') !~* '^t_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_item->'frameKey') NOT IN ('null', 'string')
       OR (jsonb_typeof(v_item->'frameKey') = 'string'
           AND (v_item->>'frameKey') !~* '^f_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
       OR jsonb_typeof(v_item->'stepKey') NOT IN ('null', 'string')
       OR (jsonb_typeof(v_item->'stepKey') = 'string'
           AND (v_item->>'stepKey') !~* '^s_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
       OR jsonb_typeof(v_item->'attempted') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(v_item->'outcome') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item->'reasonCode') NOT IN ('null', 'string') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid fill outcome event';
    END IF;

    v_target_key := v_item->>'targetKey';
    v_frame_key := CASE WHEN jsonb_typeof(v_item->'frameKey') = 'null' THEN NULL ELSE v_item->>'frameKey' END;
    v_step_key := CASE WHEN jsonb_typeof(v_item->'stepKey') = 'null' THEN NULL ELSE v_item->>'stepKey' END;
    v_outcome := v_item->>'outcome';
    v_reason := CASE WHEN jsonb_typeof(v_item->'reasonCode') = 'null' THEN NULL ELSE v_item->>'reasonCode' END;

    IF v_outcome NOT IN (
      'verified', 'unchanged', 'write_rejected', 'unverified', 'needs_value',
      'needs_mapping', 'manual', 'other_page', 'hidden', 'page_unknown',
      'not_found', 'option_mismatch', 'unsupported'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid fill outcome event';
    END IF;

    IF NOT COALESCE((
      (v_outcome = 'verified' AND v_reason IS NULL)
      OR (v_outcome = 'unchanged' AND v_reason = 'unchanged_value')
      OR (v_outcome = 'write_rejected' AND v_reason = ANY (ARRAY['mask_reverted', 'readback_mismatch', 'invalid_format', 'setter_rejected']))
      OR (v_outcome = 'unverified' AND v_reason = ANY (ARRAY['readback_unavailable', 'frame_inaccessible', 'context_changed', 'setter_unavailable']))
      OR (v_outcome = 'needs_value' AND v_reason = ANY (ARRAY['missing_value', 'invalid_format']))
      OR (v_outcome = 'needs_mapping' AND v_reason = ANY (ARRAY['mapping_required', 'ambiguous_target']))
      OR (v_outcome = 'manual' AND v_reason = 'manual_required')
      OR (v_outcome = 'other_page' AND v_reason = 'other_page')
      OR (v_outcome = 'hidden' AND v_reason = 'field_hidden')
      OR (v_outcome = 'page_unknown' AND v_reason = 'page_unknown')
      OR (v_outcome = 'not_found' AND v_reason = 'target_missing')
      OR (v_outcome = 'option_mismatch' AND v_reason = 'option_missing')
      OR (v_outcome = 'unsupported' AND v_reason = 'unsupported_control')
    ), false) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid fill outcome event';
    END IF;

    IF (v_outcome = 'verified' AND (v_item->>'attempted') <> 'true')
       OR (v_outcome = 'verified' AND v_map_id IS NULL)
       OR (v_outcome = 'unchanged' AND (v_item->>'attempted') <> 'false')
       OR (v_outcome = 'unchanged' AND v_map_id IS NULL)
       OR (v_outcome = 'write_rejected' AND (v_item->>'attempted') <> 'true')
       OR (v_outcome IN ('needs_value', 'needs_mapping', 'manual', 'other_page', 'hidden', 'page_unknown', 'not_found', 'option_mismatch', 'unsupported')
           AND (v_item->>'attempted') <> 'false') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid fill outcome event';
    END IF;

    IF v_outcome = 'not_found' THEN
      IF v_map_id IS NULL OR v_frame_key IS NULL OR v_step_key IS NULL OR NOT v_has_evidence THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid fill outcome event';
      END IF;
      v_evidence := v_item->'notFoundEvidence';
      IF jsonb_typeof(v_evidence) IS DISTINCT FROM 'object'
         OR NOT (v_evidence ?& ARRAY['stepKnown', 'frameAccessible', 'pageSettled', 'searchComplete', 'targetAbsent'])
         OR (v_evidence - ARRAY['stepKnown', 'frameAccessible', 'pageSettled', 'searchComplete', 'targetAbsent']) <> '{}'::jsonb
         OR v_evidence <> '{"stepKnown":true,"frameAccessible":true,"pageSettled":true,"searchComplete":true,"targetAbsent":true}'::jsonb THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid fill outcome event';
      END IF;
    ELSIF v_has_evidence THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid fill outcome event';
    END IF;

    IF v_map_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.portal_field_maps AS map
      WHERE map.id = v_map_id
        AND map.portal_key = NEW.portal_key
        AND map.map_type = NEW.fill_mode
        AND (map.org_id = NEW.org_id OR map.org_id IS NULL)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'fill outcome map is outside the event scope';
    END IF;

    IF (v_item->>'attempted') = 'true' THEN
      v_attempted := v_attempted + 1;
    END IF;
    IF v_outcome = 'verified' THEN
      v_verified := v_verified + 1;
    ELSIF v_outcome = 'write_rejected' THEN
      v_rejected := v_rejected + 1;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.field_outcomes) WITH ORDINALITY AS left_item(value, item_order)
    JOIN jsonb_array_elements(NEW.field_outcomes) WITH ORDINALITY AS right_item(value, item_order)
      ON left_item.item_order < right_item.item_order
    WHERE
      (CASE WHEN jsonb_typeof(left_item.value->'mapId') = 'null'
            THEN NULL::uuid ELSE (left_item.value->>'mapId')::uuid END)
        IS NOT DISTINCT FROM
      (CASE WHEN jsonb_typeof(right_item.value->'mapId') = 'null'
            THEN NULL::uuid ELSE (right_item.value->>'mapId')::uuid END)
      AND lower(left_item.value->>'targetKey') = lower(right_item.value->>'targetKey')
      AND (CASE WHEN jsonb_typeof(left_item.value->'frameKey') = 'null'
                THEN NULL::text ELSE lower(left_item.value->>'frameKey') END)
        IS NOT DISTINCT FROM
      (CASE WHEN jsonb_typeof(right_item.value->'frameKey') = 'null'
            THEN NULL::text ELSE lower(right_item.value->>'frameKey') END)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid fill outcome event';
  END IF;

  IF NEW.fields_attempted <> v_attempted
     OR NEW.fields_verified <> v_verified
     OR NEW.fields_rejected <> v_rejected
     OR NEW.fields_filled <> v_verified THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid fill outcome counters';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'label', '',
        'reason', COALESCE(item.value->>'reasonCode', item.value->>'outcome'),
        'kind', item.value->>'outcome',
        'mapId', item.value->'mapId'
      ) ORDER BY item.ordinality
    ) FILTER (WHERE item.value->>'outcome' NOT IN ('verified', 'unchanged')),
    '[]'::jsonb
  )
  INTO v_expected_skipped
  FROM jsonb_array_elements(NEW.field_outcomes) WITH ORDINALITY AS item(value, ordinality);

  IF NEW.fields_skipped IS DISTINCT FROM v_expected_skipped OR NEW.docs_attached IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid fill outcome payload';
  END IF;

  v_role := auth.jwt()->>'role';
  IF v_role = 'authenticated' THEN
    v_actor := auth.uid();
    IF v_actor IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'fill outcome actor is required';
    END IF;
    IF NEW.performed_by IS NULL THEN
      NEW.performed_by := v_actor;
    ELSIF NEW.performed_by IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'fill outcome actor does not match the caller';
    END IF;
  ELSIF v_role = 'service_role' THEN
    v_actor := NEW.performed_by;
    IF v_actor IS NULL OR (auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM v_actor) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'fill outcome actor is invalid';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'fill outcome caller is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.memberships AS membership
    WHERE membership.org_id = NEW.org_id
      AND membership.user_id = v_actor
      AND membership.role IN ('specialist', 'admin')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'fill outcome actor is outside the event organization';
  END IF;

  IF NEW.provider_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.providers AS provider
    WHERE provider.id = NEW.provider_id AND provider.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'fill outcome provider is outside the event organization';
  END IF;

  IF NEW.case_id IS NULL THEN
    IF NOT COALESCE(NEW.is_test, false) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'a real fill outcome requires a case';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.credential_cases AS credential_case
    WHERE credential_case.id = NEW.case_id
      AND credential_case.org_id = NEW.org_id
      AND credential_case.provider_id IS NOT DISTINCT FROM NEW.provider_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'fill outcome case is outside the provider organization';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_fill_sessions_validate_v2
  BEFORE INSERT ON public.fill_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public._fill_sessions_validate_v2();

CREATE OR REPLACE FUNCTION public._fill_sessions_prevent_v2_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.event_schema_version = 2 THEN
      -- Preserve the existing SECURITY DEFINER delete_case RPC's audited
      -- admin cascade, while refusing direct row deletion of V2 history.
      IF OLD.case_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.credential_cases AS c WHERE c.id = OLD.case_id)
         AND auth.jwt()->>'role' = 'authenticated'
         AND EXISTS (
           SELECT 1 FROM public.memberships AS membership
           WHERE membership.org_id = OLD.org_id
             AND membership.user_id = auth.uid()
             AND membership.role = 'admin'
         ) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'fill outcome history is immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.event_schema_version = 2 OR NEW.event_schema_version = 2 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'fill outcome history is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_fill_sessions_prevent_v2_mutation
  BEFORE UPDATE OR DELETE ON public.fill_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public._fill_sessions_prevent_v2_mutation();

CREATE OR REPLACE FUNCTION public._fill_sessions_audit_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.event_schema_version = 2 THEN
    INSERT INTO public.audit_log (
      org_id, user_id, action_type, entity_type, entity_id, after, description
    ) VALUES (
      NEW.org_id,
      NEW.performed_by,
      'CREATE',
      'fill_session',
      NEW.id,
      jsonb_build_object(
        'event_schema_version', NEW.event_schema_version,
        'fields_attempted', NEW.fields_attempted,
        'fields_verified', NEW.fields_verified,
        'fields_rejected', NEW.fields_rejected
      ),
      'Portal/PDF fill outcome recorded'
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_fill_sessions_audit_v2
  AFTER INSERT ON public.fill_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public._fill_sessions_audit_v2();

-- These functions are trigger-only. Revoke default PUBLIC execution so they
-- do not become callable RPC entry points.
REVOKE ALL ON FUNCTION public._fill_sessions_validate_v2() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._fill_sessions_prevent_v2_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._fill_sessions_audit_v2() FROM PUBLIC, anon, authenticated, service_role;

-- V2 PDF events represent a reviewed fill attempt, not payer-portal work.
-- Preserve the historical V1 and V2 web transition behavior.
CREATE OR REPLACE FUNCTION public.case_status_on_fill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.case_id IS NOT NULL
     AND COALESCE(NEW.is_test, false) = false
     AND (NEW.event_schema_version IS DISTINCT FROM 2 OR NEW.fill_mode IS DISTINCT FROM 'pdf') THEN
    PERFORM public._apply_case_status_auto(NEW.case_id, 'in_progress', NULL);
  END IF;
  RETURN NEW;
END;
$function$;
