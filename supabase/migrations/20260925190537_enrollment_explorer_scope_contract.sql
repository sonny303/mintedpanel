-- E6.13 / WP1.1 — curated payer products, concrete enrollment scopes,
-- immutable revisions/provenance, and publication boundaries.
-- Source cases/facts are read-only inputs; their identifiers are intentionally
-- snapshotted without foreign keys so case purge cannot block or erase lineage.

-- Composite keys let all new relationships prove same-organization ownership
-- in the database. These are additive keys only; no existing grain changes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_org_id_id_key') THEN
    ALTER TABLE public.providers ADD CONSTRAINT providers_org_id_id_key UNIQUE (org_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facilities_org_id_id_key') THEN
    ALTER TABLE public.facilities ADD CONSTRAINT facilities_org_id_id_key UNIQUE (org_id, id);
  END IF;
END
$$;

CREATE TABLE private.payer_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_id uuid NOT NULL,
  product_key text NOT NULL CHECK (product_key ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 160),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payer_products_payer_key UNIQUE (payer_id, product_key),
  CONSTRAINT payer_products_id_payer_key UNIQUE (id, payer_id),
  CONSTRAINT payer_products_payer_fkey FOREIGN KEY (payer_id)
    REFERENCES public.payers(id) ON DELETE RESTRICT
);

CREATE TABLE private.group_product_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  group_id uuid NOT NULL,
  payer_product_id uuid NOT NULL,
  payer_id uuid NOT NULL,
  state text NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_product_targets_identity_key UNIQUE (org_id, group_id, payer_product_id, state),
  CONSTRAINT group_product_targets_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT group_product_targets_group_fkey FOREIGN KEY (org_id, group_id)
    REFERENCES public.provider_groups(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT group_product_targets_product_fkey FOREIGN KEY (payer_product_id, payer_id)
    REFERENCES private.payer_products(id, payer_id) ON DELETE RESTRICT
);

CREATE TABLE private.enrollment_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL,
  group_id uuid NOT NULL,
  payer_product_id uuid NOT NULL,
  payer_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  state text NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  current_revision_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enrollment_scopes_six_part_key UNIQUE
    (org_id, provider_id, group_id, payer_product_id, facility_id, state),
  CONSTRAINT enrollment_scopes_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT enrollment_scopes_provider_fkey FOREIGN KEY (org_id, provider_id)
    REFERENCES public.providers(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT enrollment_scopes_group_fkey FOREIGN KEY (org_id, group_id)
    REFERENCES public.provider_groups(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT enrollment_scopes_product_fkey FOREIGN KEY (payer_product_id, payer_id)
    REFERENCES private.payer_products(id, payer_id) ON DELETE RESTRICT,
  CONSTRAINT enrollment_scopes_facility_fkey FOREIGN KEY (org_id, facility_id)
    REFERENCES public.facilities(org_id, id) ON DELETE RESTRICT
);

CREATE TABLE private.enrollment_scope_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  scope_id uuid NOT NULL,
  cycle_no integer NOT NULL CHECK (cycle_no > 0),
  revision_no integer NOT NULL CHECK (revision_no > 0),
  status text NOT NULL CHECK (status IN (
    'not_started', 'in_progress', 'submitted', 'in_review', 'action_required',
    'approved', 'denied', 'not_pursuing', 'terminated'
  )),
  intake_date date,
  complete_to_submit_date date,
  submitted_date date,
  payer_acknowledged_date date,
  approved_date date,
  effective_date date,
  termination_date date,
  payer_reference text CHECK (payer_reference IS NULL OR length(payer_reference) <= 160),
  client_safe_blocker text CHECK (client_safe_blocker IS NULL OR length(client_safe_blocker) <= 500),
  action_owner text NOT NULL CHECK (action_owner IN ('Minted', 'Client', 'Payer', 'Complete', 'Unassigned')),
  retro_status text NOT NULL CHECK (retro_status IN ('unknown', 'not_supported', 'documented')),
  retro_days integer CHECK (retro_days BETWEEN 0 AND 3650),
  retro_date date,
  retro_basis text CHECK (retro_basis IS NULL OR length(retro_basis) <= 300),
  staff_note text CHECK (staff_note IS NULL OR length(staff_note) <= 2000),
  observed_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enrollment_scope_revisions_scope_cycle_revision_key
    UNIQUE (scope_id, cycle_no, revision_no),
  CONSTRAINT enrollment_scope_revisions_scope_id_key UNIQUE (scope_id, id),
  CONSTRAINT enrollment_scope_revisions_org_id_scope_revision_key UNIQUE (org_id, scope_id, id),
  CONSTRAINT enrollment_scope_revisions_scope_fkey FOREIGN KEY (org_id, scope_id)
    REFERENCES private.enrollment_scopes(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT enrollment_scope_revisions_retro_shape CHECK (
    (retro_status = 'documented' AND retro_basis IS NOT NULL
      AND ((retro_days IS NOT NULL)::integer + (retro_date IS NOT NULL)::integer) = 1)
    OR (retro_status <> 'documented' AND retro_days IS NULL AND retro_date IS NULL AND retro_basis IS NULL)
  )
);

ALTER TABLE private.enrollment_scopes
  ADD CONSTRAINT enrollment_scopes_current_revision_fkey
  FOREIGN KEY (id, current_revision_id)
  REFERENCES private.enrollment_scope_revisions(scope_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE private.enrollment_scope_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  scope_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('case', 'fact')),
  source_id uuid NOT NULL,
  source_identity jsonb NOT NULL,
  source_snapshot jsonb NOT NULL,
  source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enrollment_scope_sources_revision_source_key
    UNIQUE (revision_id, source_kind, source_id),
  CONSTRAINT enrollment_scope_sources_scope_revision_fkey
    FOREIGN KEY (scope_id, revision_id)
    REFERENCES private.enrollment_scope_revisions(scope_id, id) ON DELETE RESTRICT,
  CONSTRAINT enrollment_scope_sources_org_scope_fkey
    FOREIGN KEY (org_id, scope_id)
    REFERENCES private.enrollment_scopes(org_id, id) ON DELETE RESTRICT
);

CREATE TABLE private.enrollment_summary_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  scope_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  published_status text NOT NULL CHECK (published_status IN (
    'not_started', 'in_progress', 'submitted', 'in_review', 'action_required',
    'approved', 'denied', 'not_pursuing', 'terminated'
  )),
  client_safe_blocker text CHECK (client_safe_blocker IS NULL OR length(client_safe_blocker) <= 500),
  action_owner text NOT NULL CHECK (action_owner IN ('Minted', 'Client', 'Payer', 'Complete', 'Unassigned')),
  published_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  published_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, scope_id, revision_id)
    REFERENCES private.enrollment_scope_revisions(org_id, scope_id, id) ON DELETE RESTRICT
);

CREATE TABLE private.enrollment_proof_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  scope_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  document_version_id uuid NOT NULL REFERENCES public.provider_documents(id) ON DELETE RESTRICT,
  evidence_kind text NOT NULL CHECK (evidence_kind IN (
    'payer_approval_letter', 'payer_roster_confirmation', 'payer_acknowledgement', 'license_psv'
  )),
  supported_fields text[] NOT NULL CHECK (cardinality(supported_fields) BETWEEN 1 AND 12),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  published_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  published_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, scope_id, revision_id)
    REFERENCES private.enrollment_scope_revisions(org_id, scope_id, id) ON DELETE RESTRICT
);

