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
SELECT pg_advisory_xact_lock(hashtextextended('mintedpanel:staging-alignment:slice-4', 0));

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
       OR current_setting('minted.restore_system_identifier', true) IS DISTINCT FROM '7689124870789845031'
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
-- Slice 4 creates immutable case numbers and mirrors exactly selected facilities.
DO $prestate$
BEGIN
  IF to_regclass('public.credential_cases_case_number_seq') IS NOT NULL OR to_regclass('public.case_facilities') IS NOT NULL OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credential_cases' AND column_name='case_number') THEN RAISE EXCEPTION 'ALIGNMENT_SLICE_4_ALREADY_APPLIED'; END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND ((table_name='payers' AND column_name IN ('provisional_billing_allowed','provisional_billing_notes','retro_billing_allowed','retro_billing_window_days','caqh_pull_deadline_days','provider_type_path','prior_auth_vendor','payer_billing_id','portal_url','cms_hios_id','prerequisite_payer_id')) OR (table_name='credential_cases' AND column_name='payer_provider_id'))) <> 12 THEN RAISE EXCEPTION 'ALIGNMENT_LEGACY_COLUMN_DRIFT'; END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='payers' AND column_name IN ('resolution_id_label','resolution_id_expected')) <> 2 THEN RAISE EXCEPTION 'ALIGNMENT_LEGACY_PAYER_ID_COLUMNS_DRIFT'; END IF;
  IF to_regclass('public.enrollment_facts') IS NULL OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payer_network_targets' AND column_name='payer_issued_id') THEN RAISE EXCEPTION 'ALIGNMENT_PRIOR_SLICES_REQUIRED'; END IF;
  IF (SELECT count(*) FROM public.credential_cases)<>65 OR (SELECT count(*) FROM public.credential_cases WHERE facility_id IS NOT NULL)<>61 OR (SELECT count(*) FROM public.credential_cases WHERE facility_id IS NULL)<>4 OR (SELECT count(*) FROM public.credential_cases c WHERE c.facility_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.provider_facility_assignments a WHERE a.provider_id=c.provider_id AND a.facility_id=c.facility_id AND a.org_id=c.org_id))<>2 THEN RAISE EXCEPTION 'ALIGNMENT_FACILITY_PRESTATE_DRIFT'; END IF;
  IF to_regclass('pg_temp.minted_alignment_facility_assignment_guard') IS NOT NULL
     OR to_regclass('pg_temp.minted_alignment_case_guard') IS NULL THEN RAISE EXCEPTION 'ALIGNMENT_FACILITY_GUARD_ALREADY_EXISTS'; END IF;
END
$prestate$;
CREATE TEMP TABLE pg_temp.minted_alignment_facility_assignment_guard ON COMMIT PRESERVE ROWS AS
SELECT a.id, md5(to_jsonb(a)::text) AS row_digest
FROM public.provider_facility_assignments a;
CREATE SEQUENCE public.credential_cases_case_number_seq AS bigint;
ALTER TABLE public.credential_cases ADD COLUMN case_number bigint;
WITH ordered AS (SELECT id,row_number() OVER (ORDER BY created_at,id) AS rn FROM public.credential_cases WHERE case_number IS NULL)
UPDATE public.credential_cases c SET case_number=1000+o.rn FROM ordered o WHERE c.id=o.id;
SELECT setval('public.credential_cases_case_number_seq',GREATEST(COALESCE((SELECT max(case_number) FROM public.credential_cases),1000),1000));
ALTER TABLE public.credential_cases ALTER COLUMN case_number SET DEFAULT nextval('public.credential_cases_case_number_seq');
ALTER TABLE public.credential_cases ALTER COLUMN case_number SET NOT NULL;
CREATE UNIQUE INDEX uq_credential_cases_case_number ON public.credential_cases (case_number);
CREATE OR REPLACE FUNCTION public.credential_cases_case_number_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.case_number IS DISTINCT FROM OLD.case_number THEN
    RAISE EXCEPTION 'case_number is immutable (case %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credential_cases_case_number_immutable ON public.credential_cases;
