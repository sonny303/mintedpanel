-- E6.8 F6.8.3 — Approved close: the per-ID "Didn't receive" acknowledgment.
--
-- E6.7 (20260727120000) made set_case_status hard-require EXACTLY the IDs the
-- payer expects at Approved. The approved product behavior (payer-and-cases
-- design bundle screen 5; conflict resolved in
-- payer-cases-ui-build-handoff.md §2.1 — this DELIBERATELY supersedes the
-- E6.7 strict-require acceptance criterion, flagged to the PM and approved
-- via the bundle) is that every expected ID field carries a "Didn't receive"
-- escape: approval letters often arrive late and a missing ID must never
-- block a close. At Approved each expected ID must now be EITHER supplied OR
-- explicitly acknowledged missing — silence still raises the E6.7 named
-- error, so the strict guard is relaxed only by deliberate action.
--
-- Same-name replacement, params extended ADDITIVELY with two defaulted
-- booleans (p_provider_id_missing_ack / p_group_id_missing_ack). Because a
-- CREATE OR REPLACE with extra defaulted params would leave TWO overloads
-- (a PostgREST ambiguity), the old 11-param signature is DROPPED and the
-- 13-param one created — the E4.2 publish-RPC precedent. Every pre-E6.8
-- caller keeps working unchanged (the new params default to false = the
-- exact E6.7 behavior).
--
-- An acknowledged-missing provider ID leaves the case's
-- payer_individual_provider_id NULL (and therefore every derived enrollment
-- surface — the providerEnrollments "From case" row, the future Awaiting-ID
-- badge = expected + approved + NULL id); same for the group ID / the
-- payer_network_targets group PIN. Back-fill rides the EXISTING set-later
-- paths (enrollment facts / Group-IDs dialog) — nothing here writes those
-- tables. The acknowledgment is recorded in BOTH trails: the audit row's
-- `after` payload (providerIdMissingAck / groupIdMissingAck, present only
-- when an ack was actually consumed) and the appended case_status_history
-- row's note ("Didn't receive: …" appended beneath any user note — the
-- history table is fixed-column, note is its payload).
--
-- Everything else — edges, corrections, mirrors, history, audit, grants — is
-- copied verbatim from the E6.7 reissue (20260727120000).

DROP FUNCTION IF EXISTS public.set_case_status(
  uuid, text, text, uuid, text, boolean, date, text, text, date, uuid
);

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
  p_evidence_touch_id uuid DEFAULT NULL,
  p_provider_id_missing_ack boolean DEFAULT false,
  p_group_id_missing_ack boolean DEFAULT false
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
  v_group_id text := NULLIF(btrim(COALESCE(p_group_provider_id, '')), '');
  v_provider_id_required boolean;
  v_group_id_required boolean;
  -- F6.8.3: an ack "consumed" = the ID was expected, absent, and explicitly
  -- acknowledged missing. An ack passed alongside a supplied ID is inert
  -- (the ID was received) and never recorded.
  v_provider_ack boolean := false;
  v_group_ack boolean := false;
  v_ack_parts text[] := '{}'::text[];
  v_history_note text;
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
  -- (F6.0.2): the effective date always; the payer-issued IDs per the payer's
  -- E6.7 ID-expectation flags. F6.8.3: each expected ID must be EITHER
  -- supplied OR explicitly acknowledged missing ("Didn't receive") — silence
  -- still raises the E6.7 named error.
  IF p_to_status = 'approved' AND NOT p_is_correction THEN
    IF p_effective_date IS NULL THEN
      RAISE EXCEPTION 'case_status_approved_needs_effective_date';
    END IF;
    SELECT COALESCE(py.provider_id_expected, py.resolution_id_expected, true),
           COALESCE(py.group_id_expected, false)
      INTO v_provider_id_required, v_group_id_required
      FROM public.payers py WHERE py.id = v_case.payer_id;
    IF NOT FOUND THEN
      v_provider_id_required := true;
      v_group_id_required := false;
    END IF;
    IF v_provider_id_required AND v_individual_id IS NULL
       AND NOT COALESCE(p_provider_id_missing_ack, false) THEN
      RAISE EXCEPTION 'case_status_approved_needs_provider_id';
    END IF;
    IF v_group_id_required AND v_group_id IS NULL
       AND NOT COALESCE(p_group_id_missing_ack, false) THEN
      RAISE EXCEPTION 'case_status_approved_needs_group_provider_id';
    END IF;
    v_provider_ack := v_provider_id_required AND v_individual_id IS NULL
      AND COALESCE(p_provider_id_missing_ack, false);
    v_group_ack := v_group_id_required AND v_group_id IS NULL
      AND COALESCE(p_group_id_missing_ack, false);
    -- array_append, not `||` — an untyped literal on `||`'s right resolves
    -- as an array and fails at runtime ("malformed array literal").
    IF v_provider_ack THEN v_ack_parts := array_append(v_ack_parts, 'provider ID'); END IF;
    IF v_group_ack THEN v_ack_parts := array_append(v_ack_parts, 'group ID'); END IF;
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

  -- Transition-shim mirrors (see 20260719120100). The credentialing mirror
  -- resolves this org's status_configs row by canonical label; a missing row
  -- (never the case for canonically-seeded orgs) leaves the legacy field
  -- unchanged.
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
    -- An acknowledged-missing ID stays NULL here — the Awaiting-ID derivation
    -- (expected + approved + NULL id) and the existing set-later back-fill
    -- paths take it from there.
    UPDATE public.credential_cases
      SET case_status = p_to_status,
          credentialing_status_id = COALESCE(v_mirror_status, credentialing_status_id),
          payer_pipeline_state = v_mirror_pipeline,
          confirmed_effective_date = p_effective_date,
          payer_individual_provider_id = v_individual_id,
          payer_group_provider_id = COALESCE(v_group_id, payer_group_provider_id),
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
  -- F6.8.3: a consumed "Didn't receive" ack is recorded beneath any user
  -- note — the fixed sentence "Didn't receive: provider ID[; group ID]".
  IF cardinality(v_ack_parts) > 0 THEN
    v_history_note := concat_ws(E'\n', v_note,
      'Didn''t receive: ' || array_to_string(v_ack_parts, '; '));
  ELSE
    v_history_note := v_note;
  END IF;
  INSERT INTO public.case_status_history (
    org_id, case_id, from_status, to_status, actor_kind, reason_code_id,
    evidence_touch_id, is_correction, note, changed_by
  ) VALUES (
    v_org, p_case_id, v_from, p_to_status, 'user', p_reason_code_id,
    p_evidence_touch_id, p_is_correction, v_history_note, v_user
  );

  -- In-RPC audit row, same transaction — rolls back with a failed transition.
  -- The ack flags join the payload only when actually consumed.
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
    ) || CASE
      WHEN v_provider_ack OR v_group_ack THEN jsonb_build_object(
        'providerIdMissingAck', v_provider_ack,
        'groupIdMissingAck', v_group_ack)
      ELSE '{}'::jsonb
    END,
    CASE WHEN p_is_correction THEN 'Case status corrected' ELSE 'Case status changed' END
  );

  RETURN to_jsonb(v_case);
END;
$$;

REVOKE ALL ON FUNCTION public.set_case_status(
  uuid, text, text, uuid, text, boolean, date, text, text, date, uuid, boolean, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_case_status(
  uuid, text, text, uuid, text, boolean, date, text, text, date, uuid, boolean, boolean
) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_case_status(
  uuid, text, text, uuid, text, boolean, date, text, text, date, uuid, boolean, boolean
) TO authenticated;
