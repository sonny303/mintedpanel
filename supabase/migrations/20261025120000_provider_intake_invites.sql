-- Provider onboarding slice 1 (docs/provider-onboarding/slice-1-invite-to-form.md):
-- a staff invite emails the provider a link; she signs in with a 6-digit code
-- and gets a short server-side session. No Supabase Auth user is created.
--
-- Three token tables, service_role only (RLS on, no policies, no anon or
-- authenticated grants), reached only through the SECURITY DEFINER RPCs below.
-- Every RPC is EXECUTE-granted to service_role alone: the /api route does the
-- authorization and passes the org and actor explicitly, because auth.uid()
-- and user_role() don't exist under the service key.
--
-- Tokens and codes are generated in Node; only sha256 hashes reach SQL.
-- Milestones are audit rows (CREATE/UPDATE on provider_intake_invite and
-- provider_intake_session), never status columns. No audit row carries an
-- email, token or code.
--
-- Additive and idempotent. Applying to hosted is an OPERATOR task.

CREATE TABLE IF NOT EXISTS public.provider_intake_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  email text NOT NULL,
  token_hash text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_intake_invites_token_hash_key
  ON public.provider_intake_invites (token_hash);
-- One unrevoked invite per provider. An expired one still counts, so Resend
-- can replace it.
CREATE UNIQUE INDEX IF NOT EXISTS provider_intake_invites_one_open
  ON public.provider_intake_invites (provider_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS provider_intake_invites_org_idx
  ON public.provider_intake_invites (org_id);

CREATE TABLE IF NOT EXISTS public.provider_intake_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL REFERENCES public.provider_intake_invites(id) ON DELETE CASCADE,
  -- sha256 of token_hash || ':' || code. Over 10^6 codes this only keeps codes
  -- out of casual reads; the 10-minute expiry and 5 attempts are the controls.
  code_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS provider_intake_codes_invite_idx
  ON public.provider_intake_codes (invite_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.provider_intake_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL REFERENCES public.provider_intake_invites(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_intake_sessions_token_hash_key
  ON public.provider_intake_sessions (token_hash);

ALTER TABLE public.provider_intake_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_intake_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_intake_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.provider_intake_invites FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.provider_intake_codes FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.provider_intake_sessions FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.provider_intake_invites TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.provider_intake_codes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.provider_intake_sessions TO service_role;

-- ---------------------------------------------------------------------------
-- create_provider_intake_invite: provider + primary group assignment + invite +
-- audit rows in one transaction. A duplicate (same email in the org, or same
-- NPI in the same group) writes nothing and returns the existing provider.
-- p_input: { first_name, last_name, email, group_id, npi?, start_date? }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_provider_intake_invite(
  p_org_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_input jsonb,
  p_token_hash text,
  p_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first text := nullif(btrim(coalesce(p_input->>'first_name', '')), '');
  v_last text := nullif(btrim(coalesce(p_input->>'last_name', '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_input->>'email', '')), ''));
  v_npi text := nullif(btrim(coalesce(p_input->>'npi', '')), '');
  v_group_id uuid := nullif(p_input->>'group_id', '')::uuid;
  v_start date := nullif(p_input->>'start_date', '')::date;
  v_existing uuid;
  v_provider_id uuid;
  v_invite_id uuid;
BEGIN
  IF v_first IS NULL OR v_last IS NULL OR v_email IS NULL OR v_group_id IS NULL THEN
    RETURN jsonb_build_object('result', 'invalid_input');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.provider_groups WHERE id = v_group_id AND org_id = p_org_id
  ) THEN
    RETURN jsonb_build_object('result', 'group_not_found');
  END IF;

  -- Serialize invites for the same address in the same org, so two
  -- simultaneous invites can't both pass the duplicate check.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':email:' || v_email, 0));
  IF v_npi IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_org_id::text || ':npi:' || v_group_id::text || ':' || v_npi, 0));
  END IF;

  SELECT id INTO v_existing
    FROM public.providers
   WHERE org_id = p_org_id AND lower(email) = v_email
   LIMIT 1;

  IF v_existing IS NULL AND v_npi IS NOT NULL THEN
    SELECT p.id INTO v_existing
      FROM public.providers p
      JOIN public.provider_group_assignments a
        ON a.provider_id = p.id AND a.group_id = v_group_id AND a.end_date IS NULL
     WHERE p.org_id = p_org_id AND p.npi = v_npi
     LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'duplicate', 'provider_id', v_existing);
  END IF;

  -- group_id is the frozen mirror of the primary assignment, set on create
  -- exactly as src/services/providers.ts does.
  INSERT INTO public.providers
    (org_id, first_name, last_name, email, npi, start_date, status, group_id)
    VALUES (p_org_id, v_first, v_last, v_email, v_npi, v_start, 'onboarding', v_group_id)
    RETURNING id INTO v_provider_id;

  INSERT INTO public.provider_group_assignments (org_id, provider_id, group_id, is_primary)
    VALUES (p_org_id, v_provider_id, v_group_id, true);

  INSERT INTO public.provider_intake_invites
    (org_id, provider_id, email, token_hash, created_by, expires_at)
    VALUES (p_org_id, v_provider_id, v_email, p_token_hash, p_actor_id, p_expires_at)
    RETURNING id INTO v_invite_id;

  INSERT INTO public.audit_log (org_id, user_id, user_name, action_type, entity_type, entity_id, description)
    VALUES
      (p_org_id, p_actor_id, p_actor_name, 'CREATE', 'provider', v_provider_id,
       'Created provider from an onboarding invite'),
      (p_org_id, p_actor_id, p_actor_name, 'CREATE', 'provider_intake_invite', v_invite_id,
       'Invited provider to onboarding');

  RETURN jsonb_build_object(
    'result', 'created',
    'provider_id', v_provider_id,
    'invite_id', v_invite_id,
    'practice_name', (SELECT name FROM public.organizations WHERE id = p_org_id)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- resend_provider_intake_invite: replace the provider's unrevoked invite (even
-- an expired one) with a new token. 10-minute cooldown from the last send.
-- Revoking the old invite also ends any session opened from it. A provider in
-- the org with an email but no open invite (added by hand or by import) gets
-- a first invite, with no cooldown, so a duplicate is never a dead end.
-- The new invite goes to the provider record's CURRENT email (the old
-- invite's address only when the record has none), so a mistyped address is
-- fixed by correcting the record and resending.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resend_provider_intake_invite(
  p_org_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_provider_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old public.provider_intake_invites%ROWTYPE;
  v_invite_id uuid;
  v_email text;
  v_first text;
BEGIN
  -- One resend per provider at a time. Without this, a double submit on the
  -- first-invite path has both callers miss the open-invite lookup and the
  -- second hits provider_intake_invites_one_open (23505, a 500) instead of
  -- answering cooldown.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('provider_intake_invite:' || p_provider_id::text, 0));

  SELECT lower(nullif(btrim(email), '')), first_name INTO v_email, v_first
    FROM public.providers
   WHERE id = p_provider_id AND org_id = p_org_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  -- No row leaves v_old all NULL, so v_old.id IS NULL marks a first invite.
  SELECT * INTO v_old
    FROM public.provider_intake_invites
   WHERE org_id = p_org_id AND provider_id = p_provider_id AND revoked_at IS NULL
   FOR UPDATE;

  IF FOUND THEN
    IF v_old.created_at > now() - interval '10 minutes' THEN
      RETURN jsonb_build_object('result', 'cooldown');
    END IF;
    v_email := coalesce(v_email, v_old.email);

    UPDATE public.provider_intake_invites SET revoked_at = now() WHERE id = v_old.id;

    INSERT INTO public.audit_log (org_id, user_id, user_name, action_type, entity_type, entity_id, description)
      VALUES (p_org_id, p_actor_id, p_actor_name, 'UPDATE', 'provider_intake_invite', v_old.id,
              'Revoked onboarding invite (replaced by a resend)');
  ELSIF v_email IS NULL THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  INSERT INTO public.provider_intake_invites
    (org_id, provider_id, email, token_hash, created_by, expires_at)
    VALUES (p_org_id, p_provider_id, v_email, p_token_hash, p_actor_id, p_expires_at)
    RETURNING id INTO v_invite_id;

  INSERT INTO public.audit_log (org_id, user_id, user_name, action_type, entity_type, entity_id, description)
    VALUES (p_org_id, p_actor_id, p_actor_name, 'CREATE', 'provider_intake_invite', v_invite_id,
            CASE WHEN v_old.id IS NULL THEN 'Invited existing provider to onboarding'
                 ELSE 'Resent onboarding invite' END);

  RETURN jsonb_build_object(
    'result', 'resent',
    'invite_id', v_invite_id,
    'email', v_email,
    'first_name', v_first,
    'practice_name', (SELECT name FROM public.organizations WHERE id = p_org_id)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- read_intake_link: the identify screen. Live link → practice and invited
-- email. Anything else → null, the same for unknown, expired and revoked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.read_intake_link(p_token_hash text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('practice_name', o.name, 'email', i.email)
    FROM public.provider_intake_invites i
    JOIN public.organizations o ON o.id = i.org_id
   WHERE i.token_hash = p_token_hash
     AND i.revoked_at IS NULL
     AND i.expires_at > now();
$$;

-- ---------------------------------------------------------------------------
-- issue_intake_code: store a new code for a live invite, within 3 per 10
-- minutes and 10 per 24 hours. Any unused earlier code is consumed. The caller
-- emails the code only when send = true, and answers the browser the same way
-- either way.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_intake_code(p_token_hash text, p_code_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.provider_intake_invites%ROWTYPE;
BEGIN
  SELECT * INTO v_invite
    FROM public.provider_intake_invites
   WHERE token_hash = p_token_hash AND revoked_at IS NULL AND expires_at > now()
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('send', false);
  END IF;

  IF (SELECT count(*) FROM public.provider_intake_codes
       WHERE invite_id = v_invite.id AND created_at > now() - interval '10 minutes') >= 3
     OR (SELECT count(*) FROM public.provider_intake_codes
       WHERE invite_id = v_invite.id AND created_at > now() - interval '24 hours') >= 10 THEN
    RETURN jsonb_build_object('send', false);
  END IF;

  UPDATE public.provider_intake_codes
     SET consumed_at = now()
   WHERE invite_id = v_invite.id AND consumed_at IS NULL;

  INSERT INTO public.provider_intake_codes (invite_id, code_hash, expires_at)
    VALUES (v_invite.id, p_code_hash, now() + interval '10 minutes');

  RETURN jsonb_build_object(
    'send', true,
    'email', v_invite.email,
    'practice_name', (SELECT name FROM public.organizations WHERE id = v_invite.org_id),
    'first_name', (SELECT first_name FROM public.providers WHERE id = v_invite.provider_id)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- verify_intake_code: check the newest live code under a row lock, so five
-- attempts means five even with parallel requests. A match consumes the code
-- and opens a session; a miss counts an attempt. Returns 'ok' or 'invalid'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_intake_code(
  p_token_hash text,
  p_code_hash text,
  p_session_hash text,
  p_session_expires_at timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.provider_intake_invites%ROWTYPE;
  v_code public.provider_intake_codes%ROWTYPE;
  v_session_id uuid;
BEGIN
  -- Locked so a resend running at the same moment can't revoke this invite
  -- between the check and the new session.
  SELECT * INTO v_invite
    FROM public.provider_intake_invites
   WHERE token_hash = p_token_hash AND revoked_at IS NULL AND expires_at > now()
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'invalid';
  END IF;

  SELECT * INTO v_code
    FROM public.provider_intake_codes
   WHERE invite_id = v_invite.id AND consumed_at IS NULL AND expires_at > now()
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND OR v_code.attempts >= 5 THEN
    RETURN 'invalid';
  END IF;

  IF v_code.code_hash <> p_code_hash THEN
    UPDATE public.provider_intake_codes SET attempts = attempts + 1 WHERE id = v_code.id;
    RETURN 'invalid';
  END IF;

  UPDATE public.provider_intake_codes
     SET attempts = attempts + 1, consumed_at = now()
   WHERE id = v_code.id;

  INSERT INTO public.provider_intake_sessions (invite_id, token_hash, expires_at)
    VALUES (v_invite.id, p_session_hash, p_session_expires_at)
    RETURNING id INTO v_session_id;

  INSERT INTO public.audit_log (org_id, action_type, entity_type, entity_id, description)
    VALUES (v_invite.org_id, 'CREATE', 'provider_intake_session', v_session_id,
            'Provider signed in to onboarding with an emailed code');

  RETURN 'ok';
END;
$$;

-- ---------------------------------------------------------------------------
-- read_intake_session: the signed-in provider's own display fields, only when
-- the session belongs to the link being opened (a shared browser can't show
-- one provider's session under another's link). Null when the session is
-- expired or revoked, or its invite was revoked by a resend.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.read_intake_session(p_session_hash text, p_token_hash text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'practice_name', o.name,
           'first_name', p.first_name,
           'last_name', p.last_name,
           'email', i.email)
    FROM public.provider_intake_sessions s
    JOIN public.provider_intake_invites i ON i.id = s.invite_id
    JOIN public.providers p ON p.id = i.provider_id
    JOIN public.organizations o ON o.id = i.org_id
   WHERE s.token_hash = p_session_hash
     AND i.token_hash = p_token_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND i.revoked_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.revoke_intake_session(p_session_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.provider_intake_sessions
     SET revoked_at = now()
   WHERE token_hash = p_session_hash AND revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.create_provider_intake_invite(uuid, uuid, text, jsonb, text, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.resend_provider_intake_invite(uuid, uuid, text, uuid, text, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_intake_link(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_intake_code(text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_intake_code(text, text, text, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_intake_session(text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_intake_session(text) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_provider_intake_invite(uuid, uuid, text, jsonb, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.resend_provider_intake_invite(uuid, uuid, text, uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_intake_link(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_intake_code(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_intake_code(text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_intake_session(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_intake_session(text) TO service_role;

NOTIFY pgrst, 'reload schema';
