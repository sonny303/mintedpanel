-- E6.0 F6.0.2 — the evidence-based AUTO transitions: the system sets only
-- what it witnessed, attributed 'system' in history, with zero user action:
--   * case creation           → not_started (create_case_with_tasks reissue)
--   * first recorded work     → in_progress (a touchpoint, a task
--                               completion, or a real fill event)
--   * extension-logged
--     submission touch        → submitted (source='extension',
--                               outcome='submitted' — the human submitted in
--                               the portal tab and the extension logged it)
-- A manual fax/mail submission is NEVER auto-flipped — the Add-touch flow
-- offers the bump instead (F6.0.3); the human is the evidence.
--
-- REPO-ONLY: hosted apply is an operator step (E6.0 PR body), after 120100.
--
-- Triggers (not service code) so EVERY write path carries the evidence rule —
-- the browser services, the /api extension endpoints (service-role), and any
-- future writer — with zero /api and zero extension change. The helper and
-- trigger functions are SECURITY DEFINER with a pinned search_path so a
-- legitimate evidence write never fails on the writer's row grants; the
-- surrounding INSERT itself is still gated by the caller's own RLS.

-- The shared apply step: flip + mirror + history, no-op when the case is
-- already past the target. Mirrors set_case_status's shim (see 120100).
CREATE OR REPLACE FUNCTION public._apply_case_status_auto(
  p_case_id uuid,
  p_to_status text,
  p_evidence_touch_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_case public.credential_cases;
  v_from text;
  v_mirror_label text;
  v_mirror_status uuid;
  v_mirror_pipeline text;
BEGIN
  SELECT * INTO v_case FROM public.credential_cases WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_from := v_case.case_status;

  -- AUTO only ever moves forward from the two pre-submission states; anything
  -- else was set by a person (or a prior auto flip) and stands.
  IF p_to_status = 'in_progress' AND v_from <> 'not_started' THEN
    RETURN;
  END IF;
  IF p_to_status = 'submitted' AND v_from NOT IN ('not_started', 'in_progress') THEN
    RETURN;
  END IF;

  v_mirror_label := CASE p_to_status
    WHEN 'in_progress' THEN 'In Progress'
    WHEN 'submitted' THEN 'Submitted'
  END;
  SELECT id INTO v_mirror_status FROM public.status_configs
    WHERE org_id = v_case.org_id AND track = 'credentialing' AND label = v_mirror_label
    ORDER BY sort_order ASC LIMIT 1;
  v_mirror_pipeline := CASE p_to_status
    WHEN 'in_progress' THEN 'drafting'
    WHEN 'submitted' THEN 'submitted'
  END;

  UPDATE public.credential_cases
    SET case_status = p_to_status,
        credentialing_status_id = COALESCE(v_mirror_status, credentialing_status_id),
        payer_pipeline_state = v_mirror_pipeline,
        submitted_date = CASE
          WHEN p_to_status = 'submitted' THEN COALESCE(submitted_date, CURRENT_DATE)
          ELSE submitted_date END,
        updated_at = now()
    WHERE id = p_case_id;

  INSERT INTO public.case_status_history (
    org_id, case_id, from_status, to_status, actor_kind, evidence_touch_id, changed_by
  ) VALUES (
    v_case.org_id, p_case_id, v_from, p_to_status, 'system', p_evidence_touch_id, auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public._apply_case_status_auto(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._apply_case_status_auto(uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._apply_case_status_auto(uuid, text, uuid) FROM authenticated;

-- A logged touchpoint is recorded work; an extension-logged submission touch
-- is THE submission evidence.
CREATE OR REPLACE FUNCTION public.case_status_on_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.case_id IS NULL OR NEW.entry_type IS DISTINCT FROM 'touchpoint' THEN
    RETURN NEW;
  END IF;
  IF NEW.source = 'extension' AND NEW.outcome = 'submitted' THEN
    PERFORM public._apply_case_status_auto(NEW.case_id, 'submitted', NEW.id);
  ELSE
    PERFORM public._apply_case_status_auto(NEW.case_id, 'in_progress', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_case_status_on_touch ON public.touches;
CREATE TRIGGER trg_case_status_on_touch
  AFTER INSERT ON public.touches
  FOR EACH ROW
  EXECUTE FUNCTION public.case_status_on_touch();

-- Completing a case task is recorded work.
CREATE OR REPLACE FUNCTION public.case_status_on_task_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.case_id IS NOT NULL
     AND NEW.status = 'completed'
     AND OLD.status IS DISTINCT FROM 'completed' THEN
    PERFORM public._apply_case_status_auto(NEW.case_id, 'in_progress', NULL);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_case_status_on_task_complete ON public.tasks;
CREATE TRIGGER trg_case_status_on_task_complete
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.case_status_on_task_complete();

-- A real (non-test) fill event against the case is recorded work. E4.2 dry
-- runs (is_test) never touch a live portal and never count.
CREATE OR REPLACE FUNCTION public.case_status_on_fill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.case_id IS NOT NULL AND COALESCE(NEW.is_test, false) = false THEN
    PERFORM public._apply_case_status_auto(NEW.case_id, 'in_progress', NULL);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_case_status_on_fill ON public.fill_sessions;
CREATE TRIGGER trg_case_status_on_fill
  AFTER INSERT ON public.fill_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.case_status_on_fill();

-- create_case_with_tasks reissue: creation → not_started, witnessed by the
-- system — the new case's first unified-history row is written in the same
-- transaction. Signature and every existing behavior unchanged (the E4.2
-- sop_resolution_tier body + one INSERT); the column default supplies
-- case_status = 'not_started'.
create or replace function public.create_case_with_tasks(p_input jsonb, p_tasks jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
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

  -- E6.0: creation is the first witnessed evidence — the unified ledger's
  -- first row, attributed system.
  INSERT INTO public.case_status_history (
    org_id, case_id, from_status, to_status, actor_kind, changed_by
  ) VALUES (
    v_org, v_case.id, NULL, v_case.case_status, 'system', v_user
  );

  FOR v_task IN SELECT * FROM jsonb_array_elements(COALESCE(p_tasks, '[]'::jsonb)) LOOP
    INSERT INTO public.tasks (
      org_id, case_id, provider_id, title, description, sop_content,
      status, sort_order, due_date, is_auto_generated,
      sop_template_id, sop_version, execution_type, sop_resolution_tier
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
      NULLIF(v_task->>'sop_version','')::int,
      NULLIF(v_task->>'execution_type',''),
      NULLIF(v_task->>'sop_resolution_tier','')
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
$function$;
