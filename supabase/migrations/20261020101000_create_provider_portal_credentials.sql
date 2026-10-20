-- Provider self-onboarding — portal login vault: the upstream portal
-- username/password Minted Panel fills on the provider's behalf (CAQH, PECOS).
--
-- Same posture as provider_ssn_vault (20260717120000): the DECRYPTABLE secret
-- exists ONLY here, encrypted at rest with pgcrypto, and the ONLY access paths
-- are the narrow SECURITY DEFINER RPCs in the next migration. RLS is enabled
-- with NO policies and there is no client SELECT grant, so a direct PostgREST
-- read returns nothing and could not decrypt anyway (no key).
--
-- The username is a non-secret identifier and stays in the clear so operator UI
-- can display it without a reveal; only the password is ciphertext. No plaintext
-- password column ever lives here.
--
-- The grain is ONE ROW PER (provider, portal): a provider is onboarded into both
-- CAQH and PECOS, each with its own login, so provider_id alone cannot be the
-- primary key. The composite PK IS the constraint the RPCs' upsert arbiter needs.
--
-- Addditive + idempotent. The master key is the SAME server-held secret the SSN
-- vault uses, read through _ssn_vault_key() (Supabase Vault first, GUC fallback)
-- inside the definer boundary — so there is no second key to provision and no
-- second crypto helper to drift.

CREATE TABLE IF NOT EXISTS public.provider_portal_credentials (
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  portal text NOT NULL CHECK (portal IN ('caqh', 'pecos')),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  username text NOT NULL,
  password_ciphertext bytea NOT NULL,
  algo text NOT NULL DEFAULT 'pgcrypto:pgp_sym',
  key_version int NOT NULL DEFAULT 1,
  rotated_at timestamptz,
  last_verified_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_portal_credentials_pkey PRIMARY KEY (provider_id, portal)
);

CREATE INDEX IF NOT EXISTS provider_portal_credentials_org_idx
  ON public.provider_portal_credentials (org_id);

ALTER TABLE public.provider_portal_credentials ENABLE ROW LEVEL SECURITY;

-- Zero-trust, matching provider_ssn_vault exactly: NO policy and NO grant for
-- anon, authenticated, or service_role. Every access path, including the
-- /api fill release, goes through the SECURITY DEFINER RPCs below, which run as
-- the function owner and so bypass both RLS and grants. A direct service_role
-- table grant would let a caller read and write ciphertext without the
-- fill-context check release_portal_credential_for_fill enforces.
REVOKE ALL ON public.provider_portal_credentials FROM public, anon, authenticated, service_role;