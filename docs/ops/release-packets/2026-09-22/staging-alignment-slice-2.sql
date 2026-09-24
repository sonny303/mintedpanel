-- AUTHOR-ONLY staging alignment packet; never run against production.
-- Required session settings are external so the identity guard cannot self-pass:
--   SET minted.release_target_kind = 'hosted_staging';
--   SET minted.release_project_ref = 'vmznysvietfaddakkegt';
--   SET minted.release_source_sha = 'ae7aff60cac28ee9e2ac5a7a30a8bb7bce6c5c3b';
-- A local adapter may use qualified_local_restore only after independently
-- checking current_database=minted_recovery, the exact qualified receipt and
-- its pg_control_system identifier, then setting restore_* session values.
-- This is additive/reconciliation SQL for a qualified restore, not a migration.

BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(hashtextextended('mintedpanel:staging-alignment:slice-2', 0));

DO $guard$
DECLARE target_kind text := current_setting('minted.release_target_kind', true);
  actual_system_identifier bigint;
BEGIN
  IF target_kind = 'hosted_staging' THEN
    IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'ALIGNMENT_HOSTED_DATABASE_REJECTED'; END IF;
    BEGIN
      SELECT system_identifier INTO actual_system_identifier
      FROM pg_catalog.pg_control_system();
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'ALIGNMENT_HOSTED_SYSTEM_ID_UNAVAILABLE';
    END;
    IF actual_system_identifier IS DISTINCT FROM 7662742571317219726::bigint THEN
      RAISE EXCEPTION 'ALIGNMENT_HOSTED_SYSTEM_ID_REJECTED';
    END IF;
  ELSIF target_kind = 'qualified_local_restore' THEN
    IF current_database() <> 'minted_recovery'
       OR current_setting('minted.restore_status', true) IS DISTINCT FROM 'LOCAL_APPLICATION_BASELINE_VERIFIED'
       OR current_setting('minted.restore_receipt_id', true) IS NULL
       OR current_setting('minted.restore_receipt_id', true) !~ '^[a-f0-9]{16}$'
       OR current_setting('minted.restore_capture_digest', true) IS DISTINCT FROM '9cd07f296ce4eab010bfa1391094c02e7299e4edc8872965e0e08b9eefb8e0de'
       OR current_setting('minted.restore_system_identifier', true) IS DISTINCT FROM '7689139001490436135'
       OR current_setting('minted.restore_system_identifier', true) !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'ALIGNMENT_LOCAL_RECEIPT_REJECTED';
    END IF;
    BEGIN
      SELECT system_identifier INTO actual_system_identifier
      FROM pg_catalog.pg_control_system();
    EXCEPTION
      WHEN undefined_function OR insufficient_privilege THEN
        RAISE EXCEPTION 'ALIGNMENT_LOCAL_SYSTEM_ID_UNAVAILABLE';
    END;
    IF actual_system_identifier IS DISTINCT FROM current_setting('minted.restore_system_identifier')::bigint THEN
      RAISE EXCEPTION 'ALIGNMENT_LOCAL_SYSTEM_ID_REJECTED';
    END IF;
  ELSE
    RAISE EXCEPTION 'ALIGNMENT_TARGET_KIND_REJECTED';
  END IF;
  IF current_setting('minted.release_project_ref', true) IS DISTINCT FROM 'vmznysvietfaddakkegt'
     OR current_setting('minted.release_source_sha', true) IS DISTINCT FROM 'ae7aff60cac28ee9e2ac5a7a30a8bb7bce6c5c3b' THEN
    RAISE EXCEPTION 'ALIGNMENT_IDENTITY_REJECTED';
  END IF;
  IF current_setting('transaction_read_only') = 'on' THEN
    RAISE EXCEPTION 'ALIGNMENT_READ_ONLY_SESSION';
  END IF;
  IF to_regclass('public.portal_field_maps_aetna_backup_20260904') IS NOT NULL
     OR to_regclass('public.portal_field_maps_aetna_direct_backup_20260812') IS NOT NULL
     OR to_regclass('public.portals_aetna_backup_20260904') IS NOT NULL THEN
    RAISE EXCEPTION 'ALIGNMENT_OPERATOR_BACKUP_PRESENT';
  END IF;
END
$guard$;
-- Source checksums are in staging-alignment-slices-1-4-manifest.json.
-- Slice 2 adds payer identity/provenance/archive columns and final controlled writes.
DO $prestate$
BEGIN
  IF (SELECT count(*) FROM public.payers)<>287 THEN RAISE EXCEPTION 'ALIGNMENT_PAYER_COUNT_DRIFT'; END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND ((table_name='payers' AND column_name IN ('provisional_billing_allowed','provisional_billing_notes','retro_billing_allowed','retro_billing_window_days','caqh_pull_deadline_days','provider_type_path','prior_auth_vendor','payer_billing_id','portal_url','cms_hios_id','prerequisite_payer_id')) OR (table_name='credential_cases' AND column_name='payer_provider_id'))) <> 12 THEN RAISE EXCEPTION 'ALIGNMENT_LEGACY_COLUMN_DRIFT'; END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='payers' AND column_name IN ('resolution_id_label','resolution_id_expected')) <> 2 THEN RAISE EXCEPTION 'ALIGNMENT_LEGACY_PAYER_ID_COLUMNS_DRIFT'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payers' AND column_name IN ('delegation_note','group_id_label','group_id_expected','provider_id_label','provider_id_expected','created_by','source','updated_at','archived_at')) OR to_regclass('pg_temp.minted_alignment_payer_guard') IS NOT NULL THEN RAISE EXCEPTION 'ALIGNMENT_SLICE_2_ALREADY_APPLIED'; END IF;
  IF (SELECT count(*) FROM public.payers WHERE resolution_id_label IS NOT NULL OR resolution_id_expected IS NOT NULL)<>0 THEN RAISE EXCEPTION 'ALIGNMENT_PAYER_ID_MAPPING_REQUIRES_REVIEW'; END IF;
  IF to_regclass('public.case_status_history') IS NULL OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credential_cases' AND column_name='case_status') THEN RAISE EXCEPTION 'ALIGNMENT_SLICE_1_REQUIRED'; END IF;
