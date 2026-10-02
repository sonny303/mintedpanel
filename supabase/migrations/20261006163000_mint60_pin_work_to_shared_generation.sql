-- MINT-60 pins organization Work receipts to the shared base used by the
-- same M52 resolver snapshot that validated their effective fingerprint.
ALTER TABLE public.fill_sessions
  ADD COLUMN shared_mapping_generation integer,
  ADD CONSTRAINT fill_sessions_shared_mapping_generation_check CHECK (
    shared_mapping_generation IS NULL OR shared_mapping_generation > 0
  );

COMMENT ON COLUMN public.fill_sessions.shared_mapping_generation IS
  'MINT-60: server-derived shared portal generation from the M52 snapshot used for this immutable Work receipt; NULL when selected config is global, org-only, or the receipt is legacy/unclassified.';

CREATE OR REPLACE FUNCTION public.mint60_has_current_approved_web_map(
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

REVOKE ALL ON FUNCTION public.mint60_has_current_approved_web_map(uuid, text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mint60_has_current_approved_web_map(uuid, text, integer, integer)
  TO service_role;

-- Replace the M58 insert guard with the same task→case→org→shared checks in
-- one function. The trigger remains invoker-safe for authenticated legacy
-- writes; it does not call a service-role-only SQL helper.

CREATE OR REPLACE FUNCTION public.validate_mint58_case_fill_context()
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
  -- Clients never choose the stored pin. Typed Work may earn it below after
  -- the current selected/shared rows are locked in the M58 lock order.
  NEW.shared_mapping_generation := NULL;
  -- The typed-case guard replaces this value below while holding the exact
  -- case row lock. All legacy and Contract rows are forcibly unstamped.
  NEW.did_auto_start_case := false;
  IF NEW.contract_id IS NOT NULL THEN
    IF NEW.case_id IS NOT NULL OR NEW.case_task_id IS NOT NULL OR NEW.case_step_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid mixed-owner fill receipt';
    END IF;
    -- Contract Work carries a stepIdentity but has no case task/step. Keep
    -- this branch distinct and pin only exact V2 receipts.
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

  -- MINT-51 increments context_version when the first real fill auto-starts a
  -- not_started case. Record that cause on this immutable row before insert;
  -- caller-supplied values were overwritten above. The submission RPC accepts
  -- exactly this receipt's one resulting increment and nothing later.
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

  -- The selected organization portal is already FOR SHARE above. Lock the
  -- same-key global base next, matching M57 reset's FOR UPDATE lock and
  -- serializing the pin against both reset/fill orderings.
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
         OR NOT public.mint60_has_current_approved_web_map(
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
