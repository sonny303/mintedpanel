-- This suite runs only in verify-roster-engine.mjs's disposable, network-none DB.
CREATE TEMP TABLE wp13_results (name text PRIMARY KEY, passed boolean NOT NULL);
GRANT ALL ON wp13_results TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.wp13_mark(p_name text, p_passed boolean) RETURNS void
LANGUAGE sql AS $$ INSERT INTO wp13_results VALUES (p_name, p_passed) $$;
CREATE FUNCTION pg_temp.wp13_expect_state(p_state text, p_statement text) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE v_state text;
BEGIN
  BEGIN
    EXECUTE p_statement;
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    RETURN v_state = p_state;
  END;
END;
$$;

-- Deterministic synthetic tenants and users.
INSERT INTO auth.users(id,email) VALUES
 ('20000000-0000-0000-0000-000000000001','admin-a@example.invalid'),
 ('20000000-0000-0000-0000-000000000002','billing-a@example.invalid'),
 ('20000000-0000-0000-0000-000000000003','specialist-b@example.invalid'),
 ('20000000-0000-0000-0000-000000000004','admin-a2@example.invalid'),
 ('20000000-0000-0000-0000-000000000005','nonmember@example.invalid');
INSERT INTO public.profiles(id,full_name) SELECT id,'Synthetic roster actor' FROM auth.users;
INSERT INTO public.organizations(id,name) VALUES
 ('10000000-0000-0000-0000-000000000001','WP13 Synthetic Org A'),
 ('10000000-0000-0000-0000-000000000002','WP13 Synthetic Org B');
INSERT INTO public.memberships(org_id,user_id,role) VALUES
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','admin'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','billing'),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','specialist'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','admin');
INSERT INTO public.provider_groups(id,org_id,name,tin,npi_type2) VALUES
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Synthetic Group A','001234567','1234567893'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Synthetic Group B','009999999','1234567893');
INSERT INTO public.providers(id,org_id,first_name,last_name,npi,date_of_birth,ssn_last4,status) VALUES
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Synthetic','Provider A','1234567893','1990-01-01','0001','active'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Synthetic','Provider B','1234567893',NULL,NULL,'active');
INSERT INTO public.facilities(id,org_id,group_id,name,state,street,city,zip,phone) VALUES
 ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Synthetic Secondary Site','NC','1 Synthetic Way','Raleigh','00123-4567','9195550100'),
 ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','Synthetic Primary Site','NC','2 Synthetic Way','Durham','00123-4567','9195550101');
INSERT INTO public.provider_facility_assignments(org_id,provider_id,facility_id,is_primary,start_date) VALUES
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',false,'2020-01-01'),
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002',true,'2020-01-01');
INSERT INTO public.provider_group_assignments(org_id,provider_id,group_id,is_primary,start_date,end_date) VALUES
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',false,'2020-01-01',NULL),
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002',true,'2020-01-01',NULL);
INSERT INTO public.state_licenses(org_id,provider_id,state,license_number,status,issue_date,expiration_date) VALUES
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','NC','SYNTHETIC-ACTIVE','active','2020-01-01','2090-01-01'),
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','NC','SYNTHETIC-INACTIVE','inactive','2020-01-01','2099-01-01');

SELECT pg_temp.wp13_mark('new_org_gets_three_draft_templates',(
 SELECT count(*)=3 AND bool_and(NOT is_verified AND verification_status='draft_pending_payer_spec')
 FROM roster_templates WHERE org_id='10000000-0000-0000-0000-000000000001'));
SELECT pg_temp.wp13_mark('default_dml_grants_revoked',NOT EXISTS(
 SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public'
 AND table_name IN ('roster_templates','roster_mappings','roster_export_snapshots','roster_export_overrides')
 AND grantee IN ('anon','authenticated','service_role') AND privilege_type<>'SELECT'));
SELECT pg_temp.wp13_mark('rpc_revoked_from_anon_and_authenticated',NOT EXISTS(
 SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('roster_engine_read_source','roster_engine_save_mapping','roster_engine_record_override','roster_engine_commit_export')
 AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))));