END
$prestate$;
CREATE TEMP TABLE pg_temp.minted_alignment_payer_guard ON COMMIT PRESERVE ROWS AS
SELECT p.id, md5((to_jsonb(p)-ARRAY['delegation_note','group_id_label','group_id_expected','provider_id_label','provider_id_expected','created_by','source','updated_at','archived_at'])::text) AS legacy_digest FROM public.payers p;
ALTER TABLE public.payers ADD COLUMN delegation_note text, ADD COLUMN group_id_label text, ADD COLUMN group_id_expected boolean, ADD COLUMN provider_id_label text, ADD COLUMN provider_id_expected boolean, ADD COLUMN created_by uuid REFERENCES auth.users (id), ADD COLUMN source text, ADD COLUMN updated_at timestamptz, ADD COLUMN archived_at timestamptz;
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payers_source_check') THEN ALTER TABLE public.payers ADD CONSTRAINT payers_source_check CHECK (source IS NULL OR source IN ('seed','sync','manual')); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payers_payer_kind_check') THEN ALTER TABLE public.payers ADD CONSTRAINT payers_payer_kind_check CHECK (payer_kind IN ('commercial','medicare','medicaid','medicaid_mco','medicare_advantage','tricare')); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payers_status_check') THEN ALTER TABLE public.payers ADD CONSTRAINT payers_status_check CHECK (status IN ('active','merged','retired')); END IF;
END
$constraints$;
ALTER TABLE public.payers VALIDATE CONSTRAINT payers_source_check;
ALTER TABLE public.payers VALIDATE CONSTRAINT payers_payer_kind_check;
ALTER TABLE public.payers VALIDATE CONSTRAINT payers_status_check;
CREATE UNIQUE INDEX uq_payers_global_normalized_name ON public.payers (lower(btrim(name))) WHERE org_id IS NULL AND status <> 'merged';
UPDATE public.payers SET source='sync' WHERE source IS NULL;
DO $backfill_guard$
BEGIN
  IF (SELECT count(*) FROM public.payers WHERE source='sync')<>287 THEN RAISE EXCEPTION 'ALIGNMENT_PAYER_SOURCE_BACKFILL_FAILED'; END IF;
  IF (SELECT count(*) FROM public.payers WHERE provider_id_label IS NOT NULL OR provider_id_expected IS NOT NULL)<>0 THEN RAISE EXCEPTION 'ALIGNMENT_PAYER_ID_MAPPING_CHANGED'; END IF;
END
$backfill_guard$;

