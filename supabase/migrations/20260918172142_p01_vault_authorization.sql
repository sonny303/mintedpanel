-- P01 / DB-01: fail closed when the caller has no target-org membership.
-- user_role() returns NULL for a missing membership. PL/pgSQL IF does not enter
-- a rejection branch for NULL, so each operator allowlist must be NULL-safe.
-- Preserve the existing RPC signatures, grants, role policy, audit behavior,
-- encrypted storage, and response contracts. Token intake and service-only fill
-- have distinct authorization models and are intentionally unchanged.
-- No data backfill or key rotation. Hosted application requires separate approval.

BEGIN;

CREATE OR REPLACE FUNCTION public.store_ssn(p_provider_id uuid, p_ssn text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_last4 text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT org_id INTO v_org FROM public.providers WHERE id = p_provider_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Provider not found';
  END IF;
  IF (public.user_role(v_org) IN ('admin', 'specialist')) IS NOT TRUE THEN
    RAISE EXCEPTION 'Not authorized to store an SSN for this provider';
  END IF;

  v_last4 := public._ssn_vault_upsert(p_provider_id, v_org, p_ssn, v_uid);

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org, v_uid, 'UPDATE', 'provider_ssn_vault', p_provider_id,
            'Full SSN stored in vault (internal secure entry)');

  RETURN jsonb_build_object('ok', true, 'ssn_last4', v_last4, 'mask', '***--' || v_last4);
END;
$$;
REVOKE ALL ON FUNCTION public.store_ssn(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.store_ssn(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reveal_ssn(p_provider_id uuid, p_justification text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_just text := btrim(coalesce(p_justification, ''));
  v_cipher bytea;
  v_digits text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT org_id INTO v_org FROM public.providers WHERE id = p_provider_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Provider not found';
  END IF;
  IF public.user_role(v_org) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an administrator can reveal a full SSN';
  END IF;
  IF v_just = '' THEN
    RAISE EXCEPTION 'A justification is required to reveal a full SSN';
  END IF;

  SELECT ssn_ciphertext INTO v_cipher
  FROM public.provider_ssn_vault WHERE provider_id = p_provider_id;
  IF v_cipher IS NULL THEN
    RAISE EXCEPTION 'No SSN on file for this provider';
  END IF;
  v_digits := public._ssn_decrypt(v_cipher);

  -- Immutable audit READ: who/when/provider/justification, never the value.
  INSERT INTO public.audit_log
    (org_id, user_id, action_type, entity_type, entity_id, description, after)
    VALUES (v_org, v_uid, 'READ', 'provider_ssn_vault', p_provider_id,
            'Full SSN revealed (admin click-to-reveal)',
            jsonb_build_object('justification', v_just));

  RETURN jsonb_build_object('ssn', v_digits, 'ssn_last4', right(v_digits, 4));
END;
$$;
REVOKE ALL ON FUNCTION public.reveal_ssn(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reveal_ssn(uuid, text) TO authenticated;

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
  IF (public.user_role(v_org) IN ('admin', 'specialist')) IS NOT TRUE THEN
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

COMMIT;
