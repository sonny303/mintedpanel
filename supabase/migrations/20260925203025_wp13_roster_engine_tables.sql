-- WP 1.3 Provider Roster Engine. Additive tables only; payer seed schemas are
-- explicitly drafts until reconciled against current authoritative workbooks.

CREATE TABLE public.roster_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  slug text NOT NULL,
  payer_name text NOT NULL,
  name text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  is_verified boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'draft_pending_payer_spec'
    CHECK (verification_status IN ('verified', 'draft_pending_payer_spec')),
  grains text[] NOT NULL CHECK (cardinality(grains) > 0),
  columns jsonb NOT NULL CHECK (jsonb_typeof(columns) = 'array' AND jsonb_array_length(columns) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roster_templates_verification_consistency CHECK (
    (is_verified AND verification_status = 'verified') OR
    (NOT is_verified AND verification_status = 'draft_pending_payer_spec')
  ),
  UNIQUE (org_id, id)
);
CREATE UNIQUE INDEX uq_roster_templates_slug_org ON public.roster_templates(org_id, slug);

CREATE TABLE public.roster_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  template_id uuid NOT NULL,
  created_by uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  grain text NOT NULL CHECK (grain IN ('provider', 'provider_location', 'provider_location_tin')),
  selected_provider_ids uuid[] NOT NULL DEFAULT '{}',
  selected_facility_ids uuid[] NOT NULL DEFAULT '{}',
  selected_group_ids uuid[] NOT NULL DEFAULT '{}',
  column_assignments jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(column_assignments) = 'array'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, template_id) REFERENCES public.roster_templates(org_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_roster_mappings_org_updated ON public.roster_mappings(org_id, updated_at DESC);

CREATE TABLE public.roster_export_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  mapping_id uuid NOT NULL,
  template_id uuid NOT NULL,
  mapping_name text NOT NULL,
  template_name text NOT NULL,
  template_is_verified boolean NOT NULL DEFAULT false,
  template_verification_status text NOT NULL DEFAULT 'draft_pending_payer_spec'
    CHECK (template_verification_status IN ('verified', 'draft_pending_payer_spec')),
  exported_by uuid NOT NULL,
  exported_at timestamptz NOT NULL DEFAULT now(),
  format text NOT NULL CHECK (format IN ('csv', 'xlsx')),
  file_name text NOT NULL,
  total_rows integer NOT NULL CHECK (total_rows > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  file_bytes bytea NOT NULL CHECK (octet_length(file_bytes) BETWEEN 1 AND 3145728),
  frozen_snapshot jsonb NOT NULL CHECK (jsonb_typeof(frozen_snapshot) = 'object'),
  applied_overrides jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(applied_overrides) = 'array'),
  expected_input_fingerprint text NOT NULL CHECK (expected_input_fingerprint ~ '^[0-9a-f]{64}$'),
  idempotency_key uuid NOT NULL,
  UNIQUE (org_id, idempotency_key),
  FOREIGN KEY (org_id, mapping_id) REFERENCES public.roster_mappings(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, template_id) REFERENCES public.roster_templates(org_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_roster_export_snapshots_org_exported ON public.roster_export_snapshots(org_id, exported_at DESC);

CREATE TABLE public.roster_export_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  mapping_id uuid NOT NULL,
  mapping_revision integer NOT NULL CHECK (mapping_revision > 0),
  input_fingerprint text NOT NULL CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
  row_key text NOT NULL CHECK (length(row_key) BETWEEN 1 AND 512),
  rule_code text NOT NULL CHECK (length(rule_code) BETWEEN 1 AND 80),
  field_key text NOT NULL CHECK (length(field_key) BETWEEN 1 AND 120),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 20),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, mapping_id) REFERENCES public.roster_mappings(org_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_roster_overrides_binding ON public.roster_export_overrides
  (org_id, mapping_id, mapping_revision, input_fingerprint, row_key, rule_code, field_key);

ALTER TABLE public.roster_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_export_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_export_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY roster_templates_read ON public.roster_templates FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));
CREATE POLICY roster_mappings_read ON public.roster_mappings FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));
CREATE POLICY roster_mappings_insert ON public.roster_mappings FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) IN ('admin', 'specialist'));
CREATE POLICY roster_mappings_update ON public.roster_mappings FOR UPDATE TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) IN ('admin', 'specialist'))
  WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) IN ('admin', 'specialist'));
