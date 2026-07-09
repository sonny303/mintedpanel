-- E0.6 TE-5/TE-6 — Secure read-only portfolio share (outbound).
--
-- The app's SECOND public unauthenticated surface (after E0.5's capture link),
-- but READ-ONLY: there is no anon write RPC. A share renders the chrome-decoupled
-- Portfolio dashboard to a recipient with NO login. Scope is filterable —
-- `full` (whole portfolio, internal P4) or `single_org` (one org, its owner P5) —
-- and the single-org filter is enforced SERVER-SIDE inside validate_report_share
-- so a filtered share can never leak other orgs even under a tampered client.
--
-- Diverges from E0.5 deliberately (PM decision): 30-day default, revocable
-- (read-only + scope-filtered + low-risk). Additive + idempotent. Only the token
-- HASH is stored (raw token lives only in the emitted URL); core sha256, no
-- pgcrypto; entropy = two gen_random_uuid()s.

CREATE TABLE IF NOT EXISTS public.report_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_key text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('full', 'single_org')),
  scope_org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  token_hash text NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked', 'expired')),
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  -- A single-org share MUST name its org; a full share MUST NOT.
  CONSTRAINT report_shares_scope_org_ck CHECK (
    (scope = 'single_org' AND scope_org_id IS NOT NULL)
    OR (scope = 'full' AND scope_org_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS report_shares_created_by_idx ON public.report_shares (created_by);
CREATE INDEX IF NOT EXISTS report_shares_token_hash_idx ON public.report_shares (token_hash);

ALTER TABLE public.report_shares ENABLE ROW LEVEL SECURITY;

-- The creator manages their own shares (a full share spans all orgs, so this is
-- created_by-scoped, not org-scoped). All writes go through the definer RPCs.
DROP POLICY IF EXISTS report_shares_select_own ON public.report_shares;
CREATE POLICY report_shares_select_own ON public.report_shares
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());

GRANT SELECT ON public.report_shares TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_shares TO service_role;

-- ---------------------------------------------------------------------------
-- create_report_share (operator, authenticated). Validates scope + membership,
-- issues a 256-bit token (hash stored), 30-day expiry; returns the raw token
-- once. Audits under the scope org (or the caller's first membership for a full
-- share — audit_log.org_id is NOT NULL).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_report_share(
  p_report_key text,
  p_scope text,
  p_scope_org_id uuid,
  p_recipient_email text
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
  v_token text;
  v_hash text;
  v_expires timestamptz := now() + interval '30 days';
  v_share_id uuid;
  v_audit_org uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_scope NOT IN ('full', 'single_org') THEN
    RAISE EXCEPTION 'Invalid share scope';
  END IF;
  IF v_email = '' OR v_email !~ v_email_re THEN
    RAISE EXCEPTION 'A valid recipient email is required';
  END IF;
  IF p_scope = 'single_org' THEN
    IF p_scope_org_id IS NULL THEN
      RAISE EXCEPTION 'A single-org share requires an organization';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.org_id = p_scope_org_id AND m.user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'Not a member of that organization';
    END IF;
  END IF;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');

  INSERT INTO public.report_shares
    (report_key, scope, scope_org_id, recipient_email, token_hash, state, expires_at, created_by)
    VALUES (
      p_report_key, p_scope,
      CASE WHEN p_scope = 'single_org' THEN p_scope_org_id ELSE NULL END,
      v_email, v_hash, 'active', v_expires, v_uid)
    RETURNING id INTO v_share_id;

  v_audit_org := coalesce(
    p_scope_org_id,
    (SELECT org_id FROM public.memberships WHERE user_id = v_uid ORDER BY created_at LIMIT 1)
  );
  IF v_audit_org IS NOT NULL THEN
    INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
      VALUES (v_audit_org, v_uid, 'CREATE', 'report_share', v_share_id,
              'Shared ' || p_report_key || ' (' || p_scope || ') with ' || v_email);
  END IF;

  RETURN jsonb_build_object(
    'token', v_token,
    'share_id', v_share_id,
    'recipient_email', v_email,
    'scope', p_scope,
    'expires_at', v_expires
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_report_share(text, text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_report_share(text, text, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- revoke_report_share (operator, authenticated). Only the creator, only an
-- active share. Idempotent-ish (a non-active/other-owner id simply no-ops).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_report_share(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  UPDATE public.report_shares
    SET state = 'revoked', revoked_at = now()
    WHERE id = p_id AND created_by = v_uid AND state = 'active';
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_report_share(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.revoke_report_share(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- validate_report_share (recipient, ANON). Hash-validates, lazy-expires, and
-- returns ONLY the in-scope orgs (full = every org the creator belongs to;
-- single_org = the one scope org). The scope filter is applied HERE, server-side,
-- so a filtered share cannot leak other orgs (TE-6). READ-ONLY — no write RPC.
-- ---------------------------------------------------------------------------
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
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT * INTO v_share FROM public.report_shares WHERE token_hash = v_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

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

REVOKE ALL ON FUNCTION public.validate_report_share(text) FROM public;
GRANT EXECUTE ON FUNCTION public.validate_report_share(text) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_report_share(text) TO authenticated;
