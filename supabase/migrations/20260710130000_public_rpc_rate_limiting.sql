-- E0.8 F0.8.8 -- IP-based rate limiting for the four public (anon) RPCs.
--
-- Adds a lightweight server-side throttle to protect the unauthenticated RPC
-- surface from brute-force token guessing (capture links, report shares) and
-- lead-form flooding (inbound leads). Each RPC logs attempts into
-- public_rpc_attempts keyed by a sha256 hash of the client IP; a helper
-- checks the recent count before allowing the call through.
--
-- Token-validation RPCs (validate_capture_token, submit_capture,
-- validate_report_share): 20 FAILED attempts per 15 min per IP. A successful
-- validation marks the attempt valid so it doesn't count toward the cap.
-- Throttled response = same as "invalid" (no oracle).
--
-- Submission RPC (submit_inbound_lead): 5 TOTAL attempts per 60 min per IP
-- (regardless of validity). Throttled response = fake success (same as the
-- honeypot path -- no oracle).
--
-- Additive + idempotent. No pgcrypto (core sha256). SECURITY DEFINER helpers
-- bypass RLS; the table has RLS enabled with no policies (only definer
-- functions and service_role touch it).

----------------------------------------------------------------------
-- 1. Attempt-tracking table
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.public_rpc_attempts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  rpc_name text NOT NULL,
  caller_hash text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  was_valid boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_rpc_attempts_lookup
  ON public.public_rpc_attempts (rpc_name, caller_hash, attempted_at);

ALTER TABLE public.public_rpc_attempts ENABLE ROW LEVEL SECURITY;

-- No policies: only SECURITY DEFINER helpers and service_role touch this table.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_rpc_attempts TO service_role;

