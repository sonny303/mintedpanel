-- 2026-10-20 — provider_intake_sessions table. Sessions are created by
-- verify_intake_code (in 20261020100000_provider_intake_links.sql) and consumed
-- by submit_provider_ssn (vault write, in 20261020100400_portal_vault.sql) and
-- submit_intake (profile submit, sibling migration).
--
-- A session is the proof-of-identity that authorizes the provider to write
-- sensitive fields (SSN, portal logins) without re-asking the code on every
-- page navigation. It expires 24h after creation and is single-use.

CREATE TABLE IF NOT EXISTS public.provider_intake_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token uuid NOT NULL UNIQUE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  intake_link_id uuid NOT NULL REFERENCES public.provider_intake_links(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'used', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid  -- the operator who issued the link (anon recipient has no auth.uid)
);

CREATE INDEX IF NOT EXISTS provider_intake_sessions_token_idx
  ON public.provider_intake_sessions (session_token);
CREATE INDEX IF NOT EXISTS provider_intake_sessions_provider_idx
  ON public.provider_intake_sessions (provider_id);

ALTER TABLE public.provider_intake_sessions ENABLE ROW LEVEL SECURITY;

-- No policies: only SECURITY DEFINER RPCs and service_role touch this table.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_intake_sessions TO service_role;