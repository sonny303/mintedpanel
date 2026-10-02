-- MINT-64 integrated Panel/database proof packet. Candidate source inputs:
-- Panel:    78204da977249ca784d44d4f7901290edd2f17cb
-- Extension: a74231e3de3dfbc1893933b21d672bc7ef92cbd3
-- These pins identify intended source inputs, not the checkout/artifact
-- executed by CI. Record the actual Panel CI head and built MV3 artifact SHA
-- separately with the corresponding CI/release evidence.
-- Run after all migrations in disposable migration CI PostgreSQL. These
-- synthetic fixtures and transaction-local service-role policies roll back.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on
\echo MINT-64 candidate source inputs Panel 78204da977249ca784d44d4f7901290edd2f17cb; Extension a74231e3de3dfbc1893933b21d672bc7ef92cbd3

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE m64_results (name text PRIMARY KEY, passed boolean NOT NULL);
CREATE TEMP TABLE m64_submission_result (name text PRIMARY KEY, result jsonb NOT NULL);
GRANT ALL ON m64_results, m64_submission_result TO service_role;

-- Two distinct current key-scoped maps are attached to the keys that share a
-- URL. The assertion below checks persisted per-key rows and proof state; it
-- does not claim to execute Extension-side effective-map resolution.

CREATE FUNCTION pg_temp.m64_mark(p_name text, p_passed boolean) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO pg_temp.m64_results VALUES (p_name, COALESCE(p_passed, false))
$$;
CREATE FUNCTION pg_temp.m64_expect_message(p_fragment text, p_statement text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_message text;
BEGIN
  BEGIN
    EXECUTE p_statement;
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    RETURN position(p_fragment IN v_message) > 0;
  END;
END;
$$;
CREATE FUNCTION pg_temp.m64_work_context(
  p_case_id uuid,
  p_task_id uuid,
  p_step_id uuid,
  p_fill_id uuid,
  p_template_id uuid,
  p_portal_id uuid,
  p_portal_key text,
  p_context_version integer
) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'launchReceiptId', p_fill_id,
    'orgId', '18000000-0000-4000-a000-000000000064'::uuid,
    'ownerKind', 'case',
    'ownerId', p_case_id,
    'contextVersion', p_context_version,
    'sopTemplateId', p_template_id,
    'sopVersion', 1,
    'portalId', p_portal_id,
    'portalKey', p_portal_key,
    'mappingGeneration', 1,
    'effectiveMappingFingerprint', 'sha256:' || repeat('a', 64),
    'providerId', '39000000-0000-4000-a000-000000000065'::uuid,
    'facilityId', NULL,
    'stepIdentity', p_case_id::text || ':' || p_task_id::text || ':' ||
      p_template_id::text || ':1:' || p_step_id::text,
    'taskId', p_task_id,
    'stepId', p_step_id
  );