CREATE TABLE private.publication_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  scope_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('summary_published', 'proof_published', 'publication_revoked')),
  summary_publication_id uuid REFERENCES private.enrollment_summary_publications(id) ON DELETE RESTRICT,
  proof_publication_id uuid REFERENCES private.enrollment_proof_publications(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text CHECK (reason IS NULL OR length(reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publication_events_target_shape CHECK (
    (event_type = 'summary_published' AND summary_publication_id IS NOT NULL AND proof_publication_id IS NULL)
    OR (event_type = 'proof_published' AND proof_publication_id IS NOT NULL AND summary_publication_id IS NULL)
    OR (event_type = 'publication_revoked' AND num_nonnulls(summary_publication_id, proof_publication_id) = 1)
  ),
  FOREIGN KEY (org_id, scope_id, revision_id)
    REFERENCES private.enrollment_scope_revisions(org_id, scope_id, id) ON DELETE RESTRICT
);

CREATE INDEX enrollment_scope_sources_source_idx
  ON private.enrollment_scope_sources (source_kind, source_id);
CREATE INDEX enrollment_scope_sources_scope_revision_idx
  ON private.enrollment_scope_sources (org_id, scope_id, revision_id);
CREATE INDEX enrollment_scope_revisions_scope_created_idx
  ON private.enrollment_scope_revisions (org_id, scope_id, created_at DESC, id DESC);
CREATE INDEX enrollment_summary_publications_scope_idx
  ON private.enrollment_summary_publications (org_id, scope_id, published_at DESC, id DESC);
CREATE INDEX enrollment_proof_publications_scope_idx
  ON private.enrollment_proof_publications (org_id, scope_id, published_at DESC, id DESC);
CREATE INDEX publication_events_summary_idx
  ON private.publication_events (summary_publication_id, event_type);
CREATE INDEX publication_events_proof_idx
  ON private.publication_events (proof_publication_id, event_type);

ALTER TABLE private.payer_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.payer_products FORCE ROW LEVEL SECURITY;
ALTER TABLE private.group_product_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.group_product_targets FORCE ROW LEVEL SECURITY;
ALTER TABLE private.enrollment_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.enrollment_scopes FORCE ROW LEVEL SECURITY;
ALTER TABLE private.enrollment_scope_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.enrollment_scope_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE private.enrollment_scope_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.enrollment_scope_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE private.enrollment_summary_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.enrollment_summary_publications FORCE ROW LEVEL SECURITY;
ALTER TABLE private.enrollment_proof_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.enrollment_proof_publications FORCE ROW LEVEL SECURITY;
ALTER TABLE private.publication_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.publication_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON private.payer_products, private.group_product_targets, private.enrollment_scopes,
  private.enrollment_scope_revisions, private.enrollment_scope_sources,
  private.enrollment_summary_publications, private.enrollment_proof_publications, private.publication_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON private.payer_products, private.group_product_targets TO service_role;
GRANT SELECT, INSERT ON private.enrollment_scopes, private.enrollment_scope_revisions,
  private.enrollment_scope_sources,
  private.enrollment_summary_publications, private.enrollment_proof_publications,
  private.publication_events TO service_role;
GRANT UPDATE (current_revision_id, updated_at) ON private.enrollment_scopes TO service_role;
GRANT INSERT (org_id, user_id, user_name, action_type, entity_type, entity_id, before, after, description)
  ON public.audit_log TO service_role;
-- Enrollment facts intentionally expose no client DELETE access. Invoker RPCs
-- need narrowly scoped read access to fingerprint live source material.
GRANT SELECT ON public.enrollment_facts TO service_role;

CREATE OR REPLACE FUNCTION private.e613_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_append_only';
END;
$$;

CREATE TRIGGER enrollment_scope_revisions_append_only
  BEFORE UPDATE OR DELETE ON private.enrollment_scope_revisions
  FOR EACH ROW EXECUTE FUNCTION private.e613_append_only();
CREATE TRIGGER enrollment_scope_sources_append_only
  BEFORE UPDATE OR DELETE ON private.enrollment_scope_sources
  FOR EACH ROW EXECUTE FUNCTION private.e613_append_only();
CREATE TRIGGER enrollment_summary_publications_append_only
  BEFORE UPDATE OR DELETE ON private.enrollment_summary_publications
  FOR EACH ROW EXECUTE FUNCTION private.e613_append_only();
CREATE TRIGGER enrollment_proof_publications_append_only
  BEFORE UPDATE OR DELETE ON private.enrollment_proof_publications
  FOR EACH ROW EXECUTE FUNCTION private.e613_append_only();
CREATE TRIGGER publication_events_append_only
  BEFORE UPDATE OR DELETE ON private.publication_events
  FOR EACH ROW EXECUTE FUNCTION private.e613_append_only();

CREATE OR REPLACE FUNCTION private.e613_scope_update_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'pg_catalog, private'
AS $$
DECLARE
  v_old_revision private.enrollment_scope_revisions%ROWTYPE;
  v_new_revision private.enrollment_scope_revisions%ROWTYPE;
BEGIN
  IF ROW(NEW.id, NEW.org_id, NEW.provider_id, NEW.group_id, NEW.payer_product_id, NEW.facility_id, NEW.state, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM
     ROW(OLD.id, OLD.org_id, OLD.provider_id, OLD.group_id, OLD.payer_product_id, OLD.facility_id, OLD.state, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_scope_identity_immutable';
  END IF;
  IF NEW.current_revision_id IS DISTINCT FROM OLD.current_revision_id THEN
    SELECT * INTO v_old_revision FROM private.enrollment_scope_revisions
      WHERE scope_id = OLD.id AND id = OLD.current_revision_id;
    SELECT * INTO v_new_revision FROM private.enrollment_scope_revisions
      WHERE scope_id = NEW.id AND id = NEW.current_revision_id;
    IF v_new_revision.id IS NULL OR v_old_revision.id IS NULL
       OR (v_new_revision.cycle_no, v_new_revision.revision_no) <= (v_old_revision.cycle_no, v_old_revision.revision_no) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_current_revision_must_advance';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enrollment_scopes_update_guard
  BEFORE UPDATE ON private.enrollment_scopes
  FOR EACH ROW EXECUTE FUNCTION private.e613_scope_update_guard();

CREATE OR REPLACE FUNCTION private.e613_scope_revision_commit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'pg_catalog, public, private'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.enrollment_scopes s
    WHERE s.id = NEW.scope_id AND s.org_id = NEW.org_id AND s.current_revision_id = NEW.id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.audit_log a
    WHERE a.org_id = NEW.org_id AND a.entity_type = 'enrollment_scope'
      AND a.entity_id = NEW.scope_id AND a.user_id = NEW.created_by
      AND a.action_type IN ('CREATE', 'UPDATE') AND a.after ->> 'revisionId' = NEW.id::text
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_revision_audit_required';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER enrollment_scope_revision_commit_guard
  AFTER INSERT ON private.enrollment_scope_revisions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.e613_scope_revision_commit_guard();

CREATE OR REPLACE FUNCTION private.e613_require_context(
  p_actor_user_id uuid,
  p_org_id uuid,
  p_audience text,
  p_require_admin boolean DEFAULT false,
  p_group_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog, public, private, auth'
AS $$
DECLARE
  v_context jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR p_org_id IS NULL OR p_audience IS NULL
     OR p_audience NOT IN ('staff', 'client') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized';
  END IF;
  -- Reuse E6.12's verified-email, classification, active-context, and
  -- capability-resolution checks. Never infer audience from a capability union.
  BEGIN
    v_context := public.resolve_enrollment_context(p_actor_user_id, p_audience, p_org_id);
  EXCEPTION WHEN raise_exception THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized';
  END;
  IF v_context ->> 'audience' IS DISTINCT FROM p_audience
     OR v_context ->> 'selectedOrgId' IS DISTINCT FROM p_org_id::text THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized';
  END IF;
  IF p_audience = 'staff' THEN
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_context -> 'staffOrgs') staff_org
      WHERE staff_org ->> 'orgId' = p_org_id::text
        AND (staff_org ->> 'reportStaff')::boolean
        AND (NOT p_require_admin OR ((staff_org ->> 'role' = 'admin') AND (staff_org ->> 'clientManage')::boolean))
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized';
    END IF;
  ELSE
    IF p_require_admin OR p_group_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_context -> 'clientOrgs') client_org
      CROSS JOIN LATERAL jsonb_array_elements(client_org -> 'groups') client_group
      WHERE client_org ->> 'orgId' = p_org_id::text
        AND client_group ->> 'groupId' = p_group_id::text
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM auth.users actor
      JOIN private.client_identity_classifications classification
        ON classification.auth_user_id = actor.id
       AND classification.org_id = p_org_id
       AND classification.state = 'active'
       AND classification.email_normalized = lower(btrim(actor.email))
      JOIN private.client_access access
        ON access.auth_user_id = actor.id AND access.org_id = classification.org_id
       AND access.classification_id = classification.id AND access.state = 'active'
      WHERE actor.id = p_actor_user_id AND actor.email_confirmed_at IS NOT NULL
        AND actor.deleted_at IS NULL AND NOT actor.is_anonymous
        AND (actor.banned_until IS NULL OR actor.banned_until <= now())
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.e613_source_snapshot(p_source_kind text, p_source_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog, public'
AS $$
DECLARE
  v_snapshot jsonb;
BEGIN
  IF p_source_kind = 'case' THEN
    SELECT jsonb_build_object(
      'id', c.id, 'org_id', c.org_id, 'provider_id', c.provider_id, 'group_id', c.group_id,
      'payer_id', c.payer_id, 'state', c.state, 'case_status', c.case_status,
      'submitted_date', c.submitted_date, 'approved_date', c.approved_date,
      'confirmed_effective_date', c.confirmed_effective_date,
      'expected_effective_date', c.expected_effective_date, 'termination_date', c.termination_date,
      'payer_reference_id', c.payer_reference_id,
      'payer_individual_provider_id', c.payer_individual_provider_id,
      'payer_group_provider_id', c.payer_group_provider_id,
      'contract_executed_date', c.contract_executed_date,
      'case_facility_ids', COALESCE((
        SELECT jsonb_agg(cf.facility_id::text ORDER BY cf.facility_id::text)
        FROM public.case_facilities cf WHERE cf.case_id = c.id
      ), '[]'::jsonb)
    ) INTO v_snapshot FROM public.credential_cases c WHERE c.id = p_source_id;
  ELSIF p_source_kind = 'fact' THEN
    SELECT jsonb_build_object(
      'id', f.id, 'org_id', f.org_id, 'provider_id', f.provider_id, 'group_id', f.group_id,
      'payer_id', f.payer_id, 'state', f.state, 'effective_date', f.effective_date,
      'payer_issued_id', f.payer_issued_id, 'expired_at', f.expired_at
    ) INTO v_snapshot FROM public.enrollment_facts f WHERE f.id = p_source_id;
  END IF;
  RETURN v_snapshot;
END;
$$;

CREATE OR REPLACE FUNCTION private.e613_source_fingerprint(p_snapshot jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path TO 'pg_catalog'
AS $$ SELECT encode(sha256(convert_to(p_snapshot::text, 'UTF8')), 'hex') $$;

-- Validate many current or historical revisions with one canonical snapshot
-- per distinct source reference. The JSON contract is an array of
-- {scope_id,revision_id}; missing source rows stay in the LEFT JOIN and make
-- their revision stale instead of disappearing from the batch.
CREATE OR REPLACE FUNCTION private.e613_revision_source_batch(p_revisions jsonb)
RETURNS TABLE(scope_id uuid, revision_id uuid, source_valid boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog, private'
AS $$
  WITH requested AS MATERIALIZED (
    SELECT DISTINCT request.scope_id, request.revision_id
    FROM jsonb_to_recordset(COALESCE(p_revisions, '[]'::jsonb))
      AS request(scope_id uuid, revision_id uuid)
    WHERE request.scope_id IS NOT NULL AND request.revision_id IS NOT NULL
  ), links AS MATERIALIZED (
    SELECT request.scope_id, request.revision_id, source.source_kind,
      source.source_id, source.source_fingerprint
    FROM requested request
    LEFT JOIN private.enrollment_scope_sources source
      ON source.scope_id = request.scope_id AND source.revision_id = request.revision_id
  ), source_refs AS MATERIALIZED (
    SELECT DISTINCT link.source_kind, link.source_id
    FROM links link WHERE link.source_kind IS NOT NULL
  ), source_snapshots AS MATERIALIZED (
    SELECT reference.source_kind, reference.source_id,
      private.e613_source_snapshot(reference.source_kind, reference.source_id) AS source_snapshot
    FROM source_refs reference
  ), fingerprints AS MATERIALIZED (
    SELECT snapshot.source_kind, snapshot.source_id, snapshot.source_snapshot,
      CASE WHEN snapshot.source_snapshot IS NULL THEN NULL
        ELSE private.e613_source_fingerprint(snapshot.source_snapshot) END AS source_fingerprint
    FROM source_snapshots snapshot
  ), validity AS (
    SELECT link.scope_id, link.revision_id,
      bool_and(
        fingerprint.source_snapshot IS NOT NULL
        AND link.source_fingerprint = fingerprint.source_fingerprint
        AND NOT (link.source_kind = 'fact'
          AND fingerprint.source_snapshot ->> 'expired_at' IS NOT NULL)
      ) FILTER (WHERE link.source_kind IS NOT NULL) AS source_valid
    FROM links link
    LEFT JOIN fingerprints fingerprint
      ON fingerprint.source_kind = link.source_kind AND fingerprint.source_id = link.source_id
    GROUP BY link.scope_id, link.revision_id
  )
  SELECT request.scope_id, request.revision_id, COALESCE(validity.source_valid, true)
  FROM requested request
  LEFT JOIN validity USING (scope_id, revision_id)
$$;

CREATE OR REPLACE FUNCTION private.e613_revision_sources_valid(p_scope_id uuid, p_revision_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog, private'
AS $$
  SELECT COALESCE((
    SELECT batch.source_valid
    FROM private.e613_revision_source_batch(jsonb_build_array(jsonb_build_object(
      'scope_id', p_scope_id, 'revision_id', p_revision_id))) batch
  ), true)
$$;

CREATE OR REPLACE FUNCTION public.curate_enrollment_payer_product(
  p_actor_user_id uuid, p_org_id uuid, p_audience text, p_payer_id uuid,
  p_product_key text, p_display_name text, p_is_active boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog, public, private'
AS $$
DECLARE v_product private.payer_products%ROWTYPE;
BEGIN
  PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, true, NULL);
  IF p_payer_id IS NULL OR p_product_key IS NULL OR p_display_name IS NULL
     OR lower(btrim(p_product_key)) !~ '^[a-z0-9][a-z0-9._-]{0,79}$'
     OR length(btrim(p_display_name)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
  END IF;
  INSERT INTO private.payer_products (payer_id, product_key, display_name, is_active, created_by)
  SELECT p.id, lower(btrim(p_product_key)), btrim(p_display_name), COALESCE(p_is_active, true), p_actor_user_id
  FROM public.payers p WHERE p.id = p_payer_id AND (p.org_id IS NULL OR p.org_id = p_org_id)
  ON CONFLICT (payer_id, product_key) DO UPDATE
    SET display_name = EXCLUDED.display_name, is_active = EXCLUDED.is_active, updated_at = now()
  RETURNING * INTO v_product;
  IF v_product.id IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
  RETURN jsonb_build_object('productId', v_product.id, 'payerId', v_product.payer_id,
    'productKey', v_product.product_key, 'displayName', v_product.display_name, 'isActive', v_product.is_active);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_enrollment_group_product_target(
  p_actor_user_id uuid, p_org_id uuid, p_audience text, p_group_id uuid,
  p_payer_product_id uuid, p_state text, p_is_active boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog, public, private'
AS $$
DECLARE
  v_target private.group_product_targets%ROWTYPE;
  v_payer_id uuid;
BEGIN
  PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, true, NULL);
  IF p_group_id IS NULL OR p_payer_product_id IS NULL OR p_state IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
  END IF;
  SELECT product.payer_id INTO v_payer_id FROM private.payer_products product
  JOIN public.payers payer ON payer.id = product.payer_id
    AND (payer.org_id IS NULL OR payer.org_id = p_org_id)
  WHERE product.id = p_payer_product_id
    AND (product.is_active OR COALESCE(p_is_active, true) IS FALSE);
  IF v_payer_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
  INSERT INTO private.group_product_targets
    (org_id, group_id, payer_product_id, payer_id, state, is_active, created_by, updated_by)
  VALUES (p_org_id, p_group_id, p_payer_product_id, v_payer_id, upper(btrim(p_state)),
    COALESCE(p_is_active, true), p_actor_user_id, p_actor_user_id)
  ON CONFLICT (org_id, group_id, payer_product_id, state) DO UPDATE
    SET is_active = EXCLUDED.is_active, updated_by = EXCLUDED.updated_by, updated_at = now()
  RETURNING * INTO v_target;
  RETURN jsonb_build_object('targetId', v_target.id, 'orgId', v_target.org_id,
    'groupId', v_target.group_id, 'payerProductId', v_target.payer_product_id,
    'state', v_target.state, 'isActive', v_target.is_active);
EXCEPTION WHEN foreign_key_violation OR check_violation THEN
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
END;
$$;

CREATE OR REPLACE FUNCTION public.save_enrollment_revision(
  p_actor_user_id uuid, p_org_id uuid, p_audience text, p_scope_id uuid,
  p_expected_revision_id uuid, p_provider_id uuid, p_group_id uuid,
  p_payer_product_id uuid, p_facility_id uuid, p_state text,
  p_revision jsonb, p_sources jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog, public, private'
AS $$
DECLARE
  v_scope private.enrollment_scopes%ROWTYPE;
  v_previous private.enrollment_scope_revisions%ROWTYPE;
  v_revision private.enrollment_scope_revisions%ROWTYPE;
  v_product private.payer_products%ROWTYPE;
  v_scope_id uuid := p_scope_id;
  v_revision_id uuid := gen_random_uuid();
  v_cycle integer := 1;
  v_revision_no integer := 1;
  v_source jsonb;
  v_snapshot jsonb;
  v_fingerprint text;
  v_status text;
BEGIN
  PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, false, NULL);
  IF p_audience <> 'staff' OR p_revision IS NULL OR jsonb_typeof(p_revision) <> 'object'
     OR p_sources IS NULL OR jsonb_typeof(p_sources) <> 'array'
     OR jsonb_array_length(p_sources) > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
  END IF;
  IF p_provider_id IS NULL OR p_group_id IS NULL OR p_payer_product_id IS NULL
     OR p_facility_id IS NULL OR p_state IS NULL OR p_state !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
  END IF;
  PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, false, p_group_id);

  SELECT product.* INTO v_product FROM private.payer_products product
  JOIN public.payers payer ON payer.id = product.payer_id
    AND (payer.org_id IS NULL OR payer.org_id = p_org_id)
  WHERE product.id = p_payer_product_id AND product.is_active;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.providers p WHERE p.id = p_provider_id AND p.org_id = p_org_id)
     OR NOT EXISTS (SELECT 1 FROM public.provider_groups g WHERE g.id = p_group_id AND g.org_id = p_org_id)
     OR NOT EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = p_facility_id AND f.org_id = p_org_id)
     OR NOT EXISTS (SELECT 1 FROM public.provider_group_assignments a
                    WHERE a.org_id = p_org_id AND a.provider_id = p_provider_id AND a.group_id = p_group_id)
     OR NOT EXISTS (SELECT 1 FROM public.provider_facility_assignments a
                    WHERE a.org_id = p_org_id AND a.provider_id = p_provider_id AND a.facility_id = p_facility_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM private.group_product_targets target
    WHERE target.org_id = p_org_id AND target.group_id = p_group_id
      AND target.payer_product_id = p_payer_product_id AND target.state = p_state
      AND target.is_active
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
  END IF;

  v_status := p_revision ->> 'status';
  IF v_status IS NULL OR v_status NOT IN ('not_started', 'in_progress', 'submitted', 'in_review', 'action_required',
                      'approved', 'denied', 'not_pursuing', 'terminated')
     OR COALESCE(p_revision ->> 'owner', '') NOT IN ('Minted', 'Client', 'Payer', 'Complete', 'Unassigned')
     OR COALESCE(p_revision ->> 'retroStatus', '') NOT IN ('unknown', 'not_supported', 'documented') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
  END IF;

  IF v_scope_id IS NULL THEN
    IF p_expected_revision_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'enrollment_revision_conflict';
    END IF;
    v_scope_id := gen_random_uuid();
    INSERT INTO private.enrollment_scopes
      (id, org_id, provider_id, group_id, payer_product_id, payer_id, facility_id, state, current_revision_id, created_by)
    VALUES (v_scope_id, p_org_id, p_provider_id, p_group_id, p_payer_product_id, v_product.payer_id,
      p_facility_id, upper(p_state), v_revision_id, p_actor_user_id);
  ELSE
    SELECT * INTO v_scope FROM private.enrollment_scopes
      WHERE id = v_scope_id AND org_id = p_org_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
    IF ROW(v_scope.provider_id, v_scope.group_id, v_scope.payer_product_id, v_scope.payer_id, v_scope.facility_id, v_scope.state)
         IS DISTINCT FROM ROW(p_provider_id, p_group_id, p_payer_product_id, v_product.payer_id, p_facility_id, upper(p_state))
       OR p_expected_revision_id IS NULL
       OR v_scope.current_revision_id IS DISTINCT FROM p_expected_revision_id THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'enrollment_revision_conflict';
    END IF;
    SELECT * INTO v_previous FROM private.enrollment_scope_revisions
      WHERE scope_id = v_scope_id AND id = v_scope.current_revision_id;
    v_cycle := v_previous.cycle_no;
    IF v_previous.status IN ('denied', 'not_pursuing', 'terminated') AND v_status IN ('not_started', 'in_progress') THEN
      v_cycle := v_cycle + 1;
      v_revision_no := 1;
    ELSE
      v_revision_no := v_previous.revision_no + 1;
    END IF;
  END IF;

  INSERT INTO private.enrollment_scope_revisions (
    id, org_id, scope_id, cycle_no, revision_no, status, intake_date, complete_to_submit_date,
    submitted_date, payer_acknowledged_date, approved_date, effective_date, termination_date,
    payer_reference, client_safe_blocker, action_owner, retro_status, retro_days, retro_date,
    retro_basis, staff_note, observed_at, created_by
  ) VALUES (
    v_revision_id, p_org_id, v_scope_id, v_cycle, v_revision_no, v_status,
    NULLIF(p_revision ->> 'intakeDate', '')::date,
    NULLIF(p_revision ->> 'completeToSubmitDate', '')::date,
    NULLIF(p_revision ->> 'submittedDate', '')::date,
    NULLIF(p_revision ->> 'payerAcknowledgedDate', '')::date,
    NULLIF(p_revision ->> 'approvedDate', '')::date,
    NULLIF(p_revision ->> 'effectiveDate', '')::date,
    NULLIF(p_revision ->> 'terminationDate', '')::date,
    NULLIF(btrim(p_revision ->> 'payerReference'), ''),
    NULLIF(btrim(p_revision ->> 'clientSafeBlocker'), ''), p_revision ->> 'owner',
    p_revision ->> 'retroStatus', NULLIF(p_revision ->> 'retroDays', '')::integer,
    NULLIF(p_revision ->> 'retroDate', '')::date,
    NULLIF(btrim(p_revision ->> 'retroBasis'), ''),
    NULLIF(btrim(p_revision ->> 'staffNote'), ''),
    COALESCE(NULLIF(p_revision ->> 'observedAt', '')::timestamptz, now()), p_actor_user_id
  ) RETURNING * INTO v_revision;

  FOR v_source IN SELECT value FROM jsonb_array_elements(p_sources)
  LOOP
    IF jsonb_typeof(v_source) <> 'object'
       OR v_source ->> 'sourceKind' IS NULL OR v_source ->> 'sourceKind' NOT IN ('case', 'fact')
       OR v_source ->> 'sourceId' IS NULL
       OR (v_source ->> 'sourceId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR v_source ->> 'sourceFingerprint' IS NULL
       OR (v_source ->> 'sourceFingerprint') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
    END IF;
    v_snapshot := private.e613_source_snapshot(v_source ->> 'sourceKind', (v_source ->> 'sourceId')::uuid);
    v_fingerprint := private.e613_source_fingerprint(v_snapshot);
    IF v_snapshot IS NULL OR v_fingerprint IS DISTINCT FROM v_source ->> 'sourceFingerprint' THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'enrollment_source_stale';
    END IF;
    IF v_source ->> 'sourceKind' = 'fact' AND v_snapshot ->> 'expired_at' IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'enrollment_source_stale';
    END IF;
    IF v_snapshot ->> 'org_id' IS DISTINCT FROM p_org_id::text
       OR v_snapshot ->> 'provider_id' IS DISTINCT FROM p_provider_id::text
       OR v_snapshot ->> 'group_id' IS DISTINCT FROM p_group_id::text
       OR v_snapshot ->> 'payer_id' IS DISTINCT FROM v_product.payer_id::text
       OR v_snapshot ->> 'state' IS DISTINCT FROM upper(p_state)
       OR (v_source ->> 'sourceKind' = 'case' AND NOT (v_snapshot -> 'case_facility_ids' ? p_facility_id::text)) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
    END IF;
    INSERT INTO private.enrollment_scope_sources (
      org_id, scope_id, revision_id, source_kind, source_id, source_identity,
      source_snapshot, source_fingerprint, created_by
    ) VALUES (
      p_org_id, v_scope_id, v_revision_id, v_source ->> 'sourceKind',
      (v_source ->> 'sourceId')::uuid,
      jsonb_build_object('org_id', p_org_id, 'provider_id', p_provider_id, 'group_id', p_group_id,
        'payer_product_id', p_payer_product_id, 'facility_id', p_facility_id, 'state', upper(p_state)),
      v_snapshot, v_fingerprint, p_actor_user_id
    );
  END LOOP;

  IF p_scope_id IS NOT NULL THEN
    UPDATE private.enrollment_scopes SET current_revision_id = v_revision_id, updated_at = now()
      WHERE id = v_scope_id AND org_id = p_org_id;
  END IF;
  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, after, description)
    VALUES (p_org_id, p_actor_user_id, CASE WHEN p_scope_id IS NULL THEN 'CREATE' ELSE 'UPDATE' END,
      'enrollment_scope', v_scope_id,
      jsonb_build_object('revisionId', v_revision_id, 'cycleNo', v_cycle, 'revisionNo', v_revision_no,
        'sourceCount', jsonb_array_length(p_sources)),
      'Saved enrollment scope revision');
  RETURN jsonb_build_object('scopeId', v_scope_id, 'revisionId', v_revision_id,
    'cycleNo', v_cycle, 'revisionNo', v_revision_no, 'created', p_scope_id IS NULL);
EXCEPTION WHEN foreign_key_violation OR check_violation OR invalid_text_representation
  OR invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_enrollment_summary(
  p_actor_user_id uuid, p_org_id uuid, p_audience text, p_scope_id uuid, p_revision_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog, public, private'
AS $$
DECLARE v_scope private.enrollment_scopes%ROWTYPE; v_revision private.enrollment_scope_revisions%ROWTYPE; v_publication uuid;
BEGIN
  PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, true, NULL);
  IF p_audience <> 'staff' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized'; END IF;
  SELECT * INTO v_scope FROM private.enrollment_scopes
    WHERE id = p_scope_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
  IF v_scope.current_revision_id IS DISTINCT FROM p_revision_id THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'enrollment_revision_conflict';
  END IF;
  IF NOT private.e613_revision_sources_valid(p_scope_id, p_revision_id) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'enrollment_source_stale';
  END IF;
  SELECT * INTO v_revision FROM private.enrollment_scope_revisions WHERE scope_id = p_scope_id AND id = p_revision_id;
  INSERT INTO private.enrollment_summary_publications
    (org_id, scope_id, revision_id, published_status, client_safe_blocker, action_owner, published_by)
  VALUES (p_org_id, p_scope_id, p_revision_id, v_revision.status, v_revision.client_safe_blocker,
    v_revision.action_owner, p_actor_user_id) RETURNING id INTO v_publication;
  INSERT INTO private.publication_events
    (org_id, scope_id, revision_id, event_type, summary_publication_id, actor_user_id)
  VALUES (p_org_id, p_scope_id, p_revision_id, 'summary_published', v_publication, p_actor_user_id);
  RETURN jsonb_build_object('publicationId', v_publication);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_enrollment_scope_detail(
  p_actor_user_id uuid, p_org_id uuid, p_audience text, p_scope_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog, public, private'
AS $$
DECLARE
  v_scope private.enrollment_scopes%ROWTYPE;
  v_revision private.enrollment_scope_revisions%ROWTYPE;
  v_summary private.enrollment_summary_publications%ROWTYPE;
  v_supported_fields text[] := ARRAY[]::text[];
  v_stale boolean := false;
  v_proof_required_missing boolean := false;
  v_result jsonb;
BEGIN
  SELECT * INTO v_scope FROM private.enrollment_scopes WHERE id = p_scope_id AND org_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
  PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, false, v_scope.group_id);
  IF p_audience = 'client' AND EXISTS (
    SELECT 1 FROM public.providers p
    WHERE p.id = v_scope.provider_id AND p.org_id = p_org_id AND COALESCE(p.is_test_provider, false)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found';
  END IF;
  SELECT * INTO v_revision FROM private.enrollment_scope_revisions
    WHERE scope_id = p_scope_id AND id = v_scope.current_revision_id;
  IF NOT private.e613_revision_sources_valid(p_scope_id, v_revision.id) THEN v_stale := true; END IF;

  SELECT * INTO v_summary FROM private.enrollment_summary_publications s
   WHERE s.scope_id = p_scope_id AND s.org_id = p_org_id
     AND NOT EXISTS (SELECT 1 FROM private.publication_events e
       WHERE e.summary_publication_id = s.id AND e.event_type = 'publication_revoked')
   ORDER BY s.published_at DESC, s.id DESC LIMIT 1;

  IF p_audience = 'client' AND v_summary.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found';
  END IF;
  IF v_summary.id IS NOT NULL AND (v_summary.revision_id IS DISTINCT FROM v_revision.id OR v_stale) THEN
    v_stale := true;
  END IF;
  SELECT COALESCE(array_agg(DISTINCT supported.field), ARRAY[]::text[])
    INTO v_supported_fields
  FROM private.enrollment_proof_publications proof
  CROSS JOIN LATERAL unnest(proof.supported_fields) supported(field)
  JOIN public.provider_documents document_version ON document_version.id = proof.document_version_id
  WHERE proof.scope_id = p_scope_id AND proof.revision_id = v_revision.id
    AND NOT EXISTS (SELECT 1 FROM private.publication_events e
      WHERE e.proof_publication_id = proof.id AND e.event_type = 'publication_revoked')
    AND (document_version.expiration_date IS NULL OR document_version.expiration_date >= CURRENT_DATE)
    AND (proof.evidence_kind <> 'license_psv' OR document_version.expiration_date >= CURRENT_DATE)
    AND NOT EXISTS (SELECT 1 FROM public.provider_documents successor
      WHERE successor.supersedes_document_id = document_version.id);

  v_proof_required_missing :=
    (v_revision.status = 'approved' AND NOT (
      'enrollment_status' = ANY(v_supported_fields)
      AND 'product_id' = ANY(v_supported_fields)
      AND 'facility_id' = ANY(v_supported_fields)))
    OR (v_revision.effective_date IS NOT NULL AND NOT ('effective_date' = ANY(v_supported_fields)))
    OR (v_revision.retro_status <> 'unknown' AND NOT ('retro_status' = ANY(v_supported_fields)))
    OR (v_revision.retro_status = 'documented' AND v_revision.retro_days IS NOT NULL
      AND NOT ('retro_days' = ANY(v_supported_fields)))
    OR (v_revision.retro_status = 'documented' AND v_revision.retro_date IS NOT NULL
      AND NOT ('retro_date' = ANY(v_supported_fields)));

  IF p_audience = 'client' THEN
    IF v_stale OR v_proof_required_missing THEN
      RETURN jsonb_build_object(
        'scopeId', v_scope.id, 'orgId', v_scope.org_id, 'providerId', v_scope.provider_id,
        'groupId', v_scope.group_id, 'payerProductId', v_scope.payer_product_id,
        'facilityId', v_scope.facility_id, 'state', v_scope.state,
        'status', 'needs_verification', 'historicalStatus', v_summary.published_status,
        'clientSafeBlocker', v_summary.client_safe_blocker, 'owner', v_summary.action_owner,
        'reviewedAt', v_summary.published_at, 'proofs', '[]'::jsonb
      );
    END IF;
    RETURN jsonb_build_object(
      'scopeId', v_scope.id, 'orgId', v_scope.org_id, 'providerId', v_scope.provider_id,
      'groupId', v_scope.group_id, 'payerProductId', v_scope.payer_product_id,
      'facilityId', v_scope.facility_id, 'state', v_scope.state,
      'status', v_summary.published_status, 'clientSafeBlocker', v_summary.client_safe_blocker,
      'owner', v_summary.action_owner, 'reviewedAt', v_summary.published_at,
      'cycleNo', v_revision.cycle_no, 'revisionNo', v_revision.revision_no,
      'intakeDate', v_revision.intake_date, 'completeToSubmitDate', v_revision.complete_to_submit_date,
      'submittedDate', v_revision.submitted_date,
      'payerAcknowledgedDate', v_revision.payer_acknowledged_date,
      'approvedDate', CASE WHEN 'approved_date' = ANY(v_supported_fields)
        THEN v_revision.approved_date ELSE NULL END,
      'effectiveDate', CASE WHEN 'effective_date' = ANY(v_supported_fields)
        THEN v_revision.effective_date ELSE NULL END,
      'terminationDate', CASE WHEN 'termination_date' = ANY(v_supported_fields)
        THEN v_revision.termination_date ELSE NULL END,
      'payerReference', v_revision.payer_reference,
      'retroStatus', CASE WHEN 'retro_status' = ANY(v_supported_fields)
        THEN v_revision.retro_status ELSE 'unknown' END,
      'retroDays', CASE WHEN 'retro_days' = ANY(v_supported_fields)
        THEN v_revision.retro_days ELSE NULL END,
      'retroDate', CASE WHEN 'retro_date' = ANY(v_supported_fields)
        THEN v_revision.retro_date ELSE NULL END,
      'retroBasis', CASE WHEN 'retro_status' = ANY(v_supported_fields)
        THEN v_revision.retro_basis ELSE NULL END,
      'proofs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'publicationId', proof.id,
        'evidenceKind', proof.evidence_kind, 'supportedFields', proof.supported_fields,
        'publishedAt', proof.published_at
      ) ORDER BY proof.published_at DESC) FROM private.enrollment_proof_publications proof
        WHERE proof.scope_id = p_scope_id AND proof.revision_id = v_revision.id
          AND NOT EXISTS (SELECT 1 FROM private.publication_events e
            WHERE e.proof_publication_id = proof.id AND e.event_type = 'publication_revoked')
          AND EXISTS (SELECT 1 FROM public.provider_documents current_document
            WHERE current_document.id = proof.document_version_id
              AND (current_document.expiration_date IS NULL OR current_document.expiration_date >= CURRENT_DATE)
              AND (proof.evidence_kind <> 'license_psv' OR current_document.expiration_date >= CURRENT_DATE))
          AND NOT EXISTS (SELECT 1 FROM public.provider_documents successor
            WHERE successor.supersedes_document_id = proof.document_version_id)), '[]'::jsonb)
    );
  END IF;

  v_result := jsonb_build_object(
    'scope', jsonb_build_object('id', v_scope.id, 'orgId', v_scope.org_id, 'providerId', v_scope.provider_id,
      'groupId', v_scope.group_id, 'payerProductId', v_scope.payer_product_id,
      'facilityId', v_scope.facility_id, 'state', v_scope.state, 'currentRevisionId', v_revision.id),
    'revision', to_jsonb(v_revision) - ARRAY['org_id','scope_id','created_by'],
    'stale', v_stale,
    'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'sourceKind', s.source_kind, 'sourceId', s.source_id, 'sourceFingerprint', s.source_fingerprint,
      'sourceSnapshot', s.source_snapshot
    ) ORDER BY s.source_kind, s.source_id) FROM private.enrollment_scope_sources s
      WHERE s.scope_id = p_scope_id AND s.revision_id = v_revision.id), '[]'::jsonb),
    'summary', CASE WHEN v_summary.id IS NULL THEN NULL ELSE jsonb_build_object(
      'publicationId', v_summary.id, 'revisionId', v_summary.revision_id,
      'status', v_summary.published_status, 'clientSafeBlocker', v_summary.client_safe_blocker,
      'owner', v_summary.action_owner, 'publishedAt', v_summary.published_at) END,
    'proofs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'publicationId', proof.id, 'documentVersionId', proof.document_version_id,
      'evidenceKind', proof.evidence_kind, 'supportedFields', proof.supported_fields,
      'sha256', proof.sha256, 'publishedAt', proof.published_at
    ) ORDER BY proof.published_at DESC) FROM private.enrollment_proof_publications proof
      WHERE proof.scope_id = p_scope_id AND NOT EXISTS (SELECT 1 FROM private.publication_events e
        WHERE e.proof_publication_id = proof.id AND e.event_type = 'publication_revoked')), '[]'::jsonb)
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_enrollment_unresolved_page(
  p_actor_user_id uuid, p_org_id uuid, p_audience text, p_group_id uuid,
  p_cursor jsonb, p_limit integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog, public, private'
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_cursor_at timestamptz;
  v_cursor_kind text;
  v_cursor_id uuid;
  v_items jsonb;
  v_more boolean;
  v_next jsonb;
BEGIN
  PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, false, NULL);
  IF p_audience <> 'staff' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized'; END IF;
  IF p_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.provider_groups WHERE id = p_group_id AND org_id = p_org_id
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
  IF p_cursor IS NOT NULL THEN
    IF jsonb_typeof(p_cursor) <> 'object'
       OR COALESCE(p_cursor ->> 'sourceKind', '') NOT IN ('case', 'fact')
       OR COALESCE(p_cursor ->> 'sourceId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR NULLIF(p_cursor ->> 'observedAt', '') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
    END IF;
    v_cursor_at := (p_cursor ->> 'observedAt')::timestamptz;
    v_cursor_kind := p_cursor ->> 'sourceKind';
    v_cursor_id := (p_cursor ->> 'sourceId')::uuid;
  END IF;

  WITH source_rows AS MATERIALIZED (
    SELECT 'case'::text AS source_kind, c.id AS source_id, c.org_id, c.provider_id, c.group_id,
      c.payer_id, c.state, COALESCE(c.updated_at, c.created_at, now()) AS observed_at,
      jsonb_build_object(
        'id', c.id, 'org_id', c.org_id, 'provider_id', c.provider_id, 'group_id', c.group_id,
        'payer_id', c.payer_id, 'state', c.state, 'case_status', c.case_status,
        'submitted_date', c.submitted_date, 'approved_date', c.approved_date,
        'confirmed_effective_date', c.confirmed_effective_date,
        'expected_effective_date', c.expected_effective_date, 'termination_date', c.termination_date,
        'payer_reference_id', c.payer_reference_id,
        'payer_individual_provider_id', c.payer_individual_provider_id,
        'payer_group_provider_id', c.payer_group_provider_id,
        'contract_executed_date', c.contract_executed_date,
        'case_facility_ids', COALESCE((SELECT jsonb_agg(cf.facility_id::text ORDER BY cf.facility_id::text)
          FROM public.case_facilities cf WHERE cf.case_id = c.id), '[]'::jsonb)
      ) AS source_snapshot
    FROM public.credential_cases c
    WHERE c.org_id = p_org_id AND (p_group_id IS NULL OR c.group_id = p_group_id)
      AND (v_cursor_at IS NULL OR (COALESCE(c.updated_at, c.created_at, now()), 'case'::text, c.id)
        > (v_cursor_at, v_cursor_kind, v_cursor_id))
    UNION ALL
    SELECT 'fact'::text, f.id, f.org_id, f.provider_id, f.group_id, f.payer_id, f.state,
      COALESCE(f.expired_at, f.created_at, now()),
      jsonb_build_object('id', f.id, 'org_id', f.org_id, 'provider_id', f.provider_id,
        'group_id', f.group_id, 'payer_id', f.payer_id, 'state', f.state,
        'effective_date', f.effective_date, 'payer_issued_id', f.payer_issued_id, 'expired_at', f.expired_at)
    FROM public.enrollment_facts f
    WHERE f.org_id = p_org_id AND (p_group_id IS NULL OR f.group_id = p_group_id)
      AND (v_cursor_at IS NULL OR (COALESCE(f.expired_at, f.created_at, now()), 'fact'::text, f.id)
        > (v_cursor_at, v_cursor_kind, v_cursor_id))
  ), fingerprints AS MATERIALIZED (
    SELECT src.*, private.e613_source_fingerprint(src.source_snapshot) AS source_fingerprint,
      CASE WHEN src.source_kind = 'case' THEN COALESCE((
        SELECT array_agg(value::uuid ORDER BY value)
        FROM jsonb_array_elements_text(src.source_snapshot -> 'case_facility_ids') value
    ), '{}'::uuid[]) ELSE '{}'::uuid[] END AS source_facility_ids
    FROM source_rows src
  ), source_facilities AS MATERIALIZED (
    SELECT src.source_kind, src.source_id, value::uuid AS facility_id
    FROM fingerprints src
    CROSS JOIN LATERAL jsonb_array_elements_text(src.source_snapshot -> 'case_facility_ids') value
    WHERE src.source_kind = 'case'
    UNION
    SELECT src.source_kind, src.source_id, assignment.facility_id
    FROM fingerprints src
    JOIN public.provider_facility_assignments assignment
      ON assignment.org_id = src.org_id AND assignment.provider_id = src.provider_id
    JOIN public.provider_group_assignments group_assignment
      ON group_assignment.org_id = src.org_id AND group_assignment.provider_id = src.provider_id
       AND group_assignment.group_id = src.group_id
    JOIN public.facilities facility ON facility.id = assignment.facility_id AND facility.org_id = src.org_id
    WHERE src.source_kind = 'fact'
  ), expected_coordinates AS MATERIALIZED (
    SELECT src.source_kind, src.source_id, target.payer_product_id, sf.facility_id, target.state,
      target.payer_product_id::text || ':' || sf.facility_id::text || ':' || target.state AS coordinate_key
    FROM fingerprints src
    JOIN private.group_product_targets target
      ON target.org_id = src.org_id AND target.group_id = src.group_id
       AND target.payer_id = src.payer_id AND target.state = src.state AND target.is_active
    JOIN source_facilities sf ON sf.source_kind = src.source_kind AND sf.source_id = src.source_id
  ), candidate_revisions AS MATERIALIZED (
    SELECT DISTINCT scope.id AS scope_id, scope.current_revision_id AS revision_id
    FROM fingerprints candidate
    JOIN private.enrollment_scope_sources link
      ON link.source_kind = candidate.source_kind AND link.source_id = candidate.source_id
    JOIN private.enrollment_scopes scope
      ON scope.id = link.scope_id AND scope.current_revision_id = link.revision_id
       AND scope.org_id = candidate.org_id
  ), revision_source_validity AS MATERIALIZED (
    SELECT batch.scope_id, batch.revision_id, batch.source_valid
    FROM private.e613_revision_source_batch(COALESCE((
      SELECT jsonb_agg(jsonb_build_object('scope_id', candidate.scope_id,
        'revision_id', candidate.revision_id)) FROM candidate_revisions candidate
    ), '[]'::jsonb)) batch
  ), mapping AS (
    SELECT src.source_kind, src.source_id,
      COALESCE(array_agg(DISTINCT s.scope_id) FILTER (
        WHERE s.scope_id IS NOT NULL AND s.source_fingerprint = src.source_fingerprint
          AND sc.current_revision_id = s.revision_id
      ), '{}'::uuid[]) AS mapped_scope_ids,
      COALESCE(array_agg(DISTINCT sc.facility_id) FILTER (
        WHERE s.scope_id IS NOT NULL AND s.source_fingerprint = src.source_fingerprint
          AND sc.current_revision_id = s.revision_id
      ), '{}'::uuid[]) AS mapped_facility_ids,
      COALESCE(array_agg(DISTINCT
        (s.source_identity ->> 'payer_product_id') || ':' || (s.source_identity ->> 'facility_id')
          || ':' || (s.source_identity ->> 'state')
      ) FILTER (WHERE s.scope_id IS NOT NULL AND s.source_fingerprint = src.source_fingerprint
          AND sc.current_revision_id = s.revision_id), '{}'::text[]) AS mapped_coordinate_keys,
      COALESCE(bool_or(s.scope_id IS NOT NULL AND sc.current_revision_id = s.revision_id
        AND (s.source_fingerprint IS DISTINCT FROM src.source_fingerprint OR validity.source_valid IS FALSE)), false) AS stale_mapping,
      COALESCE(bool_or(s.scope_id IS NOT NULL AND sc.current_revision_id = s.revision_id
        AND NOT EXISTS (SELECT 1 FROM private.enrollment_summary_publications pub
          WHERE pub.scope_id = sc.id AND pub.revision_id = sc.current_revision_id
            AND NOT EXISTS (SELECT 1 FROM private.publication_events ev
              WHERE ev.summary_publication_id = pub.id AND ev.event_type = 'publication_revoked'))), false) AS unpublished_mapping
    FROM fingerprints src
    LEFT JOIN private.enrollment_scope_sources s
      ON s.source_kind = src.source_kind AND s.source_id = src.source_id
    LEFT JOIN private.enrollment_scopes sc
      ON sc.id = s.scope_id AND sc.org_id = src.org_id
    LEFT JOIN revision_source_validity validity
      ON validity.scope_id = sc.id AND validity.revision_id = sc.current_revision_id
    GROUP BY src.source_kind, src.source_id
  ), triaged AS (
    SELECT src.*, m.mapped_scope_ids, m.mapped_facility_ids, m.mapped_coordinate_keys,
      m.stale_mapping, m.unpublished_mapping,
      COALESCE(coord.unmapped_coordinates, '[]'::jsonb) AS unmapped_coordinates,
      COALESCE(coord.unmapped_facility_ids, '{}'::uuid[]) AS unmapped_facility_ids,
      COALESCE(coord.expected_count, 0) = 0 AS mapping_needs_configuration,
      CASE
        WHEN m.stale_mapping
          OR (src.source_kind = 'fact' AND src.source_snapshot ->> 'expired_at' IS NOT NULL)
          THEN 'needs_verification'
        WHEN cardinality(m.mapped_scope_ids) = 0 THEN 'unmapped'
        WHEN COALESCE(coord.expected_count, 0) = 0 THEN 'partially_mapped'
        WHEN COALESCE(cardinality(coord.unmapped_facility_ids), 0) > 0
          OR jsonb_array_length(COALESCE(coord.unmapped_coordinates, '[]'::jsonb)) > 0 THEN 'partially_mapped'
        WHEN m.unpublished_mapping THEN 'needs_verification'
        ELSE 'mapped'
      END AS triage_state
    FROM fingerprints src JOIN mapping m USING (source_kind, source_id)
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS expected_count,
        COALESCE(jsonb_agg(jsonb_build_object('payerProductId', expected.payer_product_id,
          'facilityId', expected.facility_id, 'state', expected.state)
          ORDER BY expected.payer_product_id, expected.facility_id, expected.state)
          FILTER (WHERE NOT (expected.coordinate_key = ANY(m.mapped_coordinate_keys))), '[]'::jsonb) AS unmapped_coordinates,
        COALESCE(array_agg(DISTINCT expected.facility_id ORDER BY expected.facility_id)
          FILTER (WHERE NOT (expected.coordinate_key = ANY(m.mapped_coordinate_keys))), '{}'::uuid[]) AS unmapped_facility_ids
      FROM expected_coordinates expected
      WHERE expected.source_kind = src.source_kind AND expected.source_id = src.source_id
    ) coord ON true
  ), page AS (
    SELECT * FROM triaged
    WHERE triage_state <> 'mapped'
    ORDER BY observed_at, source_kind, source_id
    LIMIT v_limit + 1
  ), numbered AS (
    SELECT page.*, row_number() OVER (ORDER BY observed_at, source_kind, source_id) AS row_no
    FROM page
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'sourceKind', source_kind, 'sourceId', source_id, 'sourceFingerprint', source_fingerprint,
      'sourceSnapshot', source_snapshot, 'mappedScopeIds', to_jsonb(mapped_scope_ids),
      'unmappedFacilityIds', to_jsonb(unmapped_facility_ids),
      'unmappedCoordinates', unmapped_coordinates,
      'mappingNeedsConfiguration', mapping_needs_configuration,
      'triageState', triage_state,
      'observedAt', observed_at
    ) ORDER BY observed_at, source_kind, source_id) FILTER (WHERE row_no <= v_limit), '[]'::jsonb),
    count(*) > v_limit,
    (SELECT jsonb_build_object('observedAt', n.observed_at, 'sourceKind', n.source_kind, 'sourceId', n.source_id)
       FROM numbered n WHERE n.row_no = v_limit)
  INTO v_items, v_more, v_next FROM numbered;
  RETURN jsonb_build_object('items', v_items, 'nextCursor', CASE WHEN v_more THEN v_next ELSE NULL END);
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_enrollment_catalog(
  p_actor_user_id uuid, p_org_id uuid, p_audience text, p_group_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog, public, private'
AS $$
DECLARE
  v_products jsonb;
  v_targets jsonb;
BEGIN
  PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, false, NULL);
  IF p_audience <> 'staff' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'enrollment_not_authorized';
  END IF;
  IF p_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.provider_groups WHERE id = p_group_id AND org_id = p_org_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'productId', product.id, 'payerId', payer.id, 'payerName', payer.name,
    'productKey', product.product_key, 'displayName', product.display_name,
    'isActive', product.is_active
  ) ORDER BY payer.name, product.display_name, product.product_key), '[]'::jsonb)
    INTO v_products
  FROM private.payer_products product
  JOIN public.payers payer ON payer.id = product.payer_id
    AND (payer.org_id IS NULL OR payer.org_id = p_org_id)
  WHERE payer.is_active IS DISTINCT FROM false;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'targetId', target.id, 'groupId', target.group_id, 'payerProductId', target.payer_product_id,
    'payerId', target.payer_id, 'state', target.state, 'isActive', target.is_active
  ) ORDER BY target.group_id, target.state, target.payer_product_id), '[]'::jsonb)
    INTO v_targets
  FROM private.group_product_targets target
  WHERE target.org_id = p_org_id AND (p_group_id IS NULL OR target.group_id = p_group_id);

  RETURN jsonb_build_object('products', v_products, 'targets', v_targets);
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_enrollment_proof(
  p_actor_user_id uuid, p_org_id uuid, p_audience text, p_scope_id uuid, p_revision_id uuid,
  p_document_version_id uuid, p_evidence_kind text, p_supported_fields text[], p_sha256 text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog, public, private'
AS $$
DECLARE
  v_scope private.enrollment_scopes%ROWTYPE;
  v_doc public.provider_documents%ROWTYPE;
  v_publication_id uuid;
  v_allowed text[];
BEGIN
  PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, true, NULL);
  IF p_audience <> 'staff' OR p_scope_id IS NULL OR p_revision_id IS NULL OR p_document_version_id IS NULL
     OR p_evidence_kind IS NULL OR p_evidence_kind NOT IN ('payer_approval_letter', 'payer_roster_confirmation', 'payer_acknowledgement', 'license_psv')
     OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 8 AND 500
     OR COALESCE(cardinality(p_supported_fields), 0) = 0 OR cardinality(p_supported_fields) > 12 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
  END IF;
  SELECT * INTO v_scope FROM private.enrollment_scopes
    WHERE id = p_scope_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
  IF v_scope.current_revision_id IS DISTINCT FROM p_revision_id THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'enrollment_revision_conflict';
  END IF;
  IF NOT private.e613_revision_sources_valid(p_scope_id, p_revision_id) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'enrollment_source_stale';
  END IF;
  IF cardinality(p_supported_fields) <> cardinality(ARRAY(SELECT DISTINCT f FROM unnest(p_supported_fields) f)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
  END IF;
  IF p_evidence_kind = 'payer_acknowledgement' THEN
    v_allowed := ARRAY['submitted_date', 'payer_acknowledged_date', 'payer_reference'];
  ELSIF p_evidence_kind = 'license_psv' THEN
    v_allowed := ARRAY['license_current'];
  ELSE
    v_allowed := ARRAY['enrollment_status', 'payer_reference', 'approved_date', 'effective_date',
      'termination_date', 'facility_id', 'product_id', 'retro_status', 'retro_days', 'retro_date'];
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_supported_fields) f
    WHERE f IS NULL OR btrim(f) = '' OR NOT (f = ANY(v_allowed))) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
  END IF;
  SELECT * INTO v_doc FROM public.provider_documents d
    WHERE d.id = p_document_version_id AND d.org_id = p_org_id
      AND (d.expiration_date IS NULL OR d.expiration_date >= CURRENT_DATE)
      AND (p_evidence_kind <> 'license_psv' OR d.expiration_date >= CURRENT_DATE)
      AND ((d.provider_id = v_scope.provider_id AND d.group_id IS NULL)
        OR (d.group_id = v_scope.group_id AND d.provider_id IS NULL))
      AND NOT EXISTS (SELECT 1 FROM public.provider_documents successor
        WHERE successor.supersedes_document_id = d.id)
      AND (d.case_id IS NULL OR EXISTS (
        SELECT 1 FROM public.credential_cases c
        WHERE c.id = d.case_id AND c.org_id = p_org_id
          AND c.provider_id = v_scope.provider_id AND c.group_id = v_scope.group_id
          AND c.payer_id = v_scope.payer_id AND c.state = v_scope.state
          AND EXISTS (SELECT 1 FROM public.case_facilities cf
            WHERE cf.case_id = c.id AND cf.facility_id = v_scope.facility_id)
      ))
    FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
  INSERT INTO private.enrollment_proof_publications
    (org_id, scope_id, revision_id, document_version_id, evidence_kind, supported_fields, sha256, published_by)
  VALUES (p_org_id, p_scope_id, p_revision_id, p_document_version_id, p_evidence_kind,
    p_supported_fields, p_sha256, p_actor_user_id) RETURNING id INTO v_publication_id;
  INSERT INTO private.publication_events
    (org_id, scope_id, revision_id, event_type, proof_publication_id, actor_user_id, reason)
  VALUES (p_org_id, p_scope_id, p_revision_id, 'proof_published', v_publication_id, p_actor_user_id, btrim(p_reason));
  RETURN jsonb_build_object('publicationId', v_publication_id, 'sha256', p_sha256);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_enrollment_proof_capture_target(
  p_actor_user_id uuid, p_org_id uuid, p_audience text, p_scope_id uuid,
  p_revision_id uuid, p_document_version_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog, public, private'
AS $$
DECLARE
  v_scope private.enrollment_scopes%ROWTYPE;
  v_doc public.provider_documents%ROWTYPE;
BEGIN
  PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, true, NULL);
  IF p_audience <> 'staff' OR p_scope_id IS NULL OR p_revision_id IS NULL
     OR p_document_version_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
  END IF;
  SELECT * INTO v_scope FROM private.enrollment_scopes
    WHERE id = p_scope_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
  IF v_scope.current_revision_id IS DISTINCT FROM p_revision_id THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'enrollment_revision_conflict';
  END IF;
  IF NOT private.e613_revision_sources_valid(p_scope_id, p_revision_id) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'enrollment_source_stale';
  END IF;
  SELECT * INTO v_doc FROM public.provider_documents d
    WHERE d.id = p_document_version_id AND d.org_id = p_org_id
      AND (d.expiration_date IS NULL OR d.expiration_date >= CURRENT_DATE)
      AND ((d.provider_id = v_scope.provider_id AND d.group_id IS NULL)
        OR (d.group_id = v_scope.group_id AND d.provider_id IS NULL))
      AND NOT EXISTS (SELECT 1 FROM public.provider_documents successor
        WHERE successor.supersedes_document_id = d.id)
      AND (d.case_id IS NULL OR EXISTS (
        SELECT 1 FROM public.credential_cases c
        WHERE c.id = d.case_id AND c.org_id = p_org_id
          AND c.provider_id = v_scope.provider_id AND c.group_id = v_scope.group_id
          AND c.payer_id = v_scope.payer_id AND c.state = v_scope.state
          AND EXISTS (SELECT 1 FROM public.case_facilities cf
            WHERE cf.case_id = c.id AND cf.facility_id = v_scope.facility_id)
      ))
    FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
  RETURN jsonb_build_object('documentVersionId', v_doc.id, 'storagePath', v_doc.file_path,
    'fileName', v_doc.file_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_enrollment_publication(
  p_actor_user_id uuid, p_org_id uuid, p_audience text, p_publication_id uuid, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog, public, private'
AS $$
DECLARE v_scope_id uuid; v_revision_id uuid; v_event_id uuid; v_summary_id uuid; v_proof_id uuid;
BEGIN
  PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, true, NULL);
  IF p_audience <> 'staff' OR p_publication_id IS NULL OR p_reason IS NULL
     OR length(btrim(p_reason)) NOT BETWEEN 8 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
  END IF;
  SELECT s.scope_id, s.revision_id INTO v_scope_id, v_revision_id
    FROM private.enrollment_summary_publications s
   WHERE s.id = p_publication_id AND s.org_id = p_org_id;
  IF FOUND THEN
    v_summary_id := p_publication_id;
  ELSE
    SELECT p.scope_id, p.revision_id INTO v_scope_id, v_revision_id
      FROM private.enrollment_proof_publications p
     WHERE p.id = p_publication_id AND p.org_id = p_org_id;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
    v_proof_id := p_publication_id;
  END IF;
  PERFORM 1 FROM private.enrollment_scopes
   WHERE id = v_scope_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
  IF EXISTS (SELECT 1 FROM private.publication_events e
    WHERE (e.summary_publication_id = p_publication_id OR e.proof_publication_id = p_publication_id)
      AND e.event_type = 'publication_revoked') THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'enrollment_publication_revoked';
  END IF;
  INSERT INTO private.publication_events
    (org_id, scope_id, revision_id, event_type, summary_publication_id, proof_publication_id,
      actor_user_id, reason)
  VALUES (p_org_id, v_scope_id, v_revision_id, 'publication_revoked', v_summary_id, v_proof_id,
    p_actor_user_id, btrim(p_reason)) RETURNING id INTO v_event_id;
  RETURN jsonb_build_object('eventId', v_event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_enrollment_proof_download(
  p_actor_user_id uuid, p_org_id uuid, p_audience text, p_publication_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog, public, private'
AS $$
DECLARE
  v_scope private.enrollment_scopes%ROWTYPE;
  v_proof private.enrollment_proof_publications%ROWTYPE;
  v_doc public.provider_documents%ROWTYPE;
BEGIN
  SELECT * INTO v_proof FROM private.enrollment_proof_publications
    WHERE id = p_publication_id AND org_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
  SELECT * INTO v_scope FROM private.enrollment_scopes
    WHERE id = v_proof.scope_id AND org_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
  PERFORM private.e613_require_context(p_actor_user_id, p_org_id, p_audience, false, v_scope.group_id);
  IF p_audience = 'client' AND EXISTS (SELECT 1 FROM public.providers p WHERE p.id = v_scope.provider_id AND p.org_id = p_org_id
    AND COALESCE(p.is_test_provider, false)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found';
  END IF;
  IF v_scope.current_revision_id IS DISTINCT FROM v_proof.revision_id
     OR NOT private.e613_revision_sources_valid(v_scope.id, v_proof.revision_id)
     OR EXISTS (SELECT 1 FROM private.publication_events e
       WHERE e.proof_publication_id = v_proof.id AND e.event_type = 'publication_revoked') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found';
  END IF;
  IF p_audience = 'client' AND NOT EXISTS (
    SELECT 1 FROM private.enrollment_summary_publications s
     WHERE s.scope_id = v_scope.id AND s.revision_id = v_proof.revision_id
       AND NOT EXISTS (SELECT 1 FROM private.publication_events e
         WHERE e.summary_publication_id = s.id AND e.event_type = 'publication_revoked')
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
  SELECT * INTO v_doc FROM public.provider_documents d
    WHERE d.id = v_proof.document_version_id AND d.org_id = p_org_id
      AND (d.expiration_date IS NULL OR d.expiration_date >= CURRENT_DATE)
      AND (v_proof.evidence_kind <> 'license_psv' OR d.expiration_date >= CURRENT_DATE)
      AND ((d.provider_id = v_scope.provider_id AND d.group_id IS NULL)
        OR (d.group_id = v_scope.group_id AND d.provider_id IS NULL))
      AND NOT EXISTS (SELECT 1 FROM public.provider_documents successor
        WHERE successor.supersedes_document_id = d.id)
      AND (d.case_id IS NULL OR EXISTS (
        SELECT 1 FROM public.credential_cases c
        WHERE c.id = d.case_id AND c.org_id = p_org_id
          AND c.provider_id = v_scope.provider_id AND c.group_id = v_scope.group_id
          AND c.payer_id = v_scope.payer_id AND c.state = v_scope.state
          AND EXISTS (SELECT 1 FROM public.case_facilities cf
            WHERE cf.case_id = c.id AND cf.facility_id = v_scope.facility_id)
      ));
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'enrollment_not_found'; END IF;
  RETURN jsonb_build_object('publicationId', v_proof.id, 'documentVersionId', v_doc.id,
    'storagePath', v_doc.file_path, 'sha256', v_proof.sha256, 'fileName', v_doc.file_name,
    'scopeId', v_scope.id, 'groupId', v_scope.group_id, 'providerId', v_scope.provider_id,
    'supportedFields', v_proof.supported_fields, 'evidenceKind', v_proof.evidence_kind);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_enrollment_proof_download(
  p_actor_user_id uuid, p_org_id uuid, p_audience text, p_publication_id uuid,
  p_document_version_id uuid, p_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog, public, private'
AS $$
DECLARE
  v_authorized jsonb;
BEGIN
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enrollment_invalid';
  END IF;
  v_authorized := public.authorize_enrollment_proof_download(
    p_actor_user_id, p_org_id, p_audience, p_publication_id);
  IF v_authorized ->> 'documentVersionId' IS DISTINCT FROM p_document_version_id::text
     OR v_authorized ->> 'sha256' IS DISTINCT FROM p_sha256 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'enrollment_source_stale';
  END IF;
  INSERT INTO public.audit_log
    (org_id, user_id, action_type, entity_type, entity_id, after, description)
  VALUES (p_org_id, p_actor_user_id, 'READ', 'enrollment_proof_publication', p_publication_id,
    jsonb_build_object('documentVersionId', p_document_version_id),
    'Authorized enrollment proof download');
  RETURN jsonb_build_object('recorded', true);
END;
$$;

REVOKE ALL ON FUNCTION private.e613_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.e613_scope_update_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.e613_scope_revision_commit_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.e613_require_context(uuid, uuid, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.e613_source_snapshot(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.e613_source_fingerprint(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.e613_revision_source_batch(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.e613_revision_sources_valid(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.e613_append_only(), private.e613_scope_update_guard(),
  private.e613_scope_revision_commit_guard(),
  private.e613_require_context(uuid, uuid, text, boolean, uuid),
  private.e613_source_snapshot(text, uuid), private.e613_source_fingerprint(jsonb),
  private.e613_revision_source_batch(jsonb),
  private.e613_revision_sources_valid(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.curate_enrollment_payer_product(uuid, uuid, text, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_enrollment_group_product_target(uuid, uuid, text, uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_enrollment_revision(uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_enrollment_summary(uuid, uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_enrollment_scope_detail(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_enrollment_unresolved_page(uuid, uuid, text, uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_enrollment_catalog(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_enrollment_proof(uuid, uuid, text, uuid, uuid, uuid, text, text[], text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_enrollment_proof_capture_target(uuid, uuid, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_enrollment_publication(uuid, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authorize_enrollment_proof_download(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_enrollment_proof_download(uuid, uuid, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.curate_enrollment_payer_product(uuid, uuid, text, uuid, text, text, boolean),
  public.set_enrollment_group_product_target(uuid, uuid, text, uuid, uuid, text, boolean),
  public.save_enrollment_revision(uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb),
  public.publish_enrollment_summary(uuid, uuid, text, uuid, uuid),
  public.get_enrollment_scope_detail(uuid, uuid, text, uuid),
  public.get_enrollment_unresolved_page(uuid, uuid, text, uuid, jsonb, integer),
  public.get_enrollment_catalog(uuid, uuid, text, uuid),
  public.publish_enrollment_proof(uuid, uuid, text, uuid, uuid, uuid, text, text[], text, text),
  public.get_enrollment_proof_capture_target(uuid, uuid, text, uuid, uuid, uuid),
  public.revoke_enrollment_publication(uuid, uuid, text, uuid, text),
  public.authorize_enrollment_proof_download(uuid, uuid, text, uuid),
  public.record_enrollment_proof_download(uuid, uuid, text, uuid, uuid, text) TO service_role;
