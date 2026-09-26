-- E6.12 / WP1.1 — restricted client access context and trust boundary.
--
-- This migration is additive. It keeps canonical client access bound to an
-- existing verified auth user (Option A), leaves legacy staff/billing
-- claim_invites behavior intact for non-restricted identities, and gates only
-- durable restricted client identities. Private data remains service-only.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'minted_e612_authz_owner') THEN
    CREATE ROLE minted_e612_authz_owner NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE minted_e612_authz_owner NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA private TO minted_e612_authz_owner, service_role;
GRANT USAGE ON SCHEMA auth TO minted_e612_authz_owner;
GRANT EXECUTE ON FUNCTION auth.uid() TO minted_e612_authz_owner;

CREATE SCHEMA IF NOT EXISTS app_authz;
REVOKE ALL ON SCHEMA app_authz FROM PUBLIC, anon, authenticated;
REVOKE CREATE ON SCHEMA app_authz FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app_authz TO authenticated, service_role;
GRANT USAGE ON SCHEMA app_authz TO minted_e612_authz_owner;

-- ---------------------------------------------------------------------------
-- Private relations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS private.internal_staff (
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  staff_role text NOT NULL CHECK (staff_role IN ('admin', 'specialist')),
  active boolean NOT NULL DEFAULT true,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  manifest_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auth_user_id, org_id, staff_role)
);

CREATE INDEX IF NOT EXISTS internal_staff_org_active_idx
  ON private.internal_staff (org_id, auth_user_id)
  WHERE active;

CREATE TABLE IF NOT EXISTS private.client_identity_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email_normalized text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'active', 'expired', 'revoked')),
  bound_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auth_user_id, org_id),
  UNIQUE (id, auth_user_id, org_id)
);

CREATE INDEX IF NOT EXISTS client_identity_classifications_user_idx
  ON private.client_identity_classifications (auth_user_id, state);

