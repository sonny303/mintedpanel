-- MINT-60 atomic reset regression packet. Run only in disposable migration CI:
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/mint60-atomic-mapping-reset.sql
-- All synthetic rows, test trigger and receipts are rolled back at the end.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE m60_results (name text PRIMARY KEY, passed boolean NOT NULL);
GRANT ALL ON m60_results TO authenticated;
CREATE FUNCTION pg_temp.m60_mark(p_name text, p_passed boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pg_temp.m60_results VALUES (p_name, coalesce(p_passed, false));
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.m60_mark(text, boolean) TO authenticated;
CREATE FUNCTION pg_temp.m60_expect_state(p_state text, p_statement text) RETURNS boolean
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
GRANT EXECUTE ON FUNCTION pg_temp.m60_expect_state(text, text) TO authenticated;
CREATE FUNCTION pg_temp.m60_expect_message(p_fragment text, p_statement text) RETURNS boolean
LANGUAGE plpgsql AS $$
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
GRANT EXECUTE ON FUNCTION pg_temp.m60_expect_message(text, text) TO authenticated;
CREATE FUNCTION pg_temp.m60_tuple(p_fill_id uuid, p_context_version integer, p_generation integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'launchReceiptId', p_fill_id,
    'orgId', '18000000-0000-4000-a000-000000000060'::uuid,
    'ownerKind', 'case',
    'ownerId', '58000000-0000-4000-a000-000000000065'::uuid,
    'contextVersion', p_context_version,
    'sopTemplateId', '69000000-0000-4000-a000-000000000060'::uuid,
    'sopVersion', 1,
    'portalId', '38000000-0000-4000-a000-000000000061'::uuid,
    'portalKey', 'm60_shared',
    'mappingGeneration', p_generation,
    'effectiveMappingFingerprint', 'sha256:' || repeat(CASE WHEN p_generation = 1 THEN 'a' ELSE 'b' END, 64),
    'providerId', '48000000-0000-4000-a000-000000000060'::uuid,
    'facilityId', NULL,
    'stepIdentity', '58000000-0000-4000-a000-000000000065:99000000-0000-4000-a000-000000000065:69000000-0000-4000-a000-000000000060:1:89000000-0000-4000-a000-000000000065',
    'taskId', '99000000-0000-4000-a000-000000000065'::uuid,
    'stepId', '89000000-0000-4000-a000-000000000065'::uuid
  );
$$;
CREATE FUNCTION pg_temp.m60_seed_fill(p_fill_id uuid, p_context_version integer, p_generation integer)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.fill_sessions(
    id, org_id, case_id, case_task_id, case_step_id, step_identity,
    sop_template_id, sop_version, context_version, launch_receipt_id,
    mapping_generation, shared_mapping_generation, effective_mapping_fingerprint,
    portal_id, provider_id, portal_key, fill_mode, fields_filled, fields_skipped,
    is_test, event_schema_version, fields_attempted, fields_verified,
    fields_rejected, field_outcomes, performed_by
  ) VALUES (
    p_fill_id, '18000000-0000-4000-a000-000000000060',
    '58000000-0000-4000-a000-000000000065',
    '99000000-0000-4000-a000-000000000065',
    '89000000-0000-4000-a000-000000000065',
    '58000000-0000-4000-a000-000000000065:99000000-0000-4000-a000-000000000065:69000000-0000-4000-a000-000000000060:1:89000000-0000-4000-a000-000000000065',
    '69000000-0000-4000-a000-000000000060', 1, p_context_version, p_fill_id,
    1, p_generation, 'sha256:' || repeat(CASE WHEN p_generation = 1 THEN 'a' ELSE 'b' END, 64),
    '38000000-0000-4000-a000-000000000061',
    '48000000-0000-4000-a000-000000000060', 'm60_shared', 'web', 0, '[]'::jsonb,
    false, 2, 0, 0, 0, '[]'::jsonb, '39000000-0000-4000-a000-000000000060'
  );
$$;
CREATE FUNCTION pg_temp.m60_seed_contract_fill(p_fill_id uuid, p_shared_generation integer)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.fill_sessions(
    id, org_id, case_id, contract_id, contract_sop_assignment_id,
    sop_template_id, sop_version, task_index, step_index, step_identity,
    context_version, launch_receipt_id, mapping_generation,
    shared_mapping_generation, effective_mapping_fingerprint, portal_id,
    provider_id, portal_key, fill_mode, fields_filled, fields_skipped,
    is_test, event_schema_version, fields_attempted, fields_verified,
    fields_rejected, field_outcomes, performed_by
  ) VALUES (
    p_fill_id, '18000000-0000-4000-a000-000000000060', NULL,
    '29000000-0000-4000-a000-000000000060',
    '79000000-0000-4000-a000-000000000075',
    '69000000-0000-4000-a000-000000000061', 1, 0, 0,
    '29000000-0000-4000-a000-000000000060:18000000-0000-4000-a000-000000000060:79000000-0000-4000-a000-000000000075:1:69000000-0000-4000-a000-000000000061:1:0:0',
    1, p_fill_id, 1, p_shared_generation, 'sha256:' || repeat('c', 64),
    '38000000-0000-4000-a000-000000000066',
    '48000000-0000-4000-a000-000000000060', 'm60_contract_shared', 'web',
    0, '[]'::jsonb, false, 2, 0, 0, 0, '[]'::jsonb,
    '39000000-0000-4000-a000-000000000060'
  );
$$;
CREATE FUNCTION pg_temp.m60_call(p_touch_id uuid, p_fill_id uuid, p_context_version integer, p_generation integer)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.record_typed_enrollment_submission(
    '18000000-0000-4000-a000-000000000060'::uuid,
    '39000000-0000-4000-a000-000000000060'::uuid,
    '58000000-0000-4000-a000-000000000065'::uuid,
    p_touch_id,
    p_fill_id,
    pg_temp.m60_tuple(p_fill_id, p_context_version, p_generation),
    '{"note":null,"payerReferenceId":null,"wipNote":null,"pdfFilename":null}'::jsonb
  );
$$;

INSERT INTO auth.users(id, email) VALUES
  ('39000000-0000-4000-a000-000000000060', 'm60-resetter@example.invalid'),
  ('39000000-0000-4000-a000-000000000061', 'm60-outsider@example.invalid');
INSERT INTO public.profiles(id, full_name, email) VALUES
  ('39000000-0000-4000-a000-000000000060', 'MINT-60 Resetter', 'm60-resetter@example.invalid'),
  ('39000000-0000-4000-a000-000000000061', 'MINT-60 Outsider', 'm60-outsider@example.invalid');
INSERT INTO public.organizations(id, name) VALUES
  ('18000000-0000-4000-a000-000000000060', 'MINT-60 Reset Org'),
  ('18000000-0000-4000-a000-000000000061', 'MINT-60 Other Org');
INSERT INTO public.memberships(org_id, user_id, role) VALUES
  ('18000000-0000-4000-a000-000000000060', '39000000-0000-4000-a000-000000000060', 'specialist'),
  ('18000000-0000-4000-a000-000000000061', '39000000-0000-4000-a000-000000000061', 'specialist');
INSERT INTO public.payers(id, org_id, name) VALUES
  ('28000000-0000-4000-a000-000000000060', '18000000-0000-4000-a000-000000000060', 'MINT-60 Reset Payer');
INSERT INTO public.providers(id, org_id, first_name, last_name) VALUES
  ('48000000-0000-4000-a000-000000000060', '18000000-0000-4000-a000-000000000060', 'Synthetic', 'Provider');
INSERT INTO public.provider_groups(id, org_id, name) VALUES
  ('49000000-0000-4000-a000-000000000060', '18000000-0000-4000-a000-000000000060', 'MINT-60 Contract Group');
INSERT INTO public.provider_group_assignments(org_id, provider_id, group_id, is_primary) VALUES
  ('18000000-0000-4000-a000-000000000060', '48000000-0000-4000-a000-000000000060',
   '49000000-0000-4000-a000-000000000060', true);
INSERT INTO public.credential_cases(
  id, org_id, provider_id, payer_id, state, created_by
) VALUES (
  '58000000-0000-4000-a000-000000000060',
  '18000000-0000-4000-a000-000000000060',
  '48000000-0000-4000-a000-000000000060',
  '28000000-0000-4000-a000-000000000060', 'CA',
  '39000000-0000-4000-a000-000000000060'
);

INSERT INTO public.portals(
  id, org_id, portal_key, name, payer_id, form_url, case_type,
  requires_explicit_selection, mapping_generation, is_verified, last_verified_at, proven_at
) VALUES
  ('38000000-0000-4000-a000-000000000060', NULL, 'm60_shared', 'MINT-60 Shared',
   '28000000-0000-4000-a000-000000000060', 'https://same.example.invalid/form',
   NULL, false, 1, true, now(), now()),
  ('38000000-0000-4000-a000-000000000061', '18000000-0000-4000-a000-000000000060',
   'm60_shared', 'MINT-60 Shared Override', '28000000-0000-4000-a000-000000000060',
   'https://same.example.invalid/form', 'enrollment', true, 1, true, now(), now()),
  ('38000000-0000-4000-a000-000000000062', NULL, 'm60_sibling', 'MINT-60 Same URL Sibling',
   '28000000-0000-4000-a000-000000000060', 'https://same.example.invalid/form',
   'enrollment', true, 1, true, now(), now()),
  ('38000000-0000-4000-a000-000000000063', '18000000-0000-4000-a000-000000000060',
   'm60_org_only', 'MINT-60 Org Only', '28000000-0000-4000-a000-000000000060',
   'https://org.example.invalid/form', 'enrollment', true, 1, true, now(), now()),
  ('38000000-0000-4000-a000-000000000064', '18000000-0000-4000-a000-000000000060',
   'm60_failure', 'MINT-60 Failure Target', '28000000-0000-4000-a000-000000000060',
   'https://failure.example.invalid/form', 'enrollment', true, 1, true, now(), now()),
  ('38000000-0000-4000-a000-000000000065', NULL, 'm60_contract_shared',
   'MINT-60 shared Contract form', '28000000-0000-4000-a000-000000000060',
   'https://contract.example.invalid/shared', NULL, false, 1, true, now(), now()),
  ('38000000-0000-4000-a000-000000000066', '18000000-0000-4000-a000-000000000060',
   'm60_contract_shared', 'MINT-60 org Contract form', '28000000-0000-4000-a000-000000000060',
   'https://contract.example.invalid/org', 'contract', true, 1, true, now(), now()),
  ('38000000-0000-4000-a000-000000000067', NULL,
   'm60_shadow_incompatible', 'MINT-60 shared Contract shadow',
   '28000000-0000-4000-a000-000000000060', 'https://shadow.example.invalid/shared',
   'contract', true, 1, true, now(), now()),
  ('38000000-0000-4000-a000-000000000068', '18000000-0000-4000-a000-000000000060',
   'm60_shadow_incompatible', 'MINT-60 org Enrollment shadow',
   '28000000-0000-4000-a000-000000000060', 'https://shadow.example.invalid/org',
   'enrollment', true, 1, true, now(), now()),
  ('38000000-0000-4000-a000-000000000069', '18000000-0000-4000-a000-000000000060',
   'm60_hidden_only', '[hidden] MINT-60 hidden config',
   '28000000-0000-4000-a000-000000000060', 'https://hidden.example.invalid/form',
   'contract', true, 1, true, now(), now()),
  ('38000000-0000-4000-a000-000000000070', '18000000-0000-4000-a000-000000000060',
   'm60_org_only_key', 'MINT-60 org-only Contract form',
   '28000000-0000-4000-a000-000000000060', 'https://org-only.example.invalid/form',
   'contract', true, 1, true, now(), now()),
  ('38000000-0000-4000-a000-000000000071', NULL,
   'm60_global_only', 'MINT-60 global fallback form',
   '28000000-0000-4000-a000-000000000060', 'https://global-only.example.invalid/form',
   'contract', true, 1, true, now(), now());

-- More than a typical client page, with every status represented: the receipt
-- must count all rows in the selected exact-key/current generation.
SET LOCAL minted.expected_mapping_generation = '1';
INSERT INTO public.portal_field_maps(
  org_id, portal_key, map_type, selector, source, field_type, status, notes,
  token, hardcoded_value, mapping_generation
)
SELECT NULL, 'm60_shared', 'web', format('#m60-field-%s', n), 'manual', 'text',
       CASE WHEN n % 3 = 0 THEN 'approved' WHEN n % 3 = 1 THEN 'proposed' ELSE 'retired' END,
       'MINT-60 synthetic row', NULL, NULL, 1
  FROM generate_series(1, 137) AS n;
INSERT INTO public.portal_field_maps(
  org_id, portal_key, map_type, selector, source, field_type, status, notes, token,
  mapping_generation
) VALUES
  (NULL, 'm60_sibling', 'web', '#sibling-field', 'manual', 'text', 'approved', 'Synthetic sibling', NULL, 1),
  ('18000000-0000-4000-a000-000000000060', 'm60_shared', 'web', '#org-override',
   'token', 'text', 'approved', 'Synthetic override', 'provider.npi', 1),
  ('18000000-0000-4000-a000-000000000060', 'm60_org_only', 'web', '#org-only-field',
   'manual', 'text', 'proposed', 'Synthetic org-only field', NULL, 1),
  ('18000000-0000-4000-a000-000000000060', 'm60_failure', 'web', '#failure-field',
   'manual', 'text', 'proposed', 'Synthetic failure field', NULL, 1),
  (NULL, 'm60_contract_shared', 'web', '#contract-shared', 'token', 'text',
   'approved', 'MINT-60 Contract shared map', 'provider.npi', 1),
  ('18000000-0000-4000-a000-000000000060', 'm60_contract_shared', 'web', '#contract-org',
   'token', 'text', 'approved', 'MINT-60 Contract org map', 'provider.npi', 1);

INSERT INTO public.contracts(id, org_id, group_id, payer_id, state) VALUES (
  '29000000-0000-4000-a000-000000000060',
  '18000000-0000-4000-a000-000000000060',
  '49000000-0000-4000-a000-000000000060',
  '28000000-0000-4000-a000-000000000060', 'WA'
);
INSERT INTO public.sop_templates(
  id, org_id, name, payer_id, state, states, group_id, task_definitions,
  archived, current_version, required_profile_attributes, case_type
) VALUES (
  '69000000-0000-4000-a000-000000000061',
  '18000000-0000-4000-a000-000000000060', 'MINT-60 Contract SOP',
  '28000000-0000-4000-a000-000000000060', 'WA', ARRAY['WA']::text[],
  '49000000-0000-4000-a000-000000000060',
  '[{"title":"Contract application","steps":[{"label":"Contract form","stepType":"online_form","portalKey":"m60_contract_shared"}]}]'::jsonb,
  false, 1, '[]'::jsonb, 'contract'
);
INSERT INTO public.contract_sop_assignments(
  id, org_id, contract_id, sop_template_id, sop_version, context_version,
  created_by, updated_by
) VALUES (
  '79000000-0000-4000-a000-000000000075',
  '18000000-0000-4000-a000-000000000060',
  '29000000-0000-4000-a000-000000000060',
  '69000000-0000-4000-a000-000000000061', 1, 1,
  '39000000-0000-4000-a000-000000000060',
  '39000000-0000-4000-a000-000000000060'
);

INSERT INTO public.sop_templates(
  id, org_id, name, payer_id, state, states, task_definitions,
  archived, current_version, required_profile_attributes, case_type
) VALUES (
  '69000000-0000-4000-a000-000000000060',
  '18000000-0000-4000-a000-000000000060', 'MINT-60 referenced SOP',
  '28000000-0000-4000-a000-000000000060', 'CA', ARRAY['CA', 'OR']::text[],
  '[{"title":"Enrollment","steps":[{"stepType":"online_form","portalKey":"m60_shared"}]}]'::jsonb,
  false, 1, '[]'::jsonb, 'enrollment'
);

SELECT pg_temp.m60_mark('compatible_org_config_shadows_same_key_global_config',
  EXISTS (
    SELECT 1 FROM public.sop_templates
     WHERE id = '69000000-0000-4000-a000-000000000061'
       AND org_id = '18000000-0000-4000-a000-000000000060'
       AND case_type = 'contract'
  ));

INSERT INTO public.sop_templates(
  id, org_id, name, payer_id, state, states, task_definitions,
  archived, current_version, required_profile_attributes, case_type
) VALUES (
  '69000000-0000-4000-a000-000000000067',
  '18000000-0000-4000-a000-000000000060', 'MINT-60 org template uses global fallback',
  '28000000-0000-4000-a000-000000000060', 'WA', ARRAY['WA']::text[],
  '[{"title":"Contract","steps":[{"stepType":"online_form","portalKey":"m60_global_only"}]}]'::jsonb,
  false, 1, '[]'::jsonb, 'contract'
);
SELECT pg_temp.m60_mark('organization_template_uses_global_when_org_row_is_absent',
  EXISTS (
    SELECT 1 FROM public.sop_templates
     WHERE id = '69000000-0000-4000-a000-000000000067'
       AND org_id = '18000000-0000-4000-a000-000000000060'
       AND case_type = 'contract'
  ));

-- A global typed template only binds to the global row, even when the same
-- key has an incompatible organization override.
INSERT INTO public.sop_templates(
  id, org_id, name, payer_id, state, states, task_definitions,
  archived, current_version, required_profile_attributes, case_type
) VALUES (
  '69000000-0000-4000-a000-000000000062', NULL, 'MINT-60 global binding SOP',
  '28000000-0000-4000-a000-000000000060', 'WA', ARRAY['WA']::text[],
  '[{"title":"Contract","steps":[{"stepType":"online_form","portalKey":"m60_shadow_incompatible"}]}]'::jsonb,
  false, 1, '[]'::jsonb, 'contract'
);
SELECT pg_temp.m60_mark('global_template_uses_compatible_global_row_only',
  EXISTS (
    SELECT 1 FROM public.sop_templates
     WHERE id = '69000000-0000-4000-a000-000000000062'
       AND org_id IS NULL AND case_type = 'contract'
  ));

SELECT pg_temp.m60_mark('incompatible_org_override_does_not_fall_back_to_global',
  pg_temp.m60_expect_message(
    'sop_portal_binding_ineligible',
    $$INSERT INTO public.sop_templates(
        id, org_id, name, payer_id, state, states, task_definitions,
        archived, current_version, required_profile_attributes, case_type
      ) VALUES (
        '69000000-0000-4000-a000-000000000063',
        '18000000-0000-4000-a000-000000000060', 'MINT-60 incompatible shadow SOP',
        '28000000-0000-4000-a000-000000000060', 'WA', ARRAY['WA']::text[],
        '[{"title":"Contract","steps":[{"stepType":"online_form","portalKey":"m60_shadow_incompatible"}]}]'::jsonb,
        false, 1, '[]'::jsonb, 'contract'
      )$$
  ));

SELECT pg_temp.m60_mark('hidden_org_config_is_not_a_binding_candidate',
  pg_temp.m60_expect_message(
    'sop_portal_binding_ineligible',
    $$INSERT INTO public.sop_templates(
        id, org_id, name, payer_id, state, states, task_definitions,
        archived, current_version, required_profile_attributes, case_type
      ) VALUES (
        '69000000-0000-4000-a000-000000000064',
        '18000000-0000-4000-a000-000000000060', 'MINT-60 hidden binding SOP',
        '28000000-0000-4000-a000-000000000060', 'WA', ARRAY['WA']::text[],
        '[{"title":"Contract","steps":[{"stepType":"online_form","portalKey":"m60_hidden_only"}]}]'::jsonb,
        false, 1, '[]'::jsonb, 'contract'
      )$$
  ));

SELECT pg_temp.m60_mark('missing_portal_key_is_rejected',
  pg_temp.m60_expect_message(
    'sop_portal_binding_ineligible',
    $$INSERT INTO public.sop_templates(
        id, org_id, name, payer_id, state, states, task_definitions,
        archived, current_version, required_profile_attributes, case_type
      ) VALUES (
        '69000000-0000-4000-a000-000000000065',
        '18000000-0000-4000-a000-000000000060', 'MINT-60 missing binding SOP',
        '28000000-0000-4000-a000-000000000060', 'WA', ARRAY['WA']::text[],
        '[{"title":"Contract","steps":[{"stepType":"online_form","portalKey":"m60_missing_key"}]}]'::jsonb,
        false, 1, '[]'::jsonb, 'contract'
      )$$
  ));

SELECT pg_temp.m60_mark('global_template_cannot_bind_org_only_configuration',
  pg_temp.m60_expect_message(
    'sop_portal_binding_ineligible',
    $$INSERT INTO public.sop_templates(
        id, org_id, name, payer_id, state, states, task_definitions,
        archived, current_version, required_profile_attributes, case_type
      ) VALUES (
        '69000000-0000-4000-a000-000000000066', NULL, 'MINT-60 global cannot bind org-only SOP',
        '28000000-0000-4000-a000-000000000060', 'WA', ARRAY['WA']::text[],
        '[{"title":"Contract","steps":[{"stepType":"online_form","portalKey":"m60_org_only_key"}]}]'::jsonb,
        false, 1, '[]'::jsonb, 'contract'
      )$$
  ));

INSERT INTO public.fill_sessions(
  id, org_id, case_id, provider_id, portal_id, portal_key, performed_by, fields_filled
) VALUES (
  '78000000-0000-4000-a000-000000000060',
  '18000000-0000-4000-a000-000000000060',
  '58000000-0000-4000-a000-000000000060',
  '48000000-0000-4000-a000-000000000060',
  NULL, 'm60_shared',
  '39000000-0000-4000-a000-000000000060', 2
);

-- Authenticated legacy/test writes still pass through the SECURITY INVOKER
-- trigger without needing a service-role-only helper execution grant.
SELECT set_config('request.jwt.claim.sub', '39000000-0000-4000-a000-000000000060', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-a000-000000000060","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
INSERT INTO public.fill_sessions(
  id, org_id, case_id, provider_id, portal_id, portal_key, performed_by,
  fill_mode, fields_filled, fields_skipped, is_test, event_schema_version
) VALUES (
  '78000000-0000-4000-a000-000000000068',
  '18000000-0000-4000-a000-000000000060',
  '58000000-0000-4000-a000-000000000060',
  '48000000-0000-4000-a000-000000000060',
  NULL, 'm60_shared',
  '39000000-0000-4000-a000-000000000060', 'web', 0, '[]'::jsonb, true, 1
);
SELECT pg_temp.m60_mark('authenticated_legacy_test_fill_remains_unpinned',
  (SELECT shared_mapping_generation IS NULL AND event_schema_version = 1 AND is_test
     FROM public.fill_sessions WHERE id = '78000000-0000-4000-a000-000000000068'));
RESET ROLE;

-- A separate Enrollment task drives the M58 fill and human-submission guards
-- against this same-key global/org configuration pair.
INSERT INTO public.credential_cases(
  id, org_id, provider_id, payer_id, state, case_type, case_status
) VALUES (
  '58000000-0000-4000-a000-000000000065',
  '18000000-0000-4000-a000-000000000060',
  '48000000-0000-4000-a000-000000000060',
  '28000000-0000-4000-a000-000000000060', 'OR', 'enrollment', 'not_started'
);
INSERT INTO public.tasks(
  id, org_id, case_id, provider_id, title, sop_content, status, sort_order,
  sop_template_id, sop_version, execution_type
) VALUES (
  '99000000-0000-4000-a000-000000000065',
  '18000000-0000-4000-a000-000000000060',
  '58000000-0000-4000-a000-000000000065',
  '48000000-0000-4000-a000-000000000060', 'MINT-60 shared-base receipt',
  '[{"id":"89000000-0000-4000-a000-000000000065","label":"Shared-base form","stepType":"online_form","portalKey":"m60_shared","order":0,"isCompleted":false}]'::jsonb,
  'not_started', 1, '69000000-0000-4000-a000-000000000060', 1, 'extension_fill'
);

-- The migration CI service_role lacks hosted BYPASSRLS; these transaction-
-- local grants/policies model its existing tenant-scoped app boundary.
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO service_role;
GRANT SELECT ON public.memberships, public.profiles, public.payers, public.portals,
  public.case_facilities, public.fill_sessions, public.touches, public.tasks,
  public.credential_cases, public.portal_field_maps TO service_role;
GRANT INSERT ON public.fill_sessions, public.touches, public.audit_log TO service_role;
GRANT UPDATE ON public.tasks, public.credential_cases, public.portals TO service_role;
CREATE POLICY m60_test_service_membership_select ON public.memberships
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000060');
CREATE POLICY m60_test_service_profile_select ON public.profiles
  FOR SELECT TO service_role USING (id = '39000000-0000-4000-a000-000000000060');
CREATE POLICY m60_test_service_payer_select ON public.payers
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000060');
CREATE POLICY m60_test_service_portal_select ON public.portals
  FOR SELECT TO service_role USING (org_id IS NULL OR org_id = '18000000-0000-4000-a000-000000000060');
CREATE POLICY m60_test_service_portal_update ON public.portals
  FOR UPDATE TO service_role USING (org_id IS NULL OR org_id = '18000000-0000-4000-a000-000000000060')
  WITH CHECK (org_id IS NULL OR org_id = '18000000-0000-4000-a000-000000000060');
CREATE POLICY m60_test_service_fill_select ON public.fill_sessions
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000060');
CREATE POLICY m60_test_service_fill_insert ON public.fill_sessions
  FOR INSERT TO service_role WITH CHECK (org_id = '18000000-0000-4000-a000-000000000060');
CREATE POLICY m60_test_service_touch_select ON public.touches
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000060');
CREATE POLICY m60_test_service_touch_insert ON public.touches
  FOR INSERT TO service_role WITH CHECK (org_id = '18000000-0000-4000-a000-000000000060');
CREATE POLICY m60_test_service_task_select ON public.tasks
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000060');
CREATE POLICY m60_test_service_task_update ON public.tasks
  FOR UPDATE TO service_role USING (org_id = '18000000-0000-4000-a000-000000000060')
  WITH CHECK (org_id = '18000000-0000-4000-a000-000000000060');
CREATE POLICY m60_test_service_case_select ON public.credential_cases
  FOR SELECT TO service_role USING (org_id = '18000000-0000-4000-a000-000000000060');
CREATE POLICY m60_test_service_case_update ON public.credential_cases
  FOR UPDATE TO service_role USING (org_id = '18000000-0000-4000-a000-000000000060')
  WITH CHECK (org_id = '18000000-0000-4000-a000-000000000060');
CREATE POLICY m60_test_service_map_select ON public.portal_field_maps
  FOR SELECT TO service_role USING (org_id IS NULL OR org_id = '18000000-0000-4000-a000-000000000060');
CREATE POLICY m60_test_service_audit_insert ON public.audit_log
  FOR INSERT TO service_role WITH CHECK (org_id = '18000000-0000-4000-a000-000000000060');
GRANT ALL ON m60_results TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.m60_mark(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.m60_expect_state(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.m60_tuple(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.m60_seed_fill(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.m60_seed_contract_fill(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.m60_call(uuid, uuid, integer, integer) TO service_role;
SELECT set_config('request.jwt.claim.sub', '39000000-0000-4000-a000-000000000060', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-a000-000000000060","role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;
SELECT pg_temp.m60_seed_contract_fill('78000000-0000-4000-a000-000000000069', 1);
SELECT pg_temp.m60_mark('typed_contract_shared_receipt_is_server_pinned_at_generation_one',
  (SELECT contract_id = '29000000-0000-4000-a000-000000000060'
          AND case_id IS NULL AND shared_mapping_generation = 1
     FROM public.fill_sessions WHERE id = '78000000-0000-4000-a000-000000000069'));
SELECT pg_temp.m60_seed_fill('78000000-0000-4000-a000-000000000065', 1, 1);
SELECT pg_temp.m60_mark('typed_org_shared_receipt_is_server_pinned_at_generation_one',
  (SELECT shared_mapping_generation = 1 AND did_auto_start_case
     FROM public.fill_sessions WHERE id = '78000000-0000-4000-a000-000000000065')
  AND (SELECT case_status = 'in_progress' AND context_version = 2
     FROM public.credential_cases WHERE id = '58000000-0000-4000-a000-000000000065'));
RESET ROLE;

SELECT pg_temp.m60_mark('reset_function_grant_is_narrow',
  has_function_privilege(
    'authenticated', 'public.reset_portal_mapping(uuid,integer,uuid)', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon', 'public.reset_portal_mapping(uuid,integer,uuid)', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role', 'public.reset_portal_mapping(uuid,integer,uuid)', 'EXECUTE'
  ));

CREATE TEMP TABLE m60_first_receipt AS
SELECT * FROM public.form_mapping_reset_events WHERE false;
CREATE TEMP TABLE m60_org_receipt AS
SELECT * FROM public.form_mapping_reset_events WHERE false;
CREATE TEMP TABLE m60_recaptured_map(id uuid);
GRANT ALL ON m60_first_receipt, m60_org_receipt TO authenticated;
GRANT ALL ON m60_recaptured_map TO service_role;

SELECT pg_temp.m60_mark('replay_fixture_is_legacy_mutable_portal',
  (SELECT case_type IS NULL AND NOT requires_explicit_selection
     FROM public.portals WHERE id = '38000000-0000-4000-a000-000000000060'));

SELECT set_config('request.jwt.claim.sub', '39000000-0000-4000-a000-000000000060', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-a000-000000000060","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
WITH reset AS MATERIALIZED (
  SELECT public.reset_portal_mapping(
    '38000000-0000-4000-a000-000000000060', 1,
    '4fb29911-4b2e-4d83-965e-7019a8651e60'
  ) AS event
)
INSERT INTO m60_first_receipt SELECT (event).* FROM reset;
SELECT pg_temp.m60_mark('global_reset_increments_once_clears_proof_and_counts_all_rows',
  (SELECT old_mapping_generation = 1 AND new_mapping_generation = 2
          AND owner_scope = 'global' AND org_id IS NULL
          AND actor_id = '39000000-0000-4000-a000-000000000060'
          AND affected_field_count = 137
     FROM m60_first_receipt)
  AND (SELECT mapping_generation = 2 AND NOT is_verified
          AND last_verified_at IS NULL AND proven_at IS NULL
     FROM public.portals WHERE id = '38000000-0000-4000-a000-000000000060'));
SELECT pg_temp.m60_mark('authenticated_cannot_forge_reset_receipt',
  pg_temp.m60_expect_state(
    '42501',
    $$INSERT INTO public.form_mapping_reset_events(
        portal_id, owner_scope, portal_key, old_mapping_generation,
        new_mapping_generation, actor_id, affected_field_count, idempotency_key
      ) VALUES (
        '38000000-0000-4000-a000-000000000060', 'global', 'm60_shared',
        1, 2, '39000000-0000-4000-a000-000000000060', 0,
        '4fb29911-4b2e-4d83-965e-7019a8651e61'
      )$$
  ));
RESET ROLE;

-- Simulate a legacy mutable key snapshot. A retry of the same portal ID and
-- request returns its original receipt before checking the current generation.
-- MINT-57 guards every portal update, so key edits carry the live generation.
SET LOCAL minted.expected_mapping_generation = '2';
UPDATE public.portals
   SET portal_key = 'm60_shared_renamed'
 WHERE id = '38000000-0000-4000-a000-000000000060';
SET LOCAL ROLE authenticated;
WITH reset AS MATERIALIZED (
  SELECT public.reset_portal_mapping(
    '38000000-0000-4000-a000-000000000060', 1,
    '4fb29911-4b2e-4d83-965e-7019a8651e60'
  ) AS event
)
INSERT INTO m60_first_receipt SELECT (event).* FROM reset;
SELECT pg_temp.m60_mark('replay_survives_portal_key_rename_without_second_increment',
  (SELECT count(DISTINCT id) = 1 AND count(*) = 2
          AND min(portal_key) = 'm60_shared'
     FROM m60_first_receipt)
  AND (SELECT mapping_generation = 2 FROM public.portals
        WHERE id = '38000000-0000-4000-a000-000000000060'));
SELECT pg_temp.m60_mark('reused_idempotency_key_with_different_old_generation_conflicts',
  pg_temp.m60_expect_state(
    '23505',
    $$SELECT public.reset_portal_mapping(
        '38000000-0000-4000-a000-000000000060', 2,
        '4fb29911-4b2e-4d83-965e-7019a8651e60'
      )$$
  ));
SELECT pg_temp.m60_mark('stale_new_request_is_rejected',
  pg_temp.m60_expect_state(
    '40001',
    $$SELECT public.reset_portal_mapping(
        '38000000-0000-4000-a000-000000000060', 1,
        '4fb29911-4b2e-4d83-965e-7019a8651e62'
      )$$
  ));
RESET ROLE;

-- The same generation token remains current while the fixture key is restored.
UPDATE public.portals
   SET portal_key = 'm60_shared'
 WHERE id = '38000000-0000-4000-a000-000000000060';

SELECT pg_temp.m60_mark('same_url_sibling_and_historical_records_are_untouched',
  (SELECT mapping_generation = 1 AND is_verified AND proven_at IS NOT NULL
     FROM public.portals WHERE id = '38000000-0000-4000-a000-000000000062')
  AND (SELECT count(*) = 1 FROM public.portal_field_maps
        WHERE org_id IS NULL AND portal_key = 'm60_sibling'
          AND mapping_generation = 1)
  AND (SELECT count(*) = 1 FROM public.fill_sessions
        WHERE id = '78000000-0000-4000-a000-000000000060'
          AND shared_mapping_generation IS NULL)
  AND (SELECT task_definitions @> '[{"steps":[{"portalKey":"m60_shared"}]}]'::jsonb
     FROM public.sop_templates WHERE id = '69000000-0000-4000-a000-000000000060'));
SELECT pg_temp.m60_mark('shared_reset_retains_org_override_but_leaves_old_base',
  (SELECT mapping_generation = 1 AND shared_base_generation = 1
     FROM public.portal_field_maps
    WHERE org_id = '18000000-0000-4000-a000-000000000060'
      AND portal_key = 'm60_shared' AND selector = '#org-override')
  AND (SELECT mapping_generation = 1 FROM public.portals
        WHERE id = '38000000-0000-4000-a000-000000000061'));

-- A generation-one receipt created before reset cannot create a new human
-- submission after global generation two, and a new old-pin fill cannot race
-- through either the selected org portal or the unchanged org generation.
SELECT set_config('request.jwt.claim.sub', '39000000-0000-4000-a000-000000000060', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-a000-000000000060","role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;
SELECT pg_temp.m60_mark('new_fill_with_pre_reset_shared_pin_is_rejected',
  pg_temp.m60_expect_state(
    '40001',
    $$SELECT pg_temp.m60_seed_fill('78000000-0000-4000-a000-000000000066', 2, 1)$$
  ));
SELECT pg_temp.m60_mark('pre_reset_receipt_cannot_submit_after_shared_reset',
  (SELECT result->>'kind' = 'rejected' AND result->>'status' = '409'
     FROM (SELECT pg_temp.m60_call(
       'aa000000-0000-4000-a000-000000000065',
       '78000000-0000-4000-a000-000000000065', 1, 1
     ) AS result) AS attempted)
  AND NOT EXISTS (SELECT 1 FROM public.touches
                   WHERE id = 'aa000000-0000-4000-a000-000000000065')
  AND (SELECT sop_content->0->>'isCompleted' = 'false'
         FROM public.tasks WHERE id = '99000000-0000-4000-a000-000000000065')
  AND (SELECT case_status = 'in_progress'
         FROM public.credential_cases WHERE id = '58000000-0000-4000-a000-000000000065'));

-- Recapture stamps shared_base_generation=2. A new exact tuple can then fill
-- and submit while the organization portal generation remains one.
INSERT INTO m60_recaptured_map(id)
SELECT (public.capture_org_portal_field_map(
  '18000000-0000-4000-a000-000000000060', 1,
  '{"portal_key":"m60_shared","selector":"#m60-after-reset","field_label":"Recaptured field","field_type":"text"}'::jsonb
)->'map'->>'id')::uuid;
SELECT public.update_org_portal_field_map(
  '18000000-0000-4000-a000-000000000060',
  (SELECT id FROM m60_recaptured_map), 1,
  '{"status":"approved","source":"token","token":"provider.npi"}'::jsonb
);
SELECT pg_temp.m60_seed_fill('78000000-0000-4000-a000-000000000067', 2, 2);
SELECT pg_temp.m60_mark('current_generation_recapture_is_server_pinned',
  (SELECT shared_mapping_generation = 2 AND NOT did_auto_start_case
     FROM public.fill_sessions WHERE id = '78000000-0000-4000-a000-000000000067')
  AND (SELECT mapping_generation = 1 FROM public.portals
        WHERE id = '38000000-0000-4000-a000-000000000061'));
SELECT pg_temp.m60_mark('generation_two_receipt_can_submit_and_complete_selected_step',
  (SELECT result->>'kind' = 'created'
     FROM (SELECT pg_temp.m60_call(
       'aa000000-0000-4000-a000-000000000066',
       '78000000-0000-4000-a000-000000000067', 2, 2
     ) AS result) AS attempted)
  AND EXISTS (SELECT 1 FROM public.touches
               WHERE id = 'aa000000-0000-4000-a000-000000000066'
                 AND fill_session_id = '78000000-0000-4000-a000-000000000067')
  AND (SELECT sop_content->0->>'isCompleted' = 'true'
         FROM public.tasks WHERE id = '99000000-0000-4000-a000-000000000065')
  AND (SELECT case_status = 'submitted'
         FROM public.credential_cases WHERE id = '58000000-0000-4000-a000-000000000065'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '39000000-0000-4000-a000-000000000060', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-a000-000000000060","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT public.reset_portal_mapping(
  '38000000-0000-4000-a000-000000000065', 1,
  '4fb29911-4b2e-4d83-965e-7019a8651e68'
);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '39000000-0000-4000-a000-000000000060', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-a000-000000000060","role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;
SELECT pg_temp.m60_mark('shared_reset_rejects_new_contract_fill_with_old_pin',
  pg_temp.m60_expect_state(
    '40001',
    $$SELECT pg_temp.m60_seed_contract_fill('78000000-0000-4000-a000-000000000076', 1)$$
  )
  AND (SELECT shared_mapping_generation = 1
         FROM public.fill_sessions WHERE id = '78000000-0000-4000-a000-000000000069')
  AND NOT EXISTS (SELECT 1 FROM public.fill_sessions
                   WHERE id = '78000000-0000-4000-a000-000000000076'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '39000000-0000-4000-a000-000000000060', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-a000-000000000060","role":"authenticated"}',
  true
);

SET LOCAL ROLE authenticated;
SELECT pg_temp.m60_mark('org_reset_is_blocked_when_same_key_shared_fallback_exists',
  pg_temp.m60_expect_state(
    '42501',
    $$SELECT public.reset_portal_mapping(
        '38000000-0000-4000-a000-000000000061', 1,
        '4fb29911-4b2e-4d83-965e-7019a8651e63'
      )$$
  ));
SELECT set_config('request.jwt.claim.sub', '39000000-0000-4000-a000-000000000061', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-a000-000000000061","role":"authenticated"}',
  true
);
SELECT pg_temp.m60_mark('outsider_cannot_reset_another_organizations_config',
  pg_temp.m60_expect_state(
    '42501',
    $$SELECT public.reset_portal_mapping(
        '38000000-0000-4000-a000-000000000063', 1,
        '4fb29911-4b2e-4d83-965e-7019a8651e64'
      )$$
  ));
RESET ROLE;

-- The org-only configuration has no same-key global fallback and can reset.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '39000000-0000-4000-a000-000000000060', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-a000-000000000060","role":"authenticated"}',
  true
);
WITH reset AS MATERIALIZED (
  SELECT public.reset_portal_mapping(
    '38000000-0000-4000-a000-000000000063', 1,
    '4fb29911-4b2e-4d83-965e-7019a8651e66'
  ) AS event
)
INSERT INTO m60_org_receipt SELECT (event).* FROM reset;
SELECT pg_temp.m60_mark('org_only_reset_succeeds_with_exact_owner_scope',
  (SELECT owner_scope = 'organization'
          AND org_id = '18000000-0000-4000-a000-000000000060'
          AND affected_field_count = 1 AND new_mapping_generation = 2
     FROM m60_org_receipt)
  AND (SELECT mapping_generation = 2 AND NOT is_verified
          AND last_verified_at IS NULL AND proven_at IS NULL
     FROM public.portals WHERE id = '38000000-0000-4000-a000-000000000063'));
RESET ROLE;

-- Failure after the generation update but before receipt completion must roll
-- back both changes. This trigger exists only inside the rolled-back packet.
CREATE FUNCTION public.mint60_inject_receipt_failure() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('mint60.fail_receipt', true) = 'true' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'mint60_injected_receipt_failure';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mint60_inject_receipt_failure
  BEFORE INSERT ON public.form_mapping_reset_events
  FOR EACH ROW EXECUTE FUNCTION public.mint60_inject_receipt_failure();
SET LOCAL ROLE authenticated;
SELECT set_config('mint60.fail_receipt', 'true', true);
SELECT pg_temp.m60_mark('receipt_failure_rolls_back_generation_and_proof',
  pg_temp.m60_expect_state(
    'P0001',
    $$SELECT public.reset_portal_mapping(
        '38000000-0000-4000-a000-000000000064', 1,
        '4fb29911-4b2e-4d83-965e-7019a8651e67'
      )$$
  ));
SELECT set_config('mint60.fail_receipt', 'false', true);
RESET ROLE;
DROP TRIGGER mint60_inject_receipt_failure ON public.form_mapping_reset_events;
DROP FUNCTION public.mint60_inject_receipt_failure();
SELECT pg_temp.m60_mark('failure_target_stays_at_old_generation_and_proof',
  (SELECT mapping_generation = 1 AND is_verified
          AND last_verified_at IS NOT NULL AND proven_at IS NOT NULL
     FROM public.portals WHERE id = '38000000-0000-4000-a000-000000000064')
  AND NOT EXISTS (
    SELECT 1 FROM public.form_mapping_reset_events
     WHERE portal_id = '38000000-0000-4000-a000-000000000064'
  ));

DO $$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO v_failed
    FROM pg_temp.m60_results WHERE NOT passed;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'MINT-60 assertions failed: %', v_failed;
  END IF;
END;
$$;

ROLLBACK;
\echo MINT-60 atomic mapping reset packet passed.