CREATE OR REPLACE FUNCTION public._payer_norm_name(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(lower(btrim(coalesce(p_value, ''))), '\s+', ' ', 'g');
$$;

REVOKE ALL ON FUNCTION public._payer_norm_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._payer_norm_name(text) FROM anon;
REVOKE ALL ON FUNCTION public._payer_norm_name(text) FROM authenticated;

CREATE OR REPLACE FUNCTION public._payer_norm_states(p_states text[])
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_states text[];
  v_bad text;
BEGIN
  SELECT array_agg(DISTINCT s ORDER BY s) INTO v_states
    FROM (
      SELECT upper(btrim(x)) AS s
        FROM unnest(coalesce(p_states, '{}'::text[])) x
       WHERE btrim(coalesce(x, '')) <> ''
    ) u;
  IF v_states IS NULL OR cardinality(v_states) = 0 THEN
    RAISE EXCEPTION 'payer_states_required';
  END IF;
  SELECT s INTO v_bad FROM unnest(v_states) s WHERE s !~ '^[A-Z]{2}$' LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'payer_state_invalid: %', v_bad;
  END IF;
  RETURN v_states;
END;
$$;

REVOKE ALL ON FUNCTION public._payer_norm_states(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._payer_norm_states(text[]) FROM anon;
REVOKE ALL ON FUNCTION public._payer_norm_states(text[]) FROM authenticated;

CREATE OR REPLACE FUNCTION public._payer_norm_aliases(p_aliases text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(
    coalesce((
      SELECT array_agg(DISTINCT a ORDER BY a)
        FROM (
          SELECT btrim(x) AS a
            FROM unnest(coalesce(p_aliases, '{}'::text[])) x
           WHERE btrim(coalesce(x, '')) <> ''
        ) u
    ), '{}'::text[]),
    '{}'::text[]
  );
$$;

REVOKE ALL ON FUNCTION public._payer_norm_aliases(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._payer_norm_aliases(text[]) FROM anon;
REVOKE ALL ON FUNCTION public._payer_norm_aliases(text[]) FROM authenticated;

CREATE OR REPLACE FUNCTION public._payer_assert_name_available(p_keys text[], p_exclude_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_dup public.payers%ROWTYPE;
  v_successor text;
BEGIN
  SELECT px.* INTO v_dup
    FROM public.payers px
   WHERE px.org_id IS NULL
     AND px.status <> 'retired'
     AND px.id IS DISTINCT FROM p_exclude_id
     AND (
       public._payer_norm_name(px.name) = ANY (p_keys)
       OR EXISTS (
         SELECT 1 FROM unnest(coalesce(px.aliases, '{}'::text[])) al
          WHERE public._payer_norm_name(al) = ANY (p_keys)
       )
     )
   ORDER BY (px.status = 'active') DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_dup.status = 'merged' THEN
    SELECT name INTO v_successor FROM public.payers WHERE id = v_dup.merged_into_id;
    RAISE EXCEPTION 'payer_duplicate: "%" was merged into "%" — add that payer instead',
      v_dup.name, coalesce(v_successor, 'its successor');
  END IF;
  RAISE EXCEPTION 'payer_duplicate: a payer named "%" already exists in the catalog', v_dup.name;
END;
$$;

REVOKE ALL ON FUNCTION public._payer_assert_name_available(text[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._payer_assert_name_available(text[], uuid) FROM anon;
REVOKE ALL ON FUNCTION public._payer_assert_name_available(text[], uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public.create_payer(
  p_org_id uuid,
  p_name text,
  p_payer_kind text,
  p_states text[],
  p_aliases text[] DEFAULT NULL,
  p_group_id_label text DEFAULT NULL,
  p_group_id_expected boolean DEFAULT NULL,
  p_provider_id_label text DEFAULT NULL,
  p_provider_id_expected boolean DEFAULT NULL,
  p_delegation_note text DEFAULT NULL
)
RETURNS public.payers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_name text;
  v_name text := btrim(coalesce(p_name, ''));
  v_states text[];
  v_aliases text[];
  v_keys text[];
  v_row public.payers%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_org_id IS NULL
     OR NOT (p_org_id IN (SELECT user_org_ids()))
     OR user_role(p_org_id) NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'payer_name_required';
  END IF;
  IF p_payer_kind IS NULL OR p_payer_kind NOT IN
     ('commercial', 'medicare', 'medicaid', 'medicaid_mco', 'medicare_advantage', 'tricare') THEN
    RAISE EXCEPTION 'payer_kind_invalid';
  END IF;
  v_states := public._payer_norm_states(p_states);
  v_aliases := public._payer_norm_aliases(p_aliases);

  v_keys := ARRAY[public._payer_norm_name(v_name)]
            || coalesce(
                 (SELECT array_agg(public._payer_norm_name(a)) FROM unnest(coalesce(v_aliases, '{}'::text[])) a),
                 '{}'::text[]
               );
  PERFORM public._payer_assert_name_available(v_keys, NULL);

  BEGIN
    INSERT INTO public.payers
      (org_id, name, payer_kind, states, aliases, status,
       group_id_label, group_id_expected, provider_id_label, provider_id_expected,
       delegation_note, payer_slug, last_synced_at,
       created_by, source, updated_at)
    VALUES
      (NULL, v_name, p_payer_kind, v_states, v_aliases, 'active',
       nullif(btrim(coalesce(p_group_id_label, '')), ''), p_group_id_expected,
       nullif(btrim(coalesce(p_provider_id_label, '')), ''), p_provider_id_expected,
       nullif(btrim(coalesce(p_delegation_note, '')), ''), NULL, NULL,
       v_uid, 'manual', now())
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'payer_duplicate: a payer named "%" already exists in the catalog', v_name;
  END;

  -- OPA-RETIRE: no org_payer_assignments upsert. Adoption = group attach
  -- (payer_network_targets). Table stays dormant.

  SELECT coalesce(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id, after, description)
  VALUES
    (p_org_id, v_uid, v_user_name, 'CREATE', 'payer', v_row.id,
     jsonb_build_object(
       'name', v_row.name, 'payerKind', v_row.payer_kind,
       'states', v_row.states, 'aliases', v_row.aliases, 'source', v_row.source,
       'assignedToOrg', false),
     'Created payer "' || v_row.name || '" in the payer catalog (manual setup)');

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_payer(uuid, text, text, text[], text[], text, boolean, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_payer(uuid, text, text, text[], text[], text, boolean, text, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_payer(uuid, text, text, text[], text[], text, boolean, text, boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_payer(
  p_org_id uuid,
  p_payer_id uuid,
  p_name text,
  p_payer_kind text,
  p_states text[],
  p_aliases text[] DEFAULT NULL,
  p_group_id_label text DEFAULT NULL,
  p_group_id_expected boolean DEFAULT NULL,
  p_provider_id_label text DEFAULT NULL,
  p_provider_id_expected boolean DEFAULT NULL,
  p_delegation_note text DEFAULT NULL
)
RETURNS public.payers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_name text;
  v_name text := btrim(coalesce(p_name, ''));
  v_states text[];
  v_aliases text[];
  v_keys text[];
  v_before public.payers%ROWTYPE;
  v_row public.payers%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_org_id IS NULL
     OR NOT (p_org_id IN (SELECT user_org_ids()))
     OR user_role(p_org_id) NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_before FROM public.payers
   WHERE id = p_payer_id AND org_id IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payer not found';
  END IF;
  IF v_before.status <> 'active' THEN
    -- Retired/merged rows are curation history; repairs stay platform-side.
    RAISE EXCEPTION 'payer_not_editable';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'payer_name_required';
  END IF;
  IF p_payer_kind IS NULL OR p_payer_kind NOT IN
     ('commercial', 'medicare', 'medicaid', 'medicaid_mco', 'medicare_advantage', 'tricare') THEN
    RAISE EXCEPTION 'payer_kind_invalid';
  END IF;
  v_states := public._payer_norm_states(p_states);
  v_aliases := public._payer_norm_aliases(p_aliases);

  v_keys := ARRAY[public._payer_norm_name(v_name)]
            || coalesce(
                 (SELECT array_agg(public._payer_norm_name(a)) FROM unnest(coalesce(v_aliases, '{}'::text[])) a),
                 '{}'::text[]
               );
  PERFORM public._payer_assert_name_available(v_keys, p_payer_id);

  BEGIN
    UPDATE public.payers
       SET name = v_name,
           payer_kind = p_payer_kind,
           states = v_states,
           aliases = v_aliases,
           group_id_label = nullif(btrim(coalesce(p_group_id_label, '')), ''),
           group_id_expected = p_group_id_expected,
           provider_id_label = nullif(btrim(coalesce(p_provider_id_label, '')), ''),
           provider_id_expected = p_provider_id_expected,
           delegation_note = nullif(btrim(coalesce(p_delegation_note, '')), ''),
           updated_at = now()
     WHERE id = p_payer_id AND org_id IS NULL
     RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'payer_duplicate: a payer named "%" already exists in the catalog', v_name;
  END;

  SELECT coalesce(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id, before, after, description)
  VALUES
    (p_org_id, v_uid, v_user_name, 'UPDATE', 'payer', v_row.id,
     jsonb_build_object(
       'name', v_before.name, 'payerKind', v_before.payer_kind,
       'states', v_before.states, 'aliases', v_before.aliases,
       'groupIdLabel', v_before.group_id_label, 'groupIdExpected', v_before.group_id_expected,
       'providerIdLabel', v_before.provider_id_label, 'providerIdExpected', v_before.provider_id_expected,
       'delegationNote', v_before.delegation_note),
     jsonb_build_object(
       'name', v_row.name, 'payerKind', v_row.payer_kind,
       'states', v_row.states, 'aliases', v_row.aliases,
       'groupIdLabel', v_row.group_id_label, 'groupIdExpected', v_row.group_id_expected,
       'providerIdLabel', v_row.provider_id_label, 'providerIdExpected', v_row.provider_id_expected,
       'delegationNote', v_row.delegation_note),
     'Updated payer "' || v_row.name || '"');

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_payer(uuid, uuid, text, text, text[], text[], text, boolean, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_payer(uuid, uuid, text, text, text[], text[], text, boolean, text, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_payer(uuid, uuid, text, text, text[], text[], text, boolean, text, boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.archive_payer(p_org_id uuid, p_payer_id uuid)
RETURNS public.payers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_name text;
  v_before public.payers%ROWTYPE;
  v_row public.payers%ROWTYPE;
  v_open_cases int;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_org_id IS NULL
     OR NOT (p_org_id IN (SELECT user_org_ids()))
     OR user_role(p_org_id) NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Same visibility rule as listPayers: a global-catalog row or (local seed
  -- fixtures only — hosted has zero org rows) an own-org row.
  SELECT * INTO v_before FROM public.payers
   WHERE id = p_payer_id AND (org_id IS NULL OR org_id = p_org_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payer not found';
  END IF;
  IF coalesce(v_before.status, 'active') <> 'active' THEN
    RAISE EXCEPTION 'payer_not_editable';
  END IF;
  IF v_before.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'payer_already_archived';
  END IF;

  -- The orphaning guard (F6.8.1 acceptance): a payer with open (non-terminal)
  -- cases cannot be archived — archiving would hide in-flight work. Payers
  -- are global, so the count spans EVERY org's cases (definer read): an open
  -- case anywhere would be orphaned. Open mirrors src/lib/caseStatus.ts
  -- OPEN_CASE_STATUSES (everything but the three terminals).
  SELECT count(*) INTO v_open_cases
    FROM public.credential_cases c
   WHERE c.payer_id = p_payer_id
     AND c.case_status NOT IN ('approved', 'denied', 'not_pursuing');
  IF v_open_cases > 0 THEN
    RAISE EXCEPTION 'payer_archive_open_cases: %', v_open_cases;
  END IF;

  UPDATE public.payers
     SET archived_at = now(),
         updated_at = now()
   WHERE id = p_payer_id
   RETURNING * INTO v_row;

  SELECT coalesce(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id, before, after, description)
  VALUES
    (p_org_id, v_uid, v_user_name, 'UPDATE', 'payer', v_row.id,
     jsonb_build_object('archivedAt', NULL),
     jsonb_build_object('archivedAt', v_row.archived_at),
     'Archived payer "' || v_row.name || '"');

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_payer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_payer(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.archive_payer(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reactivate_payer(p_org_id uuid, p_payer_id uuid)
RETURNS public.payers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_name text;
  v_before public.payers%ROWTYPE;
  v_row public.payers%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_org_id IS NULL
     OR NOT (p_org_id IN (SELECT user_org_ids()))
     OR user_role(p_org_id) NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_before FROM public.payers
   WHERE id = p_payer_id AND (org_id IS NULL OR org_id = p_org_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payer not found';
  END IF;
  IF coalesce(v_before.status, 'active') <> 'active' THEN
    RAISE EXCEPTION 'payer_not_editable';
  END IF;
  IF v_before.archived_at IS NULL THEN
    RAISE EXCEPTION 'payer_not_archived';
  END IF;

  UPDATE public.payers
     SET archived_at = NULL,
         updated_at = now()
   WHERE id = p_payer_id
   RETURNING * INTO v_row;

  SELECT coalesce(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id, before, after, description)
  VALUES
    (p_org_id, v_uid, v_user_name, 'UPDATE', 'payer', v_row.id,
     jsonb_build_object('archivedAt', v_before.archived_at),
     jsonb_build_object('archivedAt', NULL),
     'Reactivated payer "' || v_row.name || '"');

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.reactivate_payer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reactivate_payer(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reactivate_payer(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.merge_payer(
  p_org_id uuid,
  p_loser_id uuid,
  p_survivor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_name text;
  v_loser public.payers%ROWTYPE;
  v_survivor public.payers%ROWTYPE;
  v_survivor_after public.payers%ROWTYPE;
  v_conflicts text;
  v_conflict_count int;
  v_templates int := 0;
  v_targets int := 0;
  v_dup_targets int := 0;
  v_facts int := 0;
  v_dup_facts int := 0;
  v_cases int := 0;
  v_assignments int := 0;
  v_dup_assignments int := 0;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_org_id IS NULL
     OR NOT (p_org_id IN (SELECT user_org_ids()))
     OR user_role(p_org_id) NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_loser_id = p_survivor_id THEN
    RAISE EXCEPTION 'payer_merge_self';
  END IF;

  -- Lock both rows in a deterministic order (by id) so two concurrent merges
  -- can never deadlock; then validate each side.
  PERFORM 1 FROM public.payers
   WHERE id IN (p_loser_id, p_survivor_id)
   ORDER BY id
   FOR UPDATE;

  SELECT * INTO v_loser FROM public.payers
   WHERE id = p_loser_id AND (org_id IS NULL OR org_id = p_org_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payer not found';
  END IF;
  SELECT * INTO v_survivor FROM public.payers
   WHERE id = p_survivor_id AND (org_id IS NULL OR org_id = p_org_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payer not found';
  END IF;

  IF v_loser.status = 'merged' THEN
    RAISE EXCEPTION 'payer_merge_loser_merged';
  END IF;
  IF coalesce(v_survivor.status, 'active') <> 'active' THEN
    RAISE EXCEPTION 'payer_merge_survivor_not_active';
  END IF;
  IF v_survivor.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'payer_merge_survivor_archived';
  END IF;

  -- The 4-part case-key collision pre-check (F6.8.2 acceptance): an OPEN
  -- loser case whose (provider, group, survivor, state) key is already taken
  -- (by ANY survivor case, open or closed — the unique spans all rows,
  -- NULLS NOT DISTINCT) makes the merge impossible; name the cases so the
  -- future dialog can send the user to resolve them first. First 20 listed.
  SELECT count(*),
         string_agg('C-' || sub.case_number, ', ' ORDER BY sub.case_number)
         FILTER (WHERE sub.rn <= 20)
    INTO v_conflict_count, v_conflicts
    FROM (
      SELECT c.case_number, row_number() OVER (ORDER BY c.case_number) AS rn
        FROM public.credential_cases c
       WHERE c.payer_id = p_loser_id
         AND c.case_status NOT IN ('approved', 'denied', 'not_pursuing')
         AND EXISTS (
           SELECT 1 FROM public.credential_cases s
            WHERE s.payer_id = p_survivor_id
              AND s.provider_id = c.provider_id
              AND s.group_id IS NOT DISTINCT FROM c.group_id
              AND s.state = c.state
         )
    ) sub;
  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'payer_merge_case_conflict: % open case(s) collide with the survivor — %',
      v_conflict_count, v_conflicts;
  END IF;

  -- Templates follow. Collisions are surfaced honestly on BOTH tiers,
  -- nothing partial commits:
  --   * org tier — the E4.2 partial unique (one ACTIVE org SOP per
  --     (org, payer, state, group) grain) raises 23505 on the UPDATE;
  --   * GLOBAL tier — that grain (one ACTIVE global SOP per (payer, state,
  --     group), NULLS NOT DISTINCT) has NO DB index: author_global_sop
  --     enforces it in-body (`global_sop_duplicate_match`), which a direct
  --     UPDATE bypasses. Pre-check it here with the same match, or the merge
  --     would silently mint two active global SOPs at one grain (pickTemplate
  --     tiebreaks one dead with no signal; later match-key edits jam on the
  --     occupied grain).
  IF EXISTS (
    SELECT 1
      FROM public.sop_templates l
      JOIN public.sop_templates s
        ON s.org_id IS NULL
       AND s.archived = false
       AND s.payer_id = p_survivor_id
       AND s.state IS NOT DISTINCT FROM l.state
       AND s.group_id IS NOT DISTINCT FROM l.group_id
     WHERE l.org_id IS NULL
       AND l.archived = false
       AND l.payer_id = p_loser_id
  ) THEN
    RAISE EXCEPTION 'payer_merge_template_conflict';
  END IF;
  BEGIN
    UPDATE public.sop_templates
       SET payer_id = p_survivor_id
     WHERE payer_id = p_loser_id;
    GET DIAGNOSTICS v_templates = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'payer_merge_template_conflict';
  END;

  -- Network targets. Survivor-side fold first (restore + inherit the group
  -- PIN), then archive the loser's duplicates in place, then move the rest.
  UPDATE public.payer_network_targets s
     SET status = CASE WHEN l.status = 'active' THEN 'active' ELSE s.status END,
         payer_issued_id = coalesce(s.payer_issued_id, l.payer_issued_id)
    FROM public.payer_network_targets l
   WHERE l.payer_id = p_loser_id
     AND s.payer_id = p_survivor_id
     AND s.group_id = l.group_id
     AND s.state = l.state;

  UPDATE public.payer_network_targets l
     SET status = 'archived'
   WHERE l.payer_id = p_loser_id
     AND l.status = 'active'
     AND EXISTS (
       SELECT 1 FROM public.payer_network_targets s
        WHERE s.payer_id = p_survivor_id
          AND s.group_id = l.group_id
          AND s.state = l.state
     );
  GET DIAGNOSTICS v_dup_targets = ROW_COUNT;

  UPDATE public.payer_network_targets l
     SET payer_id = p_survivor_id
   WHERE l.payer_id = p_loser_id
     AND NOT EXISTS (
       SELECT 1 FROM public.payer_network_targets s
        WHERE s.payer_id = p_survivor_id
          AND s.group_id = l.group_id
          AND s.state = l.state
     );
  GET DIAGNOSTICS v_targets = ROW_COUNT;

  -- Enrollment facts. Where both sides hold a LIVE fact at the same key the
  -- survivor's wins (inheriting the loser's provider PIN where it has none)
  -- and the loser's is expired — the standard flip, never a delete. Then
  -- everything (live non-colliding + all history) moves.
  UPDATE public.enrollment_facts s
     SET payer_issued_id = coalesce(s.payer_issued_id, l.payer_issued_id)
    FROM public.enrollment_facts l
   WHERE l.payer_id = p_loser_id AND l.expired_at IS NULL
     AND s.payer_id = p_survivor_id AND s.expired_at IS NULL
     AND s.provider_id = l.provider_id
     AND s.group_id = l.group_id
     AND s.state = l.state;

  UPDATE public.enrollment_facts l
     SET expired_at = now(), expired_by = v_uid
   WHERE l.payer_id = p_loser_id AND l.expired_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.enrollment_facts s
        WHERE s.payer_id = p_survivor_id AND s.expired_at IS NULL
          AND s.provider_id = l.provider_id
          AND s.group_id = l.group_id
          AND s.state = l.state
     );
  GET DIAGNOSTICS v_dup_facts = ROW_COUNT;

  UPDATE public.enrollment_facts
     SET payer_id = p_survivor_id
   WHERE payer_id = p_loser_id;
  GET DIAGNOSTICS v_facts = ROW_COUNT;

  -- Open cases re-point (pre-checked above; the DB unique stays the backstop
  -- against a concurrent insert — a race aborts the whole merge).
  BEGIN
    UPDATE public.credential_cases
       SET payer_id = p_survivor_id,
           updated_at = now()
     WHERE payer_id = p_loser_id
       AND case_status NOT IN ('approved', 'denied', 'not_pursuing');
    GET DIAGNOSTICS v_cases = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'payer_merge_case_conflict: a conflicting case was created concurrently — retry';
  END;

  -- Org subscriptions: fold where an org holds both (active wins), delete the
  -- loser's now-redundant row (dedupe), move the rest.
  UPDATE public.org_payer_assignments s
     SET status = CASE WHEN l.status = 'active' THEN 'active' ELSE s.status END,
         archived_at = CASE WHEN l.status = 'active' THEN NULL ELSE s.archived_at END
    FROM public.org_payer_assignments l
   WHERE l.payer_id = p_loser_id
     AND s.payer_id = p_survivor_id
     AND s.org_id = l.org_id;

  DELETE FROM public.org_payer_assignments l
   WHERE l.payer_id = p_loser_id
     AND EXISTS (
       SELECT 1 FROM public.org_payer_assignments s
        WHERE s.org_id = l.org_id AND s.payer_id = p_survivor_id
     );
  GET DIAGNOSTICS v_dup_assignments = ROW_COUNT;

  UPDATE public.org_payer_assignments
     SET payer_id = p_survivor_id
   WHERE payer_id = p_loser_id;
  GET DIAGNOSTICS v_assignments = ROW_COUNT;

  -- The loser's name becomes an alias on the survivor (skipped when the
  -- survivor already carries it as its name or an alias, by normalized key).
  UPDATE public.payers
     SET aliases = CASE
           WHEN public._payer_norm_name(name) = public._payer_norm_name(v_loser.name)
             OR EXISTS (
               SELECT 1 FROM unnest(coalesce(aliases, '{}'::text[])) a
                WHERE public._payer_norm_name(a) = public._payer_norm_name(v_loser.name)
             )
           THEN aliases
           ELSE coalesce(aliases, '{}'::text[]) || v_loser.name
         END,
         updated_at = now()
   WHERE id = p_survivor_id
   RETURNING * INTO v_survivor_after;

  -- Mark the loser merged. Flipping status also drops it out of the
  -- normalized-name partial unique (WHERE status <> 'merged'), so the
  -- survivor's new alias never collides at the index.
  UPDATE public.payers
     SET status = 'merged',
         merged_into_id = p_survivor_id,
         updated_at = now()
   WHERE id = p_loser_id;

  SELECT coalesce(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id, before, after, description)
  VALUES
    (p_org_id, v_uid, v_user_name, 'UPDATE', 'payer', p_loser_id,
     jsonb_build_object(
       'loser', jsonb_build_object('id', v_loser.id, 'name', v_loser.name, 'status', v_loser.status),
       'survivor', jsonb_build_object('id', v_survivor.id, 'name', v_survivor.name, 'aliases', v_survivor.aliases)),
     jsonb_build_object(
       'loser', jsonb_build_object('id', v_loser.id, 'status', 'merged', 'mergedIntoId', p_survivor_id),
       'survivor', jsonb_build_object('id', v_survivor_after.id, 'aliases', v_survivor_after.aliases),
       'movedTemplates', v_templates,
       'movedTargets', v_targets,
       'archivedDuplicateTargets', v_dup_targets,
       'movedFacts', v_facts,
       'expiredDuplicateFacts', v_dup_facts,
       'movedOpenCases', v_cases,
       'movedAssignments', v_assignments,
       'dedupedAssignments', v_dup_assignments),
     'Merged payer "' || v_loser.name || '" into "' || v_survivor.name || '"');

  RETURN jsonb_build_object(
    'survivor', to_jsonb(v_survivor_after),
    'movedTemplates', v_templates,
    'movedTargets', v_targets,
    'archivedDuplicateTargets', v_dup_targets,
    'movedFacts', v_facts,
    'expiredDuplicateFacts', v_dup_facts,
    'movedOpenCases', v_cases,
    'movedAssignments', v_assignments,
    'dedupedAssignments', v_dup_assignments);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_payer(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_payer(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.merge_payer(uuid, uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS payers_insert ON public.payers;
DROP POLICY IF EXISTS payers_update ON public.payers;
REVOKE INSERT, UPDATE ON public.payers FROM authenticated, anon;
DROP POLICY IF EXISTS payers_select ON public.payers;
CREATE POLICY payers_select ON public.payers FOR SELECT USING (org_id IN (SELECT public.user_org_ids()) OR org_id IS NULL);
DROP POLICY IF EXISTS payer_network_targets_insert ON public.payer_network_targets;
CREATE POLICY payer_network_targets_insert ON public.payer_network_targets FOR INSERT WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id)='admin' AND EXISTS (SELECT 1 FROM public.provider_groups g WHERE g.id=group_id AND g.org_id=payer_network_targets.org_id));
DROP POLICY IF EXISTS payer_network_targets_update ON public.payer_network_targets;
CREATE POLICY payer_network_targets_update ON public.payer_network_targets FOR UPDATE USING (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id)='admin') WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id)='admin' AND EXISTS (SELECT 1 FROM public.provider_groups g WHERE g.id=group_id AND g.org_id=payer_network_targets.org_id));
DROP FUNCTION IF EXISTS public.set_case_status(uuid, text, text, uuid, text, boolean, date, text, text, date, uuid);
CREATE OR REPLACE FUNCTION public.set_case_status(
  p_case_id uuid,
  p_to_status text,
  p_expected_status text DEFAULT NULL,
  p_reason_code_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_is_correction boolean DEFAULT false,
  p_effective_date date DEFAULT NULL,
  p_individual_provider_id text DEFAULT NULL,
  p_group_provider_id text DEFAULT NULL,
  p_contract_executed_date date DEFAULT NULL,
  p_evidence_touch_id uuid DEFAULT NULL,
  p_provider_id_missing_ack boolean DEFAULT false,
  p_group_id_missing_ack boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_case public.credential_cases;
  v_org uuid;
  v_from text;
  v_role text;
  v_user uuid := auth.uid();
  v_user_name text;
  v_reason public.denial_reason_codes;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_individual_id text := NULLIF(btrim(COALESCE(p_individual_provider_id, '')), '');
  v_group_id text := NULLIF(btrim(COALESCE(p_group_provider_id, '')), '');
  v_provider_id_required boolean;
  v_group_id_required boolean;
  -- F6.8.3: an ack "consumed" = the ID was expected, absent, and explicitly
  -- acknowledged missing. An ack passed alongside a supplied ID is inert
  -- (the ID was received) and never recorded.
  v_provider_ack boolean := false;
  v_group_ack boolean := false;
  v_ack_parts text[] := '{}'::text[];
  v_history_note text;
  v_from_rank int;
  v_to_rank int;
  v_legal boolean;
  v_mirror_label text;
  v_mirror_status uuid;
  v_mirror_pipeline text;
BEGIN
  -- Lock the row; RLS (SECURITY INVOKER) scopes this to the caller's org, so
  -- a cross-org or missing id is simply NOT FOUND.
  SELECT * INTO v_case FROM public.credential_cases WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_status_case_not_found';
  END IF;
  v_org := v_case.org_id;
  v_from := v_case.case_status;
  v_role := user_role(v_org);

  IF v_role IS NULL OR v_role NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'case_status_not_authorized';
  END IF;

  -- Optimistic concurrency: the client acted on p_expected_status. A stale
  -- second writer is rejected, not silently overwritten. (The Add-touch bump
  -- passes NULL — an auto-trigger may have just advanced the case.)
  IF p_expected_status IS NOT NULL AND p_expected_status <> v_from THEN
    RAISE EXCEPTION 'case_status_conflict:%', v_from;
  END IF;

  IF p_to_status NOT IN (
    'not_started', 'in_progress', 'submitted', 'in_review',
    'action_required', 'approved', 'denied', 'not_pursuing'
  ) THEN
    RAISE EXCEPTION 'case_status_invalid';
  END IF;

  IF p_to_status = v_from THEN
    RAISE EXCEPTION 'case_status_invalid_transition';
  END IF;

  IF p_is_correction THEN
    -- Backward/off-edge moves: admin-only, note required (F6.0.4).
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'case_status_admin_only';
    END IF;
    IF v_note IS NULL THEN
      RAISE EXCEPTION 'case_status_correction_needs_note';
    END IF;
  ELSE
    v_from_rank := CASE v_from
      WHEN 'not_started' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'submitted' THEN 2
      WHEN 'in_review' THEN 3 WHEN 'action_required' THEN 4 ELSE NULL END;
    v_to_rank := CASE p_to_status
      WHEN 'not_started' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'submitted' THEN 2
      WHEN 'in_review' THEN 3 WHEN 'action_required' THEN 4 ELSE NULL END;
    v_legal :=
      (v_from = 'denied' AND p_to_status = 'in_progress')
      OR (v_from_rank IS NOT NULL
          AND p_to_status IN ('approved', 'denied', 'not_pursuing'))
      OR (v_from_rank IS NOT NULL AND v_to_rank IS NOT NULL AND v_to_rank > v_from_rank)
      OR (v_from = 'action_required' AND p_to_status = 'in_review');
    IF NOT v_legal THEN
      RAISE EXCEPTION 'case_status_invalid_transition';
    END IF;
  END IF;

  -- Reason-code enforcement. Validate any supplied code against the
  -- global + own-org active vocabulary (the E4.0 denial_reason_codes table —
  -- the fixed word-list the Denied dialog requires).
  IF p_reason_code_id IS NOT NULL THEN
    SELECT * INTO v_reason FROM public.denial_reason_codes
      WHERE id = p_reason_code_id
        AND (org_id IS NULL OR org_id = v_org)
        AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'case_status_reason_invalid';
    END IF;
  END IF;

  IF p_to_status = 'denied' THEN
    IF p_reason_code_id IS NULL THEN
      RAISE EXCEPTION 'case_status_denied_needs_reason';
    END IF;
    IF v_reason.code = 'other' AND v_note IS NULL THEN
      RAISE EXCEPTION 'case_status_other_needs_context';
    END IF;
  END IF;

  IF p_to_status = 'not_pursuing' AND NOT p_is_correction AND v_note IS NULL THEN
    RAISE EXCEPTION 'case_status_not_pursuing_needs_note';
  END IF;

  -- Approved captures the terminal facts at the moment the letter is in hand
  -- (F6.0.2): the effective date always; the payer-issued IDs per the payer's
  -- E6.7 ID-expectation flags. F6.8.3: each expected ID must be EITHER
  -- supplied OR explicitly acknowledged missing ("Didn't receive") — silence
  -- still raises the E6.7 named error.
  IF p_to_status = 'approved' AND NOT p_is_correction THEN
    IF p_effective_date IS NULL THEN
      RAISE EXCEPTION 'case_status_approved_needs_effective_date';
    END IF;
    SELECT COALESCE(py.provider_id_expected, py.resolution_id_expected, true),
           COALESCE(py.group_id_expected, false)
      INTO v_provider_id_required, v_group_id_required
      FROM public.payers py WHERE py.id = v_case.payer_id;
    IF NOT FOUND THEN
      v_provider_id_required := true;
      v_group_id_required := false;
    END IF;
    IF v_provider_id_required AND v_individual_id IS NULL
       AND NOT COALESCE(p_provider_id_missing_ack, false) THEN
      RAISE EXCEPTION 'case_status_approved_needs_provider_id';
    END IF;
    IF v_group_id_required AND v_group_id IS NULL
       AND NOT COALESCE(p_group_id_missing_ack, false) THEN
      RAISE EXCEPTION 'case_status_approved_needs_group_provider_id';
    END IF;
    v_provider_ack := v_provider_id_required AND v_individual_id IS NULL
      AND COALESCE(p_provider_id_missing_ack, false);
    v_group_ack := v_group_id_required AND v_group_id IS NULL
      AND COALESCE(p_group_id_missing_ack, false);
    -- array_append, not `||` — an untyped literal on `||`'s right resolves
    -- as an array and fails at runtime ("malformed array literal").
    IF v_provider_ack THEN v_ack_parts := array_append(v_ack_parts, 'provider ID'); END IF;
    IF v_group_ack THEN v_ack_parts := array_append(v_ack_parts, 'group ID'); END IF;
  END IF;

  -- The evidencing touch (F6.0.3) must belong to this same case.
  IF p_evidence_touch_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.touches t
      WHERE t.id = p_evidence_touch_id AND t.case_id = p_case_id AND t.org_id = v_org
    ) THEN
      RAISE EXCEPTION 'case_status_evidence_invalid';
    END IF;
  END IF;

  -- Transition-shim mirrors (see 20260719120100). The credentialing mirror
  -- resolves this org's status_configs row by canonical label; a missing row
  -- (never the case for canonically-seeded orgs) leaves the legacy field
  -- unchanged.
  v_mirror_label := CASE p_to_status
    WHEN 'not_started' THEN 'Not Started'
    WHEN 'in_progress' THEN 'In Progress'
    WHEN 'submitted' THEN 'Submitted'
    WHEN 'in_review' THEN 'Submitted'
    WHEN 'action_required' THEN 'Waiting on Provider'
    WHEN 'approved' THEN 'Approved'
    WHEN 'denied' THEN 'Denied'
    WHEN 'not_pursuing' THEN 'Not Required'
  END;
  SELECT id INTO v_mirror_status FROM public.status_configs
    WHERE org_id = v_org AND track = 'credentialing' AND label = v_mirror_label
    ORDER BY sort_order ASC LIMIT 1;
  v_mirror_pipeline := CASE p_to_status
    WHEN 'not_started' THEN 'not_started'
    WHEN 'in_progress' THEN 'drafting'
    WHEN 'submitted' THEN 'submitted'
    WHEN 'in_review' THEN 'in_review'
    WHEN 'action_required' THEN 'action_required'
    WHEN 'approved' THEN 'approved'
    WHEN 'denied' THEN 'denied'
    WHEN 'not_pursuing' THEN 'oon'
  END;

  IF p_to_status = 'approved' AND NOT p_is_correction THEN
    -- An acknowledged-missing ID stays NULL here — the Awaiting-ID derivation
    -- (expected + approved + NULL id) and the existing set-later back-fill
    -- paths take it from there.
    UPDATE public.credential_cases
      SET case_status = p_to_status,
          credentialing_status_id = COALESCE(v_mirror_status, credentialing_status_id),
          payer_pipeline_state = v_mirror_pipeline,
          confirmed_effective_date = p_effective_date,
          payer_individual_provider_id = v_individual_id,
          payer_group_provider_id = COALESCE(v_group_id, payer_group_provider_id),
          contract_executed_date = COALESCE(p_contract_executed_date, contract_executed_date),
          approved_date = COALESCE(approved_date, CURRENT_DATE),
          updated_at = now()
      WHERE id = p_case_id
      RETURNING * INTO v_case;
  ELSIF p_is_correction AND v_from = 'approved' AND p_to_status <> 'approved' THEN
    -- Approval reversal: clear the erroneous enrollment facts (admin-only,
    -- the E4.0 reversal pattern).
    UPDATE public.credential_cases
      SET case_status = p_to_status,
          credentialing_status_id = COALESCE(v_mirror_status, credentialing_status_id),
          payer_pipeline_state = v_mirror_pipeline,
          confirmed_effective_date = NULL,
          payer_individual_provider_id = NULL,
          payer_group_provider_id = NULL,
          contract_executed_date = NULL,
          approved_date = NULL,
          updated_at = now()
      WHERE id = p_case_id
      RETURNING * INTO v_case;
  ELSIF p_to_status = 'submitted' THEN
    -- The human asserting the submission stamps the plain fact date once.
    UPDATE public.credential_cases
      SET case_status = p_to_status,
          credentialing_status_id = COALESCE(v_mirror_status, credentialing_status_id),
          payer_pipeline_state = v_mirror_pipeline,
          submitted_date = COALESCE(submitted_date, CURRENT_DATE),
          updated_at = now()
      WHERE id = p_case_id
      RETURNING * INTO v_case;
  ELSE
    UPDATE public.credential_cases
      SET case_status = p_to_status,
          credentialing_status_id = COALESCE(v_mirror_status, credentialing_status_id),
          payer_pipeline_state = v_mirror_pipeline,
          updated_at = now()
      WHERE id = p_case_id
      RETURNING * INTO v_case;
  END IF;

  -- Append-only unified history row (human transitions run through here;
  -- 'system' rows come from the 120200 triggers + create_case_with_tasks).
  -- F6.8.3: a consumed "Didn't receive" ack is recorded beneath any user
  -- note — the fixed sentence "Didn't receive: provider ID[; group ID]".
  IF cardinality(v_ack_parts) > 0 THEN
    v_history_note := concat_ws(E'\n', v_note,
      'Didn''t receive: ' || array_to_string(v_ack_parts, '; '));
  ELSE
    v_history_note := v_note;
  END IF;
  INSERT INTO public.case_status_history (
    org_id, case_id, from_status, to_status, actor_kind, reason_code_id,
    evidence_touch_id, is_correction, note, changed_by
  ) VALUES (
    v_org, p_case_id, v_from, p_to_status, 'user', p_reason_code_id,
    p_evidence_touch_id, p_is_correction, v_history_note, v_user
  );

  -- In-RPC audit row, same transaction — rolls back with a failed transition.
  -- The ack flags join the payload only when actually consumed.
  SELECT COALESCE(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_user;
  INSERT INTO public.audit_log (
    org_id, user_id, user_name, action_type, entity_type, entity_id,
    before, after, description
  ) VALUES (
    v_org, v_user, v_user_name, 'STATUS_CHANGE', 'credential_case', p_case_id,
    jsonb_build_object('caseStatus', v_from),
    jsonb_build_object(
      'caseStatus', p_to_status,
      'isCorrection', p_is_correction,
      'reasonCodeId', p_reason_code_id,
      'evidenceTouchId', p_evidence_touch_id
    ) || CASE
      WHEN v_provider_ack OR v_group_ack THEN jsonb_build_object(
        'providerIdMissingAck', v_provider_ack,
        'groupIdMissingAck', v_group_ack)
      ELSE '{}'::jsonb
    END,
    CASE WHEN p_is_correction THEN 'Case status corrected' ELSE 'Case status changed' END
  );

  RETURN to_jsonb(v_case);
END;
$$;

REVOKE ALL ON FUNCTION public.set_case_status(uuid,text,text,uuid,text,boolean,date,text,text,date,uuid,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_case_status(uuid,text,text,uuid,text,boolean,date,text,text,date,uuid,boolean,boolean) TO authenticated;

DO $poststate$
DECLARE mismatches integer;
BEGIN
  IF (SELECT count(*) FROM public.payers)<>287 OR (SELECT count(*) FROM public.payers WHERE source<>'sync' OR source IS NULL)<>0 OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='set_case_status') THEN RAISE EXCEPTION 'ALIGNMENT_SLICE_2_POSTSTATE_INVALID'; END IF;
  SELECT count(*) INTO mismatches FROM public.payers p JOIN pg_temp.minted_alignment_payer_guard g ON g.id=p.id
  WHERE md5((to_jsonb(p)-ARRAY['delegation_note','group_id_label','group_id_expected','provider_id_label','provider_id_expected','created_by','source','updated_at','archived_at'])::text) IS DISTINCT FROM g.legacy_digest OR p.provider_id_label IS NOT NULL OR p.provider_id_expected IS NOT NULL;
  IF mismatches<>0 THEN RAISE EXCEPTION 'ALIGNMENT_PAYER_PRESERVATION_FAILED'; END IF;
  IF (SELECT count(*) FROM public.credential_cases)<>(SELECT count(*) FROM pg_temp.minted_alignment_case_guard) THEN RAISE EXCEPTION 'ALIGNMENT_CASE_PRESERVATION_FAILED'; END IF;
END
$poststate$;
DO $final_guard$
BEGIN
  IF to_regclass('public.portal_field_maps_aetna_backup_20260904') IS NOT NULL
     OR to_regclass('public.portal_field_maps_aetna_direct_backup_20260812') IS NOT NULL
     OR to_regclass('public.portals_aetna_backup_20260904') IS NOT NULL THEN
    RAISE EXCEPTION 'ALIGNMENT_OPERATOR_BACKUP_PRESENT';
  END IF;
END
$final_guard$;

COMMIT;
