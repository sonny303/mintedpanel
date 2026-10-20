-- Provider self-onboarding — portal credential RPCs. Depends on
-- 20261020101000_create_provider_portal_credentials.sql (the table) and
-- 20260717120000_ssn_vault.sql / 20260718020000 (the key + crypto helpers, which
-- this reuses verbatim rather than re-implementing).
--
-- Three narrow definer functions, mirroring the E4.4 SSN vault exactly:
--   store_portal_credential              authenticated, writer roles, audited
--   reveal_portal_credential              authenticated, writer roles + justification
--   release_portal_credential_for_fill    service_role ONLY, active-fill context
--
-- NONE of them ever logs or audits the value, and none returns a stored password
-- outside the explicit reveal / fill-release payloads.

-- ---------------------------------------------------------------------------
-- _portal_vault_upsert — the shared write path, the exact analogue of
-- _ssn_vault_upsert. Encrypts INSIDE the definer boundary using the same
-- server-held key as the SSN vault, upserts the (provider, portal) row, and
-- stamps rotated_at so a re-store is visibly a rotation. The plaintext lives
-- only in this function's locals for the duration of the call.
--
-- Returns jsonb metadata (never the password) so callers can assert ok without
-- a second round trip.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._portal_vault_upsert(
  p_provider_id uuid,
  p_org_id uuid,
  p_portal text,
  p_username text,
  p_password text,
  p_uid uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_portal text := lower(btrim(coalesce(p_portal, '')));
  v_user text := btrim(coalesce(p_username, ''));
  v_pass text := coalesce(p_password, '');
BEGIN
  IF v_portal NOT IN ('caqh', 'pecos') THEN
    RAISE EXCEPTION 'Unsupported portal';
  END IF;
  IF v_user = '' THEN
    RAISE EXCEPTION 'A portal username is required';
  END IF;
  -- The message NEVER echoes the value (not even its length).
  IF v_pass = '' OR char_length(v_pass) > 512 THEN
    RAISE EXCEPTION 'A portal password is required';
  END IF;

  INSERT INTO public.provider_portal_credentials
    (provider_id, portal, org_id, username, password_ciphertext, algo, key_version,
     rotated_at, created_by, updated_by)
  VALUES
    (p_provider_id, v_portal, p_org_id, v_user,
     extensions.pgp_sym_encrypt(v_pass, public._ssn_vault_key()),
     'pgcrypto:pgp_sym', 1, now(), p_uid, p_uid)
  ON CONFLICT (provider_id, portal) DO UPDATE SET
    username = excluded.username,
    password_ciphertext = excluded.password_ciphertext,
    algo = excluded.algo,
    key_version = excluded.key_version,
    rotated_at = now(),
    updated_by = p_uid,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'provider_id', p_provider_id,
    'org_id', p_org_id,
    'portal', v_portal,
    'username', v_user,
    'rotated_at', now()
  );
END;
$$;
REVOKE ALL ON FUNCTION public._portal_vault_upsert(uuid, uuid, text, text, text, uuid)
  FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- store_portal_credential (AUTHENTICATED, writer roles admin|specialist).
