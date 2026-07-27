-- E6.7 F6.7.2a — payer_contacts: operational contacts on a payer.
--
-- PM addition 2026-07-26: the Payer Detail designs show contacts and template
-- email steps reference them, but `payers` has no contact storage. Per the
-- SCHEMA.md grain rule this is a CHILD TABLE keyed by purpose — never columns
-- on `payers` (a purpose-varying fact is a child row). Template email steps
-- will reference a contact by (payer_id, purpose) at RESOLUTION time —
-- resolving to the default contact — never by hard FK, so templates stay
-- portable across payers (the exact resolution seam is a later §5 review
-- decision; nothing resolves contacts in E6.7).
--
-- Posture:
--   * read  — member SELECT via the SAME visibility as the parent payer
--             (own-org row OR assigned-global; the payers_select disjunct is
--             RESTATED here because policies do not compose across tables —
--             the sop_template_versions precedent);
--   * write — via the upsert_payer_contact / delete_payer_contact RPCs ONLY
--             (SECURITY DEFINER, authenticated, writer-member, audited; anon
--             rejected in-body — the author_global_sop precedent). No client
--             INSERT/UPDATE/DELETE policies or grants.
--   * contacts are operational data, not an append-only ledger — hard delete
--             is allowed (audited).
--
-- Named errors the frontend seam maps:
--   payer_contact_purpose_invalid — purpose outside the governed domain
--   payer_contact_unreachable     — neither email nor phone provided
--   payer_contact_email_invalid   — email present but not email-shaped

CREATE TABLE IF NOT EXISTS public.payer_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_id uuid NOT NULL REFERENCES public.payers (id) ON DELETE CASCADE,
  -- Governed purpose domain (F6.7.2a; the Payer Detail design's list).
  purpose text NOT NULL,
  name text,
  email text,
  phone text,
  note text,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payer_contacts_purpose_check
    CHECK (purpose IN ('credentialing', 'enrollment', 'escalation', 'general')),
  -- A contact you cannot reach is not a contact.
  CONSTRAINT payer_contacts_reachable_check
    CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- FK cover index (E0.10 convention); the partial unique below only covers
-- default rows.
CREATE INDEX IF NOT EXISTS idx_payer_contacts_payer_id
  ON public.payer_contacts (payer_id);

-- One DEFAULT contact per (payer, purpose) — the resolution target for
-- template email steps.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payer_contacts_default_purpose
  ON public.payer_contacts (payer_id, purpose)
  WHERE is_default;

ALTER TABLE public.payer_contacts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payer_contacts'
      AND policyname = 'payer_contacts_select'
  ) THEN
    CREATE POLICY payer_contacts_select ON public.payer_contacts
      FOR SELECT TO authenticated USING (
        EXISTS (
          SELECT 1 FROM public.payers p
          WHERE p.id = payer_contacts.payer_id
            AND (
              (p.org_id IN (SELECT user_org_ids()))
              OR (
                p.org_id IS NULL AND EXISTS (
                  SELECT 1 FROM public.org_payer_assignments opa
                  WHERE opa.payer_id = p.id
                    AND opa.org_id IN (SELECT user_org_ids())
                )
              )
            )
        )
      );
  END IF;
END $$;

-- Revoke-then-grant floor (hosted default privileges would otherwise leave
-- authenticated a full-DML grant). SELECT only for clients — writes go
-- through the RPCs.
REVOKE ALL ON public.payer_contacts FROM anon;
REVOKE ALL ON public.payer_contacts FROM authenticated;
GRANT SELECT ON public.payer_contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payer_contacts TO service_role;

