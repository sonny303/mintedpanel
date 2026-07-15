-- E4.0 TE-5 — advance_payer_pipeline: the ONE atomic transition entry point for
-- the payer pipeline. F4.0.1 requires that a rejected transition writes NO
-- history row and NO partial state change; the current updateCaseStatus does
-- three sequential client statements which cannot guarantee that. A single
-- plpgsql function is one transaction, so any RAISE rolls the whole thing back.
--
-- SECURITY INVOKER (no SECURITY DEFINER) — it runs under the caller's RLS, so
-- there is no privilege escalation: billing (no credential_cases UPDATE policy)
-- cannot write, and the writes are tenant-scoped by the same policies the
-- browser path obeys. The edge map here MIRRORS src/lib/payerPipeline.ts by hand
-- (SQL can't import TS) — keep the two in lockstep.
--
-- Access control (TE-6): specialist|admin do normal forward transitions;
-- correction transitions, post-terminal changes, and the approval-reversal
-- enrollment clear are admin-only (RLS alone cannot express "only admin when
-- is_correction or the case is terminal"). Reapply (Denied -> Drafting) is a
-- NORMAL forward edge, open to specialists.
--
-- Named errors the service maps to UI messages:
--   pipeline_case_not_found          -> 404
--   pipeline_not_authorized          -> billing / non-member write attempt
--   pipeline_state_conflict:<actual> -> concurrent edit (refresh prompt)
--   pipeline_invalid_state           -> unknown target state
--   pipeline_invalid_transition      -> illegal edge (inline allowed-next-states)
--   pipeline_admin_only              -> correction/post-terminal by non-admin
--   pipeline_correction_needs_justification
--   pipeline_reason_code_invalid
--   pipeline_denied_needs_reason
--   pipeline_other_needs_context
--   pipeline_approved_needs_effective_date

CREATE OR REPLACE FUNCTION public.advance_payer_pipeline(
  p_case_id uuid,
  p_to_state text,
  p_expected_state text DEFAULT NULL,
  p_reason_code_id uuid DEFAULT NULL,
  p_justification text DEFAULT NULL,
  p_is_correction boolean DEFAULT false,
  p_effective_date date DEFAULT NULL,
  p_payer_provider_id text DEFAULT NULL
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
  -- Lock the row; RLS (SECURITY INVOKER) scopes this to the caller's org, so a
  -- cross-org or missing id is simply NOT FOUND.
  SELECT * INTO v_case FROM public.credential_cases WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pipeline_case_not_found';
  END IF;
  v_org := v_case.org_id;
  v_from := v_case.payer_pipeline_state;
  v_role := user_role(v_org);

  -- Writer gate. Billing is read-only; the RLS write policies would reject it
  -- anyway, but a named error beats a bare policy violation.
  IF v_role IS NULL OR v_role NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'pipeline_not_authorized';
  END IF;

  -- Optimistic concurrency: the client acted on p_expected_state. A second
  -- writer whose view is stale is rejected, not silently overwritten.
  IF p_expected_state IS NOT NULL AND p_expected_state <> v_from THEN
    RAISE EXCEPTION 'pipeline_state_conflict:%', v_from;
  END IF;

  -- Domain floor on the target.
  IF p_to_state NOT IN (
    'not_started', 'assigned', 'drafting', 'submitted', 'in_review',
    'action_required', 'approved', 'denied', 'oon'
  ) THEN
    RAISE EXCEPTION 'pipeline_invalid_state';
  END IF;

  IF p_is_correction THEN
    -- Admin-only, justified, bypasses edge validation (may move backwards).
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'pipeline_admin_only';
    END IF;
    IF v_justification IS NULL THEN
      RAISE EXCEPTION 'pipeline_correction_needs_justification';
    END IF;
  ELSE
    -- Normal transition: only the legal forward edges. A terminal source has no
    -- forward edge except Denied -> Drafting (reapply), so any other move off a
    -- terminal case falls through to pipeline_invalid_transition and must be an
    -- admin correction.
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

  -- Reason-code enforcement (TE-4 / F4.0.4). Validate any supplied code against
  -- the global+own-org active set. Denied REQUIRES a code; the 'Other' code
  -- requires the single-line context (stored as the history justification). RFI
  -- (Action Required) reason is optional/binary — stored if given, else null.
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

  -- Approved requires an effective date (F4.0.3).
  IF p_to_state = 'approved' AND p_effective_date IS NULL THEN
    RAISE EXCEPTION 'pipeline_approved_needs_effective_date';
  END IF;

  -- Apply the state change + the TE-6 enrollment writes/clears.
  IF p_to_state = 'approved' THEN
    UPDATE public.credential_cases
      SET payer_pipeline_state = p_to_state,
          confirmed_effective_date = p_effective_date,
          payer_provider_id = p_payer_provider_id,
          updated_at = now()
      WHERE id = p_case_id
      RETURNING * INTO v_case;
  ELSIF p_is_correction AND v_from = 'approved' AND p_to_state <> 'approved' THEN
    -- Approval reversal: clear the erroneous enrollment writes (admin-only).
    UPDATE public.credential_cases
      SET payer_pipeline_state = p_to_state,
          confirmed_effective_date = NULL,
          payer_provider_id = NULL,
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

  -- Append-only history row.
  INSERT INTO public.payer_pipeline_history (
    org_id, case_id, from_state, to_state, reason_code_id,
    is_correction, justification, changed_by
  ) VALUES (
    v_org, p_case_id, v_from, p_to_state, p_reason_code_id,
    p_is_correction, v_justification, v_user
  );

  -- In-RPC audit row (the create_case_with_tasks pattern), inside the same
  -- transaction so it rolls back with a failed transition.
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
  uuid, text, text, uuid, text, boolean, date, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_payer_pipeline(
  uuid, text, text, uuid, text, boolean, date, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.advance_payer_pipeline(
  uuid, text, text, uuid, text, boolean, date, text
) TO authenticated;
