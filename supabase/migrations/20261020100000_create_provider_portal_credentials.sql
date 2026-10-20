-- Provider self-onboarding — portal login vault: the upstream portal
-- username/password Minted Panel fills on the provider's behalf (CAQH, PECOS).
--
-- Same posture as provider_ssn_vault (20260717120000): the DECRYPTABLE secret
-- exists ONLY here, encrypted at rest with pgcrypto, and the ONLY access paths
-- are the narrow SECURITY DEFINER RPCs in the next migration. No client SELECT
-- grant ever, RLS enabled with no policies, so a direct PostgREST read returns
-- nothing and could not decrypt anyway (no key).
--
-- The username is a non-secret identifier and stays in the clear so it can be
-- displayed in ordinary operator UI without a reveal; only the password is
-- ciphertext. No plaintext password column ever lives here.
--
-- Addditive + idempotent. The master key is the SAME server-held secret the SSN
-- vault uses (Vault secret `ssn_vault_key`, read only inside the definer
-- boundary), so there is no second key to provision.

-- The grain is ONE ROW PER (provider, portal): a provider is onboarded into both
-- CAQH and PECOS, each with its own login, so provider_id CANNOT be the primary
-- key. A PK on provider_id caps every provider at one portal and makes the second
-- portal raise an unhandled primary-key violation — the ON CONFLICT
-- (provider_id, portal) arbiter in the RPC migration does not cover it. Surrogate
-- id PK + UNIQUE(provider_id, portal) is the grain the RPCs and the client
-- services are written against.
CREATE TABLE IF NOT EXISTS public.provider_portal_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  portal text NOT NULL CHECK (portal IN ('caqh', 'pecos')),
  username text NOT NULL,
  password_ciphertext bytea NOT NULL,
  algo text NOT NULL DEFAULT 'pgcrypto:pgp_sym',
  key_version int NOT NULL DEFAULT 1,
  rotated_at timestamptz,
  last_verified_at timestamptz,
  exception_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_portal_credentials_portal_unique UNIQUE (provider_id, portal)
);

CREATE INDEX IF NOT EXISTS provider_portal_credentials_org_idx
  ON public.provider_portal_credentials (org_id);

ALTER TABLE public.provider_portal_credentials ENABLE ROW LEVEL SECURITY;

-- Zero-trust, matching provider_ssn_vault: NO policy and NO grant for anon or
-- authenticated. The definer RPCs run as the function owner and so bypass both
-- RLS and grants. service_role is granted below because the fill-release path
-- (/api, service-role ctx) needs to touch the row the same way the SSN release
-- path does — it still can only decrypt through the service_role-only RPC.
REVOKE ALL ON public.provider_portal_credentials FROM public, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_portal_credentials TO service_role;