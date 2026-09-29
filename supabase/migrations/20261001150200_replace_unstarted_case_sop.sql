-- Change the SOP on a case before its generated checklist has been worked.
-- The selected head and task replacement are committed together. Activity
-- linked to the old tasks blocks replacement, preserving its references.
CREATE FUNCTION public.replace_unstarted_case_sop(
  p_org_id uuid,
  p_case_id uuid,
  p_template_id uuid,
  p_expected_version integer,
  p_tasks jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_case public.credential_cases%ROWTYPE;
  v_template public.sop_templates%ROWTYPE;
  v_old_count integer;
  v_old_template_id uuid;
  v_old_version integer;
  v_row jsonb;
  v_user_name text;
BEGIN
  IF auth.uid() IS NULL
     OR p_org_id IS NULL
     OR p_org_id NOT IN (SELECT user_org_ids())
     OR coalesce(user_role(p_org_id), '') NOT IN ('specialist', 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_case
  FROM public.credential_cases
  WHERE id = p_case_id AND org_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Case not found'; END IF;
  IF v_case.case_status NOT IN ('not_started', 'in_progress') THEN
    RAISE EXCEPTION 'case_sop_change_unavailable';
  END IF;

  SELECT * INTO v_template
  FROM public.sop_templates
  WHERE id = p_template_id AND (org_id = p_org_id OR org_id IS NULL)
  FOR SHARE;
  IF NOT FOUND OR v_template.archived
     OR v_template.payer_id IS DISTINCT FROM v_case.payer_id
     OR (v_template.group_id IS NOT NULL AND v_template.group_id IS DISTINCT FROM v_case.group_id)
     OR NOT (v_case.state = ANY(coalesce(v_template.states, ARRAY[v_template.state]))
                 OR coalesce(v_template.states, ARRAY[v_template.state]) = ARRAY['All']::text[])
     OR v_template.current_version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'case_sop_template_ineligible';
  END IF;

  IF jsonb_typeof(p_tasks) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'case_sop_tasks_invalid';
  END IF;
  IF jsonb_array_length(p_tasks) <> jsonb_array_length(coalesce(v_template.task_definitions, '[]'::jsonb)) THEN
    RAISE EXCEPTION 'case_sop_tasks_invalid';
  END IF;

  -- Lock all case tasks while checking. A manual task, progress, an attachment,
  -- or a task-linked touch means the old checklist is already in use.
  PERFORM 1 FROM public.tasks
  WHERE case_id = p_case_id AND org_id = p_org_id FOR UPDATE;
  SELECT count(*) INTO v_old_count FROM public.tasks
  WHERE case_id = p_case_id AND org_id = p_org_id;
  SELECT sop_template_id, sop_version INTO v_old_template_id, v_old_version
  FROM public.tasks
  WHERE case_id = p_case_id AND org_id = p_org_id
  ORDER BY created_at, id LIMIT 1;
  IF EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.case_id = p_case_id AND t.org_id = p_org_id
      AND (NOT coalesce(t.is_auto_generated, false)
        OR t.status <> 'not_started'
        OR t.completed_date IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(t.sop_content, '[]'::jsonb)) step
          WHERE coalesce((step->>'isCompleted')::boolean, false)
             OR coalesce(jsonb_array_length(coalesce(step->'attachments', '[]'::jsonb)), 0) > 0
        )
        OR EXISTS (
          SELECT 1 FROM public.touches touch
          WHERE touch.org_id = p_org_id AND touch.task_id = t.id
        ))
  ) THEN
    RAISE EXCEPTION 'case_sop_tasks_started';
  END IF;

  DELETE FROM public.tasks
  WHERE case_id = p_case_id AND org_id = p_org_id;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_tasks)
  LOOP
    IF nullif(btrim(v_row->>'title'), '') IS NULL
       OR jsonb_typeof(v_row->'sop_content') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'case_sop_tasks_invalid';
    END IF;
    INSERT INTO public.tasks (
      org_id, case_id, provider_id, title, description, sop_content,
      status, sort_order, due_date, is_auto_generated, sop_template_id,
      sop_version, execution_type, sop_resolution_tier
    ) VALUES (
      p_org_id, p_case_id, v_case.provider_id, v_row->>'title',
      v_row->>'description', v_row->'sop_content', 'not_started',
      (v_row->>'sort_order')::integer, (v_row->>'due_date')::date, true,
      v_template.id, v_template.current_version,
      nullif(v_row->>'execution_type', ''),
      CASE WHEN v_template.org_id IS NOT NULL THEN 'organization'
           ELSE 'global_payer' END
    );
  END LOOP;

  SELECT coalesce(full_name, email) INTO v_user_name
  FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id,
     description, before, after)
  VALUES
    (p_org_id, auth.uid(), v_user_name, 'UPDATE', 'credential_case', p_case_id,
     'Changed case SOP template',
     jsonb_build_object('sop_template_id', v_old_template_id,
                        'sop_version', v_old_version,
                        'replaced_task_count', v_old_count),
     jsonb_build_object('sop_template_id', v_template.id,
                        'sop_version', v_template.current_version,
                        'task_count', jsonb_array_length(p_tasks)));
  RETURN jsonb_array_length(p_tasks);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_unstarted_case_sop(uuid, uuid, uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_unstarted_case_sop(uuid, uuid, uuid, integer, jsonb) TO authenticated, service_role;
