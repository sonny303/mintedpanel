-- E2.1 TE-3 (+ the E2.2 TE-1 stamp transport) — additive extension of
-- create_case_with_tasks:
--   (a) p_input->>'generation_run_id' rides the case insert (NULL-safe: every
--       existing caller omits it and keeps producing NULL, the "run-less"
--       manual trail);
--   (b) each p_tasks element may carry sop_template_id / sop_version — the
--       E2.2 per-task version stamp (columns landed by E1.7b; E2.2 populates
--       them, this migration only threads them). NULL-safe for every caller
--       that does not pass stamps — NULL/NULL is valid under the E1.7b
--       both-or-neither CHECK.
--
-- Everything else is the baseline body verbatim (20260704210000, lines
-- 510-608). Signature unchanged — (jsonb, jsonb) — so the existing EXECUTE
-- grants (authenticated, service_role) carry over; security posture is
-- unchanged (SECURITY INVOKER: inserts run as the caller under RLS).
-- Batch semantics note (TE-3): this RPC is NOT replay-idempotent; the E2.1
-- confirm loop is per-row transactionality + skip-on-unique-violation
-- (SQLSTATE 23505 on credential_cases_provider_group_payer_state_key
-- = skipped-existing).

CREATE OR REPLACE FUNCTION public.create_case_with_tasks(p_input jsonb, p_tasks jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := NULLIF(p_input->>'org_id','')::uuid;
  v_status uuid := NULLIF(p_input->>'credentialing_status_id','')::uuid;
  v_case public.credential_cases;
  v_task jsonb;
  v_task_id uuid;
  v_task_ids uuid[] := '{}';
  v_user uuid := auth.uid();
  v_user_name text;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'org_id is required';
  END IF;

  IF v_status IS NULL THEN
    SELECT id INTO v_status
    FROM public.status_configs
    WHERE org_id = v_org AND track = 'credentialing'
    ORDER BY sort_order ASC
    LIMIT 1;
    IF v_status IS NULL THEN
      RAISE EXCEPTION 'No credentialing status configured for this organization. Add at least one credentialing status before creating cases.';
    END IF;
  END IF;

  SELECT COALESCE(full_name, email) INTO v_user_name
  FROM public.profiles WHERE id = v_user;

  INSERT INTO public.credential_cases (
    org_id, provider_id, payer_id, state, group_id, facility_id, specialty,
    credentialing_status_id, mso_id, assigned_to,
    submitted_date, expected_effective_date, generation_run_id, created_by
  ) VALUES (
    v_org,
    NULLIF(p_input->>'provider_id','')::uuid,
    NULLIF(p_input->>'payer_id','')::uuid,
    p_input->>'state',
    NULLIF(p_input->>'group_id','')::uuid,
    NULLIF(p_input->>'facility_id','')::uuid,
    NULLIF(p_input->>'specialty',''),
    v_status,
    NULLIF(p_input->>'mso_id','')::uuid,
    NULLIF(p_input->>'assigned_to','')::uuid,
    NULLIF(p_input->>'submitted_date','')::date,
    NULLIF(p_input->>'expected_effective_date','')::date,
    NULLIF(p_input->>'generation_run_id','')::uuid,
    v_user
  )
  RETURNING * INTO v_case;

  INSERT INTO public.status_history (
    org_id, case_id, track, from_status_id, to_status_id, metadata, changed_by
  ) VALUES (
    v_org, v_case.id, 'credentialing', NULL, v_status, '{}'::jsonb, v_user
  );

  FOR v_task IN SELECT * FROM jsonb_array_elements(COALESCE(p_tasks, '[]'::jsonb)) LOOP
    INSERT INTO public.tasks (
      org_id, case_id, provider_id, title, description, sop_content,
      status, sort_order, due_date, is_auto_generated,
      sop_template_id, sop_version
    ) VALUES (
      v_org, v_case.id, v_case.provider_id,
      COALESCE(NULLIF(v_task->>'title',''), 'Task'),
      v_task->>'description',
      COALESCE(v_task->'sop_content', '[]'::jsonb),
      'not_started',
      COALESCE((v_task->>'sort_order')::int, 0),
      NULLIF(v_task->>'due_date','')::date,
      true,
      NULLIF(v_task->>'sop_template_id','')::uuid,
      NULLIF(v_task->>'sop_version','')::int
    )
    RETURNING id INTO v_task_id;
    v_task_ids := v_task_ids || v_task_id;
  END LOOP;

  INSERT INTO public.audit_log (
    org_id, user_id, user_name, action_type, entity_type, entity_id,
    before, after, description
  ) VALUES (
    v_org, v_user, v_user_name, 'CREATE', 'credential_case', v_case.id,
    NULL, to_jsonb(v_case), 'Created credentialing case'
  );

  IF COALESCE(array_length(v_task_ids, 1), 0) > 0 THEN
    INSERT INTO public.audit_log (
      org_id, user_id, user_name, action_type, entity_type, entity_id,
      before, after, description
    ) VALUES (
      v_org, v_user, v_user_name, 'CREATE', 'task', v_case.id,
      NULL,
      jsonb_build_object(
        'caseId', v_case.id,
        'count', array_length(v_task_ids, 1),
        'taskIds', to_jsonb(v_task_ids)
      ),
      'Auto-generated ' || array_length(v_task_ids, 1) || ' SOP task'
        || CASE WHEN array_length(v_task_ids, 1) = 1 THEN '' ELSE 's' END
        || ' for case'
    );
  END IF;

  RETURN to_jsonb(v_case);
END;
$function$
;
