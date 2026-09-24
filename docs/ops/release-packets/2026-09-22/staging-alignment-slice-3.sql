-- AUTHOR-ONLY staging alignment packet; never run against production.
-- Required session settings are external so the identity guard cannot self-pass:
--   SET minted.release_target_kind = 'hosted_staging';
--   SET minted.release_project_ref = 'vmznysvietfaddakkegt';
--   SET minted.release_source_sha = '7a40fc7876c4b53810e1391426afbed865176c3b';
-- A local adapter may use qualified_local_restore only after independently
-- checking current_database=minted_recovery, the exact qualified receipt and
-- its pg_control_system identifier, then setting restore_* session values.
-- This is additive/reconciliation SQL for a qualified restore, not a migration.

BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(hashtextextended('mintedpanel:staging-alignment:slice-3', 0));

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
       OR current_setting('minted.restore_capture_digest', true) IS DISTINCT FROM 'efe2bdaecddf7e3ea83d0afd42110e775c637e867f06499e75537b89f66da4a5'
       OR current_setting('minted.restore_system_identifier', true) IS DISTINCT FROM '7688850032395546663'
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
     OR current_setting('minted.release_source_sha', true) IS DISTINCT FROM '7a40fc7876c4b53810e1391426afbed865176c3b' THEN
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
-- Slice 3 creates empty enrollment facts and widens only the approved ledger checks.
DO $prestate$
BEGIN
  IF to_regclass('public.enrollment_facts') IS NOT NULL OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payer_network_targets' AND column_name='payer_issued_id') OR to_regclass('pg_temp.minted_alignment_ledger_guard') IS NOT NULL THEN RAISE EXCEPTION 'ALIGNMENT_SLICE_3_ALREADY_APPLIED'; END IF;
  IF to_regclass('public.case_status_history') IS NULL OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payers' AND column_name='provider_id_expected') THEN RAISE EXCEPTION 'ALIGNMENT_PRIOR_SLICES_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM public.import_runs WHERE entity_kind='payer_attach') THEN RAISE EXCEPTION 'ALIGNMENT_IMPORT_KIND_PRESTATE_DRIFT'; END IF;
  IF (SELECT count(*) FROM public.case_generation_run_rows WHERE disposition NOT IN ('created','skipped_existing','excluded','failed'))<>0 THEN RAISE EXCEPTION 'ALIGNMENT_GENERATION_LEDGER_DRIFT'; END IF;
END
$prestate$;
CREATE TEMP TABLE pg_temp.minted_alignment_ledger_guard ON COMMIT PRESERVE ROWS AS
SELECT 'case_generation_runs'::text AS table_name, r.id AS row_id, md5(to_jsonb(r)::text) AS row_digest FROM public.case_generation_runs r
UNION ALL SELECT 'case_generation_run_rows', r.id, md5(to_jsonb(r)::text) FROM public.case_generation_run_rows r
UNION ALL SELECT 'payer_pipeline_history', h.id, md5(to_jsonb(h)::text) FROM public.payer_pipeline_history h
UNION ALL SELECT 'import_runs', r.id, md5(to_jsonb(r)::text) FROM public.import_runs r;
CREATE TEMP TABLE pg_temp.minted_alignment_targets_guard ON COMMIT PRESERVE ROWS AS SELECT id,md5((to_jsonb(t)-'payer_issued_id')::text) AS row_digest FROM public.payer_network_targets t;
CREATE TABLE public.enrollment_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers (id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.provider_groups (id) ON DELETE CASCADE,
  payer_id uuid NOT NULL REFERENCES public.payers (id) ON DELETE CASCADE,
  state text NOT NULL CONSTRAINT enrollment_facts_state_check CHECK (state ~ '^[A-Z]{2}$'),
  effective_date date NULL,
  source text NOT NULL DEFAULT 'migration' CONSTRAINT enrollment_facts_source_check CHECK (source IN ('migration')),
  expired_at timestamptz NULL,
  expired_by uuid NULL,
  created_by uuid NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  payer_issued_id text NULL
);
CREATE UNIQUE INDEX uq_enrollment_facts_live ON public.enrollment_facts (provider_id,group_id,payer_id,state) WHERE expired_at IS NULL;
CREATE INDEX idx_enrollment_facts_org_id ON public.enrollment_facts (org_id);
CREATE INDEX idx_enrollment_facts_provider_id ON public.enrollment_facts (provider_id);
CREATE INDEX idx_enrollment_facts_group_id ON public.enrollment_facts (group_id);
CREATE INDEX idx_enrollment_facts_payer_id ON public.enrollment_facts (payer_id);
ALTER TABLE public.enrollment_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.enrollment_facts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.enrollment_facts TO authenticated;
CREATE POLICY enrollment_facts_select ON public.enrollment_facts FOR SELECT USING (org_id IN (SELECT public.user_org_ids()));
CREATE POLICY enrollment_facts_insert ON public.enrollment_facts FOR INSERT WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) IN ('admin','specialist') AND EXISTS (SELECT 1 FROM public.providers p WHERE p.id=provider_id AND p.org_id=enrollment_facts.org_id) AND EXISTS (SELECT 1 FROM public.provider_groups g WHERE g.id=group_id AND g.org_id=enrollment_facts.org_id));
CREATE POLICY enrollment_facts_update ON public.enrollment_facts FOR UPDATE USING (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) IN ('admin','specialist')) WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) IN ('admin','specialist'));
ALTER TABLE public.payer_network_targets ADD COLUMN payer_issued_id text;
ALTER TABLE public.case_generation_run_rows DROP CONSTRAINT case_generation_run_rows_disposition_check;
ALTER TABLE public.case_generation_run_rows ADD CONSTRAINT case_generation_run_rows_disposition_check CHECK (disposition IN ('created','skipped_existing','excluded','failed','skipped','enrolled'));
ALTER TABLE public.case_generation_run_rows DROP CONSTRAINT case_generation_run_rows_reason_required_check;
ALTER TABLE public.case_generation_run_rows ADD CONSTRAINT case_generation_run_rows_reason_required_check CHECK (disposition NOT IN ('excluded','failed','skipped','enrolled') OR reason IS NOT NULL);
ALTER TABLE public.import_runs DROP CONSTRAINT IF EXISTS import_runs_entity_kind_check;
ALTER TABLE public.import_runs ADD CONSTRAINT import_runs_entity_kind_check CHECK (entity_kind IN ('provider_group','facility','provider','combined','payer_attach'));
REVOKE ALL ON public.case_status_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.case_status_history TO authenticated;
REVOKE ALL ON public.case_generation_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.case_generation_runs TO authenticated;
REVOKE ALL ON public.case_generation_run_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.case_generation_run_rows TO authenticated;
REVOKE ALL ON public.payer_pipeline_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.payer_pipeline_history TO authenticated;

