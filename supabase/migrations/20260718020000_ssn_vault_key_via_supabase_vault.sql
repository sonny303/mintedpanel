-- E4.4 operator fix — source the SSN vault master key from Supabase Vault.
--
-- The original provisioning path (a custom GUC via ALTER DATABASE / ALTER ROLE
-- SET app.settings.ssn_vault_key) is rejected on hosted Supabase: the dashboard
-- `postgres` role is denied permission to set custom parameters (42501). The
-- supported hosted mechanism for a server-held secret is Supabase Vault
-- (vault.decrypted_secrets), which the SECURITY DEFINER owner can read and no
-- client role can.
--
-- This redefines public._ssn_vault_key() to prefer a Vault secret named
-- 'ssn_vault_key', falling back to the original GUC (still useful for local
-- dev / CI where no Vault secret is provisioned). Fail-closed behavior is
-- unchanged: no key from either source raises, so nothing ever encrypts or
-- decrypts with an empty key. The key value is never returned to any client
-- (the function stays private: zero client EXECUTE grants).
--
-- Operator provisioning (one-time, Dashboard): Project Settings → Vault →
-- Add new secret → name `ssn_vault_key`, value = the generated key.

CREATE OR REPLACE FUNCTION public._ssn_vault_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    SELECT ds.decrypted_secret
      INTO v_key
      FROM vault.decrypted_secrets ds
     WHERE ds.name = 'ssn_vault_key';
    v_key := nullif(v_key, '');
  END IF;

  IF v_key IS NULL THEN
    v_key := nullif(current_setting('app.settings.ssn_vault_key', true), '');
  END IF;

  IF v_key IS NULL THEN
    RAISE EXCEPTION 'SSN vault key is not configured';
  END IF;

  RETURN v_key;
END;
$$;

REVOKE ALL ON FUNCTION public._ssn_vault_key() FROM public, anon, authenticated;
