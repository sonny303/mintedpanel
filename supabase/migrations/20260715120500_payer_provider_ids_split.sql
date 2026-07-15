-- E4.0 TE-6 follow-up (ChatPRD round-3 mid-build addendum, 2026-07-14) — split
-- the single resolution identifier into TWO structured columns so downstream
-- billing/EHR feeds can distinguish a Type 1 (individual, NPI-linked) payer ID
-- from a Type 2 (group, Tax-ID-linked) billing ID; a single generic ID would
-- cause claim denials (F4.0.3 billing-integrity rule).
--
-- The earlier 20260715120100_payer_provider_id.sql was ALREADY APPLIED to
-- hosted, so per the additive rule it is not edited or dropped — that column is
-- left DORMANT (superseded, never read/written by the app). This additive
-- follow-up adds the two real columns and reissues advance_payer_pipeline (TE-5)
-- to write them (dropping the single-id 8-arg signature so no overload lingers).

ALTER TABLE public.credential_cases
  ADD COLUMN IF NOT EXISTS payer_individual_provider_id text;
ALTER TABLE public.credential_cases
  ADD COLUMN IF NOT EXISTS payer_group_provider_id text;

-- Reissue the RPC with the two-id approval signature (replaces the single
-- p_payer_provider_id param). Drop the prior 8-arg signature first so PostgREST
-- resolves the one function unambiguously.
DROP FUNCTION IF EXISTS public.advance_payer_pipeline(
  uuid, text, text, uuid, text, boolean, date, text
);

CREATE OR REPLACE FUNCTION public.advance_payer_pipeline(
  p_case_id uuid,
  p_to_state text,
  p_expected_state text DEFAULT NULL,
  p_reason_code_id uuid DEFAULT NULL,
  p_justification text DEFAULT NULL,
  p_is_correction boolean DEFAULT false,
  p_effective_date date DEFAULT NULL,
  p_individual_provider_id text DEFAULT NULL,
  p_group_provider_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_case public.credential_cases;
  v_org uuid;
  v_from text;
  v_role text;
  v_user uuid := auth.uid();
  v_user_name text;
  v_reason public.denial_reason_codes;
  v_allowed text[];
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  SELECT * INTO v_case FROM public.credential_cases WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pipeline_case_not_found';
  END IF;
  v_org := v_case.org_id;
  v_from := v_case.payer_pipeline_state;
  v_role := user_role(v_org);

  IF v_role IS NULL OR v_role NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'pipeline_not_authorized';
  END IF;

  IF p_expected_state IS NOT NULL AND p_expected_state <> v_from THEN
    RAISE EXCEPTION 'pipeline_state_conflict:%', v_from;
  END IF;

  IF p_to_state NOT IN (
    'not_started', 'assigned', 'drafting', 'submitted', 'in_review',
    'action_required', 'approved', 'denied', 'oon'
  ) THEN
    RAISE EXCEPTION 'pipeline_invalid_state';
  END IF;

  IF p_is_correction THEN
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'pipeline_admin_only';
    END IF;
    IF v_justification IS NULL THEN
      RAISE EXCEPTION 'pipeline_correction_needs_justification';
    END IF;
  ELSE
    v_allowed := CASE v_from
      WHEN 'not_started' THEN ARRAY['assigned']
      WHEN 'assigned' THEN ARRAY['drafting']
      WHEN 'drafting' THEN ARRAY['submitted', 'denied', 'oon']
      WHEN 'submitted' THEN ARRAY['in_review', 'denied', 'oon']
      WHEN 'in_review' THEN ARRAY['action_required', 'approved', 'denied', 'oon']
      WHEN 'action_required' THEN ARRAY['in_review', 'approved', 'denied', 'oon']
      WHEN 'denied' THEN ARRAY['drafting']
      ELSE ARRAY[]::text[]
    END;
    IF NOT (p_to_state = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'pipeline_invalid_transition';
    END IF;
  END IF;

  IF p_reason_code_id IS NOT NULL THEN
    SELECT * INTO v_reason FROM public.denial_reason_codes
      WHERE id = p_reason_code_id
        AND (org_id IS NULL OR org_id = v_org)
        AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'pipeline_reason_code_invalid';
    END IF;
  END IF;

  IF p_to_state = 'denied' THEN
    IF p_reason_code_id IS NULL THEN
      RAISE EXCEPTION 'pipeline_denied_needs_reason';
    END IF;
    IF v_reason.code = 'other' AND v_justification IS NULL THEN
      RAISE EXCEPTION 'pipeline_other_needs_context';
    END IF;
  END IF;

  IF p_to_state = 'approved' AND p_effective_date IS NULL THEN
    RAISE EXCEPTION 'pipeline_approved_needs_effective_date';
  END IF;

  IF p_to_state = 'approved' THEN
    UPDATE public.credential_cases
      SET payer_pipeline_state = p_to_state,
          confirmed_effective_date = p_effective_date,
          payer_individual_provider_id = p_individual_provider_id,
          payer_group_provider_id = p_group_provider_id,
          updated_at = now()
      WHERE id = p_case_id
      RETURNING * INTO v_case;
  ELSIF p_is_correction AND v_from = 'approved' AND p_to_state <> 'approved' THEN
    -- Approval reversal: clear the erroneous enrollment writes (admin-only).
    UPDATE public.credential_cases
      SET payer_pipeline_state = p_to_state,
          confirmed_effective_date = NULL,
          payer_individual_provider_id = NULL,
          payer_group_provider_id = NULL,
          updated_at = now()
      WHERE id = p_case_id
      RETURNING * INTO v_case;
  ELSE
    UPDATE public.credential_cases
      SET payer_pipeline_state = p_to_state,
          updated_at = now()
      WHERE id = p_case_id
      RETURNING * INTO v_case;
  END IF;

  INSERT INTO public.payer_pipeline_history (
    org_id, case_id, from_state, to_state, reason_code_id,
    is_correction, justification, changed_by
  ) VALUES (
    v_org, p_case_id, v_from, p_to_state, p_reason_code_id,
    p_is_correction, v_justification, v_user
  );

  SELECT COALESCE(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_user;
  INSERT INTO public.audit_log (
    org_id, user_id, user_name, action_type, entity_type, entity_id,
    before, after, description
  ) VALUES (
    v_org, v_user, v_user_name, 'STATUS_CHANGE', 'payer_pipeline', p_case_id,
    jsonb_build_object('payerPipelineState', v_from),
    jsonb_build_object(
      'payerPipelineState', p_to_state,
      'isCorrection', p_is_correction,
      'reasonCodeId', p_reason_code_id
    ),
    CASE WHEN p_is_correction THEN 'Payer pipeline corrected' ELSE 'Payer pipeline advanced' END
  );

  RETURN to_jsonb(v_case);
END;
$$;

REVOKE ALL ON FUNCTION public.advance_payer_pipeline(
  uuid, text, text, uuid, text, boolean, date, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_payer_pipeline(
  uuid, text, text, uuid, text, boolean, date, text, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.advance_payer_pipeline(
  uuid, text, text, uuid, text, boolean, date, text, text
) TO authenticated;
