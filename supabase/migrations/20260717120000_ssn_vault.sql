-- E4.4 TE-1/TE-2/TE-3 — Sensitive Identifiers Vault: zero-trust full SSN.
--
-- The FIRST place the system holds a decryptable secret. PM security decisions
-- (2026-07-14, CLARIFICATIONS_NEEDED.md [e4.4] resolved):
--   * option 1 — SERVER-ONLY vault. A dedicated provider_ssn_vault table:
--     REVOKE ALL from anon AND authenticated, RLS enabled, NO client SELECT
--     grant ever. The only access paths are the SECURITY DEFINER RPCs below.
--     providers.ssn_last4 stays the ONLY value any ordinary read/list/export/
--     API payload returns; the UI mask is ***--1234 derived from it.
--   * Option A key management — in-DB pgcrypto symmetric (pgp_sym_encrypt/
--     decrypt) INSIDE the definer RPCs; the master key comes from a server-held
--     secret via a Postgres GUC (current_setting), never stored beside the
--     ciphertext, never readable by clients. The algo/key_version columns keep
--     the schema Option-B-ready (a later app-layer envelope + external KMS
--     migration is additive).
--
-- pgcrypto is enabled WITH SCHEMA "extensions" (baseline). All pgcrypto calls
-- are schema-qualified (extensions.pgp_sym_*), so search_path stays 'public'.
--
-- Additive + idempotent (safe for repo-only rebuild and re-application). Applying
-- to the hosted project is an OPERATOR task (this vault carries a decrypt secret
-- and is deliberately NOT applied by the build session) — see the PR body. The
-- operator must also provision the master key:
--   ALTER DATABASE postgres SET app.settings.ssn_vault_key = '<32+ byte secret>';
-- (then reconnect). Until it is set, every vault RPC fails closed (raises), so a
-- fresh rebuild that never calls a vault RPC still passes.