CREATE POLICY roster_snapshots_read ON public.roster_export_snapshots FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));
CREATE POLICY roster_overrides_read ON public.roster_export_overrides FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));

REVOKE ALL ON public.roster_templates, public.roster_mappings,
  public.roster_export_snapshots, public.roster_export_overrides FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.roster_templates TO authenticated;
GRANT SELECT ON public.roster_mappings TO authenticated;
GRANT SELECT ON public.roster_export_snapshots, public.roster_export_overrides TO authenticated;
GRANT SELECT ON public.roster_templates, public.roster_mappings,
  public.roster_export_snapshots, public.roster_export_overrides TO service_role;

-- Ledger tables cannot be changed, deleted, or truncated even by ordinary
-- service-role statements. The narrowly scoped SECURITY DEFINER RPCs below
-- are the only write door.
CREATE OR REPLACE FUNCTION public.roster_engine_reject_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'roster ledger rows are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER roster_snapshots_append_only BEFORE UPDATE OR DELETE ON public.roster_export_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.roster_engine_reject_ledger_mutation();
CREATE TRIGGER roster_snapshots_no_truncate BEFORE TRUNCATE ON public.roster_export_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION public.roster_engine_reject_ledger_mutation();
CREATE TRIGGER roster_overrides_append_only BEFORE UPDATE OR DELETE ON public.roster_export_overrides
  FOR EACH ROW EXECUTE FUNCTION public.roster_engine_reject_ledger_mutation();
CREATE TRIGGER roster_overrides_no_truncate BEFORE TRUNCATE ON public.roster_export_overrides
  FOR EACH STATEMENT EXECUTE FUNCTION public.roster_engine_reject_ledger_mutation();
CREATE TRIGGER roster_templates_immutable BEFORE UPDATE OR DELETE ON public.roster_templates
  FOR EACH ROW EXECUTE FUNCTION public.roster_engine_reject_ledger_mutation();
CREATE TRIGGER roster_templates_no_truncate BEFORE TRUNCATE ON public.roster_templates
  FOR EACH STATEMENT EXECUTE FUNCTION public.roster_engine_reject_ledger_mutation();

