-- E0.5 TE-1/TE-2/TE-3 — Secure one-time org data capture links.
--
-- The FIRST redesign feature that crosses the trust boundary: an unauthenticated
-- external recipient submits data through a token-validated public route. Two
-- PM-locked decisions shape it:
--   BD-1 — lightweight token link, NO login. Reads/writes go through SECURITY
--          DEFINER RPCs that hash-validate the token and touch only the single
--          party/org the token authorizes. No anonymous GoTrue session.
--   BD-2 — Stage 0 renders copy-able email text only; no send infra. The issue
--          RPC returns the raw token + template inputs for the operator to send.
--
-- Additive + idempotent (safe for repo-only rebuild and re-application to the
-- already-migrated hosted project). No pgcrypto dependency: token entropy comes
-- from two gen_random_uuid()s (>128 bit) and hashing from core sha256(bytea).
-- Only the token HASH is stored; the raw token lives only in the emitted URL.

-- ---------------------------------------------------------------------------
-- TE-1 — party_capture_links: one row per issued link. Org-scoped like every
-- other operator table. The partial unique index enforces the single-active-link
-- invariant in the SCHEMA (a concurrent second issue fails deterministically,
-- not racily). state: active|used|expired|revoked. expires_at = issue + 72h.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.party_capture_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  token_hash text NOT NULL,
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'used', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS party_capture_links_one_active
  ON public.party_capture_links (org_id) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS party_capture_links_org_idx
  ON public.party_capture_links (org_id);
CREATE INDEX IF NOT EXISTS party_capture_links_token_hash_idx
  ON public.party_capture_links (token_hash);

ALTER TABLE public.party_capture_links ENABLE ROW LEVEL SECURITY;

-- Operators read their org's link state (browser RLS). ALL writes go through the
-- SECURITY DEFINER RPCs below (which run as owner and bypass RLS), so there are
-- deliberately NO authenticated INSERT/UPDATE/DELETE policies.
DROP POLICY IF EXISTS pcl_select_org ON public.party_capture_links;
CREATE POLICY pcl_select_org ON public.party_capture_links
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids() AS user_org_ids));

GRANT SELECT ON public.party_capture_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.party_capture_links TO service_role;