DO $poststate$
DECLARE bad integer;
BEGIN
  IF to_regclass('public.enrollment_facts') IS NULL OR (SELECT count(*) FROM public.enrollment_facts)<>0 OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='enrollment_facts' AND column_name='payer_issued_id') OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payer_network_targets' AND column_name='payer_issued_id') THEN RAISE EXCEPTION 'ALIGNMENT_SLICE_3_POSTSTATE_INVALID'; END IF;
  SELECT count(*) INTO bad FROM pg_temp.minted_alignment_targets_guard g FULL JOIN public.payer_network_targets t ON t.id=g.id WHERE g.id IS NULL OR t.id IS NULL OR g.row_digest IS DISTINCT FROM md5((to_jsonb(t)-'payer_issued_id')::text);
  IF bad<>0 THEN RAISE EXCEPTION 'ALIGNMENT_TARGET_PRESERVATION_FAILED'; END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_temp.minted_alignment_ledger_guard g
    FULL JOIN (
      SELECT 'case_generation_runs'::text AS table_name, r.id AS row_id, md5(to_jsonb(r)::text) AS row_digest FROM public.case_generation_runs r
      UNION ALL SELECT 'case_generation_run_rows', r.id, md5(to_jsonb(r)::text) FROM public.case_generation_run_rows r
      UNION ALL SELECT 'payer_pipeline_history', h.id, md5(to_jsonb(h)::text) FROM public.payer_pipeline_history h
      UNION ALL SELECT 'import_runs', r.id, md5(to_jsonb(r)::text) FROM public.import_runs r
    ) current_rows USING (table_name, row_id)
    WHERE g.row_id IS NULL OR current_rows.row_id IS NULL OR g.row_digest IS DISTINCT FROM current_rows.row_digest
  ) THEN RAISE EXCEPTION 'ALIGNMENT_LEDGER_PRESERVATION_FAILED'; END IF;
END
$poststate$;
DO $ledger_acl_poststate$
DECLARE
  v_table regclass;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.case_status_history'::regclass,
    'public.case_generation_runs'::regclass,
    'public.case_generation_run_rows'::regclass,
    'public.payer_pipeline_history'::regclass,
    'public.enrollment_facts'::regclass
  ] LOOP
    IF has_table_privilege('anon', v_table, 'SELECT')
       OR has_table_privilege('anon', v_table, 'INSERT')
       OR has_table_privilege('anon', v_table, 'UPDATE')
       OR has_table_privilege('anon', v_table, 'DELETE')
       OR has_table_privilege('anon', v_table, 'TRUNCATE') THEN
      RAISE EXCEPTION 'ALIGNMENT_LEDGER_ANON_PRIVILEGE_DRIFT';
    END IF;
    IF NOT has_table_privilege('authenticated', v_table, 'SELECT')
       OR NOT has_table_privilege('authenticated', v_table, 'INSERT')
       OR (
         v_table <> 'public.enrollment_facts'::regclass
         AND has_table_privilege('authenticated', v_table, 'UPDATE')
       )
       OR (
         v_table = 'public.enrollment_facts'::regclass
         AND NOT has_table_privilege('authenticated', v_table, 'UPDATE')
       )
       OR has_table_privilege('authenticated', v_table, 'DELETE')
       OR has_table_privilege('authenticated', v_table, 'TRUNCATE') THEN
      RAISE EXCEPTION 'ALIGNMENT_LEDGER_AUTH_PRIVILEGE_DRIFT';
    END IF;
  END LOOP;
END
$ledger_acl_poststate$;
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
