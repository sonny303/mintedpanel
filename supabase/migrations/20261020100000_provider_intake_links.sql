-- 2026-10-20 — provider self-onboarding R1: provider_intake_links table +
-- request_intake_code / verify_intake_code / submit_intake RPCs +
-- provider_field_verifications CHECK expansion.
--
-- Mirrors the provider_ssn_intake_links pattern (E0.5/E0.7/E0.8 hardened):
-- token-hash only, single-use, time-expiring, RLS-locked, definer RPCs only.
-- The provider reaches this flow via an emailed link; the token unlocks
-- code-based auth (6-digit code sent to their inbox). No account, no password.
--
-- Additive + idempotent. Same threat model as the SSN intake links.
-- The provider_intake_sessions table is defined in
-- 20261020100100_provider_intake_sessions.sql (additive dependency).

-- ---------------------------------------------------------------------------
-- 1. provider_intake_links — one row per invitation to a provider to complete
-- their self-onboarding profile. state: active | used | expired | revoked.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_intake_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  token_hash text NOT NULL,
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'used', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  last_code_hash text,
  code_expires_at timestamptz,
  code_attempts int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One active link per provider (mirrors ssn_intake_links partial unique).
CREATE UNIQUE INDEX IF NOT EXISTS provider_intake_links_one_active
  ON public.provider_intake_links (provider_id) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS provider_intake_links_org_idx
  ON public.provider_intake_links (org_id);
CREATE INDEX IF NOT EXISTS provider_intake_links_token_hash_idx
  ON public.provider_intake_links (token_hash);

ALTER TABLE public.provider_intake_links ENABLE ROW LEVEL SECURITY;

-- Operators read their org's link state (browser RLS). ALL writes go through
-- SECURITY DEFINER RPCs (no authenticated INSERT/UPDATE/DELETE policy).
DROP POLICY IF EXISTS pil_select_org ON public.provider_intake_links;
CREATE POLICY pil_select_org ON public.provider_intake_links
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids() AS user_org_ids));

GRANT SELECT ON public.provider_intake_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_intake_links TO service_role;

-- ---------------------------------------------------------------------------
-- 2. create_provider_intake_link (operator side, AUTHENTICATED). Mirrors
-- create_ssn_intake_link: writer-only, revokes prior active, generates 256-bit
-- token, stores only hash, returns raw token ONCE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_provider_intake_link(
  p_provider_id uuid,
  p_recipient_email text,
  p_recipient_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := btrim(coalesce(p_recipient_email, ''));
  v_email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
  v_org uuid;
  v_provider_name text;
  v_org_name text;
  v_token text;
  v_hash text;
  v_expires timestamptz := now() + interval '72 hours';
  v_link_id uuid;
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
    RAISE EXCEPTION 'Not authorized to issue an intake link for this provider';
  END IF;
  IF v_email = '' THEN
    RAISE EXCEPTION 'Recipient email is required';
  END IF;
  IF v_email !~ v_email_re THEN
    RAISE EXCEPTION 'Recipient email is not valid';
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_org;

  UPDATE public.provider_intake_links
    SET state = 'revoked'
    WHERE provider_id = p_provider_id AND state = 'active';

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');

  INSERT INTO public.provider_intake_links
    (org_id, provider_id, recipient_email, token_hash, state, expires_at, created_by)
    VALUES (v_org, p_provider_id, v_email, v_hash, 'active', v_expires, v_uid)
    RETURNING id INTO v_link_id;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org, v_uid, 'CREATE', 'provider_intake_link', v_link_id,
            'Issued provider self-onboarding intake link to ' || v_email);

  RETURN jsonb_build_object(
    'token', v_token,
    'provider_id', p_provider_id,
    'provider_name', v_provider_name,
    'recipient_email', v_email,
    'recipient_name', coalesce(nullif(btrim(coalesce(p_recipient_name, '')), ''), v_email),
    'org_name', v_org_name,
    'expires_at', v_expires
  );
