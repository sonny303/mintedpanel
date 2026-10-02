-- MINT-58 typed case fill and human submission transaction regression packet.
-- Run after all migrations in the disposable PostgreSQL CI database. All
-- identities are synthetic, grants/policies are transaction-local, and every
-- fixture and test-only change is rolled back.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE m58_results (name text PRIMARY KEY, passed boolean NOT NULL);
CREATE TEMP TABLE m58_last (result jsonb);
GRANT ALL ON m58_results, m58_last TO service_role;
CREATE FUNCTION pg_temp.m58_mark(p_name text, p_passed boolean) RETURNS void
LANGUAGE sql AS $$ INSERT INTO pg_temp.m58_results VALUES (p_name, COALESCE(p_passed, false)) $$;
CREATE FUNCTION pg_temp.m58_expect_state(p_state text, p_statement text) RETURNS boolean
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
CREATE FUNCTION pg_temp.m58_tuple(
  p_case_id uuid,
  p_task_id uuid,
  p_step_id uuid,
  p_launch_receipt_id uuid,
  p_context_version integer,
  p_provider_id uuid,
  p_template_id uuid
) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'launchReceiptId', p_launch_receipt_id,
    'orgId', '18000000-0000-4000-a000-000000000058'::uuid,
    'ownerKind', 'case',
    'ownerId', p_case_id,
    'contextVersion', p_context_version,
    'sopTemplateId', p_template_id,
    'sopVersion', 1,
    'portalId', '38000000-0000-4000-a000-000000000058'::uuid,
    'portalKey', 'm58_enrollment',
    'mappingGeneration', 1,
    'effectiveMappingFingerprint', 'sha256:' || repeat('a', 64),
    'providerId', p_provider_id,
    'facilityId', NULL,
    'stepIdentity', p_case_id::text || ':' || p_task_id::text || ':' || p_template_id::text || ':1:' || p_step_id::text,
    'taskId', p_task_id,
    'stepId', p_step_id
  );
$$;
CREATE FUNCTION pg_temp.m58_call(
  p_actor_id uuid,
  p_case_id uuid,
  p_touch_id uuid,
  p_fill_id uuid,
  p_work_context jsonb,
  p_payload jsonb DEFAULT '{"note":null,"payerReferenceId":null,"wipNote":null,"pdfFilename":null}'::jsonb
) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.record_typed_enrollment_submission(
    '18000000-0000-4000-a000-000000000058'::uuid,
    p_actor_id,
    p_case_id,
    p_touch_id,
    p_fill_id,
    p_work_context,
    p_payload
  );