-- The authenticated write path for a portal login, wherever it is entered.
-- Encrypts on save, audits the write, returns metadata only — NEVER the password.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.store_portal_credential(
  p_provider_id uuid,
  p_portal text,
  p_username text,
  p_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT org_id INTO v_org FROM public.providers WHERE id = p_provider_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Provider not found';
  END IF;
  -- IS NOT TRUE, not NOT IN: user_role() returns NULL when the caller has no
  -- membership row for this org, and `NULL NOT IN (...)` is NULL, so a plain
  -- NOT IN would let a non-member skip this raise entirely.
  IF (public.user_role(v_org) IN ('admin', 'specialist')) IS NOT TRUE THEN
    RAISE EXCEPTION 'Not authorized to store a portal credential for this provider';
  END IF;

  v_result := public._portal_vault_upsert(
    p_provider_id, v_org, p_portal, p_username, p_password, v_uid
  );

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org, v_uid, 'UPDATE', 'provider_portal_credential', p_provider_id,
            'Portal credential stored (password encrypted)');

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.store_portal_credential(uuid, text, text, text)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.store_portal_credential(uuid, text, text, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- reveal_portal_credential (AUTHENTICATED, ADMIN-ONLY, the same tier as
-- reveal_ssn). A portal password is a weaker secret than an SSN in one respect
-- and stronger in another: it is less sensitive per-field, but it unlocks a
-- LIVE external account. Matching the stricter SSN posture, reveal is
-- admin-only while store stays writer-level (admin|specialist), which is the
-- split the PM locked for the SSN vault on 2026-07-14.
-- Requires a non-empty justification,
-- decrypts inside the function, and returns the plaintext exactly once for a
-- brief client-side auto-rehide window. Writes an immutable audit READ carrying
-- who/when/which-provider/which-portal/justification — NEVER the value. Touches
-- last_verified_at: a reveal is this login proving it still works.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reveal_portal_credential(
  p_provider_id uuid,
  p_portal text,
  p_justification text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_just text := btrim(coalesce(p_justification, ''));
  v_portal text := lower(btrim(coalesce(p_portal, '')));
  v_row public.provider_portal_credentials%ROWTYPE;
  v_pass text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT org_id INTO v_org FROM public.providers WHERE id = p_provider_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Provider not found';
  END IF;
  -- IS DISTINCT FROM, not <>: user_role() returns NULL for a non-member, and
  -- `NULL <> 'admin'` is NULL, so a plain <> would skip the raise entirely.
  IF public.user_role(v_org) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not authorized to reveal a portal credential for this provider';
  END IF;
  IF v_just = '' THEN
    RAISE EXCEPTION 'A justification is required to reveal a portal credential';
  END IF;

  SELECT * INTO v_row FROM public.provider_portal_credentials
    WHERE provider_id = p_provider_id AND portal = v_portal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No portal credential on file for this provider';
  END IF;

  v_pass := public._ssn_decrypt(v_row.password_ciphertext);

  UPDATE public.provider_portal_credentials
    SET last_verified_at = now(), updated_at = now(), updated_by = v_uid
    WHERE provider_id = p_provider_id AND portal = v_portal;

  -- Immutable audit READ: who/when/provider/portal/justification, never the value.
  INSERT INTO public.audit_log
    (org_id, user_id, action_type, entity_type, entity_id, description, after)
    VALUES (v_org, v_uid, 'READ', 'provider_portal_credential', p_provider_id,
            'Portal credential revealed (click-to-reveal)',
            jsonb_build_object('portal', v_portal, 'justification', v_just));

  RETURN jsonb_build_object(
    'portal', v_portal,
    'username', v_row.username,
    'password', v_pass,
    'last_verified_at', now()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reveal_portal_credential(uuid, text, text)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reveal_portal_credential(uuid, text, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- release_portal_credential_for_fill (fill-only release, SERVICE_ROLE ONLY).
-- Called exclusively from the guarded /api layer (the extension fill path), never
-- by a browser or anon client: EXECUTE is granted to service_role only. The /api
-- guard resolves the caller's org from the JWT and the handler writes the READ
-- audit row with the real actor (the service-role RPC has no auth.uid()); this
-- RPC is the last wall — it re-validates the active fill context (the case must
-- exist, belong to p_org_id, and be this provider's case) before decrypting.
-- Requests outside an active fill context are rejected. Returns the login once
-- into the fill payload; the handler sets Cache-Control: no-store.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_portal_credential_for_fill(
  p_provider_id uuid,
  p_org_id uuid,
  p_case_id uuid,
  p_portal text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_portal text := lower(btrim(coalesce(p_portal, '')));
  v_row public.provider_portal_credentials%ROWTYPE;
  v_pass text;
BEGIN
  IF p_case_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.credential_cases c
    WHERE c.id = p_case_id
      AND c.org_id = p_org_id
      AND c.provider_id = p_provider_id
  ) THEN
    RAISE EXCEPTION 'Portal credential release requires an active fill context';
  END IF;

  SELECT * INTO v_row FROM public.provider_portal_credentials
    WHERE provider_id = p_provider_id AND org_id = p_org_id AND portal = v_portal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No portal credential on file for this provider';
  END IF;
  v_pass := public._ssn_decrypt(v_row.password_ciphertext);

  RETURN jsonb_build_object(
    'portal', v_portal,
    'username', v_row.username,
    'password', v_pass
  );
END;
$$;
REVOKE ALL ON FUNCTION public.release_portal_credential_for_fill(uuid, uuid, uuid, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_portal_credential_for_fill(uuid, uuid, uuid, text)
  TO service_role;