-- One SQL statement creates the complete source image used for a preview.
-- Postgres uses one MVCC statement snapshot; JSONB text provides deterministic
-- canonical bytes for the input fingerprint, including today's license date.
CREATE OR REPLACE FUNCTION public.roster_engine_build_source(p_org_id uuid, p_mapping_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_mapping public.roster_mappings%ROWTYPE;
  v_template public.roster_templates%ROWTYPE;
  v_rows jsonb;
  v_include_dob boolean;
  v_include_ssn boolean;
BEGIN
  SELECT * INTO v_mapping FROM public.roster_mappings m
   WHERE m.id = p_mapping_id AND m.org_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'roster_mapping_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_template FROM public.roster_templates t
   WHERE t.id = v_mapping.template_id AND t.org_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'roster_template_not_found' USING ERRCODE = 'P0002'; END IF;

  v_include_dob := EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_mapping.column_assignments) a
    WHERE a->>'sourceField' = 'provider.date_of_birth'
  );
  v_include_ssn := EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_mapping.column_assignments) a
    WHERE a->>'sourceField' = 'provider.ssn_last4'
  );

  IF v_mapping.grain = 'provider' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'rowKey', p.id::text || ':' || COALESCE(f.id::text, 'unassigned'),
      'provider', jsonb_build_object(
        'id', p.id, 'first_name', p.first_name, 'last_name', p.last_name,
        'npi', p.npi, 'taxonomy_code', p.taxonomy_code, 'status', p.status,
        'date_of_birth', CASE WHEN v_include_dob THEN p.date_of_birth ELSE NULL END,
        'ssn_last4', CASE WHEN v_include_ssn AND p.ssn_last4 ~ '^[0-9]{4}$' THEN p.ssn_last4 ELSE NULL END,
        'ssn_last4_valid', CASE WHEN v_include_ssn THEN COALESCE(p.ssn_last4 ~ '^[0-9]{4}$', true) ELSE NULL END
      ),
      'facility', CASE WHEN f.id IS NOT NULL THEN jsonb_build_object(
        'id', f.id, 'group_id', f.group_id, 'name', f.name, 'street', f.street,
        'suite', f.suite, 'city', f.city, 'state', f.state, 'zip', f.zip,
        'phone', f.phone, 'is_active', f.is_active
      ) ELSE NULL END,
      'group', CASE WHEN pg.id IS NOT NULL THEN
        jsonb_build_object('id', pg.id, 'name', pg.name, 'npi_type2', pg.npi_type2,
          'tin', pg.tin, 'is_active', pg.is_active)
        ELSE NULL END,
      'licenses', COALESCE(lic.items, '[]'::jsonb)
    ) ORDER BY p.id, f.id NULLS LAST), '[]'::jsonb) INTO v_rows
    FROM public.providers p
    LEFT JOIN public.provider_facility_assignments pfa
      ON pfa.org_id = p_org_id AND pfa.provider_id = p.id
      AND cardinality(v_mapping.selected_facility_ids) = 1
      AND pfa.facility_id = v_mapping.selected_facility_ids[1]
      AND (pfa.start_date IS NULL OR pfa.start_date <= CURRENT_DATE)
    LEFT JOIN public.facilities f ON f.id = pfa.facility_id AND f.org_id = p_org_id
    LEFT JOIN public.provider_group_assignments pga
      ON pga.org_id = p_org_id AND pga.provider_id = p.id
      AND (pga.group_id = f.group_id OR (f.id IS NULL AND cardinality(v_mapping.selected_group_ids) = 1 AND pga.group_id = v_mapping.selected_group_ids[1]))
      AND (pga.start_date IS NULL OR pga.start_date <= CURRENT_DATE)
      AND (pga.end_date IS NULL OR pga.end_date >= CURRENT_DATE)
      AND (cardinality(v_mapping.selected_group_ids) = 0 OR pga.group_id = ANY(v_mapping.selected_group_ids))
    LEFT JOIN public.provider_groups pg ON pg.id = pga.group_id AND pg.org_id = p_org_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'license_number', sl.license_number, 'state', sl.state,
        'issue_date', sl.issue_date, 'expiration_date', sl.expiration_date,
        'status', sl.status
      ) ORDER BY (sl.status = 'active' AND sl.expiration_date >= CURRENT_DATE
                    AND (sl.issue_date IS NULL OR sl.issue_date <= CURRENT_DATE)) DESC,
                 sl.expiration_date DESC NULLS LAST, sl.id) AS items
      FROM public.state_licenses sl
      WHERE sl.org_id = p_org_id AND sl.provider_id = p.id
        AND (f.id IS NULL OR upper(sl.state) = upper(f.state))
    ) lic ON true
    WHERE p.org_id = p_org_id AND p.id = ANY(v_mapping.selected_provider_ids);
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'rowKey', p.id::text || ':' || COALESCE(f.id::text, 'unassigned') || ':' || COALESCE(pg.id::text, 'none'),
      'provider', jsonb_build_object(
        'id', p.id, 'first_name', p.first_name, 'last_name', p.last_name,
        'npi', p.npi, 'taxonomy_code', p.taxonomy_code, 'status', p.status,
        'date_of_birth', CASE WHEN v_include_dob THEN p.date_of_birth ELSE NULL END,
        'ssn_last4', CASE WHEN v_include_ssn AND p.ssn_last4 ~ '^[0-9]{4}$' THEN p.ssn_last4 ELSE NULL END,
        'ssn_last4_valid', CASE WHEN v_include_ssn THEN COALESCE(p.ssn_last4 ~ '^[0-9]{4}$', true) ELSE NULL END
      ),
      'facility', CASE WHEN f.id IS NOT NULL THEN jsonb_build_object(
        'id', f.id, 'group_id', f.group_id, 'name', f.name, 'street', f.street,
        'suite', f.suite, 'city', f.city, 'state', f.state, 'zip', f.zip,
        'phone', f.phone, 'is_active', f.is_active
      ) ELSE NULL END,
      'group', CASE WHEN pg.id IS NOT NULL THEN
        jsonb_build_object('id', pg.id, 'name', pg.name, 'npi_type2', pg.npi_type2,
          'tin', pg.tin, 'is_active', pg.is_active)
        ELSE NULL END,
      'licenses', COALESCE(lic.items, '[]'::jsonb)
    ) ORDER BY p.id, f.id NULLS LAST, pg.id NULLS LAST), '[]'::jsonb) INTO v_rows
    FROM public.providers p
    LEFT JOIN public.provider_facility_assignments pfa
      ON pfa.org_id = p_org_id AND pfa.provider_id = p.id
      AND pfa.facility_id = ANY(v_mapping.selected_facility_ids)
      AND (pfa.start_date IS NULL OR pfa.start_date <= CURRENT_DATE)
      AND (cardinality(v_mapping.selected_group_ids) = 0 OR EXISTS (
        SELECT 1 FROM public.facilities sf WHERE sf.id = pfa.facility_id
          AND sf.org_id = p_org_id AND sf.group_id = ANY(v_mapping.selected_group_ids)
      ))
    LEFT JOIN public.facilities f ON f.id = pfa.facility_id AND f.org_id = p_org_id
    LEFT JOIN public.provider_group_assignments pga
      ON pga.org_id = p_org_id AND pga.provider_id = p.id AND pga.group_id = f.group_id
      AND (cardinality(v_mapping.selected_group_ids) = 0 OR pga.group_id = ANY(v_mapping.selected_group_ids))
      AND (pga.start_date IS NULL OR pga.start_date <= CURRENT_DATE)
      AND (pga.end_date IS NULL OR pga.end_date >= CURRENT_DATE)
    LEFT JOIN public.provider_groups pg ON pg.id = pga.group_id AND pg.org_id = p_org_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'license_number', sl.license_number, 'state', sl.state,
        'issue_date', sl.issue_date, 'expiration_date', sl.expiration_date,
        'status', sl.status
      ) ORDER BY (sl.status = 'active' AND sl.expiration_date >= CURRENT_DATE
                    AND (sl.issue_date IS NULL OR sl.issue_date <= CURRENT_DATE)) DESC,
                 sl.expiration_date DESC NULLS LAST, sl.id) AS items
      FROM public.state_licenses sl
      WHERE sl.org_id = p_org_id AND sl.provider_id = p.id AND upper(sl.state) = upper(f.state)
    ) lic ON true
    WHERE p.org_id = p_org_id AND p.id = ANY(v_mapping.selected_provider_ids);
  END IF;

  IF jsonb_array_length(v_rows) > 5000 THEN
    RAISE EXCEPTION 'roster_row_limit_exceeded' USING ERRCODE = '54000';
  END IF;

  RETURN jsonb_build_object(
    'mapping', jsonb_build_object(
      'id', v_mapping.id, 'org_id', v_mapping.org_id, 'template_id', v_mapping.template_id,
      'name', v_mapping.name, 'grain', v_mapping.grain,
      'selected_provider_ids', to_jsonb(v_mapping.selected_provider_ids),
      'selected_facility_ids', to_jsonb(v_mapping.selected_facility_ids),
      'selected_group_ids', to_jsonb(v_mapping.selected_group_ids),
      'column_assignments', v_mapping.column_assignments, 'revision', v_mapping.revision,
      'updated_at', v_mapping.updated_at
    ),
    'template', jsonb_build_object(
      'id', v_template.id, 'slug', v_template.slug, 'payer_name', v_template.payer_name,
      'name', v_template.name, 'schema_version', v_template.schema_version,
      'is_verified', v_template.is_verified, 'verification_status', v_template.verification_status,
      'grains', to_jsonb(v_template.grains), 'columns', v_template.columns
    ),
    'rows', v_rows,
    'validation_date', CURRENT_DATE,
    'validator_version', '1'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.roster_engine_read_source(
  p_org_id uuid, p_mapping_id uuid, p_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_role text; v_source jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_org_id IS NULL OR p_mapping_id IS NULL THEN
    RAISE EXCEPTION 'roster_actor_org_mapping_required' USING ERRCODE = '42501';
  END IF;
  SELECT m.role INTO v_role FROM public.memberships m WHERE m.user_id = p_actor_id AND m.org_id = p_org_id;
  IF v_role IS NULL THEN RAISE EXCEPTION 'roster_membership_required' USING ERRCODE = '42501'; END IF;
  v_source := public.roster_engine_build_source(p_org_id, p_mapping_id);
  RETURN jsonb_build_object(
    'source', v_source,
    'input_fingerprint', encode(pg_catalog.sha256(convert_to(v_source::text, 'UTF8')), 'hex')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.roster_engine_save_mapping(
  p_org_id uuid, p_actor_id uuid, p_mapping_id uuid, p_expected_revision integer,
  p_template_id uuid, p_name text, p_grain text,
  p_selected_provider_ids uuid[], p_selected_facility_ids uuid[], p_selected_group_ids uuid[],
  p_column_assignments jsonb
) RETURNS public.roster_mappings LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_role text; v_row public.roster_mappings%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_org_id IS NULL THEN RAISE EXCEPTION 'roster_actor_org_required' USING ERRCODE = '42501'; END IF;
  SELECT m.role INTO v_role FROM public.memberships m WHERE m.user_id = p_actor_id AND m.org_id = p_org_id;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'specialist') THEN RAISE EXCEPTION 'roster_writer_membership_required' USING ERRCODE = '42501'; END IF;
  IF p_template_id IS NULL OR p_grain NOT IN ('provider', 'provider_location', 'provider_location_tin')
     OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120
     OR p_column_assignments IS NULL OR jsonb_typeof(p_column_assignments) <> 'array'
     OR p_selected_provider_ids IS NULL OR cardinality(p_selected_provider_ids) > 5000
     OR cardinality(COALESCE(p_selected_facility_ids, '{}'::uuid[])) > 5000
     OR cardinality(COALESCE(p_selected_group_ids, '{}'::uuid[])) > 5000 THEN
    RAISE EXCEPTION 'roster_mapping_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_grain <> 'provider' AND COALESCE(cardinality(p_selected_facility_ids), 0) = 0 THEN
    RAISE EXCEPTION 'roster_location_scope_required' USING ERRCODE = '22023';
  END IF;
  IF p_grain = 'provider' AND COALESCE(cardinality(p_selected_group_ids), 0) > 1 THEN
    RAISE EXCEPTION 'roster_provider_grain_group_ambiguous' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roster_templates t WHERE t.id = p_template_id AND t.org_id = p_org_id
                 AND p_grain = ANY(t.grains)) THEN
    RAISE EXCEPTION 'roster_template_unavailable' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_selected_provider_ids) x
    WHERE NOT EXISTS (SELECT 1 FROM public.providers p WHERE p.id = x AND p.org_id = p_org_id)
  ) OR EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_selected_facility_ids, '{}'::uuid[])) x
    WHERE NOT EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = x AND f.org_id = p_org_id)
  ) OR EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_selected_group_ids, '{}'::uuid[])) x
    WHERE NOT EXISTS (SELECT 1 FROM public.provider_groups g WHERE g.id = x AND g.org_id = p_org_id)
  ) THEN RAISE EXCEPTION 'roster_scope_cross_org' USING ERRCODE = '42501'; END IF;

  IF p_mapping_id IS NULL THEN
    INSERT INTO public.roster_mappings(
      org_id, template_id, created_by, name, grain, selected_provider_ids,
      selected_facility_ids, selected_group_ids, column_assignments
    ) VALUES (
      p_org_id, p_template_id, p_actor_id, btrim(p_name), p_grain,
      p_selected_provider_ids, COALESCE(p_selected_facility_ids, '{}'::uuid[]),
      COALESCE(p_selected_group_ids, '{}'::uuid[]), p_column_assignments
    ) RETURNING * INTO v_row;
  ELSE
    UPDATE public.roster_mappings SET
      template_id = p_template_id, name = btrim(p_name), grain = p_grain,
      selected_provider_ids = p_selected_provider_ids,
      selected_facility_ids = COALESCE(p_selected_facility_ids, '{}'::uuid[]),
      selected_group_ids = COALESCE(p_selected_group_ids, '{}'::uuid[]),
      column_assignments = p_column_assignments,
      revision = revision + 1, updated_at = now()
    WHERE id = p_mapping_id AND org_id = p_org_id AND revision = p_expected_revision
    RETURNING * INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION 'roster_mapping_revision_conflict' USING ERRCODE = '40001'; END IF;
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.roster_engine_record_override(
  p_org_id uuid, p_actor_id uuid, p_mapping_id uuid, p_mapping_revision integer,
  p_input_fingerprint text, p_row_key text, p_rule_code text, p_field_key text, p_reason text
) RETURNS public.roster_export_overrides LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_role text; v_current text; v_row public.roster_export_overrides%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_org_id IS NULL OR p_mapping_id IS NULL THEN RAISE EXCEPTION 'roster_actor_org_mapping_required' USING ERRCODE = '42501'; END IF;
  SELECT m.role INTO v_role FROM public.memberships m WHERE m.user_id = p_actor_id AND m.org_id = p_org_id;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'specialist') THEN RAISE EXCEPTION 'roster_writer_membership_required' USING ERRCODE = '42501'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN RAISE EXCEPTION 'roster_override_reason_too_short' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roster_mappings m WHERE m.id = p_mapping_id AND m.org_id = p_org_id AND m.revision = p_mapping_revision) THEN
    RAISE EXCEPTION 'roster_mapping_revision_conflict' USING ERRCODE = '40001';
  END IF;
  v_current := encode(pg_catalog.sha256(convert_to(public.roster_engine_build_source(p_org_id, p_mapping_id)::text, 'UTF8')), 'hex');
  IF v_current IS DISTINCT FROM p_input_fingerprint THEN RAISE EXCEPTION 'roster_input_fingerprint_stale' USING ERRCODE = '40001'; END IF;
  INSERT INTO public.roster_export_overrides(
    org_id, mapping_id, mapping_revision, input_fingerprint, row_key,
    rule_code, field_key, reason, created_by
  ) VALUES (
    p_org_id, p_mapping_id, p_mapping_revision, p_input_fingerprint, p_row_key,
    p_rule_code, p_field_key, btrim(p_reason), p_actor_id
  ) RETURNING * INTO v_row;
  INSERT INTO public.audit_log(org_id, user_id, action_type, entity_type, entity_id, after, description)
  VALUES (p_org_id, p_actor_id, 'CREATE', 'roster_export_override', v_row.id,
    jsonb_build_object('mapping_id', p_mapping_id, 'mapping_revision', p_mapping_revision,
      'row_key', p_row_key, 'rule_code', p_rule_code, 'field_key', p_field_key,
      'input_fingerprint', p_input_fingerprint),
    'Recorded a provider roster validation override');
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.roster_engine_commit_export(
  p_org_id uuid, p_actor_id uuid, p_mapping_id uuid, p_mapping_revision integer,
  p_template_id uuid, p_expected_input_fingerprint text, p_idempotency_key uuid,
  p_format text, p_file_name text, p_total_rows integer, p_file_bytes_b64 text,
  p_frozen_snapshot jsonb, p_applied_overrides jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_role text; v_current text; v_existing public.roster_export_snapshots%ROWTYPE;
  v_row public.roster_export_snapshots%ROWTYPE; v_file_bytes bytea;
  v_mapping public.roster_mappings%ROWTYPE; v_template public.roster_templates%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_org_id IS NULL OR p_mapping_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'roster_actor_org_mapping_idempotency_required' USING ERRCODE = '42501';
  END IF;
  SELECT m.role INTO v_role FROM public.memberships m WHERE m.user_id = p_actor_id AND m.org_id = p_org_id;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'specialist') THEN RAISE EXCEPTION 'roster_writer_membership_required' USING ERRCODE = '42501'; END IF;
  IF p_file_bytes_b64 IS NULL OR length(p_file_bytes_b64) > 4194304 THEN RAISE EXCEPTION 'roster_artifact_limit_exceeded' USING ERRCODE = '54000'; END IF;
  v_file_bytes := decode(p_file_bytes_b64, 'base64');
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org_id::text || ':' || p_idempotency_key::text, 0));
  SELECT * INTO v_existing FROM public.roster_export_snapshots s WHERE s.org_id = p_org_id AND s.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.exported_by <> p_actor_id OR v_existing.mapping_id <> p_mapping_id OR v_existing.expected_input_fingerprint <> p_expected_input_fingerprint
       OR v_existing.format <> p_format OR v_existing.file_bytes IS DISTINCT FROM v_file_bytes THEN
      RAISE EXCEPTION 'roster_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('id', v_existing.id, 'org_id', v_existing.org_id,
      'mapping_id', v_existing.mapping_id, 'template_id', v_existing.template_id,
      'mapping_name', v_existing.mapping_name, 'template_name', v_existing.template_name,
      'template_is_verified', v_existing.template_is_verified,
      'template_verification_status', v_existing.template_verification_status,
      'exported_by', v_existing.exported_by, 'exported_at', v_existing.exported_at,
      'format', v_existing.format, 'file_name', v_existing.file_name,
      'total_rows', v_existing.total_rows, 'sha256', v_existing.sha256,
      'applied_overrides', v_existing.applied_overrides);
  END IF;
  IF p_format NOT IN ('csv', 'xlsx') OR p_total_rows NOT BETWEEN 1 AND 5000
     OR v_file_bytes IS NULL OR octet_length(v_file_bytes) NOT BETWEEN 1 AND 3145728
     OR p_frozen_snapshot IS NULL OR jsonb_typeof(p_frozen_snapshot) <> 'object'
     OR p_applied_overrides IS NULL OR jsonb_typeof(p_applied_overrides) <> 'array' THEN
    RAISE EXCEPTION 'roster_export_payload_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_mapping FROM public.roster_mappings m WHERE m.id = p_mapping_id AND m.org_id = p_org_id
    AND m.revision = p_mapping_revision AND m.template_id = p_template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'roster_mapping_revision_conflict' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO v_template FROM public.roster_templates t WHERE t.id = p_template_id AND t.org_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'roster_template_not_found' USING ERRCODE = 'P0002'; END IF;
  v_current := encode(pg_catalog.sha256(convert_to(public.roster_engine_build_source(p_org_id, p_mapping_id)::text, 'UTF8')), 'hex');
  IF v_current IS DISTINCT FROM p_expected_input_fingerprint THEN RAISE EXCEPTION 'roster_input_fingerprint_stale' USING ERRCODE = '40001'; END IF;
  INSERT INTO public.roster_export_snapshots(
    org_id, mapping_id, template_id, mapping_name, template_name, template_is_verified,
    template_verification_status, exported_by, format, file_name,
    total_rows, sha256, file_bytes, frozen_snapshot, applied_overrides,
    expected_input_fingerprint, idempotency_key
  ) VALUES (
    p_org_id, p_mapping_id, p_template_id, v_mapping.name, v_template.name, v_template.is_verified,
    v_template.verification_status, p_actor_id, p_format, p_file_name,
    p_total_rows, encode(pg_catalog.sha256(v_file_bytes), 'hex'), v_file_bytes,
    p_frozen_snapshot, p_applied_overrides, p_expected_input_fingerprint, p_idempotency_key
  ) RETURNING * INTO v_row;
  INSERT INTO public.audit_log(org_id, user_id, action_type, entity_type, entity_id, after, description)
  VALUES (p_org_id, p_actor_id, 'CREATE', 'roster_export_snapshot', v_row.id,
    jsonb_build_object('mapping_id', p_mapping_id, 'template_id', p_template_id,
      'total_rows', p_total_rows, 'format', p_format, 'sha256', v_row.sha256,
      'applied_override_count', jsonb_array_length(p_applied_overrides)),
    'Generated a provider roster export snapshot');
  RETURN jsonb_build_object('id', v_row.id, 'org_id', v_row.org_id,
    'mapping_id', v_row.mapping_id, 'template_id', v_row.template_id,
    'mapping_name', v_row.mapping_name, 'template_name', v_row.template_name,
    'template_is_verified', v_row.template_is_verified,
    'template_verification_status', v_row.template_verification_status,
    'exported_by', v_row.exported_by, 'exported_at', v_row.exported_at,
    'format', v_row.format, 'file_name', v_row.file_name,
    'total_rows', v_row.total_rows, 'sha256', v_row.sha256,
    'applied_overrides', v_row.applied_overrides);
