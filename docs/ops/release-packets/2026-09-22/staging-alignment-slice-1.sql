-- AUTHOR-ONLY staging alignment packet; never run against production.
-- Required session settings are external so the identity guard cannot self-pass:
--   SET minted.release_target_kind = 'hosted_staging';
--   SET minted.release_project_ref = 'vmznysvietfaddakkegt';
--   SET minted.release_source_sha = '7a40fc7876c4b53810e1391426afbed865176c3b';
-- A local adapter may use qualified_local_restore only after independently
-- checking current_database=minted_recovery, the exact qualified receipt and
-- its pg_control_system identifier, then setting restore_* session values.
-- This is additive/reconciliation SQL for a qualified restore, not a migration.

BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(hashtextextended('mintedpanel:staging-alignment:slice-1', 0));

DO $guard$
DECLARE target_kind text := current_setting('minted.release_target_kind', true);
  actual_system_identifier bigint;
BEGIN
  IF target_kind = 'hosted_staging' THEN
    IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'ALIGNMENT_HOSTED_DATABASE_REJECTED'; END IF;
    BEGIN
      SELECT system_identifier INTO actual_system_identifier
      FROM pg_catalog.pg_control_system();
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'ALIGNMENT_HOSTED_SYSTEM_ID_UNAVAILABLE';
    END;
    IF actual_system_identifier IS DISTINCT FROM 7662742571317219726::bigint THEN
      RAISE EXCEPTION 'ALIGNMENT_HOSTED_SYSTEM_ID_REJECTED';
    END IF;
  ELSIF target_kind = 'qualified_local_restore' THEN
    IF current_database() <> 'minted_recovery'
       OR current_setting('minted.restore_status', true) IS DISTINCT FROM 'LOCAL_APPLICATION_BASELINE_VERIFIED'
       OR current_setting('minted.restore_receipt_id', true) IS NULL
       OR current_setting('minted.restore_receipt_id', true) !~ '^[a-f0-9]{16}$'
       OR current_setting('minted.restore_capture_digest', true) IS DISTINCT FROM 'efe2bdaecddf7e3ea83d0afd42110e775c637e867f06499e75537b89f66da4a5'
       OR current_setting('minted.restore_system_identifier', true) IS DISTINCT FROM '7688850032395546663'
       OR current_setting('minted.restore_system_identifier', true) !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'ALIGNMENT_LOCAL_RECEIPT_REJECTED';
    END IF;
    BEGIN
      SELECT system_identifier INTO actual_system_identifier
      FROM pg_catalog.pg_control_system();
    EXCEPTION
      WHEN undefined_function OR insufficient_privilege THEN
        RAISE EXCEPTION 'ALIGNMENT_LOCAL_SYSTEM_ID_UNAVAILABLE';
    END;
    IF actual_system_identifier IS DISTINCT FROM current_setting('minted.restore_system_identifier')::bigint THEN
      RAISE EXCEPTION 'ALIGNMENT_LOCAL_SYSTEM_ID_REJECTED';
    END IF;
  ELSE
    RAISE EXCEPTION 'ALIGNMENT_TARGET_KIND_REJECTED';
  END IF;
  IF current_setting('minted.release_project_ref', true) IS DISTINCT FROM 'vmznysvietfaddakkegt'
     OR current_setting('minted.release_source_sha', true) IS DISTINCT FROM '7a40fc7876c4b53810e1391426afbed865176c3b' THEN
    RAISE EXCEPTION 'ALIGNMENT_IDENTITY_REJECTED';
  END IF;
  IF current_setting('transaction_read_only') = 'on' THEN
    RAISE EXCEPTION 'ALIGNMENT_READ_ONLY_SESSION';
  END IF;
  IF to_regclass('public.portal_field_maps_aetna_backup_20260904') IS NOT NULL
     OR to_regclass('public.portal_field_maps_aetna_direct_backup_20260812') IS NOT NULL
     OR to_regclass('public.portals_aetna_backup_20260904') IS NOT NULL THEN
    RAISE EXCEPTION 'ALIGNMENT_OPERATOR_BACKUP_PRESENT';
  END IF;