-- ---------------------------------------------------------------------------
-- TE-2 — create_capture_link (operator side, authenticated). Validates the
-- caller is a writer member of the org, resolves/provisions the recipient party,
-- revokes any prior active link (re-issue = revoke-then-create; the partial
-- unique index guarantees only one active at a time), generates a 256-bit token,
-- stores ONLY its hash, and returns the raw token + template inputs ONCE. Writes
-- an audit row. The raw token is never persisted and never logged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_capture_link(
  p_org_id uuid,
  p_party_id uuid,
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
  v_party_id uuid;
  v_recipient_name text;
  v_org_name text;
  v_token text;
  v_hash text;
  v_expires timestamptz := now() + interval '72 hours';
  v_link_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.org_id = p_org_id AND m.user_id = v_uid
      AND m.role = ANY (ARRAY['specialist'::text, 'admin'::text])
  ) THEN
    RAISE EXCEPTION 'Not authorized to issue a capture link for this organization';
  END IF;
  IF v_email = '' THEN
    RAISE EXCEPTION 'Recipient email is required';
  END IF;
  IF v_email !~ v_email_re THEN
    RAISE EXCEPTION 'Recipient email is not valid';
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = p_org_id;

  -- Resolve the recipient party: an existing party (owner/customer/etc.) already
  -- assigned in this org or created by the caller, OR provision a new person
  -- party bound to the recipient email (ad-hoc recipient, e.g. an office manager;
  -- TD-4: an unused ad-hoc party may orphan — no deletion in Stage 0).
  IF p_party_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.parties p
      WHERE p.id = p_party_id
        AND (
          p.created_by = v_uid
          OR EXISTS (
            SELECT 1 FROM public.party_role_assignments pra
            WHERE pra.party_id = p.id AND pra.org_id = p_org_id
          )
        )
    ) THEN
      RAISE EXCEPTION 'Recipient party not found for this organization';
    END IF;
    v_party_id := p_party_id;
    SELECT name INTO v_recipient_name FROM public.parties WHERE id = v_party_id;
  ELSE
    v_recipient_name := coalesce(nullif(btrim(coalesce(p_recipient_name, '')), ''), v_email);
    INSERT INTO public.parties (party_type, name, email, created_by)
      VALUES ('person', v_recipient_name, v_email, v_uid)
      RETURNING id INTO v_party_id;
  END IF;

  -- Re-issue: revoke any existing active link BEFORE inserting, so the partial
  -- unique index (one active per org) is never violated (F0.5.2 "always re-issue").
  UPDATE public.party_capture_links
    SET state = 'revoked'
    WHERE org_id = p_org_id AND state = 'active';

  -- 256-bit unguessable token; store only its sha256 hash.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');

  INSERT INTO public.party_capture_links
    (org_id, party_id, recipient_email, token_hash, state, expires_at, created_by)
    VALUES (p_org_id, v_party_id, v_email, v_hash, 'active', v_expires, v_uid)
    RETURNING id INTO v_link_id;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (p_org_id, v_uid, 'CREATE', 'party_capture_link', v_link_id,
            'Issued data capture link to ' || v_email);

  RETURN jsonb_build_object(
    'token', v_token,
    'party_id', v_party_id,
    'recipient_email', v_email,
    'recipient_name', v_recipient_name,
    'org_name', v_org_name,
    'expires_at', v_expires
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_capture_link(uuid, uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_capture_link(uuid, uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- TE-3 — validate_capture_token (recipient side, ANON). Hash-validates the token
-- and returns ONLY the single authorized party/org (never any other org's data).
-- Lazy expiry (TD-3): an active-but-past-expiry link is flipped to 'expired' when
-- touched. Unknown token -> {state:'invalid'} and nothing else (no leak).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_capture_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hash text;
  v_link public.party_capture_links%ROWTYPE;
  v_state text;
  v_org_name text;
  v_party public.parties%ROWTYPE;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT * INTO v_link FROM public.party_capture_links WHERE token_hash = v_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  v_state := v_link.state;
  -- Lazy expiry: keep the stored state fresh when a stale-active link is opened.
  IF v_state = 'active' AND v_link.expires_at <= now() THEN
    UPDATE public.party_capture_links SET state = 'expired' WHERE id = v_link.id;
    v_state := 'expired';
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_link.org_id;
  SELECT * INTO v_party FROM public.parties WHERE id = v_link.party_id;

  IF v_state <> 'active' THEN
    -- Used/expired/revoked lockdown states are the intended terminal UX; carry the
    -- org + recipient name so the page can address them, but no field values.
    RETURN jsonb_build_object(
      'state', v_state,
      'org_name', v_org_name,
      'recipient_name', v_party.name
    );
  END IF;

  RETURN jsonb_build_object(
    'state', 'active',
    'org_name', v_org_name,
    'recipient_name', v_party.name,
    'recipient_email', v_link.recipient_email,
    'expires_at', v_link.expires_at,
    'required_fields', jsonb_build_array(
      'name', 'email', 'phone_office', 'address_line1', 'city', 'state', 'postal_code'),
    'current', jsonb_build_object(
      'name', v_party.name,
      'email', v_party.email,
      'phone_office', v_party.phone_office,
      'phone_mobile', v_party.phone_mobile,
      'address_line1', v_party.address_line1,
      'address_line2', v_party.address_line2,
      'city', v_party.city,
      'state', v_party.state,
      'postal_code', v_party.postal_code,
      'country', v_party.country
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_capture_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.validate_capture_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_capture_token(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- TE-3 — submit_capture (recipient side, ANON). Re-validates the token + state,
-- enforces required-field completeness server-side (reuses assert_contact_valid
-- from E0.2), OVERWRITES the authorized party row, flips the link to 'used', and
-- audits. Returns {ok, state}. Never a status change to the org.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_capture(p_token text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hash text;
  v_link public.party_capture_links%ROWTYPE;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  SELECT * INTO v_link FROM public.party_capture_links WHERE token_hash = v_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'invalid');
  END IF;
  IF v_link.state <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'state', v_link.state);
  END IF;
  IF v_link.expires_at <= now() THEN
    UPDATE public.party_capture_links SET state = 'expired' WHERE id = v_link.id;
    RETURN jsonb_build_object('ok', false, 'state', 'expired');
  END IF;

  -- Completeness gate (F0.5.3): raises a clear message on any missing field.
  PERFORM public.assert_contact_valid(p_payload, 'This form');

  -- Overwrite the authorized party row (F0.5.3 "overwrites party row", no deletes).
  UPDATE public.parties SET
    name = btrim(p_payload->>'name'),
    email = btrim(p_payload->>'email'),
    phone_office = nullif(btrim(coalesce(p_payload->>'phone_office', '')), ''),
    phone_mobile = nullif(btrim(coalesce(p_payload->>'phone_mobile', '')), ''),
    address_line1 = nullif(btrim(coalesce(p_payload->>'address_line1', '')), ''),
    address_line2 = nullif(btrim(coalesce(p_payload->>'address_line2', '')), ''),
    city = nullif(btrim(coalesce(p_payload->>'city', '')), ''),
    state = nullif(btrim(coalesce(p_payload->>'state', '')), ''),
    postal_code = nullif(btrim(coalesce(p_payload->>'postal_code', '')), ''),
    country = nullif(btrim(coalesce(p_payload->>'country', '')), '')
  WHERE id = v_link.party_id;

  UPDATE public.party_capture_links
    SET state = 'used', used_at = now()
    WHERE id = v_link.id;

  -- Backend logging only (F0.5 non-goal: no UI notification/review). The operator
  -- who issued the link is the actor of record (anon has no auth.uid()).
  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_link.org_id, v_link.created_by, 'UPDATE', 'party', v_link.party_id,
            'Party data captured via one-time link');

  RETURN jsonb_build_object('ok', true, 'state', 'used');
END;
$$;

REVOKE ALL ON FUNCTION public.submit_capture(text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_capture(text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_capture(text, jsonb) TO authenticated;