$$;
GRANT EXECUTE ON FUNCTION pg_temp.m58_mark(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.m58_expect_state(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.m58_tuple(uuid, uuid, uuid, uuid, integer, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.m58_call(uuid, uuid, uuid, uuid, jsonb, jsonb) TO service_role;

-- Synthetic tenant and owner fixtures. Case 1 starts not_started to exercise
-- the server-stamped M51 version increment. Cases 2/3 start in_progress.
INSERT INTO auth.users(id, email) VALUES
  ('39000000-0000-4000-a000-000000000058', 'm58-writer@example.invalid'),
  ('39000000-0000-4000-a000-000000000059', 'm58-outsider@example.invalid');
INSERT INTO public.profiles(id, full_name, email) VALUES
  ('39000000-0000-4000-a000-000000000058', 'MINT-58 Writer', 'm58-writer@example.invalid'),
  ('39000000-0000-4000-a000-000000000059', 'MINT-58 Outsider', 'm58-outsider@example.invalid');
INSERT INTO public.organizations(id, name) VALUES
  ('18000000-0000-4000-a000-000000000058', 'MINT-58 Synthetic Org'),
  ('18000000-0000-4000-a000-000000000059', 'MINT-58 Other Org');
INSERT INTO public.memberships(org_id, user_id, role) VALUES
  ('18000000-0000-4000-a000-000000000058', '39000000-0000-4000-a000-000000000058', 'specialist'),
  ('18000000-0000-4000-a000-000000000059', '39000000-0000-4000-a000-000000000059', 'specialist');
INSERT INTO public.payers(id, org_id, name) VALUES
  ('28000000-0000-4000-a000-000000000058', '18000000-0000-4000-a000-000000000058', 'MINT-58 Synthetic Payer'),
  ('28000000-0000-4000-a000-000000000059', '18000000-0000-4000-a000-000000000059', 'MINT-58 Other Payer');
INSERT INTO public.provider_groups(id, org_id, name) VALUES
  ('49000000-0000-4000-a000-000000000058', '18000000-0000-4000-a000-000000000058', 'MINT-58 Synthetic Group'),
  ('49000000-0000-4000-a000-000000000062', '18000000-0000-4000-a000-000000000058', 'MINT-58 Synthetic Group 2'),
  ('49000000-0000-4000-a000-000000000063', '18000000-0000-4000-a000-000000000058', 'MINT-58 Synthetic Group 3'),
  ('49000000-0000-4000-a000-000000000064', '18000000-0000-4000-a000-000000000058', 'MINT-58 Synthetic Group 4'),
  ('49000000-0000-4000-a000-000000000059', '18000000-0000-4000-a000-000000000059', 'MINT-58 Other Group');
INSERT INTO public.providers(id, org_id, group_id, first_name, last_name, status) VALUES
  ('39000000-0000-4000-a000-000000000060', '18000000-0000-4000-a000-000000000058', '49000000-0000-4000-a000-000000000058', 'Synthetic', 'Writer', 'active'),
  ('39000000-0000-4000-a000-000000000061', '18000000-0000-4000-a000-000000000059', '49000000-0000-4000-a000-000000000059', 'Other', 'Writer', 'active');
INSERT INTO public.provider_group_assignments(org_id, provider_id, group_id, is_primary) VALUES
  ('18000000-0000-4000-a000-000000000058', '39000000-0000-4000-a000-000000000060', '49000000-0000-4000-a000-000000000058', true),
  ('18000000-0000-4000-a000-000000000058', '39000000-0000-4000-a000-000000000060', '49000000-0000-4000-a000-000000000062', false),
  ('18000000-0000-4000-a000-000000000058', '39000000-0000-4000-a000-000000000060', '49000000-0000-4000-a000-000000000063', false),
  ('18000000-0000-4000-a000-000000000058', '39000000-0000-4000-a000-000000000060', '49000000-0000-4000-a000-000000000064', false),
  ('18000000-0000-4000-a000-000000000059', '39000000-0000-4000-a000-000000000061', '49000000-0000-4000-a000-000000000059', true);
INSERT INTO public.sop_templates(
  id, org_id, name, payer_id, state, states, task_definitions,
  archived, current_version, required_profile_attributes, case_type
) VALUES (
  '69000000-0000-4000-a000-000000000058',
  '18000000-0000-4000-a000-000000000058', 'MINT-58 Enrollment SOP',
  '28000000-0000-4000-a000-000000000058', 'CO', ARRAY['CO']::text[], '[]'::jsonb,
  false, 1, '[]'::jsonb, 'enrollment'
);
INSERT INTO public.credential_cases(id, org_id, provider_id, group_id, payer_id, state, case_type, case_status) VALUES
  ('49000000-0000-4000-a000-000000000060', '18000000-0000-4000-a000-000000000058', '39000000-0000-4000-a000-000000000060', '49000000-0000-4000-a000-000000000058', '28000000-0000-4000-a000-000000000058', 'CO', 'enrollment', 'not_started'),
  ('49000000-0000-4000-a000-000000000062', '18000000-0000-4000-a000-000000000058', '39000000-0000-4000-a000-000000000060', '49000000-0000-4000-a000-000000000062', '28000000-0000-4000-a000-000000000058', 'CO', 'enrollment', 'in_progress'),
  ('49000000-0000-4000-a000-000000000063', '18000000-0000-4000-a000-000000000058', '39000000-0000-4000-a000-000000000060', '49000000-0000-4000-a000-000000000063', '28000000-0000-4000-a000-000000000058', 'CO', 'enrollment', 'in_progress'),
  ('49000000-0000-4000-a000-000000000064', '18000000-0000-4000-a000-000000000058', '39000000-0000-4000-a000-000000000060', '49000000-0000-4000-a000-000000000064', '28000000-0000-4000-a000-000000000058', 'CO', 'enrollment', 'not_started'),
  ('49000000-0000-4000-a000-000000000061', '18000000-0000-4000-a000-000000000059', '39000000-0000-4000-a000-000000000061', '49000000-0000-4000-a000-000000000059', '28000000-0000-4000-a000-000000000059', 'CO', 'enrollment', 'in_progress');
INSERT INTO public.tasks(
  id, org_id, case_id, provider_id, title, sop_content, status, sort_order,
  sop_template_id, sop_version, execution_type
) VALUES
  ('99000000-0000-4000-a000-000000000058', '18000000-0000-4000-a000-000000000058', '49000000-0000-4000-a000-000000000060', '39000000-0000-4000-a000-000000000060', 'Enrollment application',
   '[{"id":"89000000-0000-4000-a000-000000000058","label":"First form","stepType":"online_form","portalKey":"m58_enrollment","order":0,"isCompleted":false},{"id":"89000000-0000-4000-a000-000000000059","label":"Second form","stepType":"online_form","portalKey":"m58_enrollment","order":1,"isCompleted":false},{"id":"89000000-0000-4000-a000-000000000060","label":"Third form","stepType":"online_form","portalKey":"m58_enrollment","order":2,"isCompleted":false}]'::jsonb,
   'not_started', 1, '69000000-0000-4000-a000-000000000058', 1, 'extension_fill'),
  ('99000000-0000-4000-a000-000000000062', '18000000-0000-4000-a000-000000000058', '49000000-0000-4000-a000-000000000062', '39000000-0000-4000-a000-000000000060', 'In-progress success',
   '[{"id":"89000000-0000-4000-a000-000000000062","label":"One form","stepType":"online_form","portalKey":"m58_enrollment","order":0,"isCompleted":false}]'::jsonb,
   'not_started', 1, '69000000-0000-4000-a000-000000000058', 1, 'extension_fill'),
  ('99000000-0000-4000-a000-000000000063', '18000000-0000-4000-a000-000000000058', '49000000-0000-4000-a000-000000000063', '39000000-0000-4000-a000-000000000060', 'In-progress stale',
   '[{"id":"89000000-0000-4000-a000-000000000063","label":"One form","stepType":"online_form","portalKey":"m58_enrollment","order":0,"isCompleted":false}]'::jsonb,
   'not_started', 1, '69000000-0000-4000-a000-000000000058', 1, 'extension_fill'),
  ('99000000-0000-4000-a000-000000000064', '18000000-0000-4000-a000-000000000058', '49000000-0000-4000-a000-000000000064', '39000000-0000-4000-a000-000000000060', 'Auto-start then owner edit',
   '[{"id":"89000000-0000-4000-a000-000000000064","label":"One form","stepType":"online_form","portalKey":"m58_enrollment","order":0,"isCompleted":false}]'::jsonb,
   'not_started', 1, '69000000-0000-4000-a000-000000000058', 1, 'extension_fill');
INSERT INTO public.portals(
  id, org_id, portal_key, name, payer_id, form_url, case_type,
  requires_explicit_selection, is_verified, last_verified_at, proven_at
) VALUES (
  '38000000-0000-4000-a000-000000000058',
  '18000000-0000-4000-a000-000000000058', 'm58_enrollment', 'MINT-58 portal',
  '28000000-0000-4000-a000-000000000058', 'https://m58.example.invalid/form',
  'enrollment', true, true, now(), now()
);

-- A real M49 Contract V2 receipt exercises the Contract-owner branch of the
-- M58 guard. Its stepIdentity is meaningful to Contract Work despite having
-- no case_task_id or case_step_id.
INSERT INTO public.contracts(id, org_id, group_id, payer_id, state) VALUES (
  '29000000-0000-4000-a000-000000000058',
  '18000000-0000-4000-a000-000000000058',
  '49000000-0000-4000-a000-000000000058',
  '28000000-0000-4000-a000-000000000058', 'NY'
);
INSERT INTO public.portals(
  id, org_id, portal_key, name, payer_id, form_url, case_type,
  requires_explicit_selection, is_verified, last_verified_at, proven_at
) VALUES (
  '38000000-0000-4000-a000-000000000059',
  '18000000-0000-4000-a000-000000000058', 'm58_contract', 'MINT-58 Contract portal',
  '28000000-0000-4000-a000-000000000058', 'https://m58.example.invalid/contract',
  'contract', true, true, now(), now()
);
INSERT INTO public.sop_templates(
  id, org_id, name, payer_id, state, states, group_id, task_definitions,
  archived, current_version, required_profile_attributes, case_type
) VALUES (
  '69000000-0000-4000-a000-000000000059',
  '18000000-0000-4000-a000-000000000058', 'MINT-58 Contract SOP',
  '28000000-0000-4000-a000-000000000058', 'NY', ARRAY['NY']::text[],
  '49000000-0000-4000-a000-000000000058',
  '[{"title":"Contract application","steps":[{"label":"Contract form","stepType":"online_form","portalKey":"m58_contract"}]}]'::jsonb,
  false, 1, '[]'::jsonb, 'contract'
);
INSERT INTO public.contract_sop_assignments(
  id, org_id, contract_id, sop_template_id, sop_version, context_version,
  created_by, updated_by
) VALUES (
  '79000000-0000-4000-a000-000000000071',
  '18000000-0000-4000-a000-000000000058',
  '29000000-0000-4000-a000-000000000058',
  '69000000-0000-4000-a000-000000000059', 1, 1,
  '39000000-0000-4000-a000-000000000058',
  '39000000-0000-4000-a000-000000000058'
);

-- Historical dry-run/ad-hoc fills remain outside typed case Work. They can be
-- recorded for metrics, but do not acquire an M58 receipt or auto-start a case.
INSERT INTO public.fill_sessions(
  id, org_id, case_id, provider_id, portal_key, fill_mode, fields_filled,
  fields_skipped, is_test, event_schema_version, performed_by
) VALUES (
  '79000000-0000-4000-a000-000000000069', '18000000-0000-4000-a000-000000000058',
  '49000000-0000-4000-a000-000000000060', '39000000-0000-4000-a000-000000000060',
  'm58_enrollment', 'web', 0, '[]'::jsonb, true, 1,
  '39000000-0000-4000-a000-000000000058'
);
SELECT pg_temp.m58_mark('test_fill_stays_legacy_and_does_not_auto_start_case',
  (SELECT is_test AND case_task_id IS NULL AND case_step_id IS NULL
          AND step_identity IS NULL AND NOT did_auto_start_case
     FROM public.fill_sessions WHERE id = '79000000-0000-4000-a000-000000000069')
  AND (SELECT case_status = 'not_started' AND context_version = 1
         FROM public.credential_cases WHERE id = '49000000-0000-4000-a000-000000000060'));
INSERT INTO public.touches(
  id, org_id, case_id, entry_type, touch_date, touch_type, outcome, notes, coordinator_id, source
) VALUES (
  'aa000000-0000-4000-a000-000000000059',
  '18000000-0000-4000-a000-000000000059',
  '49000000-0000-4000-a000-000000000061',
  'touchpoint', CURRENT_DATE, 'portal', 'submitted', 'other tenant idempotency row',
  '39000000-0000-4000-a000-000000000059', 'extension'
);

-- A service_role in plain CI PostgreSQL does not have Supabase's hosted
-- BYPASSRLS attribute. These transaction-local policies model only the
-- authenticated service boundary needed by this RPC; no role attribute or
-- production grant is changed. The broad touch SELECT models the hosted
-- service role's trusted idempotency lookup and lets us assert non-disclosure.
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO service_role;
GRANT SELECT ON public.memberships, public.profiles, public.payers, public.portals,
  public.case_facilities, public.fill_sessions, public.touches, public.tasks,
  public.credential_cases TO service_role;
GRANT INSERT ON public.fill_sessions, public.touches, public.audit_log TO service_role;
GRANT UPDATE ON public.tasks, public.credential_cases TO service_role;
GRANT UPDATE ON public.portals TO service_role;
CREATE POLICY m58_test_service_membership_select ON public.memberships
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000058');
CREATE POLICY m58_test_service_profile_select ON public.profiles
  FOR SELECT TO service_role USING (id = '39000000-0000-4000-a000-000000000058');
CREATE POLICY m58_test_service_payer_select ON public.payers
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000058');
CREATE POLICY m58_test_service_portal_select ON public.portals
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000058');
CREATE POLICY m58_test_service_portal_update ON public.portals
  FOR UPDATE TO service_role USING (org_id = '18000000-0000-4000-a000-000000000058')
  WITH CHECK (org_id = '18000000-0000-4000-a000-000000000058');
CREATE POLICY m58_test_service_facility_select ON public.case_facilities
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000058');
CREATE POLICY m58_test_service_fill_select ON public.fill_sessions
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000058');
CREATE POLICY m58_test_service_fill_insert ON public.fill_sessions
  FOR INSERT TO service_role WITH CHECK (org_id = '18000000-0000-4000-a000-000000000058');
CREATE POLICY m58_test_service_touch_select ON public.touches
  FOR SELECT TO service_role USING (true);
CREATE POLICY m58_test_service_touch_insert ON public.touches
  FOR INSERT TO service_role WITH CHECK (org_id = '18000000-0000-4000-a000-000000000058');
CREATE POLICY m58_test_service_task_select ON public.tasks
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000058');
CREATE POLICY m58_test_service_task_update ON public.tasks
  FOR UPDATE TO service_role USING (org_id = '18000000-0000-4000-a000-000000000058')
  WITH CHECK (org_id = '18000000-0000-4000-a000-000000000058');
CREATE POLICY m58_test_service_case_select ON public.credential_cases
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000058');
CREATE POLICY m58_test_service_case_update ON public.credential_cases
  FOR UPDATE TO service_role USING (org_id = '18000000-0000-4000-a000-000000000058')
  WITH CHECK (org_id = '18000000-0000-4000-a000-000000000058');
CREATE POLICY m58_test_service_audit_insert ON public.audit_log
  FOR INSERT TO service_role WITH CHECK (org_id = '18000000-0000-4000-a000-000000000058');

-- The M51 typed-fill trigger verifies auth.jwt()->>'role' even during these
-- privileged fixture inserts. Keep the database owner for seed privileges,
-- but establish the same service-role actor claims used by the later RPC calls.
SELECT set_config('request.jwt.claim.sub', '39000000-0000-4000-a000-000000000058', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-a000-000000000058","role":"service_role"}',
  true
);

-- Seed exact immutable V2 receipts. The first receipt is inserted against a
-- not_started case and must receive the unforgeable auto-start stamp.
INSERT INTO public.fill_sessions(
  id, org_id, case_id, case_task_id, case_step_id, step_identity,
  sop_template_id, sop_version, context_version, launch_receipt_id,
  mapping_generation, effective_mapping_fingerprint, portal_id, provider_id,
  portal_key, fill_mode, fields_filled, fields_skipped, is_test,
  event_schema_version, fields_attempted, fields_verified, fields_rejected,
  field_outcomes, performed_by, did_auto_start_case
) VALUES (
  '79000000-0000-4000-a000-000000000058', '18000000-0000-4000-a000-000000000058',
  '49000000-0000-4000-a000-000000000060', '99000000-0000-4000-a000-000000000058',
  '89000000-0000-4000-a000-000000000058',
  '49000000-0000-4000-a000-000000000060:99000000-0000-4000-a000-000000000058:69000000-0000-4000-a000-000000000058:1:89000000-0000-4000-a000-000000000058',
  '69000000-0000-4000-a000-000000000058', 1, 1, '79000000-0000-4000-a000-000000000058',
  1, 'sha256:' || repeat('a', 64), '38000000-0000-4000-a000-000000000058',
  '39000000-0000-4000-a000-000000000060', 'm58_enrollment', 'web', 0, '[]'::jsonb,
  false, 2, 0, 0, 0, '[]'::jsonb, '39000000-0000-4000-a000-000000000058', false
);
SELECT pg_temp.m58_mark('not_started_real_fill_is_server_stamped_as_auto_start',
  (SELECT did_auto_start_case AND context_version = 1
      FROM public.fill_sessions WHERE id = '79000000-0000-4000-a000-000000000058')
  AND (SELECT case_status = 'in_progress' AND context_version = 2
      FROM public.credential_cases WHERE id = '49000000-0000-4000-a000-000000000060'));
-- A bad exact step identity is rejected by the receipt trigger before insert.
SELECT pg_temp.m58_mark('typed_fill_rejects_wrong_step_identity', pg_temp.m58_expect_state(
  '40001',
  $$INSERT INTO public.fill_sessions(
      id, org_id, case_id, case_task_id, case_step_id, step_identity,
      sop_template_id, sop_version, context_version, launch_receipt_id,
      mapping_generation, effective_mapping_fingerprint, portal_id, provider_id,
      portal_key, fill_mode, fields_filled, fields_skipped, is_test,
      event_schema_version, fields_attempted, fields_verified, fields_rejected,
      field_outcomes, performed_by
    ) VALUES (
      '79000000-0000-4000-a000-000000000064', '18000000-0000-4000-a000-000000000058',
      '49000000-0000-4000-a000-000000000060', '99000000-0000-4000-a000-000000000058',
      '89000000-0000-4000-a000-000000000058', 'forged-step-identity',
      '69000000-0000-4000-a000-000000000058', 1, 2, '79000000-0000-4000-a000-000000000064',
      1, 'sha256:' || repeat('a', 64), '38000000-0000-4000-a000-000000000058',
      '39000000-0000-4000-a000-000000000060', 'm58_enrollment', 'web', 0, '[]'::jsonb,
      false, 2, 0, 0, 0, '[]'::jsonb, '39000000-0000-4000-a000-000000000058'
    )$$
));

-- In-progress fill receipt and stale-owner receipt cover both the ordinary
-- same-version submission path and rejection after any unrelated owner edit.
INSERT INTO public.fill_sessions(
  id, org_id, case_id, case_task_id, case_step_id, step_identity,
  sop_template_id, sop_version, context_version, launch_receipt_id,
  mapping_generation, effective_mapping_fingerprint, portal_id, provider_id,
  portal_key, fill_mode, fields_filled, fields_skipped, is_test,
  event_schema_version, fields_attempted, fields_verified, fields_rejected,
  field_outcomes, performed_by, did_auto_start_case
) VALUES
  ('79000000-0000-4000-a000-000000000062', '18000000-0000-4000-a000-000000000058',
   '49000000-0000-4000-a000-000000000062', '99000000-0000-4000-a000-000000000062',
   '89000000-0000-4000-a000-000000000062',
   '49000000-0000-4000-a000-000000000062:99000000-0000-4000-a000-000000000062:69000000-0000-4000-a000-000000000058:1:89000000-0000-4000-a000-000000000062',
   '69000000-0000-4000-a000-000000000058', 1, 1, '79000000-0000-4000-a000-000000000062',
   1, 'sha256:' || repeat('a', 64), '38000000-0000-4000-a000-000000000058',
   '39000000-0000-4000-a000-000000000060', 'm58_enrollment', 'web', 0, '[]'::jsonb,
   false, 2, 0, 0, 0, '[]'::jsonb, '39000000-0000-4000-a000-000000000058', false),
  ('79000000-0000-4000-a000-000000000063', '18000000-0000-4000-a000-000000000058',
   '49000000-0000-4000-a000-000000000063', '99000000-0000-4000-a000-000000000063',
   '89000000-0000-4000-a000-000000000063',
   '49000000-0000-4000-a000-000000000063:99000000-0000-4000-a000-000000000063:69000000-0000-4000-a000-000000000058:1:89000000-0000-4000-a000-000000000063',
   '69000000-0000-4000-a000-000000000058', 1, 1, '79000000-0000-4000-a000-000000000063',
   1, 'sha256:' || repeat('a', 64), '38000000-0000-4000-a000-000000000058',
   '39000000-0000-4000-a000-000000000060', 'm58_enrollment', 'web', 0, '[]'::jsonb,
   false, 2, 0, 0, 0, '[]'::jsonb, '39000000-0000-4000-a000-000000000058', true);
SELECT pg_temp.m58_mark('already_in_progress_fill_is_not_stamped_as_auto_start',
  (SELECT count(*) = 2 AND bool_and(NOT did_auto_start_case)
      FROM public.fill_sessions
     WHERE id IN ('79000000-0000-4000-a000-000000000062', '79000000-0000-4000-a000-000000000063')));
SELECT pg_temp.m58_mark('client_cannot_forge_auto_start_stamp',
  (SELECT NOT did_auto_start_case FROM public.fill_sessions
    WHERE id = '79000000-0000-4000-a000-000000000063'));

-- The fill V2 rows are immutable, including the server-owned cause stamp.
SELECT pg_temp.m58_mark('typed_fill_receipt_is_immutable', pg_temp.m58_expect_state(
  '42501',
  $$UPDATE public.fill_sessions SET did_auto_start_case = false
      WHERE id = '79000000-0000-4000-a000-000000000058'$$
));

SET LOCAL ROLE service_role;

INSERT INTO public.fill_sessions(
  id, org_id, case_id, contract_id, contract_sop_assignment_id,
  sop_template_id, sop_version, task_index, step_index, step_identity,
  context_version, launch_receipt_id, mapping_generation,
  effective_mapping_fingerprint, portal_id, provider_id, portal_key, fill_mode,
  fields_filled, fields_skipped, is_test, event_schema_version,
  fields_attempted, fields_verified, fields_rejected, field_outcomes, performed_by
) VALUES (
  '79000000-0000-4000-a000-000000000072',
  '18000000-0000-4000-a000-000000000058', NULL,
  '29000000-0000-4000-a000-000000000058',
  '79000000-0000-4000-a000-000000000071',
  '69000000-0000-4000-a000-000000000059', 1, 0, 0,
  '29000000-0000-4000-a000-000000000058:18000000-0000-4000-a000-000000000058:79000000-0000-4000-a000-000000000071:1:69000000-0000-4000-a000-000000000059:1:0:0',
  1, '79000000-0000-4000-a000-000000000072', 1,
  'sha256:' || repeat('b', 64), '38000000-0000-4000-a000-000000000059',
  '39000000-0000-4000-a000-000000000060', 'm58_contract', 'web', 0, '[]'::jsonb,
  false, 2, 0, 0, 0, '[]'::jsonb, '39000000-0000-4000-a000-000000000058'
);
SELECT pg_temp.m58_mark('contract_v2_work_receipt_retains_contract_step_identity',
  (SELECT contract_id = '29000000-0000-4000-a000-000000000058'
      AND case_id IS NULL
      AND contract_sop_assignment_id = '79000000-0000-4000-a000-000000000071'
      AND case_task_id IS NULL AND case_step_id IS NULL
      AND step_identity LIKE '29000000-0000-4000-a000-000000000058:%'
      AND NOT did_auto_start_case
    FROM public.fill_sessions
   WHERE id = '79000000-0000-4000-a000-000000000072'));

CREATE FUNCTION pg_temp.m58_reject_touch_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id = 'aa000000-0000-4000-a000-000000000058'::uuid THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'synthetic status/touch rollback';
  END IF;
  RETURN NEW;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.m58_reject_touch_insert() TO service_role;
RESET ROLE;
CREATE TRIGGER m58_test_fail_submission_touch
  BEFORE INSERT ON public.touches FOR EACH ROW EXECUTE FUNCTION pg_temp.m58_reject_touch_insert();
SET LOCAL ROLE service_role;

SELECT pg_temp.m58_mark('touch_trigger_failure_rolls_back_m19_task_and_audit', pg_temp.m58_expect_state(
  'P0001',
  $$SELECT pg_temp.m58_call(
      '39000000-0000-4000-a000-000000000058',
      '49000000-0000-4000-a000-000000000060',
      'aa000000-0000-4000-a000-000000000058',
      '79000000-0000-4000-a000-000000000058',
      pg_temp.m58_tuple(
        '49000000-0000-4000-a000-000000000060',
        '99000000-0000-4000-a000-000000000058',
        '89000000-0000-4000-a000-000000000058',
        '79000000-0000-4000-a000-000000000058', 1,
        '39000000-0000-4000-a000-000000000060',
        '69000000-0000-4000-a000-000000000058'
      ),
      '{"note":"operator confirmed","payerReferenceId":null,"wipNote":null,"pdfFilename":null}'::jsonb
    )$$
));
SELECT pg_temp.m58_mark('failed_touch_left_step_open_and_no_submission_anchor',
  (SELECT step->>'isCompleted' = 'false'
     FROM public.tasks t,
          LATERAL jsonb_array_elements(t.sop_content) AS item(step)
    WHERE t.id = '99000000-0000-4000-a000-000000000058'
      AND item.step->>'id' = '89000000-0000-4000-a000-000000000058')
  AND NOT EXISTS (SELECT 1 FROM public.touches WHERE id = 'aa000000-0000-4000-a000-000000000058')
  AND NOT EXISTS (SELECT 1 FROM public.audit_log WHERE entity_id = '99000000-0000-4000-a000-000000000058' AND action_type = 'UPDATE'));
RESET ROLE;
DROP TRIGGER m58_test_fail_submission_touch ON public.touches;
SET LOCAL ROLE service_role;

TRUNCATE m58_last;
INSERT INTO m58_last SELECT pg_temp.m58_call(
  '39000000-0000-4000-a000-000000000058',
  '49000000-0000-4000-a000-000000000060',
  'aa000000-0000-4000-a000-000000000058',
  '79000000-0000-4000-a000-000000000058',
  pg_temp.m58_tuple(
    '49000000-0000-4000-a000-000000000060',
    '99000000-0000-4000-a000-000000000058',
    '89000000-0000-4000-a000-000000000058',
    '79000000-0000-4000-a000-000000000058', 1,
    '39000000-0000-4000-a000-000000000060',
    '69000000-0000-4000-a000-000000000058'
  ),
  '{"note":"operator confirmed","payerReferenceId":null,"wipNote":null,"pdfFilename":null}'::jsonb
);
SELECT pg_temp.m58_mark('not_started_fill_context_bump_can_be_submitted',
  (SELECT result->>'kind' = 'created' FROM m58_last)
  AND (SELECT did_auto_start_case FROM public.fill_sessions
        WHERE id = '79000000-0000-4000-a000-000000000058')
  AND (SELECT case_status = 'submitted' AND context_version = 3
        FROM public.credential_cases WHERE id = '49000000-0000-4000-a000-000000000060')
  AND EXISTS (SELECT 1 FROM public.touches WHERE id = 'aa000000-0000-4000-a000-000000000058'
               AND fill_session_id = '79000000-0000-4000-a000-000000000058'
               AND submission_request_fingerprint IS NOT NULL));

-- Exact retries short-circuit before mutable current-step checks. A changed
-- payload under the same UUID is always a conflict.
TRUNCATE m58_last;
INSERT INTO m58_last SELECT pg_temp.m58_call(
  '39000000-0000-4000-a000-000000000058', '49000000-0000-4000-a000-000000000060',
  'aa000000-0000-4000-a000-000000000058', '79000000-0000-4000-a000-000000000058',
  pg_temp.m58_tuple('49000000-0000-4000-a000-000000000060', '99000000-0000-4000-a000-000000000058',
    '89000000-0000-4000-a000-000000000058', '79000000-0000-4000-a000-000000000058', 1,
    '39000000-0000-4000-a000-000000000060', '69000000-0000-4000-a000-000000000058'),
  '{"note":"operator confirmed","payerReferenceId":null,"wipNote":null,"pdfFilename":null}'::jsonb
);
SELECT pg_temp.m58_mark('exact_completed_submission_retry_is_duplicate',
  (SELECT result->>'kind' = 'duplicate' FROM m58_last));
TRUNCATE m58_last;
INSERT INTO m58_last SELECT pg_temp.m58_call(
  '39000000-0000-4000-a000-000000000058', '49000000-0000-4000-a000-000000000060',
  'aa000000-0000-4000-a000-000000000058', '79000000-0000-4000-a000-000000000058',
  pg_temp.m58_tuple('49000000-0000-4000-a000-000000000060', '99000000-0000-4000-a000-000000000058',
    '89000000-0000-4000-a000-000000000058', '79000000-0000-4000-a000-000000000058', 1,
    '39000000-0000-4000-a000-000000000060', '69000000-0000-4000-a000-000000000058'),
  '{"note":"different payload","payerReferenceId":null,"wipNote":null,"pdfFilename":null}'::jsonb
);
SELECT pg_temp.m58_mark('same_id_changed_payload_conflicts',
  (SELECT result->>'kind' = 'rejected' AND result->>'status' = '409' FROM m58_last));

-- The next selected step remains eligible after the first human submission
-- moved the case to Submitted. Its tuple uses the current M51 context version.
RESET ROLE;
INSERT INTO public.fill_sessions(
  id, org_id, case_id, case_task_id, case_step_id, step_identity,
  sop_template_id, sop_version, context_version, launch_receipt_id,
  mapping_generation, effective_mapping_fingerprint, portal_id, provider_id,
  portal_key, fill_mode, fields_filled, fields_skipped, is_test,
  event_schema_version, fields_attempted, fields_verified, fields_rejected,
  field_outcomes, performed_by
) VALUES (
  '79000000-0000-4000-a000-000000000059', '18000000-0000-4000-a000-000000000058',
  '49000000-0000-4000-a000-000000000060', '99000000-0000-4000-a000-000000000058',
  '89000000-0000-4000-a000-000000000059',
  '49000000-0000-4000-a000-000000000060:99000000-0000-4000-a000-000000000058:69000000-0000-4000-a000-000000000058:1:89000000-0000-4000-a000-000000000059',
  '69000000-0000-4000-a000-000000000058', 1, 3, '79000000-0000-4000-a000-000000000059',
  1, 'sha256:' || repeat('a', 64), '38000000-0000-4000-a000-000000000058',
  '39000000-0000-4000-a000-000000000060', 'm58_enrollment', 'web', 0, '[]'::jsonb,
  false, 2, 0, 0, 0, '[]'::jsonb, '39000000-0000-4000-a000-000000000058'
);
SET LOCAL ROLE service_role;
TRUNCATE m58_last;
INSERT INTO m58_last SELECT pg_temp.m58_call(
  '39000000-0000-4000-a000-000000000058', '49000000-0000-4000-a000-000000000060',
  'aa000000-0000-4000-a000-000000000060', '79000000-0000-4000-a000-000000000059',
  pg_temp.m58_tuple('49000000-0000-4000-a000-000000000060', '99000000-0000-4000-a000-000000000058',
    '89000000-0000-4000-a000-000000000059', '79000000-0000-4000-a000-000000000059', 3,
    '39000000-0000-4000-a000-000000000060', '69000000-0000-4000-a000-000000000058'));
SELECT pg_temp.m58_mark('second_step_submits_while_case_is_submitted',
  (SELECT result->>'kind' = 'created' FROM m58_last)
  AND (SELECT step->>'isCompleted' = 'true'
       FROM public.tasks t, LATERAL jsonb_array_elements(t.sop_content) item(step)
       WHERE t.id = '99000000-0000-4000-a000-000000000058'
         AND item.step->>'id' = '89000000-0000-4000-a000-000000000059'));

-- The normal in_progress fill can be submitted at its unchanged version.
TRUNCATE m58_last;
INSERT INTO m58_last SELECT pg_temp.m58_call(
  '39000000-0000-4000-a000-000000000058', '49000000-0000-4000-a000-000000000062',
  'aa000000-0000-4000-a000-000000000062', '79000000-0000-4000-a000-000000000062',
  pg_temp.m58_tuple('49000000-0000-4000-a000-000000000062', '99000000-0000-4000-a000-000000000062',
    '89000000-0000-4000-a000-000000000062', '79000000-0000-4000-a000-000000000062', 1,
    '39000000-0000-4000-a000-000000000060', '69000000-0000-4000-a000-000000000058'));
SELECT pg_temp.m58_mark('in_progress_fill_submits_with_exact_current_version',
  (SELECT result->>'kind' = 'created' FROM m58_last));

-- A different owner edit after a non-auto-starting fill increments the case
-- context and rejects its old receipt before completion or touch writes.
RESET ROLE;
UPDATE public.credential_cases SET state = 'UT'
 WHERE id = '49000000-0000-4000-a000-000000000063';
SET LOCAL ROLE service_role;
TRUNCATE m58_last;
INSERT INTO m58_last SELECT pg_temp.m58_call(
  '39000000-0000-4000-a000-000000000058', '49000000-0000-4000-a000-000000000063',
  'aa000000-0000-4000-a000-000000000063', '79000000-0000-4000-a000-000000000063',
  pg_temp.m58_tuple('49000000-0000-4000-a000-000000000063', '99000000-0000-4000-a000-000000000063',
    '89000000-0000-4000-a000-000000000063', '79000000-0000-4000-a000-000000000063', 1,
    '39000000-0000-4000-a000-000000000060', '69000000-0000-4000-a000-000000000058'));
SELECT pg_temp.m58_mark('unrelated_owner_context_edit_rejects_old_fill_receipt',
  (SELECT result->>'kind' = 'rejected' AND result->>'status' = '409' FROM m58_last)
  AND NOT EXISTS (SELECT 1 FROM public.touches WHERE id = 'aa000000-0000-4000-a000-000000000063')
  AND (SELECT step->>'isCompleted' = 'false'
       FROM public.tasks t, LATERAL jsonb_array_elements(t.sop_content) item(step)
       WHERE t.id = '99000000-0000-4000-a000-000000000063'));

-- Even a real server-stamped auto-start receipt is stale after a second
-- unrelated owner edit (N -> N+1 auto-start, then N+2 owner update).
RESET ROLE;
INSERT INTO public.fill_sessions(
  id, org_id, case_id, case_task_id, case_step_id, step_identity,
  sop_template_id, sop_version, context_version, launch_receipt_id,
  mapping_generation, effective_mapping_fingerprint, portal_id, provider_id,
  portal_key, fill_mode, fields_filled, fields_skipped, is_test,
  event_schema_version, fields_attempted, fields_verified, fields_rejected,
  field_outcomes, performed_by
) VALUES (
  '79000000-0000-4000-a000-000000000067', '18000000-0000-4000-a000-000000000058',
  '49000000-0000-4000-a000-000000000064', '99000000-0000-4000-a000-000000000064',
  '89000000-0000-4000-a000-000000000064',
  '49000000-0000-4000-a000-000000000064:99000000-0000-4000-a000-000000000064:69000000-0000-4000-a000-000000000058:1:89000000-0000-4000-a000-000000000064',
  '69000000-0000-4000-a000-000000000058', 1, 1, '79000000-0000-4000-a000-000000000067',
  1, 'sha256:' || repeat('a', 64), '38000000-0000-4000-a000-000000000058',
  '39000000-0000-4000-a000-000000000060', 'm58_enrollment', 'web', 0, '[]'::jsonb,
  false, 2, 0, 0, 0, '[]'::jsonb, '39000000-0000-4000-a000-000000000058'
);
SELECT pg_temp.m58_mark('auto_start_receipt_is_stamped_before_followup_owner_edit',
  (SELECT did_auto_start_case AND context_version = 1
     FROM public.fill_sessions WHERE id = '79000000-0000-4000-a000-000000000067')
  AND (SELECT context_version = 2 AND case_status = 'in_progress'
         FROM public.credential_cases WHERE id = '49000000-0000-4000-a000-000000000064'));
UPDATE public.credential_cases SET state = 'UT'
 WHERE id = '49000000-0000-4000-a000-000000000064';
SET LOCAL ROLE service_role;
TRUNCATE m58_last;
INSERT INTO m58_last SELECT pg_temp.m58_call(
  '39000000-0000-4000-a000-000000000058', '49000000-0000-4000-a000-000000000064',
  'aa000000-0000-4000-a000-000000000067', '79000000-0000-4000-a000-000000000067',
  pg_temp.m58_tuple('49000000-0000-4000-a000-000000000064', '99000000-0000-4000-a000-000000000064',
    '89000000-0000-4000-a000-000000000064', '79000000-0000-4000-a000-000000000067', 1,
    '39000000-0000-4000-a000-000000000060', '69000000-0000-4000-a000-000000000058'));
SELECT pg_temp.m58_mark('n_plus_two_owner_context_change_rejects_stamped_auto_start_receipt',
  (SELECT result->>'kind' = 'rejected' AND result->>'status' = '409' FROM m58_last)
  AND NOT EXISTS (SELECT 1 FROM public.touches WHERE id = 'aa000000-0000-4000-a000-000000000067')
  AND (SELECT step->>'isCompleted' = 'false'
       FROM public.tasks t, LATERAL jsonb_array_elements(t.sop_content) item(step)
       WHERE t.id = '99000000-0000-4000-a000-000000000064'));

-- Malformed uuid text must produce a typed 422 rather than a database cast
-- exception. Actor and membership are valid so tuple validation is exercised.
TRUNCATE m58_last;
INSERT INTO m58_last SELECT pg_temp.m58_call(
  '39000000-0000-4000-a000-000000000058', '49000000-0000-4000-a000-000000000060',
  'aa000000-0000-4000-a000-000000000064', '79000000-0000-4000-a000-000000000058',
  pg_temp.m58_tuple('49000000-0000-4000-a000-000000000060', '99000000-0000-4000-a000-000000000058',
    '89000000-0000-4000-a000-000000000058', '79000000-0000-4000-a000-000000000058', 1,
    '39000000-0000-4000-a000-000000000060', '69000000-0000-4000-a000-000000000058')
      || jsonb_build_object('stepId', 'malformed-uuid'));
SELECT pg_temp.m58_mark('malformed_step_uuid_returns_422_not_22p02',
  (SELECT result->>'kind' = 'rejected' AND result->>'status' = '422' FROM m58_last));

-- Cross-org id reuse returns the same generic 409; no foreign row details are
-- returned. Actor mismatch is denied before tuple/owner processing.
TRUNCATE m58_last;
INSERT INTO m58_last SELECT pg_temp.m58_call(
  '39000000-0000-4000-a000-000000000058', '49000000-0000-4000-a000-000000000060',
  'aa000000-0000-4000-a000-000000000059', '79000000-0000-4000-a000-000000000058',
  pg_temp.m58_tuple('49000000-0000-4000-a000-000000000060', '99000000-0000-4000-a000-000000000058',
    '89000000-0000-4000-a000-000000000058', '79000000-0000-4000-a000-000000000058', 1,
    '39000000-0000-4000-a000-000000000060', '69000000-0000-4000-a000-000000000058'));
SELECT pg_temp.m58_mark('cross_org_id_collision_is_generic_conflict',
  (SELECT result->>'kind' = 'rejected' AND result->>'status' = '409'
      AND result->>'message' = 'Idempotency id already used' FROM m58_last));

TRUNCATE m58_last;
INSERT INTO m58_last SELECT pg_temp.m58_call(
  '39000000-0000-4000-a000-000000000059', '49000000-0000-4000-a000-000000000060',
  'aa000000-0000-4000-a000-000000000065', '79000000-0000-4000-a000-000000000058',
  pg_temp.m58_tuple('49000000-0000-4000-a000-000000000060', '99000000-0000-4000-a000-000000000058',
    '89000000-0000-4000-a000-000000000058', '79000000-0000-4000-a000-000000000058', 1,
    '39000000-0000-4000-a000-000000000060', '69000000-0000-4000-a000-000000000058'));
SELECT pg_temp.m58_mark('actor_must_match_authenticated_claim',
  (SELECT result->>'kind' = 'rejected' AND result->>'status' = '403' FROM m58_last));

-- Contract-owner work can still produce M49 fill receipts, but this
-- case-submission RPC refuses a Contract tuple before looking up a case or
-- writing a touch. Existing ad-hoc and structured-touch paths stay separate.
TRUNCATE m58_last;
INSERT INTO m58_last SELECT public.record_typed_enrollment_submission(
  '18000000-0000-4000-a000-000000000058'::uuid,
  '39000000-0000-4000-a000-000000000058'::uuid,
  '49000000-0000-4000-a000-000000000060'::uuid,
  'aa000000-0000-4000-a000-000000000070'::uuid,
  '79000000-0000-4000-a000-000000000058'::uuid,
  jsonb_build_object(
    'launchReceiptId', '79000000-0000-4000-a000-000000000058',
    'orgId', '18000000-0000-4000-a000-000000000058',
    'ownerKind', 'contract', 'ownerId', '29000000-0000-4000-a000-000000000058',
    'contextVersion', 1, 'sopTemplateId', '69000000-0000-4000-a000-000000000058',
    'sopVersion', 1, 'assignmentId', '79000000-0000-4000-a000-000000000071',
    'taskIndex', 0, 'stepIndex', 0, 'portalId', '38000000-0000-4000-a000-000000000058',
    'portalKey', 'm58_enrollment', 'mappingGeneration', 1,
    'effectiveMappingFingerprint', 'sha256:' || repeat('a', 64),
    'providerId', '39000000-0000-4000-a000-000000000060', 'facilityId', NULL,
    'stepIdentity', 'contract-step'
  ),
  '{"note":null,"payerReferenceId":null,"wipNote":null,"pdfFilename":null}'::jsonb
);
SELECT pg_temp.m58_mark('contract_tuple_cannot_create_case_submission_outcome',
  (SELECT result->>'kind' = 'rejected' AND result->>'status' = '422' FROM m58_last)
  AND NOT EXISTS (SELECT 1 FROM public.touches WHERE id = 'aa000000-0000-4000-a000-000000000070'));

-- Step three is current but MINT-19 may return a rejected JSON result rather
-- than raising. M58 must inspect it before touching any submission state.
RESET ROLE;
INSERT INTO public.fill_sessions(
  id, org_id, case_id, case_task_id, case_step_id, step_identity,
  sop_template_id, sop_version, context_version, launch_receipt_id,
  mapping_generation, effective_mapping_fingerprint, portal_id, provider_id,
  portal_key, fill_mode, fields_filled, fields_skipped, is_test,
  event_schema_version, fields_attempted, fields_verified, fields_rejected,
  field_outcomes, performed_by
) VALUES (
  '79000000-0000-4000-a000-000000000060', '18000000-0000-4000-a000-000000000058',
  '49000000-0000-4000-a000-000000000060', '99000000-0000-4000-a000-000000000058',
  '89000000-0000-4000-a000-000000000060',
  '49000000-0000-4000-a000-000000000060:99000000-0000-4000-a000-000000000058:69000000-0000-4000-a000-000000000058:1:89000000-0000-4000-a000-000000000060',
  '69000000-0000-4000-a000-000000000058', 1, 3, '79000000-0000-4000-a000-000000000060',
  1, 'sha256:' || repeat('a', 64), '38000000-0000-4000-a000-000000000058',
  '39000000-0000-4000-a000-000000000060', 'm58_enrollment', 'web', 0, '[]'::jsonb,
  false, 2, 0, 0, 0, '[]'::jsonb, '39000000-0000-4000-a000-000000000058'
);
CREATE OR REPLACE FUNCTION public.complete_sop_task_step(
  p_org_id uuid, p_task_id uuid, p_step_id text, p_actor_id uuid, p_source text
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object('kind', 'rejected', 'status', 409, 'message', 'synthetic MINT-19 rejection')
$$;
SET LOCAL ROLE service_role;
TRUNCATE m58_last;
INSERT INTO m58_last SELECT pg_temp.m58_call(
  '39000000-0000-4000-a000-000000000058', '49000000-0000-4000-a000-000000000060',
  'aa000000-0000-4000-a000-000000000066', '79000000-0000-4000-a000-000000000060',
  pg_temp.m58_tuple('49000000-0000-4000-a000-000000000060', '99000000-0000-4000-a000-000000000058',
    '89000000-0000-4000-a000-000000000060', '79000000-0000-4000-a000-000000000060', 3,
    '39000000-0000-4000-a000-000000000060', '69000000-0000-4000-a000-000000000058'));
SELECT pg_temp.m58_mark('mint19_json_rejection_has_no_submission_side_effects',
  (SELECT result->>'kind' = 'rejected' AND result->>'status' = '409' FROM m58_last)
  AND NOT EXISTS (SELECT 1 FROM public.touches WHERE id = 'aa000000-0000-4000-a000-000000000066')
  AND (SELECT step->>'isCompleted' = 'false'
       FROM public.tasks t, LATERAL jsonb_array_elements(t.sop_content) item(step)
       WHERE t.id = '99000000-0000-4000-a000-000000000058'
         AND item.step->>'id' = '89000000-0000-4000-a000-000000000060'));

-- Simulate the authorized table-owner reset inside this disposable rollback
-- transaction. Historical exact retry stays valid; a new old-generation touch
-- is rejected by the current configuration guard.
RESET ROLE;
SELECT set_config('minted.expected_mapping_generation', '1', true);
SELECT set_config('minted.mapping_reset', 'true', true);
UPDATE public.portals SET mapping_generation = 2
 WHERE id = '38000000-0000-4000-a000-000000000058';
INSERT INTO public.form_mapping_reset_events(
  portal_id, owner_scope, org_id, portal_key, old_mapping_generation,
  new_mapping_generation, actor_id, affected_field_count, idempotency_key
) VALUES (
  '38000000-0000-4000-a000-000000000058', 'organization',
  '18000000-0000-4000-a000-000000000058', 'm58_enrollment', 1, 2,
  '39000000-0000-4000-a000-000000000058', 0,
  'aa000000-0000-4000-a000-000000000067'
);
SELECT set_config('minted.mapping_reset', 'false', true);
SET LOCAL ROLE service_role;
TRUNCATE m58_last;
INSERT INTO m58_last SELECT pg_temp.m58_call(
  '39000000-0000-4000-a000-000000000058', '49000000-0000-4000-a000-000000000060',
  'aa000000-0000-4000-a000-000000000058', '79000000-0000-4000-a000-000000000058',
  pg_temp.m58_tuple('49000000-0000-4000-a000-000000000060', '99000000-0000-4000-a000-000000000058',
    '89000000-0000-4000-a000-000000000058', '79000000-0000-4000-a000-000000000058', 1,
    '39000000-0000-4000-a000-000000000060', '69000000-0000-4000-a000-000000000058'),
  '{"note":"operator confirmed","payerReferenceId":null,"wipNote":null,"pdfFilename":null}'::jsonb
);
SELECT pg_temp.m58_mark('exact_retry_survives_completion_and_mapping_reset',
  (SELECT result->>'kind' = 'duplicate' FROM m58_last));
TRUNCATE m58_last;
INSERT INTO m58_last SELECT pg_temp.m58_call(
  '39000000-0000-4000-a000-000000000058', '49000000-0000-4000-a000-000000000060',
  'aa000000-0000-4000-a000-000000000068', '79000000-0000-4000-a000-000000000060',
  pg_temp.m58_tuple('49000000-0000-4000-a000-000000000060', '99000000-0000-4000-a000-000000000058',
    '89000000-0000-4000-a000-000000000060', '79000000-0000-4000-a000-000000000060', 3,
    '39000000-0000-4000-a000-000000000060', '69000000-0000-4000-a000-000000000058'));
SELECT pg_temp.m58_mark('new_submission_cannot_reuse_pre_reset_fill_receipt',
  (SELECT result->>'kind' = 'rejected' AND result->>'status' = '409' FROM m58_last)
  AND NOT EXISTS (SELECT 1 FROM public.touches WHERE id = 'aa000000-0000-4000-a000-000000000068'));

DO $$
DECLARE failures text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO failures
    FROM pg_temp.m58_results WHERE NOT passed;
  IF failures IS NOT NULL THEN
    RAISE EXCEPTION 'MINT-58 exact fill/submission checks failed: %', failures;
  END IF;
END;
$$;

ROLLBACK;
