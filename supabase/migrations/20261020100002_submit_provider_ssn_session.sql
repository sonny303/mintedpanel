-- Provider self-onboarding — session-bound SSN submission.
--
-- The E4.4 intake path (20260717120100) hands the provider a one-time LINK.
-- This is the second, narrower mechanism: a provider who is already IN an
-- onboarding session (their own authenticated browser, or a coordinator-driven
-- flow) calls submit_provider_ssn with the SESSION handle rather than clicking
-- through a fresh link. Same destination vault, same rules: encrypt on submit,
-- echo the mask only, audit the ingress.
--
-- The session row carries NO SSN — only the session machinery, exactly like
-- provider_ssn_intake_links. The value encrypts straight into provider_ssn_vault.
--
-- Swarm 2 owns provider_intake_links (request_intake_code / verify_intake_code).
-- This migration deliberately does NOT reference that table: the session
-- mechanism stands alone, and submit_provider_ssn works without it.
--
-- Depends on 20260717120000_ssn_vault.sql (vault + key + _ssn_vault_upsert) and
-- 20260710130000_public_rpc_rate_limiting.sql (check_rpc_throttle /
-- mark_rpc_attempt_valid). Additive + idempotent.

-- ---------------------------------------------------------------------------
-- provider_intake_sessions: one ACTIVE session per provider (partial unique
-- index). state: active|used|expired|revoked, mirroring the intake-link states.
-- The id IS the capability the provider submits against — a uuidv4 has ~122 bits
-- of entropy, and the row is short-lived AND single-use, so a hash column (the
-- intake-link posture) would buy nothing here. Upgrade = add token_hash if the
-- session ever has to survive being observed in a URL or a referrer header.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_intake_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'used', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_intake_sessions_one_active
  ON public.provider_intake_sessions (provider_id) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS provider_intake_sessions_org_idx
  ON public.provider_intake_sessions (org_id);

ALTER TABLE public.provider_intake_sessions ENABLE ROW LEVEL SECURITY;

-- Operators read their org's session state (browser RLS), exactly like the
-- intake-link surface. ALL writes go through the SECURITY DEFINER RPCs below
-- (no authenticated INSERT/UPDATE/DELETE policy).
DROP POLICY IF EXISTS provider_intake_sessions_select_org ON public.provider_intake_sessions;
CREATE POLICY provider_intake_sessions_select_org ON public.provider_intake_sessions
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids() AS user_org_ids));

REVOKE ALL ON public.provider_intake_sessions FROM anon;
GRANT SELECT ON public.provider_intake_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_intake_sessions TO service_role;

-- ---------------------------------------------------------------------------
-- create_intake_session (operator side, AUTHENTICATED writer). Opens (or
-- re-opens — the RPC revokes any prior active session for the provider first;
-- the partial unique index guarantees one at a time) a session for a provider
-- and returns its id ONCE for the caller to hand to the provider. Revoked
-- sessions keep their row; nothing is deleted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_intake_session(
  p_provider_id uuid,
  p_expires_minutes int DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_provider_name text;
  v_org_name text;
  v_expires timestamptz;
  v_session_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT org_id, btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
    INTO v_org, v_provider_name
    FROM public.providers WHERE id = p_provider_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Provider not found';
  END IF;
  IF public.user_role(v_org) NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'Not authorized to open an intake session for this provider';
  END IF;

  -- Re-open: revoke any existing active session BEFORE inserting.
  UPDATE public.provider_intake_sessions
    SET state = 'revoked'
    WHERE provider_id = p_provider_id AND state = 'active';

  v_expires := now() + make_interval(mins => least(greatest(coalesce(p_expires_minutes, 60), 5), 1440));
  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_org;

  INSERT INTO public.provider_intake_sessions
    (org_id, provider_id, state, expires_at, created_by)
  VALUES (v_org, p_provider_id, 'active', v_expires, v_uid)
  RETURNING id INTO v_session_id;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org, v_uid, 'CREATE', 'provider_intake_session', v_session_id,
            'Opened a provider intake session');

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', v_session_id,
    'provider_id', p_provider_id,
    'provider_name', v_provider_name,
    'org_name', v_org_name,
    'expires_at', v_expires
  );
END;
$$;
REVOKE ALL ON FUNCTION public.create_intake_session(uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_intake_session(uuid, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- validate_intake_session (provider side, ANON). Resolves the session handle
-- and returns ONLY the single authorized provider/org display context — never
-- another org's data and never the SSN (write-only ingress). Lazy expiry.
-- Rate-limited (E0.8): 20 failed / 15 min per source IP. Unknown, throttled,
-- non-active and expired all return a uniform state vocabulary
-- (invalid|expired|used|active) so this is not a session oracle.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_intake_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_session public.provider_intake_sessions%ROWTYPE;
  v_state text;
  v_org_name text;
  v_provider_name text;
BEGIN
  IF NOT public.check_rpc_throttle('validate_intake_session', 20, 15) THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  SELECT * INTO v_session FROM public.provider_intake_sessions WHERE id = p_session_id;
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
REVOKE ALL ON FUNCTION public.validate_intake_session(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.validate_intake_session(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_intake_session(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- submit_provider_ssn (provider side, ANON). The session-bound SSN write path:
-- re-validates the session + state + expiry, encrypts the full SSN into the
-- vault via _ssn_vault_upsert (touching ONLY the authorized provider/org and
-- setting providers.ssn_last4), flips the session to 'used', audits the ingress
-- (actor = the operator who opened the session; anon has no auth.uid()), and
-- echoes back ONLY the mask — never the value. The value never enters any other
-- field. Rate-limited (E0.8): 20 failed / 15 min per source IP, uniform states.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_provider_ssn(
  p_session_id uuid,
  p_ssn text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_session public.provider_intake_sessions%ROWTYPE;
  v_last4 text;
BEGIN
  IF NOT public.check_rpc_throttle('submit_provider_ssn', 20, 15) THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;
  SELECT * INTO v_session FROM public.provider_intake_sessions WHERE id = p_session_id;
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

  -- Encrypt-on-submit into the vault; _ssn_vault_upsert validates the 9-digit
  -- shape (raising, never echoing) and sets providers.ssn_last4.
  v_last4 := public._ssn_vault_upsert(
    v_session.provider_id, v_session.org_id, p_ssn, v_session.created_by
  );

  UPDATE public.provider_intake_sessions
    SET state = 'used', used_at = now()
    WHERE id = v_session.id;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_session.org_id, v_session.created_by, 'UPDATE', 'provider_ssn_vault',
            v_session.provider_id, 'Full SSN captured via provider intake session');

  RETURN jsonb_build_object('ok', true, 'state', 'used', 'mask', '***--' || v_last4);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_provider_ssn(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_provider_ssn(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_provider_ssn(uuid, text) TO authenticated;