CREATE TABLE IF NOT EXISTS private.client_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  classification_id uuid NOT NULL,
  email_normalized text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('pending', 'claimed', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  claimed_by uuid REFERENCES auth.users(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  FOREIGN KEY (classification_id, auth_user_id, org_id)
    REFERENCES private.client_identity_classifications (id, auth_user_id, org_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS client_invites_lookup_idx
  ON private.client_invites (auth_user_id, org_id, state, expires_at);

CREATE TABLE IF NOT EXISTS private.client_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  classification_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'revoked')),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auth_user_id, org_id),
  UNIQUE (id, org_id),
  FOREIGN KEY (classification_id, auth_user_id, org_id)
    REFERENCES private.client_identity_classifications (id, auth_user_id, org_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS private.client_invite_group_grants (
  invite_id uuid NOT NULL,
  org_id uuid NOT NULL,
  group_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invite_id, group_id),
  FOREIGN KEY (invite_id, org_id)
    REFERENCES private.client_invites (id, org_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS private.client_group_grants (
  access_id uuid NOT NULL,
  org_id uuid NOT NULL,
  group_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (access_id, group_id),
  FOREIGN KEY (access_id, org_id)
    REFERENCES private.client_access (id, org_id)
    ON DELETE CASCADE
);

-- provider_groups historically had only a single-column primary key. This
-- additive key permits same-org composite foreign keys on all new grants.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_groups_org_id_id_key'
  ) THEN
    ALTER TABLE public.provider_groups
      ADD CONSTRAINT provider_groups_org_id_id_key UNIQUE (org_id, id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_invite_group_grants_org_group_fkey'
  ) THEN
    ALTER TABLE private.client_invite_group_grants
      ADD CONSTRAINT client_invite_group_grants_org_group_fkey
      FOREIGN KEY (org_id, group_id)
      REFERENCES public.provider_groups (org_id, id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_group_grants_org_group_fkey'
  ) THEN
    ALTER TABLE private.client_group_grants
      ADD CONSTRAINT client_group_grants_org_group_fkey
      FOREIGN KEY (org_id, group_id)
      REFERENCES public.provider_groups (org_id, id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

ALTER TABLE private.internal_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.internal_staff FORCE ROW LEVEL SECURITY;
ALTER TABLE private.client_identity_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.client_identity_classifications FORCE ROW LEVEL SECURITY;
ALTER TABLE private.client_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.client_invites FORCE ROW LEVEL SECURITY;
ALTER TABLE private.client_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.client_access FORCE ROW LEVEL SECURITY;
ALTER TABLE private.client_invite_group_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.client_invite_group_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE private.client_group_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.client_group_grants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS e612_authz_owner_internal_staff_select ON private.internal_staff;
CREATE POLICY e612_authz_owner_internal_staff_select
  ON private.internal_staff FOR SELECT TO minted_e612_authz_owner
  USING (true);

DROP POLICY IF EXISTS e612_authz_owner_classification_select ON private.client_identity_classifications;
CREATE POLICY e612_authz_owner_classification_select
  ON private.client_identity_classifications FOR SELECT TO minted_e612_authz_owner
  USING (true);

GRANT SELECT ON private.internal_staff, private.client_identity_classifications TO minted_e612_authz_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  private.internal_staff,
  private.client_identity_classifications,
  private.client_invites,
  private.client_access,
  private.client_invite_group_grants,
  private.client_group_grants
TO service_role;

-- No browser table/schema grants. The service role is the only data gateway.
REVOKE ALL ON
  private.internal_staff,
  private.client_identity_classifications,
  private.client_invites,
  private.client_access,
  private.client_invite_group_grants,
  private.client_group_grants
FROM PUBLIC, anon, authenticated;

-- Operator-owned manifest mutation. This is deliberately a service-role-only
-- RPC: the API never exposes it to a browser and service-key possession is the
-- explicit operator trust boundary for manifest activation/revocation.
CREATE OR REPLACE FUNCTION public.set_internal_staff_manifest(
  p_operator_user_id uuid,
  p_auth_user_id uuid,
  p_org_id uuid,
  p_staff_role text,
  p_active boolean,
  p_manifest_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, private, auth, extensions'
AS $$
DECLARE
  v_row private.internal_staff%ROWTYPE;
BEGIN
  IF p_operator_user_id IS NULL OR p_auth_user_id IS NULL OR p_org_id IS NULL THEN
    RAISE EXCEPTION 'Operator, staff user, and organization are required';
  END IF;
  IF p_staff_role NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'Staff role is invalid';
  END IF;
  IF p_manifest_version IS NULL OR btrim(p_manifest_version) = '' THEN
    RAISE EXCEPTION 'Manifest version is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
     WHERE id = p_operator_user_id
       AND email_confirmed_at IS NOT NULL
       AND deleted_at IS NULL
       AND is_anonymous = false
       AND (banned_until IS NULL OR banned_until <= now())
  ) THEN
    RAISE EXCEPTION 'Verified operator is unavailable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_auth_user_id) THEN
    RAISE EXCEPTION 'Staff user is unavailable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'Organization is unavailable';
  END IF;

  INSERT INTO private.internal_staff
    (auth_user_id, org_id, staff_role, active, approved_by, approved_at,
     revoked_at, manifest_version, updated_at)
  VALUES
    (p_auth_user_id, p_org_id, p_staff_role, p_active, p_operator_user_id,
     now(), CASE WHEN p_active THEN NULL ELSE now() END, btrim(p_manifest_version), now())
  ON CONFLICT (auth_user_id, org_id, staff_role) DO UPDATE
    SET active = excluded.active,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        revoked_at = excluded.revoked_at,
        manifest_version = excluded.manifest_version,
        updated_at = now()
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
  VALUES (
    p_org_id,
    p_operator_user_id,
    CASE WHEN p_active THEN 'CREATE' ELSE 'UPDATE' END,
    'internal_staff_manifest',
    p_auth_user_id,
    format('%s internal staff %s manifest %s for role %s',
      CASE WHEN p_active THEN 'Activated' ELSE 'Revoked' END,
      p_auth_user_id,
      btrim(p_manifest_version),
      p_staff_role)
  );

  RETURN jsonb_build_object(
    'authUserId', v_row.auth_user_id,
    'organizationId', v_row.org_id,
    'staffRole', v_row.staff_role,
    'active', v_row.active,
    'manifestVersion', v_row.manifest_version,
    'updatedAt', v_row.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_internal_staff_manifest(uuid, uuid, uuid, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_internal_staff_manifest(uuid, uuid, uuid, text, boolean, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Helper-only schema: browser RLS can evaluate one boolean without seeing any
-- private rows. The function has no target-user argument and uses auth.uid().
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_authz.is_restricted_external()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM private.client_identity_classifications c
     WHERE c.auth_user_id = coalesce(
       nullif(current_setting('request.jwt.claim.sub', true), ''),
       (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
     )::uuid
       AND c.state IN ('pending', 'active', 'expired', 'revoked')
  )
  AND NOT EXISTS (
    SELECT 1
      FROM private.internal_staff s
     WHERE s.auth_user_id = coalesce(
       nullif(current_setting('request.jwt.claim.sub', true), ''),
       (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
     )::uuid
       AND s.active
  );
$$;

REVOKE ALL ON FUNCTION app_authz.is_restricted_external() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_authz.is_restricted_external() TO authenticated, service_role;

-- A hosted migration executor may be a non-superuser CREATEROLE role. PostgreSQL
-- requires both SET ROLE capability for the new owner and CREATE on the owning
-- schema before an ownership transfer. Grant only those capabilities for this
-- transfer, then restore the exact pre-migration membership/schema state before
-- the transaction commits. The helper ACL is finalized while this executor is
-- still the function owner; membership rows granted by bootstrap are preserved.
DO $$
DECLARE
  v_executor_name name := current_user;
  v_executor_oid oid := v_executor_name::regrole;
  v_owner_name constant name := 'minted_e612_authz_owner';
  v_owner_oid oid := v_owner_name::regrole;
  v_had_effective_set boolean := pg_has_role(v_executor_name, v_owner_name, 'SET');
  v_had_effective_create boolean := has_schema_privilege(v_owner_name, 'app_authz', 'CREATE');
  v_had_direct_selfgrant boolean := false;
  v_admin_option boolean;
  v_inherit_option boolean;
  v_set_option boolean;
  v_bool_admin text;
  v_bool_inherit text;
  v_bool_set text;
BEGIN
  IF NOT v_had_effective_set THEN
    SELECT m.admin_option, m.inherit_option, m.set_option
      INTO v_admin_option, v_inherit_option, v_set_option
      FROM pg_auth_members m
     WHERE m.roleid = v_owner_oid
       AND m.member = v_executor_oid
       AND m.grantor = v_executor_oid;
    v_had_direct_selfgrant := FOUND;

    -- Explicit options are required here: INHERIT is deliberately false, while
    -- SET is the only capability needed for the ownership handoff.
    EXECUTE format(
      'GRANT %I TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY CURRENT_USER',
      v_owner_name,
      v_executor_name
    );
  END IF;

  IF NOT v_had_effective_create THEN
    EXECUTE format('GRANT CREATE ON SCHEMA app_authz TO %I', v_owner_name);
  END IF;

  EXECUTE 'ALTER FUNCTION app_authz.is_restricted_external() OWNER TO minted_e612_authz_owner';

  IF NOT v_had_effective_create THEN
    EXECUTE format('REVOKE CREATE ON SCHEMA app_authz FROM %I', v_owner_name);
  END IF;

  IF NOT v_had_effective_set THEN
    IF v_had_direct_selfgrant THEN
      v_bool_admin := CASE WHEN v_admin_option THEN 'TRUE' ELSE 'FALSE' END;
      v_bool_inherit := CASE WHEN v_inherit_option THEN 'TRUE' ELSE 'FALSE' END;
      v_bool_set := CASE WHEN v_set_option THEN 'TRUE' ELSE 'FALSE' END;
      EXECUTE format(
        'GRANT %I TO %I WITH ADMIN %s, INHERIT %s, SET %s GRANTED BY CURRENT_USER',
        v_owner_name,
        v_executor_name,
        v_bool_admin,
        v_bool_inherit,
        v_bool_set
      );
    ELSE
      EXECUTE format('REVOKE %I FROM %I GRANTED BY CURRENT_USER', v_owner_name, v_executor_name);
    END IF;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Shared direct-surface hardening. Non-restricted signed-in behavior remains;
-- durable restricted clients are denied at the database boundary.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS inbound_leads_select ON public.inbound_leads;
CREATE POLICY inbound_leads_select ON public.inbound_leads
  FOR SELECT TO authenticated
  USING (NOT app_authz.is_restricted_external());

DROP POLICY IF EXISTS inbound_leads_update ON public.inbound_leads;
CREATE POLICY inbound_leads_update ON public.inbound_leads
  FOR UPDATE TO authenticated
  USING (NOT app_authz.is_restricted_external())
  WITH CHECK (NOT app_authz.is_restricted_external());

-- payer_catalog_changes is platform review state. The preceding platform-only
-- migration intentionally dropped authenticated/anon SELECT and grants;
-- preserve that final service-only posture for every E6.12 identity.

DROP POLICY IF EXISTS portal_field_maps_select_org ON public.portal_field_maps;
CREATE POLICY portal_field_maps_select_org ON public.portal_field_maps
  FOR SELECT TO authenticated
  USING (
    (org_id IS NULL AND NOT app_authz.is_restricted_external())
    OR org_id IN (SELECT user_org_ids())
  );

DROP POLICY IF EXISTS portals_select_org ON public.portals;
CREATE POLICY portals_select_org ON public.portals
  FOR SELECT TO authenticated
  USING (
    (org_id IS NULL AND NOT app_authz.is_restricted_external())
    OR org_id IN (SELECT user_org_ids())
  );

DROP POLICY IF EXISTS sop_templates_select ON public.sop_templates;
CREATE POLICY sop_templates_select ON public.sop_templates
  FOR SELECT TO authenticated
  USING (
    (org_id IS NULL AND NOT app_authz.is_restricted_external())
    OR org_id IN (SELECT user_org_ids())
  );

DROP POLICY IF EXISTS sop_template_versions_select ON public.sop_template_versions;
CREATE POLICY sop_template_versions_select ON public.sop_template_versions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.sop_templates t
       WHERE t.id = sop_template_versions.template_id
         AND (
           (t.org_id IS NULL AND NOT app_authz.is_restricted_external())
           OR t.org_id IN (SELECT user_org_ids())
         )
    )
  );

DROP POLICY IF EXISTS payer_forms_select ON public.payer_forms;
CREATE POLICY payer_forms_select ON public.payer_forms
  FOR SELECT TO authenticated
  USING (NOT app_authz.is_restricted_external());

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS payer_forms_objects_select ON storage.objects;
    CREATE POLICY payer_forms_objects_select ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'payer-forms' AND NOT app_authz.is_restricted_external());
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.list_global_payers()
RETURNS SETOF public.payers
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.*
  FROM public.payers p
  WHERE p.org_id IS NULL
    AND auth.uid() IS NOT NULL
    AND NOT app_authz.is_restricted_external()
  ORDER BY p.name;
$$;

REVOKE ALL ON FUNCTION public.list_global_payers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_global_payers() TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_global_portal(
  p_id uuid,
  p_name text,
  p_portal_key text,
  p_payer_id uuid DEFAULT NULL,
  p_form_url text DEFAULT NULL
)
RETURNS public.portals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := lower(btrim(coalesce(p_portal_key, '')));
  v_row public.portals%ROWTYPE;
BEGIN
  IF app_authz.is_restricted_external() THEN
    RAISE EXCEPTION 'Restricted client cannot modify global training surfaces';
  END IF;
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Portal name is required';
  END IF;

  IF p_id IS NULL THEN
    IF v_key = '' THEN
      RAISE EXCEPTION 'Portal key is required';
    END IF;
    BEGIN
      INSERT INTO public.portals (org_id, portal_key, name, payer_id, form_url)
      VALUES (NULL, v_key, btrim(p_name), p_payer_id, nullif(btrim(coalesce(p_form_url, '')), ''))
      RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'global_portal_key_exists: %', v_key;
    END;
    RETURN v_row;
  END IF;

  SELECT * INTO v_row FROM public.portals WHERE id = p_id AND org_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Portal not found';
  END IF;

  UPDATE public.portals
     SET name = btrim(p_name),
         payer_id = p_payer_id,
         form_url = nullif(btrim(coalesce(p_form_url, '')), ''),
         is_verified = CASE WHEN nullif(btrim(coalesce(p_form_url, '')), '') IS DISTINCT FROM form_url
                            THEN false ELSE is_verified END,
         last_verified_at = CASE WHEN nullif(btrim(coalesce(p_form_url, '')), '') IS DISTINCT FROM form_url
                                 THEN NULL ELSE last_verified_at END,
         proven_at = CASE WHEN nullif(btrim(coalesce(p_form_url, '')), '') IS DISTINCT FROM form_url
                          THEN NULL ELSE proven_at END,
         url_changed_at = CASE WHEN nullif(btrim(coalesce(p_form_url, '')), '') IS DISTINCT FROM form_url
                               THEN now() ELSE url_changed_at END
   WHERE id = p_id AND org_id IS NULL
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_global_portal(uuid, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_global_portal(uuid, text, text, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_global_portal_flags(
  p_id uuid,
  p_verified boolean DEFAULT NULL,
  p_proven boolean DEFAULT NULL
)
RETURNS public.portals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.portals%ROWTYPE;
BEGIN
  IF app_authz.is_restricted_external() THEN
    RAISE EXCEPTION 'Restricted client cannot modify global training surfaces';
  END IF;
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_row FROM public.portals WHERE id = p_id AND org_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Portal not found';
  END IF;

  UPDATE public.portals
     SET is_verified = coalesce(p_verified, is_verified),
         last_verified_at = CASE WHEN p_verified IS TRUE THEN now()
                                 WHEN p_verified IS FALSE THEN NULL
                                 ELSE last_verified_at END,
         proven_at = CASE WHEN p_proven IS TRUE THEN now()
                          WHEN p_proven IS FALSE THEN NULL
                          ELSE proven_at END
   WHERE id = p_id AND org_id IS NULL
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_global_portal_flags(uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_global_portal_flags(uuid, boolean, boolean) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.author_global_sop(uuid, text, uuid, text, uuid, jsonb, boolean, jsonb);
DROP FUNCTION IF EXISTS public.author_global_sop(uuid, text, uuid, text[], uuid, jsonb, boolean, jsonb);

CREATE FUNCTION public.author_global_sop(
  p_id uuid,
  p_name text,
  p_payer_id uuid,
  p_states text[],
  p_group_id uuid,
  p_task_definitions jsonb DEFAULT NULL,
  p_archived boolean DEFAULT NULL,
  p_required_profile_attributes jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.sop_templates%ROWTYPE;
  v_archived boolean := coalesce(p_archived, false);
  v_defs jsonb := coalesce(p_task_definitions, '[]'::jsonb);
  v_attrs jsonb := coalesce(p_required_profile_attributes, '[]'::jsonb);
  v_states text[] := p_states;
  v_mirror text := p_states[1];
  v_clash text;
BEGIN
  IF app_authz.is_restricted_external() THEN
    RAISE EXCEPTION 'Restricted client cannot modify global training surfaces';
  END IF;
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_id = '00000000-0000-4000-a000-00000000e17b'::uuid THEN
    RAISE EXCEPTION 'fallback_sop_locked';
  END IF;

  -- Active global SOPs require a complete payer + at-least-one-state match key
  -- (group stays optional = the "any group" tier). Archived rows are exempt,
  -- mirroring assertActiveOrgMatchKeyComplete.
  IF NOT v_archived
     AND (p_payer_id IS NULL OR v_states IS NULL OR array_length(v_states, 1) IS NULL) THEN
    RAISE EXCEPTION 'global_sop_match_key_incomplete';
  END IF;

  -- No ACTIVE global row for the same (payer, group) may share a state.
  IF NOT v_archived THEN
    SELECT string_agg(DISTINCT s, ', ' ORDER BY s) INTO v_clash
      FROM public.sop_templates t
      CROSS JOIN LATERAL unnest(t.states) AS s
     WHERE t.org_id IS NULL
       AND t.archived = false
       AND t.id IS DISTINCT FROM p_id
       AND t.payer_id IS NOT DISTINCT FROM p_payer_id
       AND t.group_id IS NOT DISTINCT FROM p_group_id
       AND s = ANY (v_states);
    IF v_clash IS NOT NULL THEN
      RAISE EXCEPTION 'global_sop_duplicate_match: %', v_clash;
    END IF;
  END IF;

  IF p_id IS NULL THEN
    IF p_name IS NULL OR btrim(p_name) = '' THEN
      RAISE EXCEPTION 'Template name is required';
    END IF;
    IF jsonb_typeof(v_defs) <> 'array' THEN
      RAISE EXCEPTION 'task_definitions must be a json array';
    END IF;
    IF jsonb_typeof(v_attrs) <> 'array' THEN
      RAISE EXCEPTION 'required_profile_attributes must be a json array';
    END IF;
    INSERT INTO public.sop_templates
      (org_id, name, payer_id, state, states, group_id, task_definitions,
       archived, required_profile_attributes)
    VALUES (NULL, btrim(p_name), p_payer_id, v_mirror, v_states, p_group_id, v_defs,
            v_archived, v_attrs)
    RETURNING * INTO v_row;
  ELSE
    -- UPDATE changes match key + archived ONLY; content/name/attributes go
    -- through publish_sop_template_version (the TE-5 save split), never here.
    UPDATE public.sop_templates
       SET payer_id = p_payer_id,
           state = v_mirror,
           states = v_states,
           group_id = p_group_id,
           archived = v_archived
     WHERE id = p_id AND org_id IS NULL
     RETURNING * INTO v_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Template not found';
    END IF;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.author_global_sop(uuid, text, uuid, text[], uuid, jsonb, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.author_global_sop(uuid, text, uuid, text[], uuid, jsonb, boolean, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.publish_sop_template_version(
  p_template_id uuid,
  p_expected_version integer,
  p_name text,
  p_task_definitions jsonb,
  p_change_note text DEFAULT NULL::text,
  p_required_profile_attributes jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_current integer;
  v_uid uuid := auth.uid();
  v_next integer;
  v_attrs jsonb := coalesce(p_required_profile_attributes, '[]'::jsonb);
BEGIN
  IF app_authz.is_restricted_external() THEN
    RAISE EXCEPTION 'Restricted client cannot modify global training surfaces';
  END IF;
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Template name is required';
  END IF;
  IF p_task_definitions IS NULL OR jsonb_typeof(p_task_definitions) <> 'array' THEN
    RAISE EXCEPTION 'task_definitions must be a json array';
  END IF;
  IF jsonb_typeof(v_attrs) <> 'array' THEN
    RAISE EXCEPTION 'required_profile_attributes must be a json array';
  END IF;

  SELECT org_id, current_version INTO v_org, v_current
    FROM public.sop_templates WHERE id = p_template_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found';
  END IF;

  -- Global tier (v_org NULL): authenticated authoring is the interim F6.5.6
  -- posture (R7 replaces this with real platform roles). Since E6.7 F6.7.2
  -- that includes the generic fallback — its identity guards live in
  -- author_global_sop; content versions publish like any global SOP.
  IF v_org IS NOT NULL
     AND (NOT (v_org IN (SELECT user_org_ids()))
          OR user_role(v_org) IS DISTINCT FROM 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_current IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'sop_version_conflict: expected version %, head is %',
      p_expected_version, v_current;
  END IF;

  v_next := v_current + 1;

  INSERT INTO public.sop_template_versions
    (template_id, version, name, task_definitions, change_note, published_by, required_profile_attributes)
  VALUES (p_template_id, v_next, btrim(p_name), p_task_definitions,
          nullif(btrim(coalesce(p_change_note, '')), ''), v_uid, v_attrs);

  UPDATE public.sop_templates
    SET name = btrim(p_name),
        task_definitions = p_task_definitions,
        required_profile_attributes = v_attrs,
        current_version = v_next,
        updated_at = now()
    WHERE id = p_template_id AND current_version = v_current;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sop_version_conflict: concurrent publish detected';
  END IF;

  IF v_org IS NOT NULL THEN
    INSERT INTO public.audit_log
      (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org, v_uid, 'UPDATE', 'sop_template', p_template_id,
            'Published SOP template ' || btrim(p_name) || ' version ' || v_next);
  END IF;

  RETURN jsonb_build_object('template_id', p_template_id, 'version', v_next);
END;
$function$;
REVOKE ALL ON FUNCTION public.publish_sop_template_version(uuid, integer, text, jsonb, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_sop_template_version(uuid, integer, text, jsonb, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.propose_shared_field_map(
  p_portal_key text,
  p_selector text,
  p_field_label text DEFAULT NULL,
  p_form_section text DEFAULT NULL,
  p_page_step text DEFAULT NULL,
  p_field_type text DEFAULT 'text',
  p_sort_order integer DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_control_options jsonb DEFAULT NULL,
  p_map_type text DEFAULT 'web'
)
RETURNS public.portal_field_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := lower(btrim(coalesce(p_portal_key, '')));
  v_selector text := btrim(coalesce(p_selector, ''));
  v_type text := coalesce(nullif(btrim(coalesce(p_field_type, '')), ''), 'text');
  v_map_type text := coalesce(nullif(btrim(lower(coalesce(p_map_type, ''))), ''), 'web');
  v_row public.portal_field_maps%ROWTYPE;
  v_options jsonb := NULL;
BEGIN
  IF app_authz.is_restricted_external() THEN
    RAISE EXCEPTION 'Restricted client cannot modify global training surfaces';
  END IF;
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_key = '' THEN
    RAISE EXCEPTION 'portal_key is required';
  END IF;
  IF v_selector = '' THEN
    RAISE EXCEPTION 'selector is required';
  END IF;
  IF v_type NOT IN ('text', 'select', 'radio', 'checkbox', 'date', 'file') THEN
    RAISE EXCEPTION 'Invalid field_type %', v_type;
  END IF;
  IF v_map_type NOT IN ('web', 'pdf') THEN
    RAISE EXCEPTION 'Invalid map_type %', v_map_type;
  END IF;

  IF p_control_options IS NOT NULL THEN
    IF jsonb_typeof(p_control_options) <> 'array' THEN
      RAISE EXCEPTION 'control_options must be a json array';
    END IF;
    -- Empty array is a valid inbound shape (AJAX select not yet loaded, or a
    -- PDF checkbox with no export values) but is never stored on re-capture;
    -- first insert still writes NULL rather than [] so "never captured" stays
    -- distinguishable from "captured empty".
    IF jsonb_array_length(p_control_options) > 0 THEN
      v_options := p_control_options;
    END IF;
  END IF;

  INSERT INTO public.portal_field_maps (
    org_id, portal_key, selector, field_label, form_section, page_step,
    field_type, map_type, status, source, notes, token, sort_order,
    control_options
  )
  VALUES (
    NULL, v_key, v_selector,
    nullif(btrim(coalesce(p_field_label, '')), ''),
    nullif(btrim(coalesce(p_form_section, '')), ''),
    nullif(btrim(coalesce(p_page_step, '')), ''),
    v_type, v_map_type, 'proposed', 'manual',
    coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'Captured for the shared form library'),
    NULL, p_sort_order,
    v_options
  )
  ON CONFLICT DO NOTHING;

  SELECT * INTO v_row
    FROM public.portal_field_maps
   WHERE org_id IS NULL AND portal_key = v_key AND selector = v_selector
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Could not resolve the shared field map after insert';
  END IF;

  -- Presentation refresh only. `map_type` is identity, not presentation: a row
  -- that already exists keeps the type it was created with, so a stray caller
  -- can never flip a trained web row into a PDF row (or the reverse) and
  -- silently take it out of the fill it belongs to.
  UPDATE public.portal_field_maps
     SET field_label = coalesce(nullif(btrim(coalesce(p_field_label, '')), ''), field_label),
         form_section = coalesce(nullif(btrim(coalesce(p_form_section, '')), ''), form_section),
         page_step = coalesce(nullif(btrim(coalesce(p_page_step, '')), ''), page_step),
         sort_order = CASE
                        WHEN p_sort_order IS NOT NULL THEN p_sort_order
                        ELSE sort_order
                      END,
         control_options = CASE
                             WHEN v_options IS NOT NULL THEN v_options
                             ELSE control_options
                           END,
         updated_at = now()
   WHERE id = v_row.id AND org_id IS NULL
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.propose_shared_field_map(text, text, text, text, text, text, integer, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_shared_field_map(text, text, text, text, text, text, integer, text, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.train_global_field_map(
  p_id uuid,
  p_status text,
  p_source text,
  p_token text DEFAULT NULL,
  p_field_label text DEFAULT NULL,
  p_hardcoded_value text DEFAULT NULL,
  p_transform text DEFAULT NULL
)
RETURNS public.portal_field_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.portal_field_maps%ROWTYPE;
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
  v_literal text := nullif(btrim(coalesce(p_hardcoded_value, '')), '');
  v_transform text := nullif(btrim(coalesce(p_transform, '')), '');
BEGIN
  IF app_authz.is_restricted_external() THEN
    RAISE EXCEPTION 'Restricted client cannot modify global training surfaces';
  END IF;
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('proposed', 'approved') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('token', 'manual', 'manual_partial', 'hardcoded') THEN
    RAISE EXCEPTION 'Invalid source';
  END IF;
  IF p_source IN ('token', 'manual_partial') AND v_token IS NULL THEN
    RAISE EXCEPTION 'Token is required for source %', p_source;
  END IF;
  IF p_source = 'hardcoded' THEN
    IF v_literal IS NULL THEN
      RAISE EXCEPTION 'A fixed value cannot be empty';
    END IF;
    v_token := NULL;
  ELSE
    v_literal := NULL;
  END IF;
  IF p_source = 'manual' THEN
    v_token := NULL;
  END IF;
  -- Shaping only applies to a token fill. A fixed value is already the
  -- literal that will be sent.
  IF p_source IN ('token', 'manual_partial') THEN
    IF v_transform IS NOT NULL AND v_transform NOT IN ('state_abbrev', 'date_mmddyyyy') THEN
      RAISE EXCEPTION 'Invalid transform %', v_transform;
    END IF;
  ELSE
    v_transform := NULL;
  END IF;

  SELECT * INTO v_row FROM public.portal_field_maps
   WHERE id = p_id AND org_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Field map not found';
  END IF;

  UPDATE public.portal_field_maps
     SET status = p_status,
         source = p_source,
         token = v_token,
         hardcoded_value = v_literal,
         transform = v_transform,
         notes = CASE WHEN p_source IN ('manual', 'manual_partial')
                      THEN coalesce(notes, 'Marked manual in the form editor')
                      ELSE notes END,
         field_label = coalesce(nullif(btrim(coalesce(p_field_label, '')), ''), field_label)
   WHERE id = p_id AND org_id IS NULL
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.train_global_field_map(uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.train_global_field_map(uuid, text, text, text, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_shared_field_registry(p_entries jsonb)
RETURNS SETOF public.portal_field_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry jsonb;
  v_id uuid;
BEGIN
  IF app_authz.is_restricted_external() THEN
    RAISE EXCEPTION 'Restricted client cannot modify global training surfaces';
  END IF;
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'entries must be a json array';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_id := nullif(v_entry->>'id', '')::uuid;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'each entry needs an id';
    END IF;

    UPDATE public.portal_field_maps
       SET display_label = CASE WHEN v_entry ? 'display_label'
                                THEN nullif(btrim(coalesce(v_entry->>'display_label', '')), '')
                                ELSE display_label END,
           section       = CASE WHEN v_entry ? 'section'
                                THEN nullif(btrim(coalesce(v_entry->>'section', '')), '')
                                ELSE section END,
           sort_order    = CASE WHEN v_entry ? 'sort_order'
                                THEN (v_entry->>'sort_order')::integer
                                ELSE sort_order END,
           updated_at    = now()
     WHERE id = v_id AND org_id IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Shared field map % not found', v_id;
    END IF;
  END LOOP;

  RETURN QUERY
    SELECT * FROM public.portal_field_maps
     WHERE org_id IS NULL
       AND id IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(p_entries) e);
END;
$$;

REVOKE ALL ON FUNCTION public.update_shared_field_registry(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_shared_field_registry(jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Existing auth-only SECURITY DEFINER RPCs. These guards preserve legacy
-- non-restricted staff/billing behavior and reject durable restricted clients.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Existing auth-only SECURITY DEFINER RPCs. These guards preserve legacy
-- non-restricted staff/billing behavior and reject durable restricted clients.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_organization(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF app_authz.is_restricted_external() THEN
    RAISE EXCEPTION 'Restricted client cannot create an organization';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;

  INSERT INTO public.organizations (name)
    VALUES (btrim(p_name))
    RETURNING id INTO v_org_id;

  INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (v_org_id, v_uid, 'admin');

  INSERT INTO public.status_configs (org_id, track, label, color, sort_order, action_bucket) VALUES
    (v_org_id, 'credentialing', 'Not Started',          '#9CA3AF',  5, 'ours'),
    (v_org_id, 'credentialing', 'In-Network',           '#059669', 10, 'complete'),
    (v_org_id, 'credentialing', 'OON',                  '#DC2626', 20, 'complete'),
    (v_org_id, 'credentialing', 'In Progress',          '#2563EB', 30, 'ours'),
    (v_org_id, 'credentialing', 'Waiting on Provider',  '#D97706', 31, 'waiting_provider'),
    (v_org_id, 'credentialing', 'Submitted',            '#0891B2', 32, 'waiting_payer'),
    (v_org_id, 'credentialing', 'Approved',             '#059669', 35, 'complete'),
    (v_org_id, 'credentialing', 'Denied',               '#DC2626', 40, 'ours'),
    (v_org_id, 'credentialing', 'Not Required',         '#9CA3AF', 45, 'complete'),
    (v_org_id, 'contracting',   'Not Started',          '#9CA3AF', 10, 'ours'),
    (v_org_id, 'contracting',   'In Progress',          '#2563EB', 20, 'ours'),
    (v_org_id, 'contracting',   'Denied',               '#DC2626', 30, 'ours'),
    (v_org_id, 'contracting',   'Contracted',           '#0891B2', 40, 'waiting_payer'),
    (v_org_id, 'contracting',   'In-Network',           '#059669', 50, 'complete'),
    (v_org_id, 'contracting',   'OON',                  '#DC2626', 60, 'complete'),
    (v_org_id, 'location',      'Prospect',             '#9CA3AF', 10, 'ours'),
    (v_org_id, 'location',      'Planned',              '#2563EB', 20, 'ours'),
    (v_org_id, 'location',      'Interviewing',         '#0891B2', 30, 'ours'),
    (v_org_id, 'location',      'Pending Fulfillment',  '#D97706', 40, 'ours'),
    (v_org_id, 'location',      'Ready for Launch',     '#059669', 50, 'ours'),
    (v_org_id, 'location',      'Live',                 '#059669', 60, 'complete'),
    (v_org_id, 'location',      'Inactive',             '#9CA3AF', 70, 'complete');

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org_id, v_uid, 'CREATE', 'organization', v_org_id,
            'Created organization ' || btrim(p_name));

  RETURN v_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_organization(
  p_name text,
  p_owner_name text,
  p_owner_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_party_id uuid;
  v_name text := btrim(p_name);
  v_owner_name text := btrim(p_owner_name);
  v_owner_email text := btrim(p_owner_email);
  v_norm text;
  v_email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF app_authz.is_restricted_external() THEN
    RAISE EXCEPTION 'Restricted client cannot create an organization';
  END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'Organization name is required'; END IF;
  IF v_owner_name = '' THEN RAISE EXCEPTION 'Owner name is required'; END IF;
  IF v_owner_email = '' THEN RAISE EXCEPTION 'Owner email is required'; END IF;
  IF v_owner_email !~ v_email_re THEN RAISE EXCEPTION 'Owner email is not valid'; END IF;

  v_norm := lower(regexp_replace(v_name, '\s+', '', 'g'));
  IF EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE lower(regexp_replace(o.name, '\s+', '', 'g')) = v_norm
  ) THEN
    RAISE EXCEPTION 'An organization named "%" already exists. Please use a different name.', v_name;
  END IF;

  INSERT INTO public.organizations (name, lifecycle_state)
    VALUES (v_name, 'prospect')
    RETURNING id INTO v_org_id;

  INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (v_org_id, v_uid, 'admin');

  INSERT INTO public.status_configs (org_id, track, label, color, sort_order, action_bucket) VALUES
    (v_org_id, 'credentialing', 'Not Started',          '#9CA3AF',  5, 'ours'),
    (v_org_id, 'credentialing', 'In-Network',           '#059669', 10, 'complete'),
    (v_org_id, 'credentialing', 'OON',                  '#DC2626', 20, 'complete'),
    (v_org_id, 'credentialing', 'In Progress',          '#2563EB', 30, 'ours'),
    (v_org_id, 'credentialing', 'Waiting on Provider',  '#D97706', 31, 'waiting_provider'),
    (v_org_id, 'credentialing', 'Submitted',            '#0891B2', 32, 'waiting_payer'),
    (v_org_id, 'credentialing', 'Approved',             '#059669', 35, 'complete'),
    (v_org_id, 'credentialing', 'Denied',               '#DC2626', 40, 'ours'),
    (v_org_id, 'credentialing', 'Not Required',         '#9CA3AF', 45, 'complete'),
    (v_org_id, 'contracting',   'Not Started',          '#9CA3AF', 10, 'ours'),
    (v_org_id, 'contracting',   'In Progress',          '#2563EB', 20, 'ours'),
    (v_org_id, 'contracting',   'Denied',               '#DC2626', 30, 'ours'),
    (v_org_id, 'contracting',   'Contracted',           '#0891B2', 40, 'waiting_payer'),
    (v_org_id, 'contracting',   'In-Network',           '#059669', 50, 'complete'),
    (v_org_id, 'contracting',   'OON',                  '#DC2626', 60, 'complete'),
    (v_org_id, 'location',      'Prospect',             '#9CA3AF', 10, 'ours'),
    (v_org_id, 'location',      'Planned',              '#2563EB', 20, 'ours'),
    (v_org_id, 'location',      'Interviewing',         '#0891B2', 30, 'ours'),
    (v_org_id, 'location',      'Pending Fulfillment',  '#D97706', 40, 'ours'),
    (v_org_id, 'location',      'Ready for Launch',     '#059669', 50, 'ours'),
    (v_org_id, 'location',      'Live',                 '#059669', 60, 'complete'),
    (v_org_id, 'location',      'Inactive',             '#9CA3AF', 70, 'complete');

  INSERT INTO public.parties (org_id, party_type, name, first_name, last_name, email, created_by)
    VALUES (v_org_id, 'person', v_owner_name,
            nullif(public._party_first_name(v_owner_name), ''),
            nullif(public._party_last_name(v_owner_name), ''),
            v_owner_email, v_uid)
    RETURNING id INTO v_party_id;
  INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type, is_default)
    VALUES (v_org_id, v_party_id, 'owner', 'org', true);

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org_id, v_uid, 'CREATE', 'organization', v_org_id,
            'Created organization ' || v_name);

  RETURN v_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_organization(
  p_name text,
  p_owner_name text,
  p_owner_email text,
  p_customer jsonb,
  p_sales_rep jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_party_id uuid;
  v_name text := btrim(p_name);
  v_owner_name text := btrim(p_owner_name);
  v_owner_email text := btrim(p_owner_email);
  v_norm text;
  v_email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
  v_sales jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF app_authz.is_restricted_external() THEN
    RAISE EXCEPTION 'Restricted client cannot create an organization';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;
  IF v_owner_name = '' THEN
    RAISE EXCEPTION 'Owner name is required';
  END IF;
  IF v_owner_email = '' THEN
    RAISE EXCEPTION 'Owner email is required';
  END IF;
  IF v_owner_email !~ v_email_re THEN
    RAISE EXCEPTION 'Owner email is not valid';
  END IF;

  IF p_customer IS NULL THEN
    RAISE EXCEPTION 'Customer contact is required';
  END IF;
  PERFORM public.assert_contact_valid(p_customer, 'Customer contact');

  -- Sales rep stays genuinely optional (hotfix 20260807120000): NULL, JSON null
  -- and {} all mean "no sales rep", and no placeholder identity is substituted.
  v_sales := NULL;
  IF p_sales_rep IS NOT NULL
     AND jsonb_typeof(p_sales_rep) = 'object'
     AND p_sales_rep <> '{}'::jsonb THEN
    v_sales := p_sales_rep;
    PERFORM public.assert_contact_valid(v_sales, 'Sales rep');
  END IF;

  v_norm := lower(regexp_replace(v_name, '\s+', '', 'g'));
  IF EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE lower(regexp_replace(o.name, '\s+', '', 'g')) = v_norm
  ) THEN
    RAISE EXCEPTION 'An organization named "%" already exists. Please use a different name.', v_name;
  END IF;

  INSERT INTO public.organizations (name, lifecycle_state)
    VALUES (v_name, 'prospect')
    RETURNING id INTO v_org_id;

  INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (v_org_id, v_uid, 'admin');

  INSERT INTO public.status_configs (org_id, track, label, color, sort_order, action_bucket) VALUES
    (v_org_id, 'credentialing', 'Not Started',          '#9CA3AF',  5, 'ours'),
    (v_org_id, 'credentialing', 'In-Network',           '#059669', 10, 'complete'),
    (v_org_id, 'credentialing', 'OON',                  '#DC2626', 20, 'complete'),
    (v_org_id, 'credentialing', 'In Progress',          '#2563EB', 30, 'ours'),
    (v_org_id, 'credentialing', 'Waiting on Provider',  '#D97706', 31, 'waiting_provider'),
    (v_org_id, 'credentialing', 'Submitted',            '#0891B2', 32, 'waiting_payer'),
    (v_org_id, 'credentialing', 'Approved',             '#059669', 35, 'complete'),
    (v_org_id, 'credentialing', 'Denied',               '#DC2626', 40, 'ours'),
    (v_org_id, 'credentialing', 'Not Required',         '#9CA3AF', 45, 'complete'),
    (v_org_id, 'contracting',   'Not Started',          '#9CA3AF', 10, 'ours'),
    (v_org_id, 'contracting',   'In Progress',          '#2563EB', 20, 'ours'),
    (v_org_id, 'contracting',   'Denied',               '#DC2626', 30, 'ours'),
    (v_org_id, 'contracting',   'Contracted',           '#0891B2', 40, 'waiting_payer'),
    (v_org_id, 'contracting',   'In-Network',           '#059669', 50, 'complete'),
    (v_org_id, 'contracting',   'OON',                  '#DC2626', 60, 'complete'),
    (v_org_id, 'location',      'Prospect',             '#9CA3AF', 10, 'ours'),
    (v_org_id, 'location',      'Planned',              '#2563EB', 20, 'ours'),
    (v_org_id, 'location',      'Interviewing',         '#0891B2', 30, 'ours'),
    (v_org_id, 'location',      'Pending Fulfillment',  '#D97706', 40, 'ours'),
    (v_org_id, 'location',      'Ready for Launch',     '#059669', 50, 'ours'),
    (v_org_id, 'location',      'Live',                 '#059669', 60, 'complete'),
    (v_org_id, 'location',      'Inactive',             '#9CA3AF', 70, 'complete');

  -- Owner / authorized contact (name + email only, E0.1).
  INSERT INTO public.parties (org_id, party_type, name, first_name, last_name, email, created_by)
    VALUES (v_org_id, 'person', v_owner_name,
            nullif(public._party_first_name(v_owner_name), ''),
            nullif(public._party_last_name(v_owner_name), ''),
            v_owner_email, v_uid)
    RETURNING id INTO v_party_id;
  INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type, is_default)
    VALUES (v_org_id, v_party_id, 'owner', 'org', true);

  -- Organization contact.
  v_party_id := public.insert_contact_party(p_customer, v_uid, v_org_id);
  INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type, is_default)
    VALUES (v_org_id, v_party_id, 'customer_escalation_contact', 'org', true);

  IF v_sales IS NOT NULL THEN
    v_party_id := public.insert_contact_party(v_sales, v_uid, v_org_id);
    INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type, is_default)
      VALUES (v_org_id, v_party_id, 'sales_rep', 'org', true);
  END IF;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org_id, v_uid, 'CREATE', 'organization', v_org_id,
            'Created organization ' || v_name);

  RETURN v_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_invites()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
  v_count integer := 0;
  r record;
BEGIN
  IF app_authz.is_restricted_external() THEN
    RAISE EXCEPTION 'Restricted client cannot claim staff invites';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS NULL THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT * FROM public.pending_invites WHERE lower(email) = lower(v_email)
  LOOP
    INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (r.org_id, auth.uid(), r.role)
    ON CONFLICT (user_id, org_id) DO NOTHING;

    UPDATE public.profiles
       SET full_name = COALESCE(full_name, r.full_name)
     WHERE id = auth.uid();

    DELETE FROM public.pending_invites WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$
;
-- ---------------------------------------------------------------------------
-- Service-only context and invite RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_enrollment_context(
  p_actor_user_id uuid,
  p_audience text DEFAULT NULL,
  p_org_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, private, auth, extensions'
AS $$
DECLARE
  v_user auth.users%ROWTYPE;
  v_staff_orgs jsonb := '[]'::jsonb;
  v_client_orgs jsonb := '[]'::jsonb;
  v_membership_count integer := 0;
  v_client_count integer := 0;
  v_has_manifest boolean := false;
  v_restricted boolean := false;
  v_audience text := NULLIF(lower(btrim(coalesce(p_audience, ''))), '');
  v_revision text;
  v_selected_org uuid := p_org_id;
BEGIN
  IF p_actor_user_id IS NULL THEN RAISE EXCEPTION 'Actor is required'; END IF;

  SELECT * INTO v_user FROM auth.users WHERE id = p_actor_user_id;
  IF NOT FOUND OR v_user.email_confirmed_at IS NULL
     OR v_user.deleted_at IS NOT NULL
     OR v_user.is_anonymous
     OR (v_user.banned_until IS NOT NULL AND v_user.banned_until > now()) THEN
    RAISE EXCEPTION 'Verified actor is unavailable';
  END IF;

  SELECT count(*) INTO v_membership_count FROM public.memberships WHERE user_id = p_actor_user_id;
  SELECT count(*) INTO v_client_count
    FROM private.client_access WHERE auth_user_id = p_actor_user_id AND state = 'active';
  SELECT EXISTS (
    SELECT 1 FROM private.internal_staff
     WHERE auth_user_id = p_actor_user_id AND active
  ) INTO v_has_manifest;
  SELECT EXISTS (
    SELECT 1 FROM private.client_identity_classifications
     WHERE auth_user_id = p_actor_user_id
       AND state IN ('pending', 'active', 'expired', 'revoked')
  ) AND NOT v_has_manifest INTO v_restricted;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'orgId', x.org_id,
      'orgName', x.org_name,
      'role', x.role,
      'reportStaff', x.report_staff,
      'clientManage', x.client_manage
    ) ORDER BY x.org_name), '[]'::jsonb)
    INTO v_staff_orgs
    FROM (
      SELECT m.org_id, o.name AS org_name, m.role,
             EXISTS (
               SELECT 1 FROM private.internal_staff s
                WHERE s.auth_user_id = p_actor_user_id
                  AND s.org_id = m.org_id
                  AND s.staff_role = m.role
                  AND s.active
             ) AS report_staff,
             (m.role = 'admin' AND EXISTS (
               SELECT 1 FROM private.internal_staff s
                WHERE s.auth_user_id = p_actor_user_id
                  AND s.org_id = m.org_id
                  AND s.staff_role = 'admin'
                  AND s.active
             )) AS client_manage
        FROM public.memberships m
        JOIN public.organizations o ON o.id = m.org_id
       WHERE m.user_id = p_actor_user_id
    ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'orgId', x.org_id,
      'orgName', x.org_name,
      'groups', x.groups
    ) ORDER BY x.org_name), '[]'::jsonb)
    INTO v_client_orgs
    FROM (
      SELECT ca.org_id, o.name AS org_name,
             coalesce(jsonb_agg(jsonb_build_object(
               'groupId', g.id,
               'groupName', g.name
             ) ORDER BY g.name) FILTER (WHERE g.id IS NOT NULL), '[]'::jsonb) AS groups
        FROM private.client_access ca
        JOIN public.organizations o ON o.id = ca.org_id
        LEFT JOIN private.client_group_grants cg ON cg.access_id = ca.id AND cg.org_id = ca.org_id
        LEFT JOIN public.provider_groups g ON g.id = cg.group_id AND g.org_id = cg.org_id
       WHERE ca.auth_user_id = p_actor_user_id AND ca.state = 'active'
       GROUP BY ca.org_id, o.name
    ) x;

  IF v_audience IS NOT NULL AND v_audience NOT IN ('staff', 'client') THEN
    RAISE EXCEPTION 'Unsupported audience';
  END IF;
  -- A single-capability actor keeps the existing landing behavior. Only a
  -- dual-capability actor needs an explicit audience choice; org-less
  -- internal training remains audience-neutral.
  IF v_audience IS NULL THEN
    IF v_restricted AND v_client_count > 0 THEN
      v_audience := 'client';
    ELSIF v_membership_count > 0 AND v_client_count = 0 THEN
      v_audience := 'staff';
    ELSIF v_client_count > 0 AND v_membership_count = 0 THEN
      v_audience := 'client';
    END IF;
  END IF;
  IF v_restricted AND v_audience <> 'client' THEN
    RAISE EXCEPTION 'Restricted client cannot use staff context';
  END IF;
  IF v_audience = 'client' AND v_selected_org IS NULL AND v_client_count = 1 THEN
    SELECT ca.org_id INTO v_selected_org
      FROM private.client_access ca
     WHERE ca.auth_user_id = p_actor_user_id AND ca.state = 'active'
     ORDER BY ca.org_id
     LIMIT 1;
  END IF;
  IF v_selected_org IS NOT NULL AND v_audience IS NULL THEN
    RAISE EXCEPTION 'Audience is required when selecting an organization';
  END IF;
  IF v_audience = 'client' AND v_client_count = 0 THEN
    RAISE EXCEPTION 'Client context is unavailable';
  END IF;
  IF v_audience = 'staff' AND v_membership_count = 0 THEN
    RAISE EXCEPTION 'Staff context is unavailable';
  END IF;
  IF v_selected_org IS NOT NULL THEN
    IF v_audience = 'client' AND NOT EXISTS (
      SELECT 1 FROM private.client_access ca
       WHERE ca.auth_user_id = p_actor_user_id AND ca.org_id = v_selected_org AND ca.state = 'active'
    ) THEN
      RAISE EXCEPTION 'Client organization is unavailable';
    END IF;
    IF v_audience = 'staff' AND NOT EXISTS (
      SELECT 1 FROM public.memberships m
       WHERE m.user_id = p_actor_user_id AND m.org_id = v_selected_org
    ) THEN
      RAISE EXCEPTION 'Staff organization is unavailable';
    END IF;
  END IF;

  SELECT md5(concat_ws('|',
    p_actor_user_id::text,
    lower(coalesce(v_user.email, '')),
    coalesce(v_user.email_confirmed_at::text, ''),
    coalesce(v_user.banned_until::text, ''),
    coalesce(v_user.deleted_at::text, ''),
    coalesce(v_user.is_anonymous::text, ''),
    coalesce((SELECT string_agg(format('%s:%s:%s', m.org_id, m.user_id, m.role), '|' ORDER BY m.org_id, m.role)
                FROM public.memberships m WHERE m.user_id = p_actor_user_id), ''),
    coalesce((SELECT string_agg(format('%s:%s:%s:%s', s.org_id, s.staff_role, s.active, s.manifest_version), '|' ORDER BY s.org_id, s.staff_role)
                FROM private.internal_staff s WHERE s.auth_user_id = p_actor_user_id), ''),
    coalesce((SELECT string_agg(format('%s:%s:%s', c.org_id, c.state, c.email_normalized), '|' ORDER BY c.org_id)
                FROM private.client_identity_classifications c WHERE c.auth_user_id = p_actor_user_id), ''),
    coalesce((SELECT string_agg(format('%s:%s:%s', ca.org_id, ca.state, cg.group_id), '|' ORDER BY ca.org_id, cg.group_id)
                FROM private.client_access ca
                LEFT JOIN private.client_group_grants cg ON cg.access_id = ca.id
               WHERE ca.auth_user_id = p_actor_user_id), '')
  )) INTO v_revision;

  RETURN jsonb_build_object(
    'actorUserId', p_actor_user_id,
    'email', v_user.email,
    'audience', v_audience,
    'selectedOrgId', v_selected_org,
    'staffOrgs', v_staff_orgs,
    'clientOrgs', v_client_orgs,
    'globalTraining', NOT v_restricted,
    'restrictedExternal', v_restricted,
    'contextRevision', v_revision
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_client_invite(
  p_actor_user_id uuid,
  p_org_id uuid,
  p_recipient_email text,
  p_group_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, private, auth, extensions'
AS $$
DECLARE
  v_actor auth.users%ROWTYPE;
  v_email text := lower(btrim(coalesce(p_recipient_email, '')));
  v_recipient auth.users%ROWTYPE;
  v_classification_id uuid;
  v_invite_id uuid;
  v_has_active_access boolean := false;
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_hash text := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
  v_expires timestamptz := now() + interval '7 days';
BEGIN
  IF p_actor_user_id IS NULL OR p_org_id IS NULL THEN RAISE EXCEPTION 'Actor and organization are required'; END IF;
  SELECT * INTO v_actor FROM auth.users WHERE id = p_actor_user_id;
  IF NOT FOUND OR v_actor.email_confirmed_at IS NULL OR v_actor.deleted_at IS NOT NULL
     OR v_actor.is_anonymous OR (v_actor.banned_until IS NOT NULL AND v_actor.banned_until > now()) THEN
    RAISE EXCEPTION 'Verified actor is unavailable';
  END IF;
  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'Recipient email is not valid'; END IF;
  IF p_group_ids IS NULL OR cardinality(p_group_ids) = 0 THEN RAISE EXCEPTION 'At least one provider group is required'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m
     JOIN private.internal_staff s ON s.auth_user_id = m.user_id AND s.org_id = m.org_id
       AND s.staff_role = 'admin' AND s.active
    WHERE m.user_id = p_actor_user_id AND m.org_id = p_org_id AND m.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Client management requires current same-org admin authority';
  END IF;

  SELECT * INTO v_recipient
    FROM auth.users
   WHERE lower(email) = v_email
     AND email_confirmed_at IS NOT NULL
     AND deleted_at IS NULL
     AND is_anonymous = false
     AND (banned_until IS NULL OR banned_until <= now())
   LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recipient must be an existing verified Auth user'; END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_group_ids) AS requested(group_id)
     LEFT JOIN public.provider_groups g ON g.id = requested.group_id AND g.org_id = p_org_id
    WHERE g.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Every provider group must belong to the organization';
  END IF;

  -- Insert-or-find obtains the durable identity row lock before changing its
  -- invite set. Claim and revoke use this same classification -> invite
  -- ordering; the follow-up access read happens after that lock so a revoke
  -- cannot be hidden by a stale pre-lock snapshot.
  INSERT INTO private.client_identity_classifications
    (auth_user_id, org_id, email_normalized, state, bound_at, expires_at, revoked_at)
  VALUES (
    v_recipient.id,
    p_org_id,
    v_email,
    'pending',
    now(),
    v_expires,
    NULL
  )
  ON CONFLICT (auth_user_id, org_id) DO NOTHING
  RETURNING id INTO v_classification_id;
  IF v_classification_id IS NULL THEN
    SELECT id INTO v_classification_id
      FROM private.client_identity_classifications
     WHERE auth_user_id = v_recipient.id AND org_id = p_org_id
     FOR UPDATE;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM private.client_access
     WHERE auth_user_id = v_recipient.id AND org_id = p_org_id AND state = 'active'
  ) INTO v_has_active_access;
  UPDATE private.client_identity_classifications
     SET email_normalized = v_email,
         state = CASE WHEN v_has_active_access THEN 'active' ELSE 'pending' END,
         expires_at = v_expires,
         revoked_at = NULL,
         updated_at = now()
   WHERE id = v_classification_id;

  UPDATE private.client_invites
     SET state = 'revoked'
   WHERE classification_id = v_classification_id AND state = 'pending';

  INSERT INTO private.client_invites
    (auth_user_id, org_id, classification_id, email_normalized, token_hash, state, expires_at, created_by)
  VALUES (v_recipient.id, p_org_id, v_classification_id, v_email, v_hash, 'pending', v_expires, p_actor_user_id)
  RETURNING id INTO v_invite_id;

  INSERT INTO private.client_invite_group_grants (invite_id, org_id, group_id)
  SELECT v_invite_id, p_org_id, requested.group_id
    FROM (SELECT DISTINCT unnest(p_group_ids) AS group_id) requested;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
  VALUES (p_org_id, p_actor_user_id, 'CREATE', 'client_invite', v_invite_id,
          'Issued restricted client invite for ' || v_email);

  RETURN jsonb_build_object(
    'inviteId', v_invite_id,
    'organizationId', p_org_id,
    'recipientUserId', v_recipient.id,
    'recipientEmail', v_email,
    'token', v_token,
    'expiresAt', v_expires
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_client_invite(
  p_actor_user_id uuid,
  p_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, private, auth, extensions'
AS $$
DECLARE
  v_user auth.users%ROWTYPE;
  v_invite private.client_invites%ROWTYPE;
  v_classification private.client_identity_classifications%ROWTYPE;
  v_access_id uuid;
  v_hash text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  v_groups jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR btrim(coalesce(p_token, '')) = '' THEN RAISE EXCEPTION 'Actor and invite token are required'; END IF;
  SELECT * INTO v_user FROM auth.users WHERE id = p_actor_user_id;
  IF NOT FOUND OR v_user.email_confirmed_at IS NULL OR v_user.deleted_at IS NOT NULL
     OR v_user.is_anonymous OR (v_user.banned_until IS NOT NULL AND v_user.banned_until > now()) THEN
    RAISE EXCEPTION 'Verified actor is unavailable';
  END IF;

  -- Locate without holding the invite lock, then lock classification first.
  -- This is the shared lock order used by issuance/revocation and prevents a
  -- revoked replacement token from reactivating access.
  SELECT i.* INTO v_invite
    FROM private.client_invites i
   WHERE i.token_hash = v_hash
   LIMIT 1;
  IF NOT FOUND OR v_invite.state <> 'pending' THEN RAISE EXCEPTION 'Invite is invalid or already claimed'; END IF;
  SELECT c.* INTO v_classification
    FROM private.client_identity_classifications c
   WHERE c.id = v_invite.classification_id
   FOR UPDATE;
  -- An active classification may receive a replacement invite. Revoked and
  -- expired classifications remain terminal, so a stale token cannot restore
  -- access after management revocation.
  IF NOT FOUND OR v_classification.state NOT IN ('pending', 'active') THEN
    RAISE EXCEPTION 'Invite is invalid or already claimed';
  END IF;
  SELECT i.* INTO v_invite
    FROM private.client_invites i
   WHERE i.id = v_invite.id
   FOR UPDATE;
  IF NOT FOUND OR v_invite.state <> 'pending' THEN RAISE EXCEPTION 'Invite is invalid or already claimed'; END IF;
  IF v_invite.expires_at <= now() THEN
    UPDATE private.client_invites SET state = 'expired' WHERE id = v_invite.id;
    UPDATE private.client_identity_classifications SET state = 'expired', updated_at = now()
     WHERE id = v_invite.classification_id;
    RAISE EXCEPTION 'Invite is expired';
  END IF;
  IF v_invite.auth_user_id <> p_actor_user_id OR lower(coalesce(v_user.email, '')) <> v_invite.email_normalized THEN
    RAISE EXCEPTION 'Invite email does not match verified actor';
  END IF;

  INSERT INTO private.client_access (auth_user_id, org_id, classification_id, state)
  VALUES (p_actor_user_id, v_invite.org_id, v_invite.classification_id, 'active')
  ON CONFLICT (auth_user_id, org_id) DO UPDATE
    SET classification_id = excluded.classification_id,
        state = 'active', revoked_at = NULL, revoked_by = NULL, updated_at = now()
  RETURNING id INTO v_access_id;

  -- A replacement invite carries the complete current group snapshot. Remove
  -- the prior snapshot before applying it so removed groups cannot survive a
  -- later re-claim.
  DELETE FROM private.client_group_grants WHERE access_id = v_access_id;
  INSERT INTO private.client_group_grants (access_id, org_id, group_id)
  SELECT v_access_id, v_invite.org_id, group_id
    FROM private.client_invite_group_grants
   WHERE invite_id = v_invite.id
  ON CONFLICT (access_id, group_id) DO NOTHING;

  UPDATE private.client_identity_classifications
     SET state = 'active', bound_at = coalesce(bound_at, now()), expires_at = v_invite.expires_at,
         revoked_at = NULL, updated_at = now()
   WHERE id = v_invite.classification_id;
  UPDATE private.client_invites
     SET state = 'claimed', claimed_at = now(), claimed_by = p_actor_user_id
   WHERE id = v_invite.id;

  SELECT coalesce(jsonb_agg(group_id ORDER BY group_id), '[]'::jsonb)
    INTO v_groups FROM private.client_group_grants WHERE access_id = v_access_id;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
  VALUES (v_invite.org_id, p_actor_user_id, 'UPDATE', 'client_access', v_access_id,
          'Claimed restricted client invite atomically');

  RETURN jsonb_build_object('accessId', v_access_id, 'organizationId', v_invite.org_id, 'groupIds', v_groups);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_client_group_grants(
  p_actor_user_id uuid,
  p_access_id uuid,
  p_group_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, private, auth, extensions'
AS $$
DECLARE
  v_access private.client_access%ROWTYPE;
  v_classification private.client_identity_classifications%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR p_access_id IS NULL THEN RAISE EXCEPTION 'Actor and access are required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
     WHERE u.id = p_actor_user_id
       AND u.email_confirmed_at IS NOT NULL
       AND u.deleted_at IS NULL
       AND u.is_anonymous = false
       AND (u.banned_until IS NULL OR u.banned_until <= now())
  ) THEN
    RAISE EXCEPTION 'Verified actor is unavailable';
  END IF;
  SELECT * INTO v_access FROM private.client_access WHERE id = p_access_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client access not found'; END IF;
  SELECT * INTO v_classification
    FROM private.client_identity_classifications
   WHERE id = v_access.classification_id
   FOR UPDATE;
  IF NOT FOUND OR v_classification.state <> 'active' THEN RAISE EXCEPTION 'Client access is not active'; END IF;
  SELECT * INTO v_access FROM private.client_access WHERE id = p_access_id FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m
     JOIN private.internal_staff s ON s.auth_user_id = m.user_id AND s.org_id = m.org_id
       AND s.staff_role = 'admin' AND s.active
    WHERE m.user_id = p_actor_user_id AND m.org_id = v_access.org_id AND m.role = 'admin'
  ) THEN RAISE EXCEPTION 'Client management requires current same-org admin authority'; END IF;
  IF p_group_ids IS NULL OR cardinality(p_group_ids) = 0 THEN RAISE EXCEPTION 'At least one provider group is required'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_group_ids) AS requested(group_id)
     LEFT JOIN public.provider_groups g ON g.id = requested.group_id AND g.org_id = v_access.org_id
    WHERE g.id IS NULL
  ) THEN RAISE EXCEPTION 'Every provider group must belong to the client organization'; END IF;

  UPDATE private.client_invites
     SET state = 'revoked'
   WHERE classification_id = v_access.classification_id AND state = 'pending';
  DELETE FROM private.client_invite_group_grants
   WHERE invite_id IN (
     SELECT id FROM private.client_invites
      WHERE classification_id = v_access.classification_id AND state = 'revoked'
   );
  DELETE FROM private.client_group_grants WHERE access_id = p_access_id;
  INSERT INTO private.client_group_grants (access_id, org_id, group_id)
  SELECT p_access_id, v_access.org_id, requested.group_id
    FROM (SELECT DISTINCT unnest(p_group_ids) AS group_id) requested;
  UPDATE private.client_access SET updated_at = now() WHERE id = p_access_id;
  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
  VALUES (v_access.org_id, p_actor_user_id, 'UPDATE', 'client_access', p_access_id, 'Replaced client group grants');
  RETURN jsonb_build_object('accessId', p_access_id, 'organizationId', v_access.org_id, 'groupIds', to_jsonb(p_group_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_client_access(
  p_actor_user_id uuid,
  p_access_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, private, auth, extensions'
AS $$
DECLARE
  v_access private.client_access%ROWTYPE;
  v_classification private.client_identity_classifications%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR p_access_id IS NULL THEN RAISE EXCEPTION 'Actor and access are required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
     WHERE u.id = p_actor_user_id
       AND u.email_confirmed_at IS NOT NULL
       AND u.deleted_at IS NULL
       AND u.is_anonymous = false
       AND (u.banned_until IS NULL OR u.banned_until <= now())
  ) THEN
    RAISE EXCEPTION 'Verified actor is unavailable';
  END IF;
  SELECT * INTO v_access FROM private.client_access WHERE id = p_access_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client access not found'; END IF;
  SELECT * INTO v_classification
    FROM private.client_identity_classifications
   WHERE id = v_access.classification_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client classification not found'; END IF;
  SELECT * INTO v_access FROM private.client_access WHERE id = p_access_id FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m
     JOIN private.internal_staff s ON s.auth_user_id = m.user_id AND s.org_id = m.org_id
       AND s.staff_role = 'admin' AND s.active
    WHERE m.user_id = p_actor_user_id AND m.org_id = v_access.org_id AND m.role = 'admin'
  ) THEN RAISE EXCEPTION 'Client management requires current same-org admin authority'; END IF;

  DELETE FROM private.client_group_grants WHERE access_id = p_access_id;
  UPDATE private.client_access
     SET state = 'revoked', revoked_at = now(), revoked_by = p_actor_user_id, updated_at = now()
   WHERE id = p_access_id;
  UPDATE private.client_identity_classifications
     SET state = 'revoked', revoked_at = now(), updated_at = now()
   WHERE id = v_access.classification_id;
  UPDATE private.client_invites
     SET state = 'revoked'
   WHERE classification_id = v_access.classification_id AND state = 'pending';
  DELETE FROM private.client_invite_group_grants
   WHERE invite_id IN (
     SELECT id FROM private.client_invites
      WHERE classification_id = v_access.classification_id AND state = 'revoked'
   );
  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
  VALUES (v_access.org_id, p_actor_user_id, 'UPDATE', 'client_access', p_access_id, 'Revoked restricted client access');
  RETURN jsonb_build_object('accessId', p_access_id, 'organizationId', v_access.org_id, 'state', 'revoked');
END;
$$;

-- Preserve the existing authenticated entry points while removing the
-- default PUBLIC/anon grant. Restricted-client checks run inside each function.
REVOKE ALL ON FUNCTION public.create_organization(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_organization(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_organization(text, text, text, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_invites() TO authenticated, service_role;

-- Service-only RPC floor. SECURITY DEFINER owned by postgres ensures secure
-- access to internal tables while execute privileges are strictly restricted to service_role.
REVOKE ALL ON FUNCTION public.resolve_enrollment_context(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_client_invite(uuid, uuid, text, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_client_invite(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_client_group_grants(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_client_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_enrollment_context(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_client_invite(uuid, uuid, text, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_client_invite(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_client_group_grants(uuid, uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_client_access(uuid, uuid) TO service_role;

COMMIT;