----------------------------------------------------------------------
-- 2. Throttle-check helper
----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_rpc_throttle(
  p_rpc_name text,
  p_max_attempts int,
  p_window_minutes int,
  p_count_all boolean DEFAULT false
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_hash text;
  v_count int;
BEGIN
  -- Hash the client IP as the fingerprint (core sha256, no pgcrypto).
  v_caller_hash := encode(sha256(coalesce(inet_client_addr()::text, 'unknown')::bytea), 'hex');

  -- Lazy prune: delete rows older than 2x window for this caller+rpc.
  DELETE FROM public.public_rpc_attempts
  WHERE rpc_name = p_rpc_name
    AND caller_hash = v_caller_hash
    AND attempted_at < now() - make_interval(mins := p_window_minutes * 2);

  -- Count recent attempts: ALL when p_count_all, otherwise only FAILED.
  IF p_count_all THEN
    SELECT count(*) INTO v_count
    FROM public.public_rpc_attempts
    WHERE rpc_name = p_rpc_name
      AND caller_hash = v_caller_hash
      AND attempted_at > now() - make_interval(mins := p_window_minutes);
  ELSE
    SELECT count(*) INTO v_count
    FROM public.public_rpc_attempts
    WHERE rpc_name = p_rpc_name
      AND caller_hash = v_caller_hash
      AND attempted_at > now() - make_interval(mins := p_window_minutes)
      AND NOT was_valid;
  END IF;

  -- Log this attempt (defaults to was_valid = false; the calling RPC updates
  -- to true on success via mark_rpc_attempt_valid).
  INSERT INTO public.public_rpc_attempts (rpc_name, caller_hash)
  VALUES (p_rpc_name, v_caller_hash);

  -- Return true = allowed, false = throttled.
  RETURN v_count < p_max_attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rpc_throttle(text, int, int, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.check_rpc_throttle(text, int, int, boolean) TO anon, authenticated;

----------------------------------------------------------------------
-- 3. Mark-valid helper
----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_rpc_attempt_valid(
  p_rpc_name text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.public_rpc_attempts
  SET was_valid = true
  WHERE id = (
    SELECT id FROM public.public_rpc_attempts
    WHERE rpc_name = p_rpc_name
      AND caller_hash = encode(sha256(coalesce(inet_client_addr()::text, 'unknown')::bytea), 'hex')
    ORDER BY attempted_at DESC
    LIMIT 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_rpc_attempt_valid(text) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_rpc_attempt_valid(text) TO anon, authenticated;

----------------------------------------------------------------------
-- 4a. Redefine validate_capture_token with throttle
----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_capture_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hash text;
  v_link public.party_capture_links%ROWTYPE;
  v_state text;
  v_org_name text;
  v_party public.parties%ROWTYPE;
BEGIN
  -- Rate-limit: 20 failed attempts per 15 min per source IP.
  IF NOT public.check_rpc_throttle('validate_capture_token', 20, 15) THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT * INTO v_link FROM public.party_capture_links WHERE token_hash = v_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  -- Token found: mark this attempt valid so it does not count toward the cap.
  PERFORM public.mark_rpc_attempt_valid('validate_capture_token');

  v_state := v_link.state;
  -- Lazy expiry: keep the stored state fresh when a stale-active link is opened.
  IF v_state = 'active' AND v_link.expires_at <= now() THEN
    UPDATE public.party_capture_links SET state = 'expired' WHERE id = v_link.id;
    v_state := 'expired';
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_link.org_id;
  SELECT * INTO v_party FROM public.parties WHERE id = v_link.party_id;

  IF v_state <> 'active' THEN
    -- Used/expired/revoked lockdown states are the intended terminal UX; carry the
    -- org + recipient name so the page can address them, but no field values.
    RETURN jsonb_build_object(
      'state', v_state,
      'org_name', v_org_name,
      'recipient_name', v_party.name
    );
  END IF;

  RETURN jsonb_build_object(
    'state', 'active',
    'org_name', v_org_name,
    'recipient_name', v_party.name,
    'recipient_email', v_link.recipient_email,
    'expires_at', v_link.expires_at,
    'required_fields', jsonb_build_array(
      'name', 'email', 'phone_office', 'address_line1', 'city', 'state', 'postal_code'),
    'current', jsonb_build_object(
      'name', v_party.name,
      'email', v_party.email,
      'phone_office', v_party.phone_office,
      'phone_mobile', v_party.phone_mobile,
      'address_line1', v_party.address_line1,
      'address_line2', v_party.address_line2,
      'city', v_party.city,
      'state', v_party.state,
      'postal_code', v_party.postal_code,
      'country', v_party.country
    )
  );
END;
$$;

----------------------------------------------------------------------
-- 4b. Redefine submit_capture with throttle
----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_capture(p_token text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hash text;
  v_link public.party_capture_links%ROWTYPE;
BEGIN
  -- Rate-limit: 20 failed attempts per 15 min per source IP.
  IF NOT public.check_rpc_throttle('submit_capture', 20, 15) THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT * INTO v_link FROM public.party_capture_links WHERE token_hash = v_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  -- Token found: mark this attempt valid so it does not count toward the cap.
  PERFORM public.mark_rpc_attempt_valid('submit_capture');

  IF v_link.state <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'state', v_link.state);
  END IF;
  IF v_link.expires_at <= now() THEN
    UPDATE public.party_capture_links SET state = 'expired' WHERE id = v_link.id;
    RETURN jsonb_build_object('ok', false, 'state', 'expired');
  END IF;

  -- Completeness gate (F0.5.3): raises a clear message on any missing field.
  PERFORM public.assert_contact_valid(p_payload, 'This form');

  -- Overwrite the authorized party row (F0.5.3 "overwrites party row", no deletes).
  UPDATE public.parties SET
    name = btrim(p_payload->>'name'),
    email = btrim(p_payload->>'email'),
    phone_office = nullif(btrim(coalesce(p_payload->>'phone_office', '')), ''),
    phone_mobile = nullif(btrim(coalesce(p_payload->>'phone_mobile', '')), ''),
    address_line1 = nullif(btrim(coalesce(p_payload->>'address_line1', '')), ''),
    address_line2 = nullif(btrim(coalesce(p_payload->>'address_line2', '')), ''),
    city = nullif(btrim(coalesce(p_payload->>'city', '')), ''),
    state = nullif(btrim(coalesce(p_payload->>'state', '')), ''),
    postal_code = nullif(btrim(coalesce(p_payload->>'postal_code', '')), ''),
    country = nullif(btrim(coalesce(p_payload->>'country', '')), '')
  WHERE id = v_link.party_id;

  UPDATE public.party_capture_links
    SET state = 'used', used_at = now()
    WHERE id = v_link.id;

  -- Backend logging only (F0.5 non-goal: no UI notification/review). The operator
  -- who issued the link is the actor of record (anon has no auth.uid()).
  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_link.org_id, v_link.created_by, 'UPDATE', 'party', v_link.party_id,
            'Party data captured via one-time link');

  RETURN jsonb_build_object('ok', true, 'state', 'used');
END;
$$;

----------------------------------------------------------------------
-- 4c. Redefine validate_report_share with throttle
----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_report_share(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hash text;
  v_share public.report_shares%ROWTYPE;
  v_state text;
  v_orgs jsonb;
BEGIN
  -- Rate-limit: 20 failed attempts per 15 min per source IP.
  IF NOT public.check_rpc_throttle('validate_report_share', 20, 15) THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT * INTO v_share FROM public.report_shares WHERE token_hash = v_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  -- Token found: mark this attempt valid so it does not count toward the cap.
  PERFORM public.mark_rpc_attempt_valid('validate_report_share');

  v_state := v_share.state;
  IF v_state = 'active' AND v_share.expires_at <= now() THEN
    UPDATE public.report_shares SET state = 'expired' WHERE id = v_share.id;
    v_state := 'expired';
  END IF;
  IF v_state <> 'active' THEN
    RETURN jsonb_build_object('state', v_state);
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_orgs
  FROM (
    SELECT o.id, o.name, o.lifecycle_state, o.created_at
    FROM public.organizations o
    WHERE (
      v_share.scope = 'full'
      AND o.id IN (SELECT m.org_id FROM public.memberships m WHERE m.user_id = v_share.created_by)
    )
    OR (v_share.scope = 'single_org' AND o.id = v_share.scope_org_id)
    ORDER BY o.name
  ) x;

  RETURN jsonb_build_object(
    'state', 'active',
    'report_key', v_share.report_key,
    'scope', v_share.scope,
    'orgs', v_orgs
  );
END;
$$;

----------------------------------------------------------------------
-- 4d. Redefine submit_inbound_lead with throttle
----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_inbound_lead(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text := btrim(coalesce(p_payload->>'contact_email', ''));
  v_email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
BEGIN
  -- Rate-limit: 5 total attempts per 60 min per source IP (all attempts,
  -- not just failed -- this is a submission cap, not a validation cap).
  -- Throttled response = fake success (same as honeypot -- no oracle).
  IF NOT public.check_rpc_throttle('submit_inbound_lead', 5, 60, true) THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- Honeypot: real users never populate this hidden field; bots do. Silently
  -- pretend success so a bot gets no signal, but insert nothing.
  IF btrim(coalesce(p_payload->>'company_website', '')) <> '' THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF btrim(coalesce(p_payload->>'org_name', '')) = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;
  IF btrim(coalesce(p_payload->>'contact_name', '')) = '' THEN
    RAISE EXCEPTION 'Your name is required';
  END IF;
  IF v_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;
  IF v_email !~ v_email_re THEN
    RAISE EXCEPTION 'Email is not valid';
  END IF;
  IF btrim(coalesce(p_payload->>'contact_phone', '')) = '' THEN
    RAISE EXCEPTION 'Phone is required';
  END IF;

  INSERT INTO public.inbound_leads (
    org_name, contact_name, contact_email, contact_phone,
    address_line1, address_line2, city, state, postal_code, country, status
  ) VALUES (
    btrim(p_payload->>'org_name'),
    btrim(p_payload->>'contact_name'),
    v_email,
    nullif(btrim(coalesce(p_payload->>'contact_phone', '')), ''),
    nullif(btrim(coalesce(p_payload->>'address_line1', '')), ''),
    nullif(btrim(coalesce(p_payload->>'address_line2', '')), ''),
    nullif(btrim(coalesce(p_payload->>'city', '')), ''),
    nullif(btrim(coalesce(p_payload->>'state', '')), ''),
    nullif(btrim(coalesce(p_payload->>'postal_code', '')), ''),
    nullif(btrim(coalesce(p_payload->>'country', '')), ''),
    'new'
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;