-- ---------------------------------------------------------------------------
-- upsert_payer_contact — create (p_id NULL) or edit one contact row.
-- p_is_default TRUE swaps the default within (payer, purpose) in the same
-- transaction — the partial unique is the race backstop, not the UX.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_payer_contact(
  p_org_id uuid,
  p_id uuid,
  p_payer_id uuid,
  p_purpose text,
  p_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_is_default boolean DEFAULT false
)
RETURNS public.payer_contacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_name text;
  v_payer public.payers%ROWTYPE;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_default boolean := coalesce(p_is_default, false);
  v_before public.payer_contacts%ROWTYPE;
  v_row public.payer_contacts%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_org_id IS NULL
     OR NOT (p_org_id IN (SELECT user_org_ids()))
     OR user_role(p_org_id) NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_purpose IS NULL
     OR p_purpose NOT IN ('credentialing', 'enrollment', 'escalation', 'general') THEN
    RAISE EXCEPTION 'payer_contact_purpose_invalid';
  END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN
    RAISE EXCEPTION 'payer_contact_unreachable';
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'payer_contact_email_invalid';
  END IF;

  SELECT * INTO v_payer FROM public.payers WHERE id = p_payer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payer not found';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_before FROM public.payer_contacts
     WHERE id = p_id AND payer_id = p_payer_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Contact not found';
    END IF;
  END IF;

  -- Default swap: at most one default per (payer, purpose); making this row
  -- the default demotes any current holder in the same transaction.
  IF v_default THEN
    UPDATE public.payer_contacts
       SET is_default = false, updated_at = now()
     WHERE payer_id = p_payer_id
       AND purpose = p_purpose
       AND is_default
       AND id IS DISTINCT FROM p_id;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.payer_contacts
      (payer_id, purpose, name, email, phone, note, is_default, created_by)
    VALUES
      (p_payer_id, p_purpose, v_name, v_email, v_phone, v_note, v_default, v_uid)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.payer_contacts
       SET purpose = p_purpose,
           name = v_name,
           email = v_email,
           phone = v_phone,
           note = v_note,
           is_default = v_default,
           updated_at = now()
     WHERE id = p_id
     RETURNING * INTO v_row;
  END IF;

  SELECT coalesce(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id, before, after, description)
  VALUES
    (p_org_id, v_uid, v_user_name,
     CASE WHEN p_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END,
     'payer_contact', v_row.id,
     CASE WHEN p_id IS NULL THEN NULL ELSE jsonb_build_object(
       'purpose', v_before.purpose, 'name', v_before.name, 'email', v_before.email,
       'phone', v_before.phone, 'isDefault', v_before.is_default) END,
     jsonb_build_object(
       'payerId', v_row.payer_id, 'purpose', v_row.purpose, 'name', v_row.name,
       'email', v_row.email, 'phone', v_row.phone, 'isDefault', v_row.is_default),
     CASE WHEN p_id IS NULL
       THEN 'Added ' || v_row.purpose || ' contact for payer "' || v_payer.name || '"'
       ELSE 'Updated ' || v_row.purpose || ' contact for payer "' || v_payer.name || '"' END);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_payer_contact(uuid, uuid, uuid, text, text, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_payer_contact(uuid, uuid, uuid, text, text, text, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_payer_contact(uuid, uuid, uuid, text, text, text, text, text, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- delete_payer_contact — hard delete (operational data, audited).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_payer_contact(
  p_org_id uuid,
  p_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_name text;
  v_row public.payer_contacts%ROWTYPE;
  v_payer_name text;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_org_id IS NULL
     OR NOT (p_org_id IN (SELECT user_org_ids()))
     OR user_role(p_org_id) NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_row FROM public.payer_contacts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contact not found';
  END IF;
  SELECT name INTO v_payer_name FROM public.payers WHERE id = v_row.payer_id;

  DELETE FROM public.payer_contacts WHERE id = p_id;

  SELECT coalesce(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id, before, description)
  VALUES
    (p_org_id, v_uid, v_user_name, 'DELETE', 'payer_contact', p_id,
     jsonb_build_object(
       'payerId', v_row.payer_id, 'purpose', v_row.purpose, 'name', v_row.name,
       'email', v_row.email, 'phone', v_row.phone, 'isDefault', v_row.is_default),
     'Removed ' || v_row.purpose || ' contact for payer "' || coalesce(v_payer_name, 'unknown') || '"');
END;
$$;

REVOKE ALL ON FUNCTION public.delete_payer_contact(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_payer_contact(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_payer_contact(uuid, uuid) TO authenticated, service_role;