END
$guard$;
-- Source checksums are in staging-alignment-slices-1-4-manifest.json.
-- Slice 1 adds canonical case status/history; set_case_status is deferred to slice 2.
DO $prestate$
BEGIN
  IF (SELECT count(*) FROM public.credential_cases) <> 65 THEN RAISE EXCEPTION 'ALIGNMENT_CASE_COUNT_DRIFT'; END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND ((table_name='payers' AND column_name IN ('provisional_billing_allowed','provisional_billing_notes','retro_billing_allowed','retro_billing_window_days','caqh_pull_deadline_days','provider_type_path','prior_auth_vendor','payer_billing_id','portal_url','cms_hios_id','prerequisite_payer_id')) OR (table_name='credential_cases' AND column_name='payer_provider_id'))) <> 12 THEN RAISE EXCEPTION 'ALIGNMENT_LEGACY_COLUMN_DRIFT'; END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='payers' AND column_name IN ('resolution_id_label','resolution_id_expected')) <> 2 THEN RAISE EXCEPTION 'ALIGNMENT_LEGACY_PAYER_ID_COLUMNS_DRIFT'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credential_cases' AND column_name IN ('case_status','contract_executed_date'))
     OR to_regclass('public.case_status_history') IS NOT NULL THEN RAISE EXCEPTION 'ALIGNMENT_SLICE_1_ALREADY_APPLIED'; END IF;
  IF (SELECT count(*) FROM public.credential_cases c WHERE c.payer_pipeline_state NOT IN ('not_started','assigned','drafting','submitted','in_review','action_required','approved','denied','oon')) <> 0
     OR (SELECT count(*) FROM public.credential_cases c WHERE c.credentialing_status_id IS NOT NULL AND coalesce((SELECT s.label FROM public.status_configs s WHERE s.id=c.credentialing_status_id),'') NOT IN ('Not Started','In Progress','Waiting on Provider','Submitted','Approved','In-Network','Denied','OON','Not Required')) <> 0 THEN RAISE EXCEPTION 'ALIGNMENT_CASE_STATUS_INPUT_DRIFT'; END IF;
  IF (SELECT count(*) FROM public.credential_cases c JOIN public.contracts ct ON ct.org_id=c.org_id AND ct.group_id=c.group_id AND ct.payer_id=c.payer_id AND ct.state=c.state WHERE c.payer_pipeline_state='approved' AND c.confirmed_effective_date IS NULL AND ct.effective_date IS NOT NULL) <> 0 THEN RAISE EXCEPTION 'ALIGNMENT_EFFECTIVE_DATE_AMBIGUITY'; END IF;
  IF to_regclass('pg_temp.minted_alignment_case_guard') IS NOT NULL
     OR to_regclass('pg_temp.minted_alignment_case_status_guard') IS NOT NULL THEN RAISE EXCEPTION 'ALIGNMENT_CASE_GUARD_ALREADY_EXISTS'; END IF;
END
$prestate$;

CREATE TEMP TABLE pg_temp.minted_alignment_case_guard ON COMMIT PRESERVE ROWS AS
SELECT c.id, c.facility_id, md5((to_jsonb(c) - ARRAY['case_status','contract_executed_date','case_number'])::text) AS legacy_digest
FROM public.credential_cases c;

CREATE TEMP TABLE pg_temp.minted_alignment_case_status_guard ON COMMIT PRESERVE ROWS AS
SELECT c.id,
  CASE
    WHEN c.payer_pipeline_state IN ('assigned','drafting') THEN 'in_progress'
    WHEN c.payer_pipeline_state='submitted' THEN 'submitted'
    WHEN c.payer_pipeline_state='in_review' THEN 'in_review'
    WHEN c.payer_pipeline_state='action_required' THEN 'action_required'
    WHEN c.payer_pipeline_state='approved' THEN 'approved'
    WHEN c.payer_pipeline_state='denied' THEN 'denied'
    WHEN c.payer_pipeline_state='oon' THEN 'not_pursuing'
    ELSE CASE COALESCE((SELECT s.label FROM public.status_configs s WHERE s.id=c.credentialing_status_id),'')
      WHEN 'In Progress' THEN 'in_progress' WHEN 'Waiting on Provider' THEN 'in_progress'
      WHEN 'Submitted' THEN 'submitted' WHEN 'Approved' THEN 'approved' WHEN 'In-Network' THEN 'approved'
      WHEN 'Denied' THEN 'denied' WHEN 'OON' THEN 'not_pursuing' WHEN 'Not Required' THEN 'not_pursuing'
      ELSE 'not_started' END
  END AS mapped_status
FROM public.credential_cases c;

