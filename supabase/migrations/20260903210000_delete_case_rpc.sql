-- Admin hard-delete of a credentialing case (controlled carve-out).
--
-- Day-to-day ledgers (touches, status_history, case_status_history, …) stay
-- INSERT-only for ordinary writers. This SECURITY DEFINER RPC is the ONE
-- path that may DELETE case-scoped children + the case itself, so UAT can
-- clear a bad case and generation can recreate at the same 4-part key.
-- Pattern matches delete_payer_contact.
--
-- Cascade owned here (NO ACTION FKs that would otherwise block):
--   touches (notes / touchpoints / system_event / task_update),
--   tasks, status_history, case_facilities.
-- Left to existing FK actions on DELETE of credential_cases:
--   case_status_history / payer_pipeline_history / fill_sessions → CASCADE
--   case_generation_run_rows.case_id / provider_documents.case_id → SET NULL
-- communication_event parents are left alone (batch may still hold other cases).
--
-- Side effects for re-generation eligibility:
--   * if case_status = 'approved', expire any LIVE enrollment_facts row at
--     the same (provider, group, payer, state);
--   * void any ACTIVE case_generation_exclusions at that same 4-part key.

CREATE OR REPLACE FUNCTION public.delete_case(
  p_org_id uuid,
  p_case_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_name text;
  v_case public.credential_cases%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_org_id IS NULL
     OR p_case_id IS NULL
     OR NOT (p_org_id IN (SELECT user_org_ids()))
     OR user_role(p_org_id) <> 'admin' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_case
  FROM public.credential_cases
  WHERE id = p_case_id
  FOR UPDATE;

  IF NOT FOUND OR v_case.org_id IS DISTINCT FROM p_org_id THEN
    RAISE EXCEPTION 'Case not found';
  END IF;

  -- Free generation candidacy when this was an Approved enrollment.
  IF v_case.case_status = 'approved'
     AND v_case.provider_id IS NOT NULL
     AND v_case.group_id IS NOT NULL
     AND v_case.payer_id IS NOT NULL
     AND v_case.state IS NOT NULL THEN
    UPDATE public.enrollment_facts
    SET expired_at = now(),
        expired_by = v_uid
    WHERE org_id = p_org_id
      AND provider_id = v_case.provider_id
      AND group_id = v_case.group_id
      AND payer_id = v_case.payer_id
      AND state = v_case.state
      AND expired_at IS NULL;
  END IF;

  -- Void active exclusions at the same 4-part key so generation is not blocked.
  IF v_case.provider_id IS NOT NULL
     AND v_case.group_id IS NOT NULL
     AND v_case.payer_id IS NOT NULL
     AND v_case.state IS NOT NULL THEN
    UPDATE public.case_generation_exclusions
    SET status = 'voided',
        voided_by = v_uid,
        voided_at = now()
    WHERE org_id = p_org_id
      AND provider_id = v_case.provider_id
      AND group_id = v_case.group_id
      AND payer_id = v_case.payer_id
      AND state = v_case.state
      AND status = 'active';
  END IF;

  -- Break self-FK on correction chains before bulk-deleting touches.
  UPDATE public.touches
  SET corrects_touch_id = NULL
  WHERE case_id = p_case_id
    AND corrects_touch_id IS NOT NULL;

  DELETE FROM public.touches WHERE case_id = p_case_id;
  DELETE FROM public.tasks WHERE case_id = p_case_id;
  DELETE FROM public.status_history WHERE case_id = p_case_id;
  DELETE FROM public.case_facilities WHERE case_id = p_case_id;

  -- Cascades: case_status_history, payer_pipeline_history, fill_sessions.
  -- SET NULL: case_generation_run_rows.case_id, provider_documents.case_id.
  DELETE FROM public.credential_cases
  WHERE id = p_case_id
    AND org_id = p_org_id;

  SELECT coalesce(full_name, email) INTO v_user_name
  FROM public.profiles
  WHERE id = v_uid;

  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id, description)
  VALUES
    (p_org_id, v_uid, v_user_name, 'DELETE', 'case', p_case_id, 'Case deleted');
END;
$$;

REVOKE ALL ON FUNCTION public.delete_case(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_case(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_case(uuid, uuid) TO authenticated, service_role;
