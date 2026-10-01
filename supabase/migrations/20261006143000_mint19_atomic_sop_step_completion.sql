-- MINT-19: complete one SOP step, roll task/case state forward, and audit it
-- in one transaction. The task row lock serializes competing step completions
-- so separate clients cannot overwrite one another's sop_content changes.

CREATE OR REPLACE FUNCTION public.complete_sop_task_step(
  p_org_id uuid,
  p_task_id uuid,
  p_step_id text,
  p_actor_id uuid,
  p_source text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_task public.tasks%ROWTYPE;
  v_case public.credential_cases%ROWTYPE;
  v_steps jsonb;
  v_target jsonb;
  v_target_order numeric;
  v_blocked_label text;
  v_next_steps jsonb;
  v_all_done boolean;
  v_next_status text;
  v_completed_date date;
  v_now timestamptz;
  v_user_name text;
BEGIN
  IF p_step_id IS NULL OR pg_catalog.btrim(p_step_id) = '' THEN
    RETURN pg_catalog.jsonb_build_object(
      'kind', 'rejected', 'status', 422, 'message', 'stepId is required'
    );
  END IF;

  IF p_source IS NULL OR p_source NOT IN ('panel', 'extension') THEN
    RETURN pg_catalog.jsonb_build_object(
      'kind', 'rejected', 'status', 422, 'message', 'source must be panel or extension'
    );
  END IF;

  IF p_org_id IS NULL OR p_task_id IS NULL OR p_actor_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'kind', 'rejected', 'status', 404, 'message', 'Task not found'
    );
  END IF;

  -- Browser calls run as authenticated and must bind attribution to auth.uid.
  -- The extension server uses its service-role client only after JWT and org
  -- membership resolution in the API guard; membership is rechecked below.
  IF current_user = 'authenticated' THEN
    IF auth.uid() IS NULL OR auth.uid() <> p_actor_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'kind', 'rejected', 'status', 403, 'message', 'Actor does not match the authenticated user'
      );
    END IF;
  ELSIF current_user <> 'service_role' THEN
    RETURN pg_catalog.jsonb_build_object(
      'kind', 'rejected', 'status', 403, 'message', 'Caller role cannot complete SOP steps'
    );
  END IF;

  -- Do not rely on p_org_id supplied by the caller. This membership check is
  -- explicit for both authenticated/RLS callers and the API's service client.
  SELECT m.role
    INTO v_role
    FROM public.memberships AS m
   WHERE m.org_id = p_org_id
     AND m.user_id = p_actor_id;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'kind', 'rejected', 'status', 404, 'message', 'Task not found'
    );
  END IF;

  IF v_role NOT IN ('specialist', 'admin') THEN
    RETURN pg_catalog.jsonb_build_object(
      'kind', 'rejected', 'status', 403, 'message', 'Your role cannot complete task steps'
    );
  END IF;

  -- Lock before reading sop_content. Concurrent callers now plan from the
  -- preceding committed version after waiting for this row lock.
  SELECT t.*
    INTO v_task
    FROM public.tasks AS t
   WHERE t.id = p_task_id
     AND t.org_id = p_org_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'kind', 'rejected', 'status', 404, 'message', 'Task not found'
    );
  END IF;

  -- A task may reference a case only in its own organization. Fail closed on
  -- corrupt historical cross-org links before changing any state.
  IF v_task.case_id IS NOT NULL THEN
    SELECT c.*
      INTO v_case
      FROM public.credential_cases AS c
     WHERE c.id = v_task.case_id
       AND c.org_id = p_org_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object(
        'kind', 'rejected', 'status', 409, 'message', 'Task case organization does not match'
      );
    END IF;
  END IF;

  v_steps := CASE
    WHEN pg_catalog.jsonb_typeof(v_task.sop_content) = 'array' THEN v_task.sop_content
    ELSE '[]'::jsonb
  END;

  SELECT s.step
    INTO v_target
    FROM pg_catalog.jsonb_array_elements(v_steps) WITH ORDINALITY AS s(step, ordinal)
   WHERE s.step ->> 'id' = p_step_id
   ORDER BY s.ordinal
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'kind', 'rejected', 'status', 404, 'message', 'Step not found on task'
    );
  END IF;

  -- Repeating the same completed step is a successful no-op. In particular,
  -- it does not append another audit event.
  IF v_target ->> 'isCompleted' = 'true' THEN
    SELECT COALESCE(
             pg_catalog.bool_and(s.step ->> 'isCompleted' = 'true'),
             true
           )
      INTO v_all_done
      FROM pg_catalog.jsonb_array_elements(v_steps) AS s(step);

    RETURN pg_catalog.jsonb_build_object(
      'kind', 'ok', 'task', pg_catalog.to_jsonb(v_task), 'allDone', v_all_done
    );
  END IF;

  v_target_order := CASE
    WHEN pg_catalog.jsonb_typeof(v_target -> 'order') = 'number'
      THEN (v_target ->> 'order')::numeric
    ELSE NULL
  END;

  SELECT COALESCE(NULLIF(s.step ->> 'label', ''), 'an earlier step')
    INTO v_blocked_label
    FROM pg_catalog.jsonb_array_elements(v_steps) AS s(step)
   WHERE v_target_order IS NOT NULL
     AND pg_catalog.jsonb_typeof(s.step -> 'order') = 'number'
     AND (s.step ->> 'order')::numeric < v_target_order
     AND s.step ->> 'isCompleted' IS DISTINCT FROM 'true'
   ORDER BY (s.step ->> 'order')::numeric
   LIMIT 1;

  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'kind', 'rejected',
      'status', 409,
      'message', 'Complete "' || v_blocked_label || '" first'
    );
  END IF;

  v_now := pg_catalog.clock_timestamp();
  SELECT pg_catalog.jsonb_agg(
           CASE
             WHEN s.step ->> 'id' = p_step_id THEN
               s.step || pg_catalog.jsonb_build_object(
                 'isCompleted', true,
                 'completedAt', pg_catalog.to_char(
                   v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                 ),
                 'completedBy', p_actor_id
               )
             ELSE s.step
           END
           ORDER BY s.ordinal
         )
    INTO v_next_steps
    FROM pg_catalog.jsonb_array_elements(v_steps) WITH ORDINALITY AS s(step, ordinal);
  v_next_steps := COALESCE(v_next_steps, '[]'::jsonb);

  SELECT COALESCE(
           pg_catalog.bool_and(s.step ->> 'isCompleted' = 'true'),
           true
         )
    INTO v_all_done
    FROM pg_catalog.jsonb_array_elements(v_next_steps) AS s(step);

  v_next_status := CASE
    WHEN v_all_done THEN 'completed'
    WHEN v_task.status = 'not_started' THEN 'in_progress'
    ELSE v_task.status
  END;
  v_completed_date := CASE
    WHEN v_all_done THEN (v_now AT TIME ZONE 'UTC')::date
    ELSE v_task.completed_date
  END;

  UPDATE public.tasks AS t
     SET sop_content = v_next_steps,
         status = v_next_status,
         completed_date = v_completed_date,
         updated_at = v_now
   WHERE t.id = p_task_id
     AND t.org_id = p_org_id
   RETURNING t.* INTO v_task;

  IF v_all_done
     AND v_task.case_id IS NOT NULL
     AND pg_catalog.lower(v_task.title) LIKE 'submit termination%' THEN
    UPDATE public.credential_cases AS c
       SET termination_date = COALESCE(c.termination_date, (v_now AT TIME ZONE 'UTC')::date)
     WHERE c.id = v_task.case_id
       AND c.org_id = p_org_id
       AND c.termination_date IS NULL;
  END IF;

  -- MINT-8's audit actor trigger verifies authenticated attribution. Under
  -- service_role, retain the actor and profile name supplied by this verified
  -- API operation. Any insert error aborts task and case updates as one unit.
  SELECT COALESCE(NULLIF(pg_catalog.btrim(p.full_name), ''), p.email)
    INTO v_user_name
    FROM public.profiles AS p
   WHERE p.id = p_actor_id;

  INSERT INTO public.audit_log (
    org_id, user_id, user_name, action_type, entity_type, entity_id,
    before, after, description
  ) VALUES (
    p_org_id,
    p_actor_id,
    v_user_name,
    'UPDATE',
    'task',
    p_task_id,
    pg_catalog.jsonb_build_object('stepId', p_step_id, 'isCompleted', false),
    pg_catalog.jsonb_build_object(
      'stepId', p_step_id,
      'isCompleted', true,
      'taskStatus', v_task.status,
      'source', p_source
    ),
    'Completed SOP step "' || COALESCE(v_target ->> 'label', p_step_id) || '"'
  );

  RETURN pg_catalog.jsonb_build_object(
    'kind', 'ok', 'task', pg_catalog.to_jsonb(v_task), 'allDone', v_all_done
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_sop_task_step(uuid, uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_sop_task_step(uuid, uuid, text, uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.complete_sop_task_step(uuid, uuid, text, uuid, text)
  IS 'Atomically completes one ordered SOP step, updates its task and optional termination case, and appends one verified audit event.';

NOTIFY pgrst, 'reload schema';