$$;
GRANT EXECUTE ON FUNCTION pg_temp.m64_mark(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.m64_expect_message(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.m64_work_context(uuid, uuid, uuid, uuid, uuid, uuid, text, integer)
  TO service_role;

INSERT INTO auth.users(id, email) VALUES
  ('39000000-0000-4000-a000-000000000064', 'm64-operator@example.invalid');
INSERT INTO public.profiles(id, full_name, email) VALUES
  ('39000000-0000-4000-a000-000000000064', 'MINT-64 Synthetic Operator',
   'm64-operator@example.invalid');
INSERT INTO public.organizations(id, name) VALUES
  ('18000000-0000-4000-a000-000000000064', 'MINT-64 Synthetic Organization');
INSERT INTO public.memberships(org_id, user_id, role) VALUES
  ('18000000-0000-4000-a000-000000000064', '39000000-0000-4000-a000-000000000064', 'specialist');
INSERT INTO public.payers(id, org_id, name) VALUES
  ('28000000-0000-4000-a000-000000000064',
   '18000000-0000-4000-a000-000000000064', 'MINT-64 Synthetic Payer');
INSERT INTO public.provider_groups(id, org_id, name) VALUES
  ('49000000-0000-4000-a000-000000000064',
   '18000000-0000-4000-a000-000000000064', 'MINT-64 Synthetic Group');
INSERT INTO public.providers(id, org_id, group_id, first_name, last_name, status) VALUES
  ('39000000-0000-4000-a000-000000000065',
   '18000000-0000-4000-a000-000000000064',
   '49000000-0000-4000-a000-000000000064', 'Synthetic', 'Provider', 'active');
INSERT INTO public.provider_group_assignments(org_id, provider_id, group_id, is_primary, start_date)
VALUES ('18000000-0000-4000-a000-000000000064',
        '39000000-0000-4000-a000-000000000065',
        '49000000-0000-4000-a000-000000000064', true, current_date);

-- These are distinct typed configurations with the same payer URL. Neither
-- the URL nor the payer is an owner key; the selected portal key is exact.
INSERT INTO public.portals(
  id, org_id, portal_key, name, payer_id, form_url, case_type,
  requires_explicit_selection, is_verified, last_verified_at, proven_at
) VALUES
  ('38000000-0000-4000-a000-000000000064',
   '18000000-0000-4000-a000-000000000064', 'm64_contract', 'MINT-64 Contract form',
   '28000000-0000-4000-a000-000000000064', 'https://same.example.invalid/application',
   'contract', true, true, now(), now()),
  ('38000000-0000-4000-a000-000000000065',
   '18000000-0000-4000-a000-000000000064', 'm64_enrollment', 'MINT-64 Enrollment form',
   '28000000-0000-4000-a000-000000000064', 'https://same.example.invalid/application',
   'enrollment', true, false, NULL, NULL),
  ('38000000-0000-4000-a000-000000000066',
   '18000000-0000-4000-a000-000000000064', 'm64_recredentialing',
   'MINT-64 Recredentialing manual form', '28000000-0000-4000-a000-000000000064',
   'https://same.example.invalid/application', 'recredentialing', true, true, now(), now());

INSERT INTO public.contracts(id, org_id, group_id, payer_id, state) VALUES (
  '29000000-0000-4000-a000-000000000064',
  '18000000-0000-4000-a000-000000000064',
  '49000000-0000-4000-a000-000000000064',
  '28000000-0000-4000-a000-000000000064', 'NY'
);
INSERT INTO public.credential_cases(
  id, org_id, provider_id, group_id, payer_id, state, case_type, case_status, created_by
) VALUES
  ('49000000-0000-4000-a000-000000000064',
   '18000000-0000-4000-a000-000000000064',
   '39000000-0000-4000-a000-000000000065',
   '49000000-0000-4000-a000-000000000064',
   '28000000-0000-4000-a000-000000000064', 'NY', 'enrollment', 'in_progress',
   '39000000-0000-4000-a000-000000000064');

INSERT INTO public.sop_templates(
  id, org_id, name, payer_id, state, states, group_id, task_definitions,
  archived, current_version, required_profile_attributes, case_type
) VALUES
  ('69000000-0000-4000-a000-000000000064',
   '18000000-0000-4000-a000-000000000064', 'MINT-64 Contract SOP',
   '28000000-0000-4000-a000-000000000064', 'NY', ARRAY['NY']::text[],
   '49000000-0000-4000-a000-000000000064',
   '[{"title":"Contract application","steps":[{"label":"Contract form","stepType":"online_form","portalKey":"m64_contract"}]}]'::jsonb,
   false, 1, '[]'::jsonb, 'contract'),
  ('69000000-0000-4000-a000-000000000065',
   '18000000-0000-4000-a000-000000000064', 'MINT-64 Enrollment SOP',
   '28000000-0000-4000-a000-000000000064', 'NY', ARRAY['NY']::text[], NULL,
   '[{"title":"Enrollment forms","steps":[{"label":"First form","stepType":"online_form","portalKey":"m64_enrollment"},{"label":"Second form","stepType":"online_form","portalKey":"m64_enrollment"}]},{"title":"Enrollment sibling","steps":[{"label":"Sibling form","stepType":"online_form","portalKey":"m64_enrollment"}]}]'::jsonb,
   false, 1, '[]'::jsonb, 'enrollment'),
  ('69000000-0000-4000-a000-000000000066',
   '18000000-0000-4000-a000-000000000064', 'MINT-64 Recredentialing SOP',
   '28000000-0000-4000-a000-000000000064', 'OR', ARRAY['OR']::text[], NULL,
   '[{"title":"Recredentialing manual review","steps":[{"label":"Review by hand","stepType":"online_form","portalKey":"m64_recredentialing"}]}]'::jsonb,
   false, 1, '[]'::jsonb, 'recredentialing');

INSERT INTO public.contract_sop_assignments(
  id, org_id, contract_id, sop_template_id, sop_version, context_version,
  created_by, updated_by
) VALUES (
  '79000000-0000-4000-a000-000000000064',
  '18000000-0000-4000-a000-000000000064',
  '29000000-0000-4000-a000-000000000064',
  '69000000-0000-4000-a000-000000000064', 1, 1,
  '39000000-0000-4000-a000-000000000064',
  '39000000-0000-4000-a000-000000000064'
);
INSERT INTO public.tasks(
  id, org_id, case_id, provider_id, title, sop_content, status, sort_order,
  sop_template_id, sop_version, execution_type
) VALUES
  ('99000000-0000-4000-a000-000000000064',
   '18000000-0000-4000-a000-000000000064', '49000000-0000-4000-a000-000000000064',
   '39000000-0000-4000-a000-000000000065', 'Enrollment forms',
   '[{"id":"89000000-0000-4000-a000-000000000064","label":"First form","stepType":"online_form","portalKey":"m64_enrollment","order":0,"isCompleted":false},{"id":"89000000-0000-4000-a000-000000000065","label":"Second form","stepType":"online_form","portalKey":"m64_enrollment","order":1,"isCompleted":false}]'::jsonb,
   'not_started', 1, '69000000-0000-4000-a000-000000000065', 1, 'extension_fill'),
  ('99000000-0000-4000-a000-000000000065',
   '18000000-0000-4000-a000-000000000064', '49000000-0000-4000-a000-000000000064',
   '39000000-0000-4000-a000-000000000065', 'Enrollment sibling',
   '[{"id":"89000000-0000-4000-a000-000000000066","label":"Sibling form","stepType":"online_form","portalKey":"m64_enrollment","order":0,"isCompleted":false}]'::jsonb,
   'not_started', 2, '69000000-0000-4000-a000-000000000065', 1, 'extension_fill');

SET LOCAL minted.expected_mapping_generation = '1';
INSERT INTO public.portal_field_maps(
  org_id, portal_key, map_type, selector, source, field_type, status, notes,
  token, mapping_generation
) VALUES
  ('18000000-0000-4000-a000-000000000064', 'm64_contract', 'web', '#contract-npi',
   'token', 'text', 'approved', 'MINT-64 synthetic Contract map', 'provider.npi', 1),
  ('18000000-0000-4000-a000-000000000064', 'm64_enrollment', 'web', '#enrollment-npi',
   'token', 'text', 'approved', 'MINT-64 synthetic Enrollment map', 'provider.npi', 1);

SELECT pg_temp.m64_mark('same_url_typed_configs_have_distinct_keys_and_types',
  (SELECT count(*) = 3
      AND count(DISTINCT portal_key) = 3
      AND bool_and(requires_explicit_selection)
      AND bool_and(form_url = 'https://same.example.invalid/application')
     FROM public.portals
    WHERE id IN ('38000000-0000-4000-a000-000000000064',
                 '38000000-0000-4000-a000-000000000065',
                 '38000000-0000-4000-a000-000000000066'))
  AND (SELECT count(*) = 3 AND count(DISTINCT case_type) = 3
         FROM public.portals
        WHERE portal_key IN ('m64_contract', 'm64_enrollment', 'm64_recredentialing')));
SELECT pg_temp.m64_mark('same_url_keys_keep_separate_keyed_maps_and_proof_state',
  (SELECT is_verified AND proven_at IS NOT NULL
     FROM public.portals WHERE portal_key = 'm64_contract'
       AND org_id = '18000000-0000-4000-a000-000000000064')
  AND (SELECT NOT is_verified AND last_verified_at IS NULL AND proven_at IS NULL
         FROM public.portals WHERE portal_key = 'm64_enrollment'
           AND org_id = '18000000-0000-4000-a000-000000000064')
  AND (SELECT count(*) = 2 AND count(DISTINCT portal_key) = 2
          AND count(DISTINCT selector) = 2 AND bool_and(mapping_generation = 1)
         FROM public.portal_field_maps
        WHERE org_id = '18000000-0000-4000-a000-000000000064'
          AND portal_key IN ('m64_contract', 'm64_enrollment'))
  AND EXISTS (SELECT 1 FROM public.portal_field_maps
               WHERE org_id = '18000000-0000-4000-a000-000000000064'
                 AND portal_key = 'm64_contract' AND selector = '#contract-npi'
                 AND status = 'approved' AND token = 'provider.npi')
  AND EXISTS (SELECT 1 FROM public.portal_field_maps
               WHERE org_id = '18000000-0000-4000-a000-000000000064'
                 AND portal_key = 'm64_enrollment' AND selector = '#enrollment-npi'
                 AND status = 'approved' AND token = 'provider.npi'));
SELECT pg_temp.m64_mark('contract_and_enrollment_sop_snapshots_bind_their_exact_key',
  EXISTS (
    SELECT 1 FROM public.sop_template_versions
     WHERE template_id = '69000000-0000-4000-a000-000000000064'
       AND version = 1 AND case_type = 'contract'
       AND task_definitions->0->'steps'->0->>'portalKey' = 'm64_contract'
  )
  AND EXISTS (
    SELECT 1 FROM public.sop_template_versions
     WHERE template_id = '69000000-0000-4000-a000-000000000065'
       AND version = 1 AND case_type = 'enrollment'
       AND task_definitions->0->'steps'->0->>'portalKey' = 'm64_enrollment'
       AND task_definitions->0->'steps'->1->>'portalKey' = 'm64_enrollment'
  ));
SELECT pg_temp.m64_mark('cross_type_sop_binding_is_rejected',
  pg_temp.m64_expect_message(
    'sop_portal_binding_ineligible',
    $$INSERT INTO public.sop_templates(
        id, org_id, name, payer_id, state, states, group_id, task_definitions,
        archived, current_version, required_profile_attributes, case_type
      ) VALUES (
        '69000000-0000-4000-a000-000000000067',
        '18000000-0000-4000-a000-000000000064', 'MINT-64 Wrong Contract Key',
        '28000000-0000-4000-a000-000000000064', 'NY', ARRAY['NY']::text[],
        '49000000-0000-4000-a000-000000000064',
        '[{"title":"Wrong form","steps":[{"stepType":"online_form","portalKey":"m64_enrollment"}]}]'::jsonb,
        false, 1, '[]'::jsonb, 'contract'
      )$$
  ));

-- Save the complete active Enrollment owner and task rows. The Contract fill
-- below must be observationally separate from this credentialing case.
CREATE TEMP TABLE m64_enrollment_snapshot AS
SELECT to_jsonb(case_row) AS case_row,
       (SELECT jsonb_agg(to_jsonb(task_row) ORDER BY task_row.id)
          FROM public.tasks AS task_row
         WHERE task_row.case_id = case_row.id) AS task_rows
  FROM public.credential_cases AS case_row
 WHERE case_row.id = '49000000-0000-4000-a000-000000000064';

-- Plain CI PostgreSQL does not give service_role Supabase's hosted bypass
-- attribute. Narrow transaction-local grants and policies expose only these
-- synthetic rows to the tested writer routines.
GRANT USAGE ON SCHEMA auth, public TO service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO service_role;
GRANT SELECT ON public.memberships, public.profiles, public.payers, public.portals,
  public.case_facilities, public.fill_sessions, public.touches, public.tasks,
  public.credential_cases, public.contracts, public.contract_sop_assignments,
  public.sop_templates, public.sop_template_versions, public.providers,
  public.provider_groups, public.provider_group_assignments TO service_role;
GRANT INSERT ON public.fill_sessions, public.touches, public.audit_log TO service_role;
GRANT UPDATE ON public.tasks, public.credential_cases, public.portals,
  public.contract_sop_assignments TO service_role;

CREATE POLICY m64_service_membership_select ON public.memberships
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_profile_select ON public.profiles
  FOR SELECT TO service_role USING (id = '39000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_payer_select ON public.payers
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_portal_select ON public.portals
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_portal_update ON public.portals
  FOR UPDATE TO service_role USING (org_id = '18000000-0000-4000-a000-000000000064')
  WITH CHECK (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_facility_select ON public.case_facilities
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_fill_select ON public.fill_sessions
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_fill_insert ON public.fill_sessions
  FOR INSERT TO service_role WITH CHECK (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_touch_select ON public.touches
  FOR SELECT TO service_role USING (true);
CREATE POLICY m64_service_touch_insert ON public.touches
  FOR INSERT TO service_role WITH CHECK (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_task_select ON public.tasks
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_task_update ON public.tasks
  FOR UPDATE TO service_role USING (org_id = '18000000-0000-4000-a000-000000000064')
  WITH CHECK (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_case_select ON public.credential_cases
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_case_update ON public.credential_cases
  FOR UPDATE TO service_role USING (org_id = '18000000-0000-4000-a000-000000000064')
  WITH CHECK (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_contract_select ON public.contracts
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_assignment_select ON public.contract_sop_assignments
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_assignment_update ON public.contract_sop_assignments
  FOR UPDATE TO service_role USING (org_id = '18000000-0000-4000-a000-000000000064')
  WITH CHECK (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_template_select ON public.sop_templates
  FOR SELECT TO service_role USING (
    org_id = '18000000-0000-4000-a000-000000000064' OR org_id IS NULL
  );
CREATE POLICY m64_service_template_version_select ON public.sop_template_versions
  FOR SELECT TO service_role USING (
    EXISTS (SELECT 1 FROM public.sop_templates template
             WHERE template.id = template_id
               AND (template.org_id = '18000000-0000-4000-a000-000000000064'
                    OR template.org_id IS NULL))
  );
CREATE POLICY m64_service_provider_select ON public.providers
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_group_select ON public.provider_groups
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_group_assignment_select ON public.provider_group_assignments
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000064');
CREATE POLICY m64_service_audit_insert ON public.audit_log
  FOR INSERT TO service_role WITH CHECK (org_id = '18000000-0000-4000-a000-000000000064');

SELECT set_config('request.jwt.claim.sub', '39000000-0000-4000-a000-000000000064', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-a000-000000000064","role":"service_role"}', true
);
SET LOCAL ROLE service_role;

INSERT INTO public.fill_sessions(
  id, org_id, case_id, contract_id, contract_sop_assignment_id,
  sop_template_id, sop_version, task_index, step_index, step_identity,
  context_version, launch_receipt_id, mapping_generation,
  effective_mapping_fingerprint, portal_id, provider_id, portal_key,
  fill_mode, fields_filled, fields_skipped, is_test, event_schema_version,
  fields_attempted, fields_verified, fields_rejected, field_outcomes, performed_by
) VALUES (
  '79000000-0000-4000-a000-000000000065',
  '18000000-0000-4000-a000-000000000064', NULL,
  '29000000-0000-4000-a000-000000000064',
  '79000000-0000-4000-a000-000000000064',
  '69000000-0000-4000-a000-000000000064', 1, 0, 0,
  '29000000-0000-4000-a000-000000000064:18000000-0000-4000-a000-000000000064:79000000-0000-4000-a000-000000000064:1:1:0:0',
  1, '79000000-0000-4000-a000-000000000065', 1,
  'sha256:' || repeat('b', 64),
  '38000000-0000-4000-a000-000000000064',
  '39000000-0000-4000-a000-000000000065', 'm64_contract',
  'web', 0, '[]'::jsonb, false, 2, 0, 0, 0, '[]'::jsonb,
  '39000000-0000-4000-a000-000000000064'
);
SELECT pg_temp.m64_mark('contract_fill_receipt_has_exact_contract_owner',
  (SELECT contract_id = '29000000-0000-4000-a000-000000000064'
          AND case_id IS NULL
          AND contract_sop_assignment_id = '79000000-0000-4000-a000-000000000064'
          AND portal_id = '38000000-0000-4000-a000-000000000064'
          AND portal_key = 'm64_contract'
          AND step_identity LIKE '29000000-0000-4000-a000-000000000064:%'
     FROM public.fill_sessions
    WHERE id = '79000000-0000-4000-a000-000000000065'));

-- Historical clients may record an untyped receipt. It cannot be upgraded to
-- an exact Work submission because it lacks the task, step and config tuple.
INSERT INTO public.fill_sessions(
  id, org_id, case_id, provider_id, portal_key, fill_mode,
  fields_filled, fields_skipped, is_test, event_schema_version, performed_by
) VALUES (
  '79000000-0000-4000-a000-000000000066',
  '18000000-0000-4000-a000-000000000064',
  '49000000-0000-4000-a000-000000000064',
  '39000000-0000-4000-a000-000000000065', 'm64_enrollment',
  'web', 0, '[]'::jsonb, false, 1,
  '39000000-0000-4000-a000-000000000064'
);
SELECT pg_temp.m64_mark('legacy_client_receipt_cannot_submit_as_an_exact_step',
  (SELECT case_task_id IS NULL AND case_step_id IS NULL
          AND step_identity IS NULL AND portal_id IS NULL
     FROM public.fill_sessions
    WHERE id = '79000000-0000-4000-a000-000000000066')
  AND (SELECT case_status = 'in_progress' AND context_version = 1
         FROM public.credential_cases
        WHERE id = '49000000-0000-4000-a000-000000000064'));

INSERT INTO public.fill_sessions(
  id, org_id, case_id, case_task_id, case_step_id, step_identity,
  sop_template_id, sop_version, context_version, launch_receipt_id,
  mapping_generation, effective_mapping_fingerprint, portal_id, provider_id,
  portal_key, fill_mode, fields_filled, fields_skipped, is_test,
  event_schema_version, fields_attempted, fields_verified, fields_rejected,
  field_outcomes, performed_by
) VALUES (
  '79000000-0000-4000-a000-000000000067',
  '18000000-0000-4000-a000-000000000064',
  '49000000-0000-4000-a000-000000000064',
  '99000000-0000-4000-a000-000000000064',
  '89000000-0000-4000-a000-000000000064',
  '49000000-0000-4000-a000-000000000064:99000000-0000-4000-a000-000000000064:69000000-0000-4000-a000-000000000065:1:89000000-0000-4000-a000-000000000064',
  '69000000-0000-4000-a000-000000000065', 1, 1,
  '79000000-0000-4000-a000-000000000067', 1,
  'sha256:' || repeat('a', 64),
  '38000000-0000-4000-a000-000000000065',
  '39000000-0000-4000-a000-000000000065', 'm64_enrollment', 'web',
  0, '[]'::jsonb, false, 2, 0, 0, 0, '[]'::jsonb,
  '39000000-0000-4000-a000-000000000064'
);

INSERT INTO m64_submission_result(name, result)
SELECT 'legacy_client_submission', public.record_typed_enrollment_submission(
  '18000000-0000-4000-a000-000000000064',
  '39000000-0000-4000-a000-000000000064',
  '49000000-0000-4000-a000-000000000064',
  'aa000000-0000-4000-a000-000000000064',
  '79000000-0000-4000-a000-000000000066',
  pg_temp.m64_work_context(
    '49000000-0000-4000-a000-000000000064',
    '99000000-0000-4000-a000-000000000064',
    '89000000-0000-4000-a000-000000000064',
    '79000000-0000-4000-a000-000000000066',
    '69000000-0000-4000-a000-000000000065',
    '38000000-0000-4000-a000-000000000065', 'm64_enrollment', 1
  ),
  '{"note":null,"payerReferenceId":null,"wipNote":null,"pdfFilename":null}'::jsonb
);
SELECT pg_temp.m64_mark('legacy_exact_submission_is_rejected_without_touch_or_completion',
  (SELECT result->>'kind' = 'rejected' AND result->>'status' = '409'
     FROM m64_submission_result WHERE name = 'legacy_client_submission')
  AND NOT EXISTS (SELECT 1 FROM public.touches
                   WHERE id = 'aa000000-0000-4000-a000-000000000064')
  AND (SELECT step->>'isCompleted' = 'false'
         FROM public.tasks task_row,
              LATERAL jsonb_array_elements(task_row.sop_content) AS item(step)
        WHERE task_row.id = '99000000-0000-4000-a000-000000000064'
          AND item.step->>'id' = '89000000-0000-4000-a000-000000000064'));

SELECT pg_temp.m64_mark('contract_receipt_left_enrollment_case_and_tasks_unchanged',
  EXISTS (
    SELECT 1 FROM m64_enrollment_snapshot AS before
     JOIN public.credential_cases AS case_row
       ON case_row.id = '49000000-0000-4000-a000-000000000064'
     WHERE before.case_row = to_jsonb(case_row)
       AND before.task_rows = (
         SELECT jsonb_agg(to_jsonb(task_row) ORDER BY task_row.id)
           FROM public.tasks AS task_row
          WHERE task_row.case_id = case_row.id
       )
  ));

INSERT INTO m64_submission_result(name, result)
SELECT 'exact_enrollment_submission', public.record_typed_enrollment_submission(
  '18000000-0000-4000-a000-000000000064',
  '39000000-0000-4000-a000-000000000064',
  '49000000-0000-4000-a000-000000000064',
  'aa000000-0000-4000-a000-000000000065',
  '79000000-0000-4000-a000-000000000067',
  pg_temp.m64_work_context(
    '49000000-0000-4000-a000-000000000064',
    '99000000-0000-4000-a000-000000000064',
    '89000000-0000-4000-a000-000000000064',
    '79000000-0000-4000-a000-000000000067',
    '69000000-0000-4000-a000-000000000065',
    '38000000-0000-4000-a000-000000000065', 'm64_enrollment', 1
  ),
  '{"note":"Synthetic operator confirmed the exact step","payerReferenceId":null,"wipNote":null,"pdfFilename":null}'::jsonb
);
SELECT pg_temp.m64_mark('exact_submission_completes_only_selected_enrollment_step',
  (SELECT result->>'kind' = 'created'
     FROM m64_submission_result WHERE name = 'exact_enrollment_submission')
  AND (SELECT step->>'isCompleted' = 'true'
         FROM public.tasks task_row,
              LATERAL jsonb_array_elements(task_row.sop_content) AS item(step)
        WHERE task_row.id = '99000000-0000-4000-a000-000000000064'
          AND item.step->>'id' = '89000000-0000-4000-a000-000000000064')
  AND (SELECT step->>'isCompleted' = 'false'
         FROM public.tasks task_row,
              LATERAL jsonb_array_elements(task_row.sop_content) AS item(step)
        WHERE task_row.id = '99000000-0000-4000-a000-000000000064'
          AND item.step->>'id' = '89000000-0000-4000-a000-000000000065'));
SELECT pg_temp.m64_mark('sibling_task_row_is_unchanged',
  (SELECT status = 'not_started'
          AND sop_content = '[{"id":"89000000-0000-4000-a000-000000000066","label":"Sibling form","stepType":"online_form","portalKey":"m64_enrollment","order":0,"isCompleted":false}]'::jsonb
     FROM public.tasks WHERE id = '99000000-0000-4000-a000-000000000065')
  AND (SELECT count(*) = 1 FROM public.touches
        WHERE case_id = '49000000-0000-4000-a000-000000000064'
          AND task_id = '99000000-0000-4000-a000-000000000064'
          AND fill_session_id = '79000000-0000-4000-a000-000000000067'));

-- M44 intentionally permits new credential_cases rows only for Enrollment.
-- Prove the current Enrollment-only submission boundary without fabricating a
-- Recredentialing case: pair a valid Enrollment receipt with an otherwise
-- well-formed Recredentialing SOP/portal tuple. The RPC must reject that
-- mismatched context before attempting a touch or completing the step.
INSERT INTO public.fill_sessions(
  id, org_id, case_id, case_task_id, case_step_id, step_identity,
  sop_template_id, sop_version, context_version, launch_receipt_id,
  mapping_generation, effective_mapping_fingerprint, portal_id, provider_id,
  portal_key, fill_mode, fields_filled, fields_skipped, is_test,
  event_schema_version, fields_attempted, fields_verified, fields_rejected,
  field_outcomes, performed_by
) VALUES (
  '79000000-0000-4000-a000-000000000068',
  '18000000-0000-4000-a000-000000000064',
  '49000000-0000-4000-a000-000000000064',
  '99000000-0000-4000-a000-000000000064',
  '89000000-0000-4000-a000-000000000065',
  '49000000-0000-4000-a000-000000000064:99000000-0000-4000-a000-000000000064:69000000-0000-4000-a000-000000000065:1:89000000-0000-4000-a000-000000000065',
  '69000000-0000-4000-a000-000000000065', 1,
  (SELECT case_row.context_version FROM public.credential_cases AS case_row
    WHERE case_row.id = '49000000-0000-4000-a000-000000000064'),
  '79000000-0000-4000-a000-000000000068', 1,
  'sha256:' || repeat('c', 64),
  '38000000-0000-4000-a000-000000000065',
  '39000000-0000-4000-a000-000000000065', 'm64_enrollment', 'web',
  0, '[]'::jsonb, false, 2, 0, 0, 0, '[]'::jsonb,
  '39000000-0000-4000-a000-000000000064'
);
SELECT pg_temp.m64_mark('enrollment_fill_receipt_is_valid_for_recredentialing_context_negative',
  EXISTS (SELECT 1 FROM public.fill_sessions
           WHERE id = '79000000-0000-4000-a000-000000000068'
             AND case_id = '49000000-0000-4000-a000-000000000064'
             AND case_task_id = '99000000-0000-4000-a000-000000000064'
             AND case_step_id = '89000000-0000-4000-a000-000000000065'
             AND sop_template_id = '69000000-0000-4000-a000-000000000065'
             AND context_version = (SELECT case_row.context_version
                                      FROM public.credential_cases AS case_row
                                     WHERE case_row.id = '49000000-0000-4000-a000-000000000064')
             AND portal_id = '38000000-0000-4000-a000-000000000065'
             AND portal_key = 'm64_enrollment'
             AND event_schema_version = 2));

-- Pass Recredentialing context for the valid Enrollment receipt. This exercises
-- the explicit tuple guard; it does not imply that a Recredentialing case row
-- is currently a supported credential_cases insert.
INSERT INTO m64_submission_result(name, result)
SELECT 'recredentialing_context_on_enrollment_case', public.record_typed_enrollment_submission(
  '18000000-0000-4000-a000-000000000064',
  '39000000-0000-4000-a000-000000000064',
  '49000000-0000-4000-a000-000000000064',
  'aa000000-0000-4000-a000-000000000066',
  '79000000-0000-4000-a000-000000000068',
  pg_temp.m64_work_context(
    '49000000-0000-4000-a000-000000000064',
    '99000000-0000-4000-a000-000000000064',
    '89000000-0000-4000-a000-000000000065',
    '79000000-0000-4000-a000-000000000068',
    '69000000-0000-4000-a000-000000000066',
    '38000000-0000-4000-a000-000000000066', 'm64_recredentialing',
    (SELECT case_row.context_version FROM public.credential_cases AS case_row
      WHERE case_row.id = '49000000-0000-4000-a000-000000000064')
  ),
  '{"note":null,"payerReferenceId":null,"wipNote":null,"pdfFilename":null}'::jsonb
);
SELECT pg_temp.m64_mark('recredentialing_context_cannot_submit_enrollment_step',
  (SELECT result->>'kind' = 'rejected' AND result->>'status' = '409'
          AND result->>'message' = 'Enrollment Work context is stale or mismatched'
     FROM m64_submission_result WHERE name = 'recredentialing_context_on_enrollment_case')
  AND EXISTS (SELECT 1 FROM public.fill_sessions
               WHERE id = '79000000-0000-4000-a000-000000000068'
                 AND case_id = '49000000-0000-4000-a000-000000000064'
                 AND portal_id = '38000000-0000-4000-a000-000000000065')
  AND NOT EXISTS (SELECT 1 FROM public.touches
                   WHERE id = 'aa000000-0000-4000-a000-000000000066')
  AND (SELECT step->>'isCompleted' = 'false'
         FROM public.tasks task_row,
              LATERAL jsonb_array_elements(task_row.sop_content) AS item(step)
        WHERE task_row.id = '99000000-0000-4000-a000-000000000064'
          AND item.step->>'id' = '89000000-0000-4000-a000-000000000065'));

RESET ROLE;
DO $$
DECLARE failures text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO failures
    FROM pg_temp.m64_results WHERE NOT passed;
  IF failures IS NOT NULL THEN
    RAISE EXCEPTION 'MINT-64 integrated checks failed: %', failures;
  END IF;
END;
$$;

TABLE pg_temp.m64_results;
ROLLBACK;
