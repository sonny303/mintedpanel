-- 20261015160000_provider_primary_case_location_defaults.sql
-- Provider primary location defaults for cases:
-- 1. Track explicitly cleared locations on cases via `locations_cleared` boolean.
-- 2. Reissue create_case_with_tasks to atomically resolve eligible default facility
--    and persist both credential_cases.facility_id and case_facilities join row,
--    while preserving case_type and immutable SOP version checks.
-- 3. Historical audited repair:
--    - Mark explicitly cleared cases from audit log evidence
--    - Normalize sole provider facility assignments to is_primary = true
--    - Repair missing case_facilities rows for cases with valid facility_id
--    - Default unassigned unconfigured cases with an eligible sole/primary facility

ALTER TABLE public.credential_cases
  ADD COLUMN IF NOT EXISTS locations_cleared boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_credential_cases_locations_cleared
  ON public.credential_cases (org_id, locations_cleared);

CREATE OR REPLACE FUNCTION public.create_case_with_tasks(p_input jsonb, p_tasks jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := NULLIF(p_input->>'org_id','')::uuid;
  v_status uuid := NULLIF(p_input->>'credentialing_status_id','')::uuid;
  v_provider uuid := NULLIF(p_input->>'provider_id','')::uuid;
  v_payer uuid := NULLIF(p_input->>'payer_id','')::uuid;
  v_group uuid := NULLIF(p_input->>'group_id','')::uuid;
  v_facility uuid := NULLIF(p_input->>'facility_id','')::uuid;
  v_eligible_count int;
  v_primary_fac_id uuid;
  v_sole_fac_id uuid;
  v_case public.credential_cases;
  v_case_facility_id uuid;
  v_task jsonb;
  v_task_id uuid;
  v_task_ids uuid[] := '{}';
  v_case_type text := coalesce(nullif(p_input->>'case_type', ''), 'enrollment');
  v_task_template_id uuid;
  v_task_version integer;
  v_stamp_template_id uuid;
  v_stamp_version integer;
  v_has_unstamped_task boolean := false;
  v_template public.sop_templates%ROWTYPE;
  v_version_case_type text;
  v_is_generic_fallback boolean;
  v_user uuid := auth.uid();
  v_user_name text;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'org_id is required'; END IF;
  IF v_case_type <> 'enrollment' THEN RAISE EXCEPTION 'provider_case_type_unsupported'; END IF;
  IF jsonb_typeof(coalesce(p_tasks, '[]'::jsonb)) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'case_tasks_invalid';
  END IF;

  FOR v_task IN SELECT value FROM jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb))
  LOOP
    v_task_template_id := nullif(v_task->>'sop_template_id', '')::uuid;
    v_task_version := nullif(v_task->>'sop_version', '')::integer;
    IF v_task_template_id IS NOT NULL THEN
      IF v_stamp_template_id IS NOT NULL
         AND (v_stamp_template_id IS DISTINCT FROM v_task_template_id
              OR v_stamp_version IS DISTINCT FROM v_task_version) THEN
        RAISE EXCEPTION 'case_sop_stamp_mixed';
      END IF;
      v_stamp_template_id := v_task_template_id;
      v_stamp_version := v_task_version;
      SELECT case_type INTO v_version_case_type
      FROM public.sop_template_versions
      WHERE template_id = v_task_template_id AND version = v_task_version;
      IF NOT FOUND THEN RAISE EXCEPTION 'case_sop_type_mismatch'; END IF;
      SELECT * INTO v_template FROM public.sop_templates WHERE id = v_task_template_id;
      v_is_generic_fallback := v_template.id = '00000000-0000-4000-a000-00000000e17b'::uuid
        AND v_template.org_id IS NULL AND v_template.payer_id IS NULL
        AND v_template.group_id IS NULL AND v_template.state IS NULL
        AND v_template.states IS NULL;
      IF NOT FOUND
         OR v_version_case_type IS DISTINCT FROM v_case_type
         OR v_template.case_type IS DISTINCT FROM v_case_type
         OR v_template.current_version IS DISTINCT FROM v_task_version
         OR v_template.archived
         OR (v_template.group_id IS NOT NULL
             AND v_template.group_id IS DISTINCT FROM nullif(p_input->>'group_id', '')::uuid)
         OR (NOT v_is_generic_fallback AND (
              v_template.payer_id IS DISTINCT FROM nullif(p_input->>'payer_id', '')::uuid
              OR NOT ((p_input->>'state') = ANY(coalesce(v_template.states, ARRAY[v_template.state]))
                      OR coalesce(v_template.states, ARRAY[v_template.state]) = ARRAY['All']::text[])
            ))
         OR (v_template.org_id IS NOT NULL AND v_template.org_id IS DISTINCT FROM v_org) THEN
        RAISE EXCEPTION 'case_sop_type_mismatch';
      END IF;
    ELSE
      v_has_unstamped_task := true;
    END IF;
  END LOOP;
  IF v_stamp_template_id IS NOT NULL AND v_has_unstamped_task THEN
    RAISE EXCEPTION 'case_sop_stamp_incomplete';
  END IF;

  IF v_status IS NULL THEN
    SELECT id INTO v_status
    FROM public.status_configs
    WHERE org_id = v_org AND track = 'credentialing'
    ORDER BY sort_order ASC LIMIT 1;
    IF v_status IS NULL THEN
      RAISE EXCEPTION 'No credentialing status configured for this organization. Add at least one credentialing status before creating cases.';
    END IF;
  END IF;
  SELECT COALESCE(full_name, email) INTO v_user_name
  FROM public.profiles WHERE id = v_user;

  -- Validate explicit facility_id if supplied
  IF v_facility IS NOT NULL AND v_provider IS NOT NULL AND v_group IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.facilities f
      JOIN public.provider_facility_assignments pfa
        ON pfa.facility_id = f.id AND pfa.provider_id = v_provider AND pfa.org_id = v_org
      WHERE f.id = v_facility AND f.org_id = v_org AND f.group_id = v_group AND f.is_active = true
    ) THEN
      v_facility := NULL;
    END IF;
  END IF;

  -- Resolve default facility if none supplied (or supplied choice was invalid)
  IF v_facility IS NULL AND v_provider IS NOT NULL AND v_group IS NOT NULL THEN
    SELECT count(f.id),
           (max(case when pfa.is_primary then f.id::text end))::uuid,
           (min(f.id::text))::uuid
    INTO v_eligible_count, v_primary_fac_id, v_sole_fac_id
    FROM public.facilities f
    JOIN public.provider_facility_assignments pfa
      ON pfa.facility_id = f.id AND pfa.provider_id = v_provider AND pfa.org_id = v_org
    WHERE f.group_id = v_group AND f.org_id = v_org AND f.is_active = true;

    IF v_eligible_count = 1 THEN
      v_facility := v_sole_fac_id;
    ELSIF v_eligible_count > 1 AND v_primary_fac_id IS NOT NULL THEN
      v_facility := v_primary_fac_id;
    ELSE
      v_facility := NULL;
    END IF;
  END IF;

  INSERT INTO public.credential_cases (
    org_id, provider_id, payer_id, state, group_id, facility_id, specialty,
    credentialing_status_id, mso_id, assigned_to, submitted_date,
    expected_effective_date, generation_run_id, created_by, case_type,
    locations_cleared
  ) VALUES (
    v_org,
    v_provider,
    v_payer,
    p_input->>'state',
    v_group,
    v_facility,
    NULLIF(p_input->>'specialty',''),
    v_status,
    NULLIF(p_input->>'mso_id','')::uuid,
    NULLIF(p_input->>'assigned_to','')::uuid,
    NULLIF(p_input->>'submitted_date','')::date,
    NULLIF(p_input->>'expected_effective_date','')::date,
    NULLIF(p_input->>'generation_run_id','')::uuid,
    v_user,
    v_case_type,
    false
  ) RETURNING * INTO v_case;

  -- Atomically persist primary case_facilities row if facility is stamped
  IF v_case.facility_id IS NOT NULL THEN
    INSERT INTO public.case_facilities (
      org_id, case_id, facility_id, is_primary, created_by
    ) VALUES (
      v_org, v_case.id, v_case.facility_id, true, v_user
    )
    ON CONFLICT (case_id, facility_id) DO UPDATE
      SET is_primary = true
    RETURNING id INTO v_case_facility_id;

    INSERT INTO public.audit_log (
      org_id, user_id, user_name, action_type, entity_type, entity_id,
      before, after, description
    ) VALUES (
      v_org, v_user, v_user_name, 'CREATE', 'case_facility', v_case_facility_id,
      null,
      jsonb_build_object('caseId', v_case.id, 'facilityId', v_case.facility_id, 'isPrimary', true),
      'Added case location (default primary location on create)'
    );
  END IF;

  INSERT INTO public.status_history
    (org_id, case_id, track, from_status_id, to_status_id, metadata, changed_by)
  VALUES (v_org, v_case.id, 'credentialing', NULL, v_status, '{}'::jsonb, v_user);
  INSERT INTO public.case_status_history
    (org_id, case_id, from_status, to_status, actor_kind, changed_by)
  VALUES (v_org, v_case.id, NULL, v_case.case_status, 'system', v_user);

  FOR v_task IN SELECT value FROM jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb))
  LOOP
    INSERT INTO public.tasks (
      org_id, case_id, provider_id, title, description, sop_content,
      status, sort_order, due_date, is_auto_generated, sop_template_id,
      sop_version, execution_type, sop_resolution_tier
    ) VALUES (
      v_org, v_case.id, v_case.provider_id,
      COALESCE(NULLIF(v_task->>'title',''), 'Task'), v_task->>'description',
      COALESCE(v_task->'sop_content', '[]'::jsonb), 'not_started',
      COALESCE((v_task->>'sort_order')::int, 0),
      NULLIF(v_task->>'due_date','')::date, true,
      NULLIF(v_task->>'sop_template_id','')::uuid,
      NULLIF(v_task->>'sop_version','')::int,
      NULLIF(v_task->>'execution_type',''),
      NULLIF(v_task->>'sop_resolution_tier','')
    ) RETURNING id INTO v_task_id;
    v_task_ids := v_task_ids || v_task_id;
  END LOOP;

  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id,
     before, after, description)
  VALUES (v_org, v_user, v_user_name, 'CREATE', 'credential_case', v_case.id,
          NULL, to_jsonb(v_case), 'Created credentialing case');
  IF coalesce(array_length(v_task_ids, 1), 0) > 0 THEN
    INSERT INTO public.audit_log
      (org_id, user_id, user_name, action_type, entity_type, entity_id,
       before, after, description)
    VALUES (
      v_org, v_user, v_user_name, 'CREATE', 'task', v_case.id, NULL,
      jsonb_build_object('caseId', v_case.id,
                         'count', array_length(v_task_ids, 1),
                         'taskIds', to_jsonb(v_task_ids)),
      'Auto-generated ' || array_length(v_task_ids, 1) || ' SOP task'
        || CASE WHEN array_length(v_task_ids, 1) = 1 THEN '' ELSE 's' END
        || ' for case'
    );
  END IF;
  RETURN to_jsonb(v_case);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_case_with_tasks(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_case_with_tasks(jsonb, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Historical data backfill and audited repair
-- ---------------------------------------------------------------------------

-- 1. Mark explicitly cleared cases based on historical audit log evidence
UPDATE public.credential_cases c
SET locations_cleared = true
WHERE c.facility_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.case_facilities cf WHERE cf.case_id = c.id)
  AND EXISTS (
    SELECT 1 FROM public.audit_log a
    WHERE (
      (a.entity_type = 'case_facility' AND a.action_type = 'DELETE' AND (a.before->>'caseId') = c.id::text)
      OR (a.entity_type = 'case' AND a.action_type = 'UPDATE' AND a.entity_id = c.id AND a.after->>'facilityId' IS NULL AND a.before->>'facilityId' IS NOT NULL)
    )
  );

-- 2. Normalize sole provider facility assignments to is_primary = true
WITH sole_assignments AS (
  SELECT pfa.id, pfa.org_id, pfa.provider_id, pfa.facility_id
  FROM public.provider_facility_assignments pfa
  WHERE pfa.provider_id IN (
    SELECT provider_id
    FROM public.provider_facility_assignments
    GROUP BY provider_id
    HAVING count(*) = 1 AND bool_or(is_primary) = false
  )
)
, updated_pfa AS (
  UPDATE public.provider_facility_assignments pfa
  SET is_primary = true
  FROM sole_assignments sa
  WHERE pfa.id = sa.id
  RETURNING pfa.id, pfa.org_id, pfa.provider_id, pfa.facility_id
)
INSERT INTO public.audit_log (
  org_id, action_type, entity_type, entity_id,
  before, after, description
)
SELECT
  up.org_id, 'UPDATE', 'provider_facility_assignment', up.id,
  jsonb_build_object('providerId', up.provider_id, 'facilityId', up.facility_id, 'isPrimary', false),
  jsonb_build_object('providerId', up.provider_id, 'facilityId', up.facility_id, 'isPrimary', true),
  'Promoted sole facility assignment to primary (normalization)'
FROM updated_pfa up;

-- 3. Repair missing case_facilities rows for cases with valid facility_id mirror
WITH missing_joins AS (
  SELECT c.id AS case_id, c.org_id, c.facility_id
  FROM public.credential_cases c
  JOIN public.facilities f ON f.id = c.facility_id AND f.org_id = c.org_id
  WHERE c.facility_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.case_facilities cf WHERE cf.case_id = c.id
    )
)
, inserted_joins AS (
  INSERT INTO public.case_facilities (org_id, case_id, facility_id, is_primary, created_by)
  SELECT mj.org_id, mj.case_id, mj.facility_id, true, NULL
  FROM missing_joins mj
  ON CONFLICT (case_id, facility_id) DO UPDATE SET is_primary = true
  RETURNING id, org_id, case_id, facility_id
)
INSERT INTO public.audit_log (
  org_id, action_type, entity_type, entity_id,
  before, after, description
)
SELECT
  ij.org_id, 'CREATE', 'case_facility', ij.id,
  null,
  jsonb_build_object('caseId', ij.case_id, 'facilityId', ij.facility_id, 'isPrimary', true),
  'Repaired missing case_facilities row from case facility_id mirror'
