-- E4.2 SOP resolution hardening — deterministic template selection provenance
-- + an active-org uniqueness backstop. All additive; no existing data is
-- deleted, rewritten, or archived (the PM constraint). Repo + hosted.
--
-- 1) tasks.sop_resolution_tier — the deterministic tier the SOP was selected at
--    (organization | global_payer | generic_fallback). Stamped so a MANUAL case
--    (no generation run) stays directly tier-reportable without reconstructing
--    the tier from mutable template ownership. Independent of the existing
--    both-or-neither (sop_template_id, sop_version) stamp; nullable ⇒ legacy /
--    non-SOP task.
alter table public.tasks
  add column if not exists sop_resolution_tier text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_sop_resolution_tier_check'
  ) then
    alter table public.tasks
      add constraint tasks_sop_resolution_tier_check
      check (sop_resolution_tier is null
             or sop_resolution_tier in ('organization','global_payer','generic_fallback'));
  end if;
end $$;

-- 2) case_generation_run_rows — the resolution provenance for a `created` row
--    (which SOP resolved, at which version, at which tier). A confirm-time
--    SNAPSHOT on the immutable ledger (like `reason`) — plain columns, no FK, so
--    the ledger is never mutated by a downstream template change. NULL for
--    skipped_existing/excluded/failed rows (no SOP resolved).
alter table public.case_generation_run_rows
  add column if not exists sop_template_id uuid;
alter table public.case_generation_run_rows
  add column if not exists sop_version integer;
alter table public.case_generation_run_rows
  add column if not exists sop_resolution_tier text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'case_generation_run_rows_sop_resolution_tier_check'
  ) then
    alter table public.case_generation_run_rows
      add constraint case_generation_run_rows_sop_resolution_tier_check
      check (sop_resolution_tier is null
             or sop_resolution_tier in ('organization','global_payer','generic_fallback'));
  end if;
end $$;

-- 3) Active-org uniqueness at the SUPPORTED match grain
--    (org_id, payer_id, state, group_id) with NULLS NOT DISTINCT so two
--    any-group (group_id NULL) templates for the same (org, payer, state)
--    collide. Scoped to ACTIVE ORG templates that carry a payer AND state — the
--    only rows the runtime deterministically resolves. Global rows (org_id
--    NULL), archived rows, and legacy payer/state-less rows are deliberately
--    outside the constraint, so existing data is untouched. Live data verified
--    duplicate-free at this grain before adding the index.
create unique index if not exists uq_sop_templates_active_org_match
  on public.sop_templates (org_id, payer_id, state, group_id)
  nulls not distinct
  where org_id is not null and payer_id is not null and state is not null and archived = false;

-- 4) create_case_with_tasks — thread the per-task sop_resolution_tier stamp.
--    Additive: each p_tasks element may carry `sop_resolution_tier`;
--    NULL/absent is stored as-is. Signature identical to the E4.2 execution-type
--    version (20260715140600), so this is an in-place CREATE OR REPLACE.
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
