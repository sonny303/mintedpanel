-- E4.4 TE-4 — Secure SSN intake link (E0.5 capture-link pattern, E0.7/E0.8
-- hardened). The provider or an authorized org rep enters the full SSN on a
-- minimal branded page reached by a hashed, single-use, provider-bound,
-- time-expiring token — keeping internal staff out of the loop. The value
-- encrypts on submit into the E4.4 vault (previous migration), sets ssn_last4,
-- and is never echoed back (mask only).
--
-- Depends on 20260717120000_ssn_vault.sql (the vault table + _ssn_vault_upsert).
-- Additive + idempotent; only the token HASH is stored (entropy = two
-- gen_random_uuid()s, hashing = core sha256). Applying to hosted is an OPERATOR
-- task (see the PR body).

-- ---------------------------------------------------------------------------
-- The link table carries NO SSN — only the token machinery, exactly like
-- party_capture_links. Single active link per PROVIDER (the partial unique
-- index). state: active|used|expired|revoked.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_ssn_intake_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  token_hash text NOT NULL,
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'used', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_ssn_intake_links_one_active
  ON public.provider_ssn_intake_links (provider_id) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS provider_ssn_intake_links_org_idx
  ON public.provider_ssn_intake_links (org_id);
CREATE INDEX IF NOT EXISTS provider_ssn_intake_links_token_hash_idx
  ON public.provider_ssn_intake_links (token_hash);

ALTER TABLE public.provider_ssn_intake_links ENABLE ROW LEVEL SECURITY;

-- Operators read their org's link state (browser RLS). ALL writes go through the
-- SECURITY DEFINER RPCs below (no authenticated INSERT/UPDATE/DELETE policy).
DROP POLICY IF EXISTS ssil_select_org ON public.provider_ssn_intake_links;
CREATE POLICY ssil_select_org ON public.provider_ssn_intake_links
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids() AS user_org_ids));

GRANT SELECT ON public.provider_ssn_intake_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_ssn_intake_links TO service_role;

-- ---------------------------------------------------------------------------
-- create_ssn_intake_link (operator side, AUTHENTICATED writer). Validates the
-- caller is a writer member of the provider's org, revokes any prior active
-- link for that provider (re-issue = revoke-then-create; the partial unique
-- index guarantees one active at a time), generates a 256-bit token, stores only
-- its hash, audits, and returns the raw token ONCE. The raw token is never
-- persisted and never logged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_ssn_intake_link(
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
    RAISE EXCEPTION 'Not authorized to issue an SSN intake link for this provider';
  END IF;
  IF v_email = '' THEN
    RAISE EXCEPTION 'Recipient email is required';
  END IF;
  IF v_email !~ v_email_re THEN
    RAISE EXCEPTION 'Recipient email is not valid';
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_org;

  -- Re-issue: revoke any existing active link for this provider BEFORE inserting.
  UPDATE public.provider_ssn_intake_links
    SET state = 'revoked'
    WHERE provider_id = p_provider_id AND state = 'active';

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');

  INSERT INTO public.provider_ssn_intake_links
    (org_id, provider_id, recipient_email, token_hash, state, expires_at, created_by)
    VALUES (v_org, p_provider_id, v_email, v_hash, 'active', v_expires, v_uid)
    RETURNING id INTO v_link_id;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org, v_uid, 'CREATE', 'provider_ssn_intake_link', v_link_id,
            'Issued secure SSN intake link to ' || v_email);

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
REVOKE ALL ON FUNCTION public.create_ssn_intake_link(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_ssn_intake_link(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- validate_ssn_intake_token (recipient side, ANON). Hash-validates the token and
-- returns ONLY the single authorized provider/org display context — never any
-- other org's data and never the SSN (there is nothing to prefill; the SSN is
-- write-only). Lazy expiry. Rate-limited (E0.8): 20 failed / 15 min per source
-- IP. Unknown/throttled token -> uniform { state: 'invalid' } (no oracle).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_ssn_intake_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hash text;
  v_link public.provider_ssn_intake_links%ROWTYPE;
  v_state text;
  v_org_name text;
  v_provider_name text;
BEGIN
  IF NOT public.check_rpc_throttle('validate_ssn_intake_token', 20, 15) THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT * INTO v_link FROM public.provider_ssn_intake_links WHERE token_hash = v_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  PERFORM public.mark_rpc_attempt_valid('validate_ssn_intake_token');

  v_state := v_link.state;
  IF v_state = 'active' AND v_link.expires_at <= now() THEN
    UPDATE public.provider_ssn_intake_links SET state = 'expired' WHERE id = v_link.id;
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
REVOKE ALL ON FUNCTION public.validate_ssn_intake_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.validate_ssn_intake_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_ssn_intake_token(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- submit_ssn_intake (recipient side, ANON). Re-validates the token + state +
-- expiry, encrypts the full SSN into the vault via _ssn_vault_upsert (touching
-- ONLY the authorized provider/org), sets ssn_last4, flips the link to 'used',
-- audits the ingress (actor = the operator who issued the link; anon has no
-- auth.uid()), and echoes back ONLY the mask — never the value. The value never
-- enters any other field. Rate-limited (E0.8): 20 failed / 15 min per source IP.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_ssn_intake(p_token text, p_ssn text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hash text;
  v_link public.provider_ssn_intake_links%ROWTYPE;
  v_last4 text;
BEGIN
  IF NOT public.check_rpc_throttle('submit_ssn_intake', 20, 15) THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT * INTO v_link FROM public.provider_ssn_intake_links WHERE token_hash = v_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;

  PERFORM public.mark_rpc_attempt_valid('submit_ssn_intake');

  IF v_link.state <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'state', v_link.state);
  END IF;
  IF v_link.expires_at <= now() THEN
    UPDATE public.provider_ssn_intake_links SET state = 'expired' WHERE id = v_link.id;
    RETURN jsonb_build_object('ok', false, 'state', 'expired');
  END IF;

  -- Encrypt-on-submit into the vault; _ssn_vault_upsert validates the 9-digit
  -- shape (raising, never echoing) and sets providers.ssn_last4.
  v_last4 := public._ssn_vault_upsert(v_link.provider_id, v_link.org_id, p_ssn, v_link.created_by);

  UPDATE public.provider_ssn_intake_links
    SET state = 'used', used_at = now()
    WHERE id = v_link.id;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_link.org_id, v_link.created_by, 'UPDATE', 'provider_ssn_vault', v_link.provider_id,
            'Full SSN captured via secure intake link');

  RETURN jsonb_build_object('ok', true, 'state', 'used', 'mask', '***--' || v_last4);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_ssn_intake(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_ssn_intake(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_ssn_intake(text, text) TO authenticated;