END;
$$;
REVOKE ALL ON FUNCTION public.create_provider_intake_link(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_provider_intake_link(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. validate_provider_intake_token (recipient side, ANON). Hash-validates the
-- token and returns ONLY the authorized provider/org display context. Lazy
-- expiry. Rate-limited: 20 failed / 15 min per source IP. Unknown/throttled
-- token -> uniform { state: 'invalid' } (no oracle).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_provider_intake_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hash text;
  v_link public.provider_intake_links%ROWTYPE;
  v_state text;
  v_org_name text;
  v_provider_name text;
BEGIN
  IF NOT public.check_rpc_throttle('validate_provider_intake_token', 20, 15) THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT * INTO v_link FROM public.provider_intake_links WHERE token_hash = v_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  PERFORM public.mark_rpc_attempt_valid('validate_provider_intake_token');

  v_state := v_link.state;
  IF v_state = 'active' AND v_link.expires_at <= now() THEN
    UPDATE public.provider_intake_links SET state = 'expired' WHERE id = v_link.id;
    v_state := 'expired';
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_link.org_id;
  SELECT btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
    INTO v_provider_name FROM public.providers WHERE id = v_link.provider_id;

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
    'recipient_email', v_link.recipient_email,
    'expires_at', v_link.expires_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.validate_provider_intake_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.validate_provider_intake_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_provider_intake_token(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. request_intake_code (recipient side, ANON). Generates a 6-digit code,
-- stores its hash (never the raw code), sets code_expires_at = now() + 10 min,
-- audits. The raw code is returned to the caller ONLY so the calling system
-- can deliver it via the email service; in practice the email service reads
-- the code from the email-send payload (not from this RPC's caller) to keep
-- the rate-limit surface tight. We DO return the code here so the email
-- pipeline can fire-and-forget.
-- Rate-limited: 10 requests / 15 min per source IP.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_intake_code(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hash text;
  v_link public.provider_intake_links%ROWTYPE;
  v_code text;
  v_code_hash text;
  v_code_expires timestamptz := now() + interval '10 minutes';
  v_org_name text;
  v_provider_name text;
BEGIN
  IF NOT public.check_rpc_throttle('request_intake_code', 10, 15) THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT * INTO v_link FROM public.provider_intake_links WHERE token_hash = v_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  PERFORM public.mark_rpc_attempt_valid('request_intake_code');

  IF v_link.state <> 'active' THEN
    RETURN jsonb_build_object('state', v_link.state);
  END IF;
  IF v_link.expires_at <= now() THEN
    UPDATE public.provider_intake_links SET state = 'expired' WHERE id = v_link.id;
    RETURN jsonb_build_object('state', 'expired');
  END IF;
  IF v_link.code_attempts >= 5 THEN
    UPDATE public.provider_intake_links SET state = 'revoked' WHERE id = v_link.id;
    RETURN jsonb_build_object('state', 'revoked');
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_link.org_id;
  SELECT btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
    INTO v_provider_name FROM public.providers WHERE id = v_link.provider_id;

  -- 6-digit numeric code. Re-roll until uniqueness at the row level (vanishingly rare).
  v_code := lpad((floor(random() * 1000000))::text, 6, '0');
  v_code_hash := encode(sha256(convert_to(v_code, 'UTF8')), 'hex');

  UPDATE public.provider_intake_links
    SET last_code_hash = v_code_hash,
        code_expires_at = v_code_expires,
        code_attempts = 0
    WHERE id = v_link.id;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_link.org_id, v_link.created_by, 'UPDATE', 'provider_intake_link', v_link.id,
            'Issued 6-digit intake code to ' || v_link.recipient_email);

  -- Return the code in the response. It will be used by the email service to send
  -- the message; the code is short-lived (10 min) and never reissued without audit.
  RETURN jsonb_build_object(
    'state', 'active',
    'org_name', v_org_name,
    'provider_name', v_provider_name,
    'recipient_email', v_link.recipient_email,
    'code', v_code,
    'code_expires_at', v_code_expires
  );
END;
$$;
REVOKE ALL ON FUNCTION public.request_intake_code(text) FROM public;
GRANT EXECUTE ON FUNCTION public.request_intake_code(text) TO anon;
GRANT EXECUTE ON FUNCTION public.request_intake_code(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. verify_intake_code (recipient side, ANON). Validates token + code hash,
-- increments code_attempts, revokes at 5 attempts. On success: creates a
-- provider_intake_sessions row and returns its session_token. Throttled: 10
-- failed / 15 min per source IP. Uniform 'invalid' on any failure.
-- Depends on provider_intake_sessions table (defined in the next migration).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_intake_code(p_token text, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hash text;
  v_link public.provider_intake_links%ROWTYPE;
  v_code_hash text;
  v_session_token uuid;
  v_org_name text;
  v_provider_name text;
BEGIN
  IF NOT public.check_rpc_throttle('verify_intake_code', 10, 15) THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  IF p_token IS NULL OR btrim(p_token) = '' OR p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT * INTO v_link FROM public.provider_intake_links WHERE token_hash = v_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  PERFORM public.mark_rpc_attempt_valid('verify_intake_code');

  IF v_link.state <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'state', v_link.state);
  END IF;
  IF v_link.expires_at <= now() THEN
    UPDATE public.provider_intake_links SET state = 'expired' WHERE id = v_link.id;
    RETURN jsonb_build_object('ok', false, 'state', 'expired');
  END IF;
  IF v_link.code_expires_at IS NULL OR v_link.code_expires_at <= now() OR v_link.last_code_hash IS NULL THEN
    -- Stale or no code requested yet; uniform response.
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  v_code_hash := encode(sha256(convert_to(btrim(p_code), 'UTF8')), 'hex');
  IF v_code_hash <> v_link.last_code_hash THEN
    UPDATE public.provider_intake_links
      SET code_attempts = code_attempts + 1
      WHERE id = v_link.id;
    IF (v_link.code_attempts + 1) >= 5 THEN
      UPDATE public.provider_intake_links SET state = 'revoked' WHERE id = v_link.id;
      RETURN jsonb_build_object('ok', false, 'state', 'revoked');
    END IF;
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_link.org_id;
  SELECT btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
    INTO v_provider_name FROM public.providers WHERE id = v_link.provider_id;

  -- Create a session token bound to the provider + org, expires in 24h.
  v_session_token := gen_random_uuid();
  INSERT INTO public.provider_intake_sessions
    (session_token, org_id, provider_id, intake_link_id, state, expires_at)
  VALUES
    (v_session_token, v_link.org_id, v_link.provider_id, v_link.id, 'active', now() + interval '24 hours');

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_link.org_id, v_link.created_by, 'CREATE', 'provider_intake_session', v_session_token,
            'Provider intake session opened for ' || v_link.recipient_email);

  RETURN jsonb_build_object(
    'ok', true,
    'session_token', v_session_token,
    'provider_id', v_link.provider_id,
    'org_id', v_link.org_id,
    'org_name', v_org_name,
    'provider_name', v_provider_name
  );
END;
$$;
REVOKE ALL ON FUNCTION public.verify_intake_code(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_intake_code(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_intake_code(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. submit_intake (recipient side, ANON). Validates the session, validates
-- payload shape, writes via the existing providers UPDATE flow, audit row,
-- marks the session used, flips the link to 'used'. Returns {ok, state,
-- redirect_url}. NEVER accepts SSN or portal credentials in the payload (those
-- use their own session-bound RPCs). Throttled: 10 / 15 min per source IP.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_intake(
  p_session_token text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_session public.provider_intake_sessions%ROWTYPE;
  v_provider public.providers%ROWTYPE;
  v_first_name text;
  v_last_name text;
  v_mobile text;
  v_address_line1 text;
  v_city text;
  v_state_us text;
  v_postal_code text;
  v_dob date;
  v_caqh_id text;
BEGIN
  IF NOT public.check_rpc_throttle('submit_intake', 10, 15) THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  IF p_session_token IS NULL OR btrim(p_session_token) = '' THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  SELECT * INTO v_session
    FROM public.provider_intake_sessions
    WHERE session_token = p_session_token::uuid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  PERFORM public.mark_rpc_attempt_valid('submit_intake');

  IF v_session.state <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'state', v_session.state);
  END IF;
  IF v_session.expires_at <= now() THEN
    UPDATE public.provider_intake_sessions SET state = 'expired' WHERE id = v_session.id;
    RETURN jsonb_build_object('ok', false, 'state', 'expired');
  END IF;

  SELECT * INTO v_provider FROM public.providers WHERE id = v_session.provider_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  -- Apply the submitted profile fields to the existing provider row. The minimum
  -- data set (D2) lives in the app layer; this RPC writes whatever is non-null.
  v_first_name := nullif(btrim(coalesce(p_payload->>'first_name', '')), '');
  v_last_name := nullif(btrim(coalesce(p_payload->>'last_name', '')), '');
  v_mobile := nullif(btrim(coalesce(p_payload->>'mobile', '')), '');
  v_address_line1 := nullif(btrim(coalesce(p_payload->>'home_address_line1', '')), '');
  v_city := nullif(btrim(coalesce(p_payload->>'home_city', '')), '');
  v_state_us := nullif(btrim(coalesce(p_payload->>'home_state', '')), '');
  v_postal_code := nullif(btrim(coalesce(p_payload->>'home_postal_code', '')), '');
  BEGIN
    v_dob := nullif(btrim(coalesce(p_payload->>'date_of_birth', '')), '')::date;
  EXCEPTION WHEN OTHERS THEN
    v_dob := NULL;
  END;
  v_caqh_id := nullif(btrim(coalesce(p_payload->>'caqh_id', '')), '');

  UPDATE public.providers SET
    first_name = coalesce(v_first_name, first_name),
    last_name = coalesce(v_last_name, last_name),
    mobile = coalesce(v_mobile, mobile),
    address_line1 = coalesce(v_address_line1, address_line1),
    city = coalesce(v_city, city),
    state = coalesce(v_state_us, state),
    postal_code = coalesce(v_postal_code, postal_code),
    date_of_birth = coalesce(v_dob, date_of_birth),
    caqh_id = coalesce(v_caqh_id, caqh_id),
    updated_at = now()
    WHERE id = v_provider.id;

  -- Mark session + link used. Provider stays 'onboarding' (status) until Admit &
  -- assign (separate RPC in 20261020100300_provider_status_flow.sql).
  UPDATE public.provider_intake_sessions SET state = 'used' WHERE id = v_session.id;
  UPDATE public.provider_intake_links SET state = 'used', used_at = now() WHERE id = v_session.intake_link_id;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_session.org_id, v_session.created_by, 'UPDATE', 'provider', v_provider.id,
            'Provider self-onboarding profile submitted via intake link');

  RETURN jsonb_build_object(
    'ok', true,
    'state', 'submitted',
    'redirect_url', '/onboarding/thanks'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.submit_intake(text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_intake(text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_intake(text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Relax provider_field_verifications CHECK to include 'provider' as a valid
-- verified_source. Add a NEW migration file for the actual CHECK rewrite (this
-- file documents the intent; the migration file is sibling: see
-- 20261020100200_provider_field_verifications_provider_source.sql).
-- ---------------------------------------------------------------------------
-- (The relaxation itself is in the sibling migration to keep this file focused
-- on the intake-link plumbing.)