DO $mapping_prestate$
BEGIN
  IF (SELECT count(*) FROM pg_temp.minted_alignment_case_status_guard WHERE mapped_status='submitted')<>32
     OR (SELECT count(*) FROM pg_temp.minted_alignment_case_status_guard WHERE mapped_status='approved')<>14
     OR (SELECT count(*) FROM pg_temp.minted_alignment_case_status_guard WHERE mapped_status='not_started')<>12
     OR (SELECT count(*) FROM pg_temp.minted_alignment_case_status_guard WHERE mapped_status='in_progress')<>3
     OR (SELECT count(*) FROM pg_temp.minted_alignment_case_status_guard WHERE mapped_status='not_pursuing')<>2
     OR (SELECT count(*) FROM pg_temp.minted_alignment_case_status_guard WHERE mapped_status='in_review')<>1
     OR (SELECT count(*) FROM pg_temp.minted_alignment_case_status_guard WHERE mapped_status='denied')<>1
     OR (SELECT count(*) FROM pg_temp.minted_alignment_case_status_guard WHERE mapped_status='action_required')<>0
     OR (SELECT count(*) FROM pg_temp.minted_alignment_case_status_guard)<>65 THEN
    RAISE EXCEPTION 'ALIGNMENT_CASE_STATUS_MAPPING_DRIFT';
  END IF;
END
$mapping_prestate$;

ALTER TABLE public.credential_cases ADD COLUMN case_status text NOT NULL DEFAULT 'not_started';
ALTER TABLE public.credential_cases ADD CONSTRAINT credential_cases_case_status_check CHECK (case_status IN ('not_started','in_progress','submitted','in_review','action_required','approved','denied','not_pursuing'));
CREATE INDEX idx_credential_cases_case_status ON public.credential_cases (org_id, case_status);
ALTER TABLE public.credential_cases ADD COLUMN contract_executed_date date;

CREATE TABLE public.case_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.credential_cases (id) ON DELETE CASCADE,
  from_status text NULL CONSTRAINT case_status_history_from_status_check CHECK (from_status IS NULL OR from_status IN ('not_started','in_progress','submitted','in_review','action_required','approved','denied','not_pursuing')),
  to_status text NOT NULL CONSTRAINT case_status_history_to_status_check CHECK (to_status IN ('not_started','in_progress','submitted','in_review','action_required','approved','denied','not_pursuing')),
  actor_kind text NOT NULL DEFAULT 'user' CONSTRAINT case_status_history_actor_kind_check CHECK (actor_kind IN ('system','user')),
  reason_code_id uuid NULL REFERENCES public.denial_reason_codes (id) ON DELETE SET NULL,
  evidence_touch_id uuid NULL REFERENCES public.touches (id) ON DELETE SET NULL,
  is_correction boolean NOT NULL DEFAULT false,
  note text NULL,
  changed_by uuid NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_status_history_correction_note_check CHECK (NOT is_correction OR note IS NOT NULL)
);
CREATE INDEX idx_case_status_history_case_id ON public.case_status_history (case_id);
CREATE INDEX idx_case_status_history_org_id ON public.case_status_history (org_id);
CREATE INDEX idx_case_status_history_reason_code_id ON public.case_status_history (reason_code_id) WHERE reason_code_id IS NOT NULL;
CREATE INDEX idx_case_status_history_evidence_touch_id ON public.case_status_history (evidence_touch_id) WHERE evidence_touch_id IS NOT NULL;
ALTER TABLE public.case_status_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_status_history FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.case_status_history TO authenticated;
CREATE POLICY case_status_history_select ON public.case_status_history FOR SELECT USING (org_id IN (SELECT public.user_org_ids()));
CREATE POLICY case_status_history_insert ON public.case_status_history FOR INSERT WITH CHECK (
  org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) IN ('admin','specialist')
  AND EXISTS (SELECT 1 FROM public.credential_cases c WHERE c.id=case_id AND c.org_id=case_status_history.org_id)
);

