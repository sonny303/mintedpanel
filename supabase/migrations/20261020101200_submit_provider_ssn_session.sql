-- Provider self-onboarding — the session-bound SSN submission path.
--
-- The E4.4 intake path (20260717120100) hands the provider a one-time LINK. This
-- is the second, narrower mechanism for the self-onboarding flow: the provider
-- has already proven identity via verify_intake_code (which minted a
-- provider_intake_sessions row and returned its session_token), so they submit
-- their SSN against that session rather than clicking through a fresh link.
--
-- Same destination vault, same rules as submit_ssn_intake: encrypt on submit,
-- echo the mask only, audit the ingress, flip the session to 'used'.
--
-- Depends on 20260717120000_ssn_vault.sql (vault + key + _ssn_vault_upsert),
-- 20260710130000_public_rpc_rate_limiting.sql (check_rpc_throttle /
-- mark_rpc_attempt_valid) and 20261020100100_provider_intake_sessions.sql (the
-- session table). Additive + idempotent.

-- ---------------------------------------------------------------------------
-- submit_provider_ssn (provider side, ANON). Re-validates the session + state +
-- expiry, encrypts the full SSN into the vault via _ssn_vault_upsert (touching
-- ONLY the authorized provider/org and setting providers.ssn_last4), flips the
-- session to 'used' so the token cannot be replayed, audits the ingress (actor =
-- the operator who issued the link; anon has no auth.uid()), and echoes back ONLY
-- the mask — never the value. The value never enters any other field.
--
-- Rate-limited (E0.8): 20 failed / 15 min per source IP. Unknown, throttled,
-- non-active and expired answers come from one uniform state vocabulary
-- (invalid|expired|used|revoked|active), so this is not a session oracle.
--
-- The session handle is the provider_intake_sessions.id, carried across the wire
-- as the opaque session_token minted by verify_intake_code; taking it as text
-- (not uuid) keeps a malformed value on the uniform 'invalid' path instead of a
-- Postgres cast error that would leak that the shape is wrong.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_provider_ssn(
  p_session_token text,
  p_ssn text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_session_id uuid;
  v_session public.provider_intake_sessions%ROWTYPE;
  v_actor uuid;
  v_last4 text;
BEGIN
  IF NOT public.check_rpc_throttle('submit_provider_ssn', 20, 15) THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  IF p_session_token IS NULL OR btrim(p_session_token) = ''
     OR btrim(p_session_token) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;
  v_session_id := btrim(p_session_token)::uuid;

  -- v_actor is the OPERATOR who issued the LINK. NOT v_session.created_by:
  -- verify_intake_code creates the session without populating that column, so it
  -- is always NULL and would leave the SSN ingress audit unattributed.
  -- provider_intake_links.created_by is NOT NULL and the session already joins
  -- its link, so this is the same attribution submit_ssn_intake uses for the
  -- link path (20260717120100). Postgres rejects a %ROWTYPE in a multi-item
  -- INTO, so the actor lands in its own scalar from the same row.
  SELECT l.created_by INTO v_actor
    FROM public.provider_intake_sessions s
    JOIN public.provider_intake_links l ON l.id = s.intake_link_id
   WHERE s.session_token = v_session_id;
  SELECT s.* INTO v_session
    FROM public.provider_intake_sessions s
    JOIN public.provider_intake_links l ON l.id = s.intake_link_id
   WHERE s.session_token = v_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  PERFORM public.mark_rpc_attempt_valid('submit_provider_ssn');

  IF v_session.state <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'state', v_session.state);
  END IF;
  IF v_session.expires_at <= now() THEN
    UPDATE public.provider_intake_sessions SET state = 'expired' WHERE id = v_session.id;
    RETURN jsonb_build_object('ok', false, 'state', 'expired');
  END IF;

  -- The link must still be live too: a revoked link must not be able to finish
  -- the session it opened.
  IF NOT EXISTS (
    SELECT 1 FROM public.provider_intake_links l
    WHERE l.id = v_session.intake_link_id AND l.state = 'active'
  ) THEN
    UPDATE public.provider_intake_sessions SET state = 'revoked' WHERE id = v_session.id;
    RETURN jsonb_build_object('ok', false, 'state', 'revoked');
  END IF;

  -- Encrypt-on-submit into the vault; _ssn_vault_upsert validates the 9-digit
  -- shape (raising, never echoing) and sets providers.ssn_last4.
  v_last4 := public._ssn_vault_upsert(
    v_session.provider_id, v_session.org_id, p_ssn, v_actor
  );

  -- provider_intake_sessions has no used_at column (the link does; the session
  -- records only its terminal state), so the flip is the whole write.
  UPDATE public.provider_intake_sessions
    SET state = 'used'
    WHERE id = v_session.id;

  -- Audit actor is the operator who ISSUED THE LINK (v_actor), not
  -- auth.uid(): the submitter is an anon provider with no authenticated session,
  -- so there is no real caller to attribute. Same attribution as
  -- submit_ssn_intake for the link path (20260717120100). The provider identity
  -- is v_session.provider_id / intake_link_id.
  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_session.org_id, v_actor, 'UPDATE', 'provider_ssn_vault',
            v_session.provider_id, 'Full SSN captured via provider self-onboarding session');

  RETURN jsonb_build_object('ok', true, 'state', 'used', 'mask', '***--' || v_last4);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_provider_ssn(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_provider_ssn(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_provider_ssn(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- validate_intake_session (provider side, ANON). Resolves the session handle and
-- returns ONLY the single authorized provider/org display context — never another
-- org's data and never the SSN (write-only ingress; there is nothing to prefill).
-- Lazy expiry. Rate-limited (E0.8): 20 failed / 15 min per source IP, uniform
-- states so this is not a session oracle.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_intake_session(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_session_id uuid;
  v_session public.provider_intake_sessions%ROWTYPE;
  v_state text;
  v_org_name text;
  v_provider_name text;
BEGIN
  IF NOT public.check_rpc_throttle('validate_intake_session', 20, 15) THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  IF p_session_token IS NULL OR btrim(p_session_token) = ''
     OR btrim(p_session_token) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  v_session_id := btrim(p_session_token)::uuid;

  SELECT s.* INTO v_session
    FROM public.provider_intake_sessions s
    JOIN public.provider_intake_links l ON l.id = s.intake_link_id
   WHERE s.session_token = v_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  PERFORM public.mark_rpc_attempt_valid('validate_intake_session');

  v_state := v_session.state;
  IF v_state = 'active' AND v_session.expires_at <= now() THEN
    UPDATE public.provider_intake_sessions SET state = 'expired' WHERE id = v_session.id;
    v_state := 'expired';
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_session.org_id;
  SELECT btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
    INTO v_provider_name FROM public.providers WHERE id = v_session.provider_id;

  IF v_state <> 'active' THEN
    RETURN jsonb_build_object(
      'state', v_state,
      'org_name', v_org_name,
      'provider_name', v_provider_name
    );
  END IF;

  RETURN jsonb_build_object(
    'state', 'active',
    'org_name', v_org_name,
    'provider_name', v_provider_name,
    'expires_at', v_session.expires_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.validate_intake_session(text) FROM public;
GRANT EXECUTE ON FUNCTION public.validate_intake_session(text) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_intake_session(text) TO authenticated;