FROM inserted_joins ij;

-- 4. Default unassigned, unconfigured cases that have a single or primary eligible facility
WITH eligible_defaults AS (
  SELECT
    c.id AS case_id,
    c.org_id,
    CASE
      WHEN count(f.id) = 1 THEN (min(f.id::text))::uuid
      WHEN count(f.id) > 1 AND count(f.id) FILTER (WHERE pfa.is_primary) = 1
        THEN (min(f.id::text) FILTER (WHERE pfa.is_primary))::uuid
      ELSE NULL
    END AS default_facility_id
  FROM public.credential_cases c
  JOIN public.facilities f ON f.group_id = c.group_id AND f.org_id = c.org_id AND f.is_active = true
  JOIN public.provider_facility_assignments pfa
    ON pfa.facility_id = f.id AND pfa.provider_id = c.provider_id AND pfa.org_id = c.org_id
  WHERE c.facility_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.case_facilities cf WHERE cf.case_id = c.id)
    AND c.locations_cleared = false
  GROUP BY c.id, c.org_id
)
, resolved_cases AS (
  SELECT case_id, org_id, default_facility_id
  FROM eligible_defaults
  WHERE default_facility_id IS NOT NULL
)
, updated_cases AS (
  UPDATE public.credential_cases c
  SET facility_id = rc.default_facility_id
  FROM resolved_cases rc
  WHERE c.id = rc.case_id
  RETURNING c.id, c.org_id, c.facility_id
)
, inserted_case_facs AS (
  INSERT INTO public.case_facilities (org_id, case_id, facility_id, is_primary, created_by)
  SELECT rc.org_id, rc.case_id, rc.default_facility_id, true, NULL
  FROM resolved_cases rc
  ON CONFLICT (case_id, facility_id) DO UPDATE SET is_primary = true
  RETURNING id, org_id, case_id, facility_id
)
INSERT INTO public.audit_log (
  org_id, action_type, entity_type, entity_id,
  before, after, description
)
SELECT
  icf.org_id, 'CREATE', 'case_facility', icf.id,
  null,
  jsonb_build_object('caseId', icf.case_id, 'facilityId', icf.facility_id, 'isPrimary', true),
  'Defaulted case location from provider eligible primary assignment'
FROM inserted_case_facs icf;