-- ---------------------------------------------------------------------------
-- TE-1 — provider_ssn_vault: the separated ciphertext surface. One row per
-- provider (provider_id PK). org_id scopes it for RLS/definer checks. algo +
-- key_version make the schema Option-B-ready. NO plaintext or client-readable
-- secret column ever lives here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_ssn_vault (
  provider_id uuid PRIMARY KEY REFERENCES public.providers(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ssn_ciphertext bytea NOT NULL,
  algo text NOT NULL DEFAULT 'pgcrypto:pgp_sym',
  key_version int NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_ssn_vault_org_idx
  ON public.provider_ssn_vault (org_id);

ALTER TABLE public.provider_ssn_vault ENABLE ROW LEVEL SECURITY;

-- Zero-trust: NO policy and NO grant for anon or authenticated. A direct
-- PostgREST read by an authenticated (or anon) client returns nothing (no
-- grant) and could not decrypt anyway (no key). The ONLY access is through the
-- SECURITY DEFINER RPCs below, which run as the function owner (a superuser)
-- and so bypass both RLS and grants. service_role is intentionally NOT granted
-- table access either — every server path also goes through the RPCs.
REVOKE ALL ON public.provider_ssn_vault FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- TE-2 — key + crypto helpers. All private: REVOKE ALL from public/anon/
-- authenticated so no client can call them. They are invoked only from the
-- vault RPCs below (which run as owner and therefore have EXECUTE).
-- ---------------------------------------------------------------------------

-- The master key, read from a server-held GUC. Fails closed (raises) when the
-- secret is not provisioned, so nothing ever encrypts/decrypts with an empty
-- key. The value is never returned to any client (this function is private).
CREATE OR REPLACE FUNCTION public._ssn_vault_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := nullif(current_setting('app.settings.ssn_vault_key', true), '');
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'SSN vault key is not configured';
  END IF;
  RETURN v_key;
END;
$$;
REVOKE ALL ON FUNCTION public._ssn_vault_key() FROM public, anon, authenticated;

-- Normalize a raw SSN to 9 digits (strip any punctuation/spaces) and validate.
-- The error message NEVER echoes the value (no truncation to a last-4 either).
CREATE OR REPLACE FUNCTION public._ssn_digits(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v text;
BEGIN
  v := regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g');
  IF char_length(v) <> 9 THEN
    RAISE EXCEPTION 'A valid 9-digit Social Security Number is required';
  END IF;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public._ssn_digits(text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._ssn_encrypt(p_plaintext text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN extensions.pgp_sym_encrypt(p_plaintext, public._ssn_vault_key());
END;
$$;
REVOKE ALL ON FUNCTION public._ssn_encrypt(text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._ssn_decrypt(p_ciphertext bytea)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN extensions.pgp_sym_decrypt(p_ciphertext, public._ssn_vault_key());
END;
$$;
REVOKE ALL ON FUNCTION public._ssn_decrypt(bytea) FROM public, anon, authenticated;

-- Shared write path used by every ingress RPC (store_ssn + submit_ssn_intake).
-- Encrypts inside the definer boundary, upserts the single vault row, and sets
-- providers.ssn_last4 from the last four. The plaintext lives only in this
-- function's locals for the duration of the call and is never logged or audited.
CREATE OR REPLACE FUNCTION public._ssn_vault_upsert(
  p_provider_id uuid,
  p_org_id uuid,
  p_ssn text,
  p_actor uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_digits text := public._ssn_digits(p_ssn);
  v_last4 text := right(v_digits, 4);
BEGIN
  INSERT INTO public.provider_ssn_vault
    (provider_id, org_id, ssn_ciphertext, algo, key_version, created_by, updated_by)
  VALUES
    (p_provider_id, p_org_id, public._ssn_encrypt(v_digits), 'pgcrypto:pgp_sym', 1, p_actor, p_actor)
  ON CONFLICT (provider_id) DO UPDATE SET
    ssn_ciphertext = excluded.ssn_ciphertext,
    algo = excluded.algo,
    key_version = excluded.key_version,
    updated_by = p_actor,
    updated_at = now();

  -- ssn_last4 stays the ONLY value ordinary reads return; keep it in step with
  -- the vaulted full value.
  UPDATE public.providers SET ssn_last4 = v_last4 WHERE id = p_provider_id;

  RETURN v_last4;
END;
$$;
REVOKE ALL ON FUNCTION public._ssn_vault_upsert(uuid, uuid, text, uuid) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- TE-4 — store_ssn (internal secure modal, AUTHENTICATED). PM decision
-- 2026-07-14: writer roles (specialist|admin) — reveal stays admin-only. The
-- full value NEVER enters any ordinary field; this is the only authenticated
-- write path for it. Encrypts on save, returns the MASK only, writes an ingress
-- audit row (never the value).
-- ---------------------------------------------------------------------------
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
  IF public.user_role(v_org) NOT IN ('admin', 'specialist') THEN
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

-- ---------------------------------------------------------------------------
-- TE-3 — reveal_ssn (admin Click-to-Reveal, AUTHENTICATED, ADMIN-ONLY).
-- Requires a non-empty justification; decrypts inside the function and returns
-- the plaintext exactly once for a brief client-side auto-rehide window. Writes
-- an immutable audit READ row carrying who/when/which-provider/justification —
-- NEVER the value. Non-admins never receive the control (role-gated UI) and the
-- RPC re-checks server-side.
-- ---------------------------------------------------------------------------
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
  IF public.user_role(v_org) <> 'admin' THEN
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

-- ---------------------------------------------------------------------------
-- TE-3 — release_ssn_for_fill (fill-only release, SERVICE_ROLE ONLY). Called
-- exclusively from the guarded /api layer (the extension fill path), never by a
-- browser/anon client: EXECUTE is granted to service_role only. The /api guard
-- resolves the caller's org from the JWT and the handler writes the READ audit
-- row with the real actor (the service-role RPC has no auth.uid()); this RPC is
-- the last wall — it re-validates the active-fill context (the case must exist,
-- belong to p_org_id, and be this provider's case) before decrypting. Requests
-- outside an active fill context are rejected. Returns the value once into the
-- fill payload; the handler sets Cache-Control: no-store.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_ssn_for_fill(
  p_provider_id uuid,
  p_org_id uuid,
  p_case_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cipher bytea;
  v_digits text;
BEGIN
  IF p_case_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.credential_cases c
    WHERE c.id = p_case_id
      AND c.org_id = p_org_id
      AND c.provider_id = p_provider_id
  ) THEN
    RAISE EXCEPTION 'SSN release requires an active fill context';
  END IF;

  SELECT v.ssn_ciphertext INTO v_cipher
  FROM public.provider_ssn_vault v
  WHERE v.provider_id = p_provider_id AND v.org_id = p_org_id;
  IF v_cipher IS NULL THEN
    RAISE EXCEPTION 'No SSN on file for this provider';
  END IF;
  v_digits := public._ssn_decrypt(v_cipher);

  RETURN jsonb_build_object('ssn', v_digits, 'ssn_last4', right(v_digits, 4));
END;
$$;
REVOKE ALL ON FUNCTION public.release_ssn_for_fill(uuid, uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_ssn_for_fill(uuid, uuid, uuid) TO service_role;