CREATE TRIGGER trg_credential_cases_case_number_immutable BEFORE UPDATE ON public.credential_cases FOR EACH ROW EXECUTE FUNCTION public.credential_cases_case_number_immutable();
GRANT USAGE, SELECT ON SEQUENCE public.credential_cases_case_number_seq TO authenticated, service_role;
CREATE TABLE public.case_facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  case_id uuid NOT NULL REFERENCES public.credential_cases(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CONSTRAINT case_facilities_case_facility_key UNIQUE (case_id, facility_id)
);
CREATE INDEX idx_case_facilities_org_id ON public.case_facilities (org_id);
CREATE INDEX idx_case_facilities_case_id ON public.case_facilities (case_id);
CREATE INDEX idx_case_facilities_facility_id ON public.case_facilities (facility_id);
CREATE UNIQUE INDEX uq_case_facilities_primary_per_case ON public.case_facilities (case_id) WHERE is_primary;
ALTER TABLE public.case_facilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_facilities FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.case_facilities TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.case_facilities TO service_role;
CREATE POLICY case_facilities_select ON public.case_facilities FOR SELECT TO authenticated USING (org_id IN (SELECT public.user_org_ids()));
CREATE POLICY case_facilities_insert ON public.case_facilities FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id)=ANY(ARRAY['specialist'::text,'admin'::text]));
CREATE POLICY case_facilities_update ON public.case_facilities FOR UPDATE TO authenticated USING (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id)=ANY(ARRAY['specialist'::text,'admin'::text])) WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id)=ANY(ARRAY['specialist'::text,'admin'::text]));
CREATE POLICY case_facilities_delete ON public.case_facilities FOR DELETE TO authenticated USING (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id)=ANY(ARRAY['specialist'::text,'admin'::text]));
INSERT INTO public.case_facilities (org_id,case_id,facility_id,is_primary,created_by)
SELECT c.org_id,c.id,c.facility_id,true,NULL FROM public.credential_cases c WHERE c.facility_id IS NOT NULL;

DO $poststate$
BEGIN
  IF (SELECT count(*) FROM public.credential_cases)<>65 OR (SELECT count(*) FROM public.credential_cases WHERE case_number IS NULL)<>0 OR EXISTS (SELECT 1 FROM public.credential_cases GROUP BY case_number HAVING count(*)>1) OR (SELECT min(case_number) FROM public.credential_cases)<>1001 OR (SELECT max(case_number) FROM public.credential_cases)<>1065 OR (SELECT count(*) FROM public.case_facilities)<>61 OR (SELECT count(*) FROM public.case_facilities WHERE is_primary)<>61 OR (SELECT count(*) FROM public.case_facilities cf JOIN public.credential_cases c ON c.id=cf.case_id WHERE c.facility_id IS DISTINCT FROM cf.facility_id)<>0 OR (SELECT count(*) FROM public.case_facilities cf JOIN public.credential_cases c ON c.id=cf.case_id WHERE c.facility_id IS NULL)<>0 THEN RAISE EXCEPTION 'ALIGNMENT_SLICE_4_POSTSTATE_INVALID'; END IF;
  IF (SELECT last_value FROM pg_sequences WHERE schemaname='public' AND sequencename='credential_cases_case_number_seq')<>1065 THEN RAISE EXCEPTION 'ALIGNMENT_CASE_NUMBER_SEQUENCE_INVALID'; END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_temp.minted_alignment_facility_assignment_guard g
    FULL JOIN public.provider_facility_assignments a ON a.id=g.id
    WHERE g.id IS NULL OR a.id IS NULL OR g.row_digest IS DISTINCT FROM md5(to_jsonb(a)::text)
  ) THEN RAISE EXCEPTION 'ALIGNMENT_FACILITY_ASSIGNMENT_MUTATED'; END IF;
  IF to_regclass('pg_temp.minted_alignment_case_guard') IS NULL
     OR EXISTS (SELECT 1 FROM public.credential_cases c JOIN pg_temp.minted_alignment_case_guard g ON g.id=c.id WHERE c.facility_id IS DISTINCT FROM g.facility_id OR md5((to_jsonb(c)-ARRAY['case_status','contract_executed_date','case_number'])::text) IS DISTINCT FROM g.legacy_digest)
     OR (SELECT count(*) FROM public.credential_cases)<>(SELECT count(*) FROM pg_temp.minted_alignment_case_guard) THEN RAISE EXCEPTION 'ALIGNMENT_CASE_PRESERVATION_FAILED'; END IF;
  IF (SELECT count(*) FROM public.credential_cases c WHERE c.facility_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.provider_facility_assignments a WHERE a.provider_id=c.provider_id AND a.facility_id=c.facility_id AND a.org_id=c.org_id))<>2 THEN RAISE EXCEPTION 'ALIGNMENT_FACILITY_EXCEPTIONS_CHANGED'; END IF;
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