END;
$$;

CREATE OR REPLACE FUNCTION public.roster_engine_seed_templates(p_org_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.roster_templates(org_id, slug, payer_name, name, grains, columns) VALUES
  (p_org_id, 'bcbs-nc-roster', 'Blue Cross Blue Shield of North Carolina', 'BCBS NC Roster',
   ARRAY['provider', 'provider_location', 'provider_location_tin'],
   '[{"key":"first_name","header":"First Name","required":true,"targetType":"text"},{"key":"last_name","header":"Last Name","required":true,"targetType":"text"},{"key":"npi","header":"NPI","required":true,"targetType":"npi"},{"key":"taxonomy","header":"Taxonomy","required":false,"targetType":"text"},{"key":"location_name","header":"Practice Name","required":true,"targetType":"text"},{"key":"address_1","header":"Practice Address 1","required":true,"targetType":"text"},{"key":"city","header":"City","required":true,"targetType":"text"},{"key":"state","header":"State","required":true,"targetType":"text"},{"key":"zip_plus_4","header":"ZIP+4","required":true,"targetType":"zip_plus_4"},{"key":"phone","header":"Phone","required":true,"targetType":"phone"},{"key":"tin","header":"Billing TIN","required":true,"targetType":"text"}]'::jsonb),
  (p_org_id, 'humana-provider-roster', 'Humana', 'Humana Provider Roster',
   ARRAY['provider', 'provider_location', 'provider_location_tin'],
   '[{"key":"last_name","header":"Last Name","required":true,"targetType":"text"},{"key":"first_name","header":"First Name","required":true,"targetType":"text"},{"key":"npi","header":"Individual NPI","required":true,"targetType":"npi"},{"key":"dob","header":"Date of Birth","required":false,"targetType":"date"},{"key":"taxonomy","header":"Taxonomy Code","required":false,"targetType":"text"},{"key":"practice_name","header":"Practice Location Name","required":true,"targetType":"text"},{"key":"address_1","header":"Address Line 1","required":true,"targetType":"text"},{"key":"city","header":"City","required":true,"targetType":"text"},{"key":"state","header":"State","required":true,"targetType":"text"},{"key":"zip_plus_4","header":"ZIP Code + 4","required":true,"targetType":"zip_plus_4"},{"key":"phone","header":"Practice Phone","required":true,"targetType":"phone"},{"key":"group_npi","header":"Group NPI","required":false,"targetType":"npi"},{"key":"tin","header":"Federal Tax ID","required":true,"targetType":"text"}]'::jsonb),
  (p_org_id, 'medicare-reassignment-worksheet', 'Medicare', 'Medicare Reassignment Worksheet',
   ARRAY['provider', 'provider_location', 'provider_location_tin'],
   '[{"key":"individual_npi","header":"Individual NPI","required":true,"targetType":"npi"},{"key":"first_name","header":"Individual First Name","required":true,"targetType":"text"},{"key":"last_name","header":"Individual Last Name","required":true,"targetType":"text"},{"key":"group_name","header":"Organization Legal Name","required":true,"targetType":"text"},{"key":"group_npi","header":"Organization NPI","required":false,"targetType":"npi"},{"key":"tin","header":"Organization TIN","required":true,"targetType":"text"},{"key":"location_name","header":"Practice Location","required":true,"targetType":"text"},{"key":"address_1","header":"Street Address","required":true,"targetType":"text"},{"key":"city","header":"City","required":true,"targetType":"text"},{"key":"state","header":"State","required":true,"targetType":"text"},{"key":"zip_plus_4","header":"ZIP+4","required":true,"targetType":"zip_plus_4"},{"key":"license_number","header":"State License Number","required":true,"targetType":"text"},{"key":"license_expiration","header":"License Expiration Date","required":true,"targetType":"date"}]'::jsonb)
  ON CONFLICT (org_id, slug) DO NOTHING;
$$;
CREATE OR REPLACE FUNCTION public.roster_engine_seed_templates_for_new_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.roster_engine_seed_templates(NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER roster_engine_seed_org_templates AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.roster_engine_seed_templates_for_new_org();
DO $$ DECLARE v_org_id uuid; BEGIN
  FOR v_org_id IN SELECT id FROM public.organizations LOOP
    PERFORM public.roster_engine_seed_templates(v_org_id);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.roster_engine_build_source(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.roster_engine_seed_templates(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.roster_engine_seed_templates_for_new_org() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.roster_engine_read_source(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roster_engine_read_source(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.roster_engine_save_mapping(uuid, uuid, uuid, integer, uuid, text, text, uuid[], uuid[], uuid[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roster_engine_save_mapping(uuid, uuid, uuid, integer, uuid, text, text, uuid[], uuid[], uuid[], jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.roster_engine_record_override(uuid, uuid, uuid, integer, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roster_engine_record_override(uuid, uuid, uuid, integer, text, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.roster_engine_commit_export(uuid, uuid, uuid, integer, uuid, text, uuid, text, text, integer, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roster_engine_commit_export(uuid, uuid, uuid, integer, uuid, text, uuid, text, text, integer, text, jsonb, jsonb) TO service_role;