SELECT pg_temp.wp13_mark('service_role_has_rpc_execute',
 has_function_privilege('service_role','public.roster_engine_read_source(uuid,uuid,uuid)','EXECUTE')
 AND has_function_privilege('service_role','public.roster_engine_commit_export(uuid,uuid,uuid,integer,uuid,text,uuid,text,text,integer,text,jsonb,jsonb)','EXECUTE'));

SET ROLE service_role;
SELECT (public.roster_engine_save_mapping(
 '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',NULL,NULL,
 (SELECT id FROM roster_templates WHERE org_id='10000000-0000-0000-0000-000000000001' AND slug='bcbs-nc-roster'),
 'Synthetic selected-secondary-site mapping','provider_location_tin',
 ARRAY['30000000-0000-0000-0000-000000000001']::uuid[],
 ARRAY['50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002']::uuid[],
 ARRAY['40000000-0000-0000-0000-000000000001']::uuid[],
 '[{"columnKey":"first_name","sourceField":"provider.first_name","transform":null},{"columnKey":"last_name","sourceField":"provider.last_name","transform":null},{"columnKey":"npi","sourceField":"provider.npi","transform":"npi_check"},{"columnKey":"address_1","sourceField":"facility.street","transform":null},{"columnKey":"city","sourceField":"facility.city","transform":null},{"columnKey":"state","sourceField":"facility.state","transform":"uppercase"},{"columnKey":"zip_plus_4","sourceField":"facility.zip","transform":null},{"columnKey":"tin","sourceField":"group.tin","transform":null},{"columnKey":"phone","sourceField":"facility.phone","transform":"phone_strip"}]'::jsonb
)).id AS mapping_id \gset
RESET ROLE;
SET app.wp13_mapping_id=:'mapping_id';
SELECT public.roster_engine_read_source('10000000-0000-0000-0000-000000000001',:'mapping_id','20000000-0000-0000-0000-000000000001')->>'input_fingerprint' AS input_fingerprint \gset
SET app.wp13_fingerprint=:'input_fingerprint';
SELECT pg_temp.wp13_mark('source_uses_selected_secondary_location_and_group',(
 SELECT jsonb_array_length(data#>'{source,rows}')=1
 AND data#>>'{source,rows,0,facility,id}'='50000000-0000-0000-0000-000000000001'
 AND data#>>'{source,rows,0,group,id}'='40000000-0000-0000-0000-000000000001'
 FROM (SELECT public.roster_engine_read_source('10000000-0000-0000-0000-000000000001',:'mapping_id','20000000-0000-0000-0000-000000000001') data) q));
SELECT pg_temp.wp13_mark('source_selects_active_state_license',(
 SELECT data#>>'{source,rows,0,licenses,0,license_number}'='SYNTHETIC-ACTIVE'
 FROM (SELECT public.roster_engine_read_source('10000000-0000-0000-0000-000000000001',:'mapping_id','20000000-0000-0000-0000-000000000001') data) q));
SELECT pg_temp.wp13_mark('unmapped_dob_and_ssn_are_redacted',(
 SELECT data#>>'{source,rows,0,provider,date_of_birth}' IS NULL AND data#>>'{source,rows,0,provider,ssn_last4}' IS NULL
 FROM (SELECT public.roster_engine_read_source('10000000-0000-0000-0000-000000000001',:'mapping_id','20000000-0000-0000-0000-000000000001') data) q));
SELECT pg_temp.wp13_mark('forged_nonmember_actor_rejected',pg_temp.wp13_expect_state('42501',
 $$SELECT public.roster_engine_read_source('10000000-0000-0000-0000-000000000001',current_setting('app.wp13_mapping_id')::uuid,'20000000-0000-0000-0000-000000000005')$$));
SELECT pg_temp.wp13_mark('null_actor_rejected',pg_temp.wp13_expect_state('42501',
 $$SELECT public.roster_engine_read_source('10000000-0000-0000-0000-000000000001',current_setting('app.wp13_mapping_id')::uuid,NULL)$$));
SELECT pg_temp.wp13_mark('cross_org_source_id_rejected',pg_temp.wp13_expect_state('42501',
 $$SELECT public.roster_engine_save_mapping('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',NULL,NULL,(SELECT id FROM roster_templates WHERE org_id='10000000-0000-0000-0000-000000000001' AND slug='bcbs-nc-roster'),'Cross tenant','provider_location',ARRAY['30000000-0000-0000-0000-000000000002']::uuid[],ARRAY['50000000-0000-0000-0000-000000000001']::uuid[],'{}'::uuid[],'[]'::jsonb)$$));

SET ROLE authenticated;
SET request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
SELECT pg_temp.wp13_mark('billing_can_read_own_mapping',(SELECT count(*)=1 FROM roster_mappings WHERE id=:'mapping_id'));
SELECT pg_temp.wp13_mark('billing_cannot_insert_override',pg_temp.wp13_expect_state('42501',
 $$INSERT INTO roster_export_overrides(org_id,mapping_id,mapping_revision,input_fingerprint,row_key,rule_code,field_key,reason,created_by)
 VALUES ('10000000-0000-0000-0000-000000000001',current_setting('app.wp13_mapping_id')::uuid,1,current_setting('app.wp13_fingerprint'),'row','rule','field','Synthetic reason has at least twenty characters.','20000000-0000-0000-0000-000000000002')$$));
SELECT pg_temp.wp13_mark('billing_cannot_execute_save_rpc',pg_temp.wp13_expect_state('42501',
 $$SELECT public.roster_engine_save_mapping('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',NULL,NULL,(SELECT id FROM roster_templates WHERE org_id='10000000-0000-0000-0000-000000000001' AND slug='bcbs-nc-roster'),'Billing attempt','provider_location',ARRAY[]::uuid[],ARRAY[]::uuid[],ARRAY[]::uuid[],'[]'::jsonb)$$));
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub='20000000-0000-0000-0000-000000000003';
SELECT pg_temp.wp13_mark('rls_hides_foreign_mapping',(SELECT count(*)=0 FROM roster_mappings WHERE id=:'mapping_id'));
RESET ROLE;

SET ROLE service_role;
SELECT (public.roster_engine_record_override(
 '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',:'mapping_id',1,:'input_fingerprint',
 '30000000-0000-0000-0000-000000000001:50000000-0000-0000-0000-000000000001:40000000-0000-0000-0000-000000000001',
 'required_value_missing','synthetic_column','Synthetic reviewed exception reason exceeds twenty characters.'
)).id AS override_id \gset
SELECT pg_temp.wp13_mark('short_override_reason_rejected',pg_temp.wp13_expect_state('22023',
 $$SELECT public.roster_engine_record_override('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',current_setting('app.wp13_mapping_id')::uuid,1,current_setting('app.wp13_fingerprint'),'row','rule','field','too short')$$));
RESET ROLE;
SET app.wp13_override_id=:'override_id';
UPDATE provider_group_assignments SET end_date='2021-01-01'
 WHERE provider_id='30000000-0000-0000-0000-000000000001' AND group_id='40000000-0000-0000-0000-000000000001';
SET ROLE service_role;
SELECT pg_temp.wp13_mark('ended_group_binding_removed',(
 SELECT data#>>'{source,rows,0,group,id}' IS NULL
 FROM (SELECT public.roster_engine_read_source('10000000-0000-0000-0000-000000000001',:'mapping_id','20000000-0000-0000-0000-000000000001') data) q));
SELECT pg_temp.wp13_mark('ended_group_changes_fingerprint',(
 SELECT data->>'input_fingerprint'<>current_setting('app.wp13_fingerprint')
 FROM (SELECT public.roster_engine_read_source('10000000-0000-0000-0000-000000000001',:'mapping_id','20000000-0000-0000-0000-000000000001') data) q));
SELECT pg_temp.wp13_mark('ended_group_rejects_old_override',pg_temp.wp13_expect_state('40001',
 $$SELECT public.roster_engine_record_override('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',current_setting('app.wp13_mapping_id')::uuid,1,current_setting('app.wp13_fingerprint'),'row','rule','field','This stale reason exceeds twenty characters.')$$));
RESET ROLE;
UPDATE provider_group_assignments SET end_date=NULL
 WHERE provider_id='30000000-0000-0000-0000-000000000001' AND group_id='40000000-0000-0000-0000-000000000001';
SET ROLE service_role;
SELECT public.roster_engine_read_source('10000000-0000-0000-0000-000000000001',:'mapping_id','20000000-0000-0000-0000-000000000001')->>'input_fingerprint' AS input_fingerprint \gset
SET app.wp13_fingerprint=:'input_fingerprint';
SELECT public.roster_engine_commit_export(
 '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',:'mapping_id',1,
 (SELECT template_id FROM roster_mappings WHERE id=:'mapping_id'),:'input_fingerprint',
 '60000000-0000-0000-0000-000000000001','csv','synthetic.csv',1,'aGVsbG8=',
 '{"synthetic":true}'::jsonb,'[]'::jsonb)->>'id' AS snapshot_id \gset
SELECT pg_temp.wp13_mark('checksum_matches_exact_bytes',(
 SELECT sha256=encode(pg_catalog.sha256(file_bytes),'hex') AND file_bytes=convert_to('hello','UTF8')
 FROM roster_export_snapshots WHERE id=:'snapshot_id'));
SELECT pg_temp.wp13_mark('history_freezes_names_and_draft_status',(
 SELECT mapping_name='Synthetic selected-secondary-site mapping' AND template_name='BCBS NC Roster'
 AND NOT template_is_verified AND template_verification_status='draft_pending_payer_spec'
 FROM roster_export_snapshots WHERE id=:'snapshot_id'));
SELECT pg_temp.wp13_mark('one_snapshot_and_atomic_audit_records',
 (SELECT count(*)=1 FROM roster_export_snapshots WHERE id=:'snapshot_id')
 AND (SELECT count(*)=2 FROM audit_log WHERE entity_type IN ('roster_export_snapshot','roster_export_override'))
 AND NOT EXISTS (SELECT 1 FROM audit_log WHERE entity_type='roster_export_override' AND after ? 'reason'));
SET ROLE authenticated;
SET request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
SELECT pg_temp.wp13_mark('billing_can_read_export_history',
 (SELECT count(*)=1 FROM roster_export_snapshots WHERE id=:'snapshot_id'));
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.wp13_mark('same_idempotency_returns_same_snapshot',(
 roster_engine_commit_export(
  '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',:'mapping_id',1,
  (SELECT template_id FROM roster_mappings WHERE id=:'mapping_id'),:'input_fingerprint',
  '60000000-0000-0000-0000-000000000001','csv','synthetic.csv',1,'aGVsbG8=',
  '{"synthetic":true}'::jsonb,'[]'::jsonb)->>'id'=:'snapshot_id'));
SELECT pg_temp.wp13_mark('idempotency_rejects_other_actor',pg_temp.wp13_expect_state('23505',
 $$SELECT roster_engine_commit_export('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004',current_setting('app.wp13_mapping_id')::uuid,1,(SELECT template_id FROM roster_mappings WHERE id=current_setting('app.wp13_mapping_id')::uuid),current_setting('app.wp13_fingerprint'),'60000000-0000-0000-0000-000000000001','csv','synthetic.csv',1,'aGVsbG8=','{"synthetic":true}'::jsonb,'[]'::jsonb)$$));
RESET ROLE;
SET app.wp13_snapshot_id=:'snapshot_id';

CREATE FUNCTION public.wp13_fail_export_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.entity_type='roster_export_snapshot' THEN RAISE EXCEPTION 'synthetic audit failure' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER wp13_fail_export_audit BEFORE INSERT ON public.audit_log
 FOR EACH ROW EXECUTE FUNCTION public.wp13_fail_export_audit();
SET ROLE service_role;
SELECT pg_temp.wp13_mark('audit_failure_rolls_back_snapshot',pg_temp.wp13_expect_state('23514',
 $$SELECT roster_engine_commit_export('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',current_setting('app.wp13_mapping_id')::uuid,1,(SELECT template_id FROM roster_mappings WHERE id=current_setting('app.wp13_mapping_id')::uuid),current_setting('app.wp13_fingerprint'),'60000000-0000-0000-0000-000000000002','csv','rollback.csv',1,'aGVsbG8=','{"synthetic":true}'::jsonb,'[]'::jsonb)$$));
RESET ROLE;
DROP TRIGGER wp13_fail_export_audit ON public.audit_log;
DROP FUNCTION public.wp13_fail_export_audit();
SELECT pg_temp.wp13_mark('audit_failure_left_no_partial_snapshot',NOT EXISTS(
 SELECT 1 FROM roster_export_snapshots WHERE idempotency_key='60000000-0000-0000-0000-000000000002'));
SELECT pg_temp.wp13_mark('snapshot_update_rejected',pg_temp.wp13_expect_state('55000',
 $$UPDATE roster_export_snapshots SET file_name='tampered.csv' WHERE id=current_setting('app.wp13_snapshot_id')::uuid$$));
SELECT pg_temp.wp13_mark('snapshot_delete_rejected',pg_temp.wp13_expect_state('55000',
 $$DELETE FROM roster_export_snapshots WHERE id=current_setting('app.wp13_snapshot_id')::uuid$$));
SELECT pg_temp.wp13_mark('snapshot_truncate_rejected',pg_temp.wp13_expect_state('55000',$$TRUNCATE roster_export_snapshots$$));
SELECT pg_temp.wp13_mark('override_update_rejected',pg_temp.wp13_expect_state('55000',
 $$UPDATE roster_export_overrides SET reason='Tampered reason text has twenty characters' WHERE id=current_setting('app.wp13_override_id')::uuid$$));
SELECT pg_temp.wp13_mark('override_delete_rejected',pg_temp.wp13_expect_state('55000',
 $$DELETE FROM roster_export_overrides WHERE id=current_setting('app.wp13_override_id')::uuid$$));
SELECT pg_temp.wp13_mark('override_truncate_rejected',pg_temp.wp13_expect_state('55000',$$TRUNCATE roster_export_overrides$$));

ALTER TABLE public.providers DROP CONSTRAINT providers_ssn_last4_check;
UPDATE public.providers SET ssn_last4='123456789' WHERE id='30000000-0000-0000-0000-000000000001';
SET ROLE service_role;
SELECT (public.roster_engine_save_mapping(
 '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',NULL,NULL,
 (SELECT id FROM roster_templates WHERE org_id='10000000-0000-0000-0000-000000000001' AND slug='bcbs-nc-roster'),
 'Synthetic mapped last-four check','provider',
 ARRAY['30000000-0000-0000-0000-000000000001']::uuid[],'{}'::uuid[],'{}'::uuid[],
 '[{"columnKey":"last_name","sourceField":"provider.ssn_last4","transform":null}]'::jsonb
)).id AS ssn_mapping_id \gset
SELECT pg_temp.wp13_mark('malformed_last4_redacted_and_signalled',(
 SELECT data#>>'{source,rows,0,provider,ssn_last4}' IS NULL AND data#>>'{source,rows,0,provider,ssn_last4_valid}'='false'
 FROM (SELECT public.roster_engine_read_source('10000000-0000-0000-0000-000000000001',:'ssn_mapping_id','20000000-0000-0000-0000-000000000001') data) q));
RESET ROLE;

SELECT CASE WHEN passed THEN 'WP13|PASS|' ELSE 'WP13|FAIL|' END || name FROM wp13_results ORDER BY name;
SELECT 'WP13|COUNT|' || count(*) FROM wp13_results;
