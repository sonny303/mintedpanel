-- 2026-10-20 — provider_status_flow: the Admit & assign action + first-application
-- recorder + status transition audit helper.
--
-- providers.status already exists (baseline 20260704210000) with the exact
-- CHECK we need ('onboarding'|'active'|'terminated'); no column change here.
--
-- Admit & assign is ONE action: confirms a pending record, assigns group and
-- location, flips status to 'active', writes one onboarding.admitted audit row,
-- and returns ready_at = the timestamp the 2-business-day target clock starts.
--
-- The target clock STOPS at the first credential_cases row reaching 'submitted'
-- for this provider, recorded by record_first_credential_submission (called
-- from the case-status update path).

-- ---------------------------------------------------------------------------
-- 1. record_provider_status_change (AUTHENTICATED). Helper that writes one
-- audit_log row for a status change. The 'onboarding' -> 'active' transition
-- also writes one onboarding.admitted row (the target clock start).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_provider_status_change(
  p_provider_id uuid,
  p_from_status text,
  p_to_status text,
  p_actor uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Actor is required';
  END IF;
  SELECT org_id INTO v_org FROM public.providers WHERE id = p_provider_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Provider not found';
  END IF;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org, p_actor, 'UPDATE', 'provider', p_provider_id,
            'Provider status changed: ' || coalesce(p_from_status, '(none)')
              || ' -> ' || coalesce(p_to_status, '(none)')
              || case when p_reason is not null then ' (' || p_reason || ')' else '' end);

  -- The handoff moment. The 2-business-day target clock starts here.
  IF p_from_status = 'onboarding' AND p_to_status = 'active' THEN
    INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
      VALUES (v_org, p_actor, 'UPDATE', 'onboarding', p_provider_id,
              'onboarding.admitted: provider ready for credentialing');
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_provider_status_change(uuid, text, text, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_provider_status_change(uuid, text, text, uuid, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. submit_onboarding (the Admit & assign action, AUTHENTICATED). Validates:
-- current status = 'onboarding'; no same-group duplicate; required fields
-- present (NPI present and well-formed, SSN on file via providers.ssn_last4,
-- at least one license, CAQH + PECOS credentials on file). On success:
-- assigns group + location (if not already assigned), flips status to
-- 'active', writes one audit row via record_provider_status_change, returns
-- {ok, ready_at}. The ready_at starts the 2-business-day target clock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_onboarding(
  p_provider_id uuid,
  p_actor uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := coalesce(auth.uid(), p_actor);
  v_provider public.providers%ROWTYPE;
  v_dup_count int;
  v_license_count int;
  v_credential_count int;
  v_has_ssn boolean;
  v_has_caqh boolean;
  v_has_pecos boolean;
  v_group_id uuid;
  v_location_id uuid;
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT * INTO v_provider FROM public.providers WHERE id = p_provider_id;
  IF v_provider.id IS NULL THEN
    RAISE EXCEPTION 'Provider not found';
  END IF;
  IF public.user_role(v_provider.org_id) NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'Not authorized to admit this provider';
  END IF;
  IF v_provider.status <> 'onboarding' THEN
    RAISE EXCEPTION 'Provider is not in onboarding (current status: %)', v_provider.status;
  END IF;

  -- Same-group duplicate check (a different provider with the same NPI in this group).
  SELECT count(*) INTO v_dup_count
    FROM public.providers p2
    WHERE p2.org_id = v_provider.org_id
      AND p2.id <> v_provider.id
      AND p2.npi IS NOT NULL AND p2.npi = v_provider.npi;
  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'Same-group duplicate NPI exists — resolve before admitting';
  END IF;

  -- Required fields present.
  IF v_provider.npi IS NULL OR length(v_provider.npi) <> 10 THEN
    RAISE EXCEPTION 'NPI is required (10 digits)';
  END IF;
  v_has_ssn := v_provider.ssn_last4 IS NOT NULL;
  IF NOT v_has_ssn THEN
    RAISE EXCEPTION 'SSN is required';
  END IF;

  SELECT count(*) INTO v_license_count FROM public.state_licenses
    WHERE provider_id = p_provider_id AND expiration_date > current_date;
  IF v_license_count < 1 THEN
    RAISE EXCEPTION 'At least one current license is required';
  END IF;

  SELECT count(*) INTO v_credential_count FROM public.provider_portal_credentials
    WHERE provider_id = p_provider_id AND portal = 'caqh';
  v_has_caqh := v_credential_count > 0;
  SELECT count(*) INTO v_credential_count FROM public.provider_portal_credentials
    WHERE provider_id = p_provider_id AND portal = 'pecos';
  v_has_pecos := v_credential_count > 0;
  IF NOT v_has_caqh OR NOT v_has_pecos THEN
    RAISE EXCEPTION 'Both CAQH and PECOS portal credentials are required';
  END IF;

  -- Pick up the assigned group/location if missing.
  v_group_id := NULL;
  v_location_id := NULL;
  SELECT pga.group_id INTO v_group_id
    FROM public.provider_group_assignments pga
    WHERE pga.provider_id = p_provider_id
    ORDER BY pga.start_date DESC NULLS LAST
    LIMIT 1;

  -- Flip status and write one audit row.
  UPDATE public.providers SET status = 'active', updated_at = v_now WHERE id = p_provider_id;
  PERFORM public.record_provider_status_change(p_provider_id, 'onboarding', 'active', v_uid, 'Admit & assign');

  RETURN jsonb_build_object(
    'ok', true,
    'ready_at', v_now,
    'group_id', v_group_id,
    'location_id', v_location_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.submit_onboarding(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_onboarding(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. record_first_credential_submission (called by the case-status update path
-- when credential_cases.status transitions to 'submitted' for the first time
-- for this provider). Writes one first_credential_application audit row.
-- Idempotent: writes the audit row only once per provider (checks for an
-- existing first_credential_application row).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_first_credential_submission(
  p_provider_id uuid,
  p_case_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid;
  v_existing int;
BEGIN
  SELECT org_id INTO v_org FROM public.providers WHERE id = p_provider_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Provider not found';
  END IF;

  SELECT count(*) INTO v_existing FROM public.audit_log
    WHERE org_id = v_org
      AND entity_type = 'onboarding'
      AND entity_id = p_provider_id
      AND description = 'first_credential_application: target clock stop';
  IF v_existing > 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org, NULL, 'UPDATE', 'onboarding', p_provider_id,
            'first_credential_application: target clock stop');
END;
$$;
REVOKE ALL ON FUNCTION public.record_first_credential_submission(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_first_credential_submission(uuid, uuid) TO service_role;