-- E6.0 F6.0.2/F6.0.4 — set_case_status: the ONE atomic transition entry point
-- for the unified case status (the advance_payer_pipeline template). A
-- rejected transition writes NO history row and no partial state — one
-- plpgsql function is one transaction, any RAISE rolls everything back.
--
-- REPO-ONLY: hosted apply is an operator step (E6.0 PR body), after 120000.
--
-- SECURITY INVOKER — runs under the caller's RLS: billing (no
-- credential_cases UPDATE policy) cannot write, and every write is
-- tenant-scoped by the same policies the browser obeys. The edge rules
-- MIRROR src/lib/caseStatus.ts by hand (SQL can't import TS) — keep them in
-- lockstep:
--   * forward along the spine (skips allowed): not_started(0) →
--     in_progress(1) → submitted(2) → in_review(3) → action_required(4);
--   * the one backward open edge: action_required → in_review (RFI return);
--   * any open status closes to approved / denied / not_pursuing;
--   * denied → in_progress is the reapply edge (normal, specialist-open);
--   * everything else is backward and requires an ADMIN correction with a
--     note (F6.0.4 — corrections append to history, never rewrite).
--
-- Evidence rules enforced here (F6.0.2):
--   * approved REQUIRES an effective date AND the payer-issued provider ID
--     (rendered under the payer's own label client-side);
--   * denied REQUIRES a reason code from the governed list ('other' also
--     needs the single-line context in p_note);
--   * not_pursuing REQUIRES a note;
--   * p_evidence_touch_id (F6.0.3 — the Add-touch bump) must be a touch on
--     this same case.
--
-- TRANSITION SHIM (documented, temporary): canonical case_status is THE
-- truth. Until the remaining legacy readers retire (E6.1–E6.4), this RPC
-- also mirrors the legacy credentialing_status_id (by canonical label) and
-- payer_pipeline_state (fixed map) so surviving derived surfaces and the
-- locked extension /api wire contract stay truthful with zero /api or
-- extension change. The maps mirror LEGACY_CREDENTIALING_MIRROR /
-- PIPELINE_STATE_MIRROR in src/lib/caseStatus.ts. It deliberately does NOT
-- write status_history or payer_pipeline_history — those ledgers are
-- retained read-only; the unified trail lives in case_status_history.
--
-- Named errors the service maps to UI messages:
--   case_status_case_not_found            -> 404
--   case_status_not_authorized            -> billing / non-member write
--   case_status_conflict:<actual>         -> concurrent edit (refresh)
--   case_status_invalid                   -> unknown target status
--   case_status_invalid_transition        -> illegal edge
--   case_status_admin_only                -> correction by non-admin
--   case_status_correction_needs_note
--   case_status_reason_invalid
--   case_status_denied_needs_reason
--   case_status_other_needs_context
--   case_status_not_pursuing_needs_note
--   case_status_approved_needs_effective_date
--   case_status_approved_needs_provider_id
--   case_status_evidence_invalid

CREATE OR REPLACE FUNCTION public.set_case_status(
  p_case_id uuid,
  p_to_status text,
  p_expected_status text DEFAULT NULL,
  p_reason_code_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_is_correction boolean DEFAULT false,
  p_effective_date date DEFAULT NULL,
  p_individual_provider_id text DEFAULT NULL,
  p_group_provider_id text DEFAULT NULL,
  p_contract_executed_date date DEFAULT NULL,
  p_evidence_touch_id uuid DEFAULT NULL
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
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_individual_id text := NULLIF(btrim(COALESCE(p_individual_provider_id, '')), '');
  v_from_rank int;
  v_to_rank int;
  v_legal boolean;
  v_mirror_label text;
  v_mirror_status uuid;
  v_mirror_pipeline text;
BEGIN
  -- Lock the row; RLS (SECURITY INVOKER) scopes this to the caller's org, so
  -- a cross-org or missing id is simply NOT FOUND.
  SELECT * INTO v_case FROM public.credential_cases WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_status_case_not_found';
  END IF;
  v_org := v_case.org_id;
  v_from := v_case.case_status;
  v_role := user_role(v_org);

  IF v_role IS NULL OR v_role NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'case_status_not_authorized';
  END IF;

  -- Optimistic concurrency: the client acted on p_expected_status. A stale
  -- second writer is rejected, not silently overwritten. (The Add-touch bump
  -- passes NULL — an auto-trigger may have just advanced the case.)
  IF p_expected_status IS NOT NULL AND p_expected_status <> v_from THEN
    RAISE EXCEPTION 'case_status_conflict:%', v_from;
  END IF;

  IF p_to_status NOT IN (
    'not_started', 'in_progress', 'submitted', 'in_review',
    'action_required', 'approved', 'denied', 'not_pursuing'
  ) THEN
    RAISE EXCEPTION 'case_status_invalid';
  END IF;

  IF p_to_status = v_from THEN
    RAISE EXCEPTION 'case_status_invalid_transition';
  END IF;

  IF p_is_correction THEN
    -- Backward/off-edge moves: admin-only, note required (F6.0.4).
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'case_status_admin_only';
    END IF;
    IF v_note IS NULL THEN
      RAISE EXCEPTION 'case_status_correction_needs_note';
    END IF;
  ELSE
    v_from_rank := CASE v_from
      WHEN 'not_started' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'submitted' THEN 2
      WHEN 'in_review' THEN 3 WHEN 'action_required' THEN 4 ELSE NULL END;
    v_to_rank := CASE p_to_status
      WHEN 'not_started' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'submitted' THEN 2
      WHEN 'in_review' THEN 3 WHEN 'action_required' THEN 4 ELSE NULL END;
    v_legal :=
      (v_from = 'denied' AND p_to_status = 'in_progress')
      OR (v_from_rank IS NOT NULL
          AND p_to_status IN ('approved', 'denied', 'not_pursuing'))
      OR (v_from_rank IS NOT NULL AND v_to_rank IS NOT NULL AND v_to_rank > v_from_rank)
      OR (v_from = 'action_required' AND p_to_status = 'in_review');
    IF NOT v_legal THEN
      RAISE EXCEPTION 'case_status_invalid_transition';
    END IF;
  END IF;

  -- Reason-code enforcement. Validate any supplied code against the
  -- global + own-org active vocabulary (the E4.0 denial_reason_codes table —
  -- the fixed word-list the Denied dialog requires).
  IF p_reason_code_id IS NOT NULL THEN
    SELECT * INTO v_reason FROM public.denial_reason_codes
      WHERE id = p_reason_code_id
        AND (org_id IS NULL OR org_id = v_org)
        AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'case_status_reason_invalid';
    END IF;
  END IF;

  IF p_to_status = 'denied' THEN
    IF p_reason_code_id IS NULL THEN
      RAISE EXCEPTION 'case_status_denied_needs_reason';
    END IF;
    IF v_reason.code = 'other' AND v_note IS NULL THEN
      RAISE EXCEPTION 'case_status_other_needs_context';
    END IF;
  END IF;

  IF p_to_status = 'not_pursuing' AND NOT p_is_correction AND v_note IS NULL THEN
    RAISE EXCEPTION 'case_status_not_pursuing_needs_note';
  END IF;

  -- Approved captures the terminal facts at the moment the letter is in hand
  -- (F6.0.2): effective date + the payer-issued provider ID, both required.
  IF p_to_status = 'approved' AND NOT p_is_correction THEN
    IF p_effective_date IS NULL THEN
      RAISE EXCEPTION 'case_status_approved_needs_effective_date';
    END IF;
    IF v_individual_id IS NULL THEN
      RAISE EXCEPTION 'case_status_approved_needs_provider_id';
    END IF;
  END IF;

  -- The evidencing touch (F6.0.3) must belong to this same case.
  IF p_evidence_touch_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.touches t
      WHERE t.id = p_evidence_touch_id AND t.case_id = p_case_id AND t.org_id = v_org
    ) THEN
      RAISE EXCEPTION 'case_status_evidence_invalid';
    END IF;
  END IF;

  -- Transition-shim mirrors (see header). The credentialing mirror resolves
  -- this org's status_configs row by canonical label; a missing row (never
  -- the case for canonically-seeded orgs) leaves the legacy field unchanged.
  v_mirror_label := CASE p_to_status
    WHEN 'not_started' THEN 'Not Started'
    WHEN 'in_progress' THEN 'In Progress'
    WHEN 'submitted' THEN 'Submitted'
    WHEN 'in_review' THEN 'Submitted'
    WHEN 'action_required' THEN 'Waiting on Provider'
    WHEN 'approved' THEN 'Approved'
    WHEN 'denied' THEN 'Denied'
    WHEN 'not_pursuing' THEN 'Not Required'
  END;
  SELECT id INTO v_mirror_status FROM public.status_configs
    WHERE org_id = v_org AND track = 'credentialing' AND label = v_mirror_label
    ORDER BY sort_order ASC LIMIT 1;
  v_mirror_pipeline := CASE p_to_status
    WHEN 'not_started' THEN 'not_started'
    WHEN 'in_progress' THEN 'drafting'
    WHEN 'submitted' THEN 'submitted'
    WHEN 'in_review' THEN 'in_review'
    WHEN 'action_required' THEN 'action_required'
    WHEN 'approved' THEN 'approved'
    WHEN 'denied' THEN 'denied'
    WHEN 'not_pursuing' THEN 'oon'
  END;

  IF p_to_status = 'approved' AND NOT p_is_correction THEN
    UPDATE public.credential_cases
      SET case_status = p_to_status,
          credentialing_status_id = COALESCE(v_mirror_status, credentialing_status_id),
          payer_pipeline_state = v_mirror_pipeline,
          confirmed_effective_date = p_effective_date,
          payer_individual_provider_id = v_individual_id,
          payer_group_provider_id = COALESCE(
            NULLIF(btrim(COALESCE(p_group_provider_id, '')), ''), payer_group_provider_id),
          contract_executed_date = COALESCE(p_contract_executed_date, contract_executed_date),
          approved_date = COALESCE(approved_date, CURRENT_DATE),
          updated_at = now()
      WHERE id = p_case_id
      RETURNING * INTO v_case;
  ELSIF p_is_correction AND v_from = 'approved' AND p_to_status <> 'approved' THEN
    -- Approval reversal: clear the erroneous enrollment facts (admin-only,
    -- the E4.0 reversal pattern).
    UPDATE public.credential_cases
      SET case_status = p_to_status,
          credentialing_status_id = COALESCE(v_mirror_status, credentialing_status_id),
          payer_pipeline_state = v_mirror_pipeline,
          confirmed_effective_date = NULL,
          payer_individual_provider_id = NULL,
          payer_group_provider_id = NULL,
          contract_executed_date = NULL,
          approved_date = NULL,
          updated_at = now()
      WHERE id = p_case_id
      RETURNING * INTO v_case;
  ELSIF p_to_status = 'submitted' THEN
    -- The human asserting the submission stamps the plain fact date once.
    UPDATE public.credential_cases
      SET case_status = p_to_status,
          credentialing_status_id = COALESCE(v_mirror_status, credentialing_status_id),
          payer_pipeline_state = v_mirror_pipeline,
          submitted_date = COALESCE(submitted_date, CURRENT_DATE),
          updated_at = now()
      WHERE id = p_case_id
      RETURNING * INTO v_case;
  ELSE
    UPDATE public.credential_cases
      SET case_status = p_to_status,
          credentialing_status_id = COALESCE(v_mirror_status, credentialing_status_id),
          payer_pipeline_state = v_mirror_pipeline,
          updated_at = now()
      WHERE id = p_case_id
      RETURNING * INTO v_case;
  END IF;

  -- Append-only unified history row (human transitions run through here;
  -- 'system' rows come from the 120200 triggers + create_case_with_tasks).
  INSERT INTO public.case_status_history (
    org_id, case_id, from_status, to_status, actor_kind, reason_code_id,
    evidence_touch_id, is_correction, note, changed_by
  ) VALUES (
    v_org, p_case_id, v_from, p_to_status, 'user', p_reason_code_id,
    p_evidence_touch_id, p_is_correction, v_note, v_user
  );

  -- In-RPC audit row, same transaction — rolls back with a failed transition.
  SELECT COALESCE(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_user;
  INSERT INTO public.audit_log (
    org_id, user_id, user_name, action_type, entity_type, entity_id,
    before, after, description
  ) VALUES (
    v_org, v_user, v_user_name, 'STATUS_CHANGE', 'credential_case', p_case_id,
    jsonb_build_object('caseStatus', v_from),
    jsonb_build_object(
      'caseStatus', p_to_status,
      'isCorrection', p_is_correction,
      'reasonCodeId', p_reason_code_id,
      'evidenceTouchId', p_evidence_touch_id
    ),
    CASE WHEN p_is_correction THEN 'Case status corrected' ELSE 'Case status changed' END
  );

  RETURN to_jsonb(v_case);
END;
$$;

REVOKE ALL ON FUNCTION public.set_case_status(
  uuid, text, text, uuid, text, boolean, date, text, text, date, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_case_status(
  uuid, text, text, uuid, text, boolean, date, text, text, date, uuid
) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_case_status(
  uuid, text, text, uuid, text, boolean, date, text, text, date, uuid
) TO authenticated;