UPDATE public.credential_cases c SET case_status = CASE
  WHEN c.payer_pipeline_state IN ('assigned','drafting') THEN 'in_progress'
  WHEN c.payer_pipeline_state='submitted' THEN 'submitted'
  WHEN c.payer_pipeline_state='in_review' THEN 'in_review'
  WHEN c.payer_pipeline_state='action_required' THEN 'action_required'
  WHEN c.payer_pipeline_state='approved' THEN 'approved'
  WHEN c.payer_pipeline_state='denied' THEN 'denied'
  WHEN c.payer_pipeline_state='oon' THEN 'not_pursuing'
  ELSE CASE COALESCE((SELECT s.label FROM public.status_configs s WHERE s.id=c.credentialing_status_id),'')
    WHEN 'In Progress' THEN 'in_progress' WHEN 'Waiting on Provider' THEN 'in_progress'
    WHEN 'Submitted' THEN 'submitted' WHEN 'Approved' THEN 'approved' WHEN 'In-Network' THEN 'approved'
    WHEN 'Denied' THEN 'denied' WHEN 'OON' THEN 'not_pursuing' WHEN 'Not Required' THEN 'not_pursuing'
    ELSE 'not_started' END
END;

INSERT INTO public.case_status_history (org_id, case_id, from_status, to_status, actor_kind, note)
SELECT c.org_id, c.id, NULL, c.case_status, 'system', 'Unified case status migration (E6.0)'
FROM public.credential_cases c;

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
CREATE TRIGGER trg_case_status_on_touch AFTER INSERT ON public.touches FOR EACH ROW EXECUTE FUNCTION public.case_status_on_touch();

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
CREATE TRIGGER trg_case_status_on_task_complete AFTER UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.case_status_on_task_complete();

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
CREATE TRIGGER trg_case_status_on_fill AFTER INSERT ON public.fill_sessions FOR EACH ROW EXECUTE FUNCTION public.case_status_on_fill();

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
DO $poststate$
DECLARE mismatches integer;
BEGIN
  IF to_regclass('public.case_status_history') IS NULL OR (SELECT count(*) FROM public.case_status_history)<>65 OR (SELECT count(*) FROM public.credential_cases WHERE case_status IS NULL)<>0 THEN RAISE EXCEPTION 'ALIGNMENT_SLICE_1_POSTSTATE_INVALID'; END IF;
  IF (SELECT count(*) FROM public.credential_cases WHERE case_status='submitted')<>32
     OR (SELECT count(*) FROM public.credential_cases WHERE case_status='approved')<>14
     OR (SELECT count(*) FROM public.credential_cases WHERE case_status='not_started')<>12
     OR (SELECT count(*) FROM public.credential_cases WHERE case_status='in_progress')<>3
     OR (SELECT count(*) FROM public.credential_cases WHERE case_status='not_pursuing')<>2
     OR (SELECT count(*) FROM public.credential_cases WHERE case_status='in_review')<>1
     OR (SELECT count(*) FROM public.credential_cases WHERE case_status='denied')<>1
     OR (SELECT count(*) FROM public.credential_cases WHERE case_status='action_required')<>0
     OR (SELECT count(*) FROM public.credential_cases)<>65 THEN RAISE EXCEPTION 'ALIGNMENT_CASE_STATUS_POSTSTATE_INVALID'; END IF;
  IF EXISTS (SELECT 1 FROM public.credential_cases c JOIN pg_temp.minted_alignment_case_status_guard g ON g.id=c.id WHERE c.case_status IS DISTINCT FROM g.mapped_status) THEN RAISE EXCEPTION 'ALIGNMENT_CASE_STATUS_MAPPING_CHANGED'; END IF;
  SELECT count(*) INTO mismatches FROM public.credential_cases c JOIN pg_temp.minted_alignment_case_guard g ON g.id=c.id
  WHERE c.facility_id IS DISTINCT FROM g.facility_id OR md5((to_jsonb(c)-ARRAY['case_status','contract_executed_date','case_number'])::text) IS DISTINCT FROM g.legacy_digest;
  IF mismatches<>0 OR (SELECT count(*) FROM public.credential_cases)<>(SELECT count(*) FROM pg_temp.minted_alignment_case_guard) THEN RAISE EXCEPTION 'ALIGNMENT_CASE_PRESERVATION_FAILED'; END IF;
END
$poststate$;
DO $final_guard$
BEGIN
  IF to_regclass('public.portal_field_maps_aetna_backup_20260904') IS NOT NULL
     OR to_regclass('public.portal_field_maps_aetna_direct_backup_20260812') IS NOT NULL
     OR to_regclass('public.portals_aetna_backup_20260904') IS NOT NULL THEN
    RAISE EXCEPTION 'ALIGNMENT_OPERATOR_BACKUP_PRESENT';
  END IF;
END
$final_guard$;

COMMIT;
