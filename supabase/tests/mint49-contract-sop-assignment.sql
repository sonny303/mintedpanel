-- MINT-49 Contract SOP assignment and receipt boundary regression packet.
-- Run after MINT-45/MINT-44/MINT-48 plus this additive migration in a
-- disposable local database. All fixtures are synthetic and rolled back.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE m49_results (name text PRIMARY KEY, passed boolean NOT NULL);
GRANT ALL ON m49_results TO authenticated;
CREATE FUNCTION pg_temp.m49_mark(p_name text, p_passed boolean) RETURNS void
LANGUAGE sql AS $$ INSERT INTO pg_temp.m49_results VALUES (p_name, p_passed) $$;
CREATE FUNCTION pg_temp.m49_expect_state(p_state text, p_statement text) RETURNS boolean
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
CREATE FUNCTION pg_temp.m49_insert_contract_fill(
  p_id uuid,
  p_assignment_id uuid,
  p_template_id uuid,
  p_sop_version integer,
  p_context_version integer,
  p_provider_id uuid,
  p_performed_by uuid DEFAULT NULL,
  p_case_id uuid DEFAULT NULL,
  p_portal_id uuid DEFAULT '59000000-0000-4000-a000-000000000049'
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.fill_sessions (
    id, org_id, case_id, contract_id, contract_sop_assignment_id,
    sop_template_id, sop_version, task_index, step_index, context_version,
    launch_receipt_id, mapping_generation, effective_mapping_fingerprint,
    portal_id,
    provider_id, portal_key, fill_mode, fields_filled, fields_skipped,
    is_test, event_schema_version, fields_attempted, fields_verified,
    fields_rejected, field_outcomes, performed_by
  ) VALUES (
    p_id, '19000000-0000-4000-a000-000000000049', p_case_id,
    '29000000-0000-4000-a000-000000000050', p_assignment_id,
    p_template_id, p_sop_version, 0, 0, p_context_version,
    p_id, 1, 'synthetic-canonical-fingerprint', p_portal_id, p_provider_id,
    'm49_contract_form', 'web', 0, '[]'::jsonb, false,
    2, 0, 0, 0, '[]'::jsonb, p_performed_by
  );
END;
$$;

INSERT INTO auth.users(id, email) VALUES
  ('39000000-0000-4000-a000-000000000049', 'm49-specialist@example.invalid'),
  ('39000000-0000-4000-a000-000000000050', 'm49-billing@example.invalid');
INSERT INTO public.profiles(id, full_name, email) VALUES
  ('39000000-0000-4000-a000-000000000049', 'MINT-49 Synthetic Specialist', 'm49-specialist@example.invalid'),
  ('39000000-0000-4000-a000-000000000050', 'MINT-49 Synthetic Billing', 'm49-billing@example.invalid');
INSERT INTO public.organizations(id, name)
VALUES ('19000000-0000-4000-a000-000000000049', 'MINT-49 Synthetic Org');
INSERT INTO public.memberships(org_id, user_id, role) VALUES
  ('19000000-0000-4000-a000-000000000049', '39000000-0000-4000-a000-000000000049', 'specialist'),
  ('19000000-0000-4000-a000-000000000049', '39000000-0000-4000-a000-000000000050', 'billing');
INSERT INTO public.payers(id, org_id, name)
VALUES ('29000000-0000-4000-a000-000000000049', '19000000-0000-4000-a000-000000000049', 'MINT-49 Synthetic Payer');
INSERT INTO public.provider_groups(id, org_id, name)
VALUES ('49000000-0000-4000-a000-000000000049', '19000000-0000-4000-a000-000000000049', 'MINT-49 Synthetic Group');
INSERT INTO public.providers(id, org_id, group_id, first_name, last_name, status)
VALUES (
  '39000000-0000-4000-a000-000000000051',
  '19000000-0000-4000-a000-000000000049',
  '49000000-0000-4000-a000-000000000049',
  'Synthetic', 'Provider', 'active'
);
INSERT INTO public.provider_group_assignments(org_id, provider_id, group_id, is_primary, start_date)
VALUES (
  '19000000-0000-4000-a000-000000000049',
  '39000000-0000-4000-a000-000000000051',
  '49000000-0000-4000-a000-000000000049', true, current_date
);
INSERT INTO public.contracts(id, org_id, group_id, payer_id, state)
VALUES (
  '29000000-0000-4000-a000-000000000050',
  '19000000-0000-4000-a000-000000000049',
  '49000000-0000-4000-a000-000000000049',
  '29000000-0000-4000-a000-000000000049', 'NY'
);
INSERT INTO public.credential_cases(id, org_id, provider_id, payer_id, state, case_type)
VALUES (
  '49000000-0000-4000-a000-000000000050',
  '19000000-0000-4000-a000-000000000049',
  '39000000-0000-4000-a000-000000000051',
  '29000000-0000-4000-a000-000000000049', 'NY', 'enrollment'
);

INSERT INTO public.portals(
  id, org_id, portal_key, name, payer_id, form_url, case_type
)
VALUES (
  '59000000-0000-4000-a000-000000000049',
  '19000000-0000-4000-a000-000000000049',
  'm49_contract_form', 'MINT-49 Synthetic Contract Form',
  '29000000-0000-4000-a000-000000000049',
  'https://m49.example.invalid/contract', 'contract'
);

INSERT INTO public.sop_templates(
  id, org_id, name, payer_id, state, states, group_id, task_definitions,
  archived, current_version, required_profile_attributes, case_type
) VALUES
  (
    '69000000-0000-4000-a000-000000000049',
    '19000000-0000-4000-a000-000000000049', 'MINT-49 Contract SOP One',
    '29000000-0000-4000-a000-000000000049', 'NY', ARRAY['NY']::text[], NULL,
    '[{"title":"Contract form","steps":[{"label":"Complete application","stepType":"online_form","portalKey":"m49_contract_form"}]}]'::jsonb,
    false, 1, '[]'::jsonb, 'contract'
  ),
  (
    '69000000-0000-4000-a000-000000000050',
    '19000000-0000-4000-a000-000000000049', 'MINT-49 Contract SOP Two',
    '29000000-0000-4000-a000-000000000049', 'NY', ARRAY['NY']::text[], NULL,
    '[{"title":"Contract form","steps":[{"label":"Complete application","stepType":"online_form","portalKey":"m49_contract_form"}]}]'::jsonb,
    false, 1, '[]'::jsonb, 'contract'
  ),
  (
    '69000000-0000-4000-a000-000000000051',
    '19000000-0000-4000-a000-000000000049', 'MINT-49 Contract SOP Three',
    '29000000-0000-4000-a000-000000000049', 'NY', ARRAY['NY']::text[], NULL,
    '[{"title":"Contract form","steps":[{"label":"Complete application","stepType":"online_form","portalKey":"m49_contract_form"}]}]'::jsonb,
    false, 1, '[]'::jsonb, 'contract'
  );
SELECT pg_temp.m49_mark('fresh_typed_portal_is_explicit',
  (SELECT case_type = 'contract' AND requires_explicit_selection
      AND mapping_generation = 1 AND NOT is_verified AND proven_at IS NULL
     FROM public.portals WHERE id = '59000000-0000-4000-a000-000000000049'));
SELECT pg_temp.m49_mark('assignment_rpc_authenticated_only',
  has_function_privilege(
    'authenticated', 'public.assign_contract_sop(uuid,uuid,integer,integer)', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon', 'public.assign_contract_sop(uuid,uuid,integer,integer)', 'EXECUTE'
  ));

SELECT set_config('request.jwt.claim.sub', '39000000-0000-4000-a000-000000000049', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-a000-000000000049","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT public.assign_contract_sop(
  '29000000-0000-4000-a000-000000000050',
  '69000000-0000-4000-a000-000000000049', 1, 0
);
SELECT public.assign_contract_sop(
  '29000000-0000-4000-a000-000000000050',
  '69000000-0000-4000-a000-000000000049', 1, 0
);
SELECT pg_temp.m49_mark('create_retry_is_idempotent_with_original_context',
  (SELECT count(*) = 1 AND min(context_version) = 1
     FROM public.contract_sop_assignments
    WHERE contract_id = '29000000-0000-4000-a000-000000000050'
      AND sop_template_id = '69000000-0000-4000-a000-000000000049')
  AND (SELECT count(*) = 1 FROM public.audit_log
        WHERE entity_type = 'contract_sop_assignment'
          AND entity_id = (SELECT id FROM public.contract_sop_assignments
                            WHERE contract_id = '29000000-0000-4000-a000-000000000050'))
);
SELECT pg_temp.m49_mark('stale_assignment_context_rejected', pg_temp.m49_expect_state(
  '40001',
  $$SELECT public.assign_contract_sop(
      '29000000-0000-4000-a000-000000000050',
      '69000000-0000-4000-a000-000000000050', 1, 0
    )$$
));
SELECT public.assign_contract_sop(
  '29000000-0000-4000-a000-000000000050',
  '69000000-0000-4000-a000-000000000050', 1, 1
);
SELECT pg_temp.m49_mark('valid_pre_activity_replacement_advances_context',
  (SELECT sop_template_id = '69000000-0000-4000-a000-000000000050'
      AND sop_version = 1 AND context_version = 2
     FROM public.contract_sop_assignments
    WHERE contract_id = '29000000-0000-4000-a000-000000000050')
);

SELECT set_config('request.jwt.claim.sub', '39000000-0000-4000-a000-000000000050', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-a000-000000000050","role":"authenticated"}',
  true
);
SELECT pg_temp.m49_mark('billing_member_cannot_assign', pg_temp.m49_expect_state(
  '42501',
  $$SELECT public.assign_contract_sop(
      '29000000-0000-4000-a000-000000000050',
      '69000000-0000-4000-a000-000000000051', 1, 2
    )$$
));
SELECT set_config('request.jwt.claim.sub', '39000000-0000-4000-a000-000000000049', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-a000-000000000049","role":"authenticated"}',
  true
);

-- Add a same-key global row only after version publication: the version writer
-- correctly rejects ambiguous keys at publication time, while this fixture
-- directly probes the receipt boundary's org-over-global exact selection.
RESET ROLE;
INSERT INTO public.portals(
  id, org_id, portal_key, name, payer_id, form_url, case_type
) VALUES (
  '59000000-0000-4000-a000-000000000050',
  NULL,
  'm49_contract_form', 'MINT-49 Same-Key Global Form',
  '29000000-0000-4000-a000-000000000049',
  'https://m49.example.invalid/global-contract', 'contract'
);
SET LOCAL ROLE authenticated;

SELECT pg_temp.m49_mark('typed_contract_sop_snapshot_and_portal_step_match',
  (SELECT template.case_type = version.case_type
      AND version.case_type = 'contract'
      AND version.task_definitions->0->'steps'->0->>'stepType' = 'online_form'
      AND version.task_definitions->0->'steps'->0->>'portalKey' = portal.portal_key
      AND portal.case_type = 'contract'
      AND portal.requires_explicit_selection
      AND portal.mapping_generation = 1
     FROM public.sop_templates template
     JOIN public.sop_template_versions version
       ON version.template_id = template.id AND version.version = 1
     JOIN public.portals portal
       ON portal.id = '59000000-0000-4000-a000-000000000049'
    WHERE template.id = '69000000-0000-4000-a000-000000000050')
);

SELECT pg_temp.m49_insert_contract_fill(
  '79000000-0000-4000-a000-000000000049',
  (SELECT id FROM public.contract_sop_assignments
    WHERE contract_id = '29000000-0000-4000-a000-000000000050'),
  '69000000-0000-4000-a000-000000000050', 1, 2,
  '39000000-0000-4000-a000-000000000051'
);
SELECT pg_temp.m49_mark('real_contract_receipt_has_exact_owner_and_no_case',
  (SELECT session.contract_id = '29000000-0000-4000-a000-000000000050'
      AND session.case_id IS NULL
      AND session.contract_sop_assignment_id = assignment.id
      AND session.sop_template_id = assignment.sop_template_id
      AND session.sop_version = assignment.sop_version
      AND session.context_version = assignment.context_version
      AND session.task_index = 0 AND session.step_index = 0
      AND session.portal_key = 'm49_contract_form'
      AND session.portal_id = '59000000-0000-4000-a000-000000000049'
      AND session.provider_id = '39000000-0000-4000-a000-000000000051'
      AND session.mapping_generation = 1
      AND session.effective_mapping_fingerprint = 'synthetic-canonical-fingerprint'
     FROM public.fill_sessions session
     JOIN public.contract_sop_assignments assignment
       ON assignment.id = session.contract_sop_assignment_id
    WHERE session.id = '79000000-0000-4000-a000-000000000049')
  AND (SELECT count(*) = 1 FROM public.contract_sop_assignments
        WHERE contract_id = '29000000-0000-4000-a000-000000000050')
  AND NOT EXISTS (SELECT 1 FROM public.tasks WHERE org_id = '19000000-0000-4000-a000-000000000049')
  AND (SELECT count(*) = 1 FROM public.credential_cases
        WHERE org_id = '19000000-0000-4000-a000-000000000049')
);
UPDATE public.provider_group_assignments
SET start_date = current_date + 1
WHERE provider_id = '39000000-0000-4000-a000-000000000051'
  AND group_id = '49000000-0000-4000-a000-000000000049';
SELECT pg_temp.m49_mark('future_provider_group_membership_is_rejected', pg_temp.m49_expect_state(
  '42501',
  $$SELECT pg_temp.m49_insert_contract_fill(
      '79000000-0000-4000-a000-000000000057',
      (SELECT id FROM public.contract_sop_assignments
        WHERE contract_id = '29000000-0000-4000-a000-000000000050'),
      '69000000-0000-4000-a000-000000000050', 1, 2,
      '39000000-0000-4000-a000-000000000051'
    )$$
));
UPDATE public.provider_group_assignments
SET start_date = current_date
WHERE provider_id = '39000000-0000-4000-a000-000000000051'
  AND group_id = '49000000-0000-4000-a000-000000000049';
UPDATE public.providers SET status = 'terminated'
WHERE id = '39000000-0000-4000-a000-000000000051';
SELECT pg_temp.m49_mark('terminated_provider_is_rejected', pg_temp.m49_expect_state(
  '42501',
  $$SELECT pg_temp.m49_insert_contract_fill(
      '79000000-0000-4000-a000-000000000058',
      (SELECT id FROM public.contract_sop_assignments
        WHERE contract_id = '29000000-0000-4000-a000-000000000050'),
      '69000000-0000-4000-a000-000000000050', 1, 2,
      '39000000-0000-4000-a000-000000000051'
    )$$
));
UPDATE public.providers SET status = 'active'
WHERE id = '39000000-0000-4000-a000-000000000051';
SELECT pg_temp.m49_mark('global_same_key_cannot_bypass_org_selected_config', pg_temp.m49_expect_state(
  '42501',
  $$SELECT pg_temp.m49_insert_contract_fill(
      '79000000-0000-4000-a000-000000000059',
      (SELECT id FROM public.contract_sop_assignments
        WHERE contract_id = '29000000-0000-4000-a000-000000000050'),
      '69000000-0000-4000-a000-000000000050', 1, 2,
      '39000000-0000-4000-a000-000000000051', NULL, NULL,
      '59000000-0000-4000-a000-000000000050'
    )$$
));
SELECT pg_temp.m49_mark('real_ownerless_fill_is_rejected', pg_temp.m49_expect_state(
  '42501',
  $$INSERT INTO public.fill_sessions(
      id, org_id, case_id, provider_id, portal_key, fill_mode, fields_filled,
      fields_skipped, is_test, event_schema_version, fields_attempted,
      fields_verified, fields_rejected, field_outcomes
    ) VALUES (
      '79000000-0000-4000-a000-000000000052',
      '19000000-0000-4000-a000-000000000049', NULL,
      '39000000-0000-4000-a000-000000000051', 'm49_contract_form', 'web', 0,
      '[]'::jsonb, false, 2, 0, 0, 0, '[]'::jsonb
    )$$
));
SELECT pg_temp.m49_mark('dual_case_and_contract_owners_are_rejected', pg_temp.m49_expect_state(
  '42501',
  $$SELECT pg_temp.m49_insert_contract_fill(
      '79000000-0000-4000-a000-000000000053',
      (SELECT id FROM public.contract_sop_assignments
        WHERE contract_id = '29000000-0000-4000-a000-000000000050'),
      '69000000-0000-4000-a000-000000000050', 1, 2,
      '39000000-0000-4000-a000-000000000051', NULL,
      '49000000-0000-4000-a000-000000000050', NULL
    )$$
));
SELECT pg_temp.m49_mark('stale_assignment_receipt_context_is_rejected', pg_temp.m49_expect_state(
  '42501',
  $$SELECT pg_temp.m49_insert_contract_fill(
      '79000000-0000-4000-a000-000000000054',
      (SELECT id FROM public.contract_sop_assignments
        WHERE contract_id = '29000000-0000-4000-a000-000000000050'),
      '69000000-0000-4000-a000-000000000050', 1, 1,
      '39000000-0000-4000-a000-000000000051'
    )$$
));
SELECT pg_temp.m49_mark('replacement_after_contract_activity_is_locked', pg_temp.m49_expect_state(
  '55000',
  $$SELECT public.assign_contract_sop(
      '29000000-0000-4000-a000-000000000050',
      '69000000-0000-4000-a000-000000000051', 1, 2
    )$$
));

-- A case-owned V2 receipt may carry the shared SOP step receipt columns while
-- retaining exactly one owner and no Contract assignment identity.
INSERT INTO public.fill_sessions(
  id, org_id, case_id, contract_id, contract_sop_assignment_id,
  sop_template_id, sop_version, task_index, step_index, context_version,
  launch_receipt_id, mapping_generation, effective_mapping_fingerprint,
  provider_id, portal_key, fill_mode, fields_filled, fields_skipped, is_test,
  event_schema_version, fields_attempted, fields_verified, fields_rejected,
  field_outcomes
) VALUES (
  '79000000-0000-4000-a000-000000000055',
  '19000000-0000-4000-a000-000000000049',
  '49000000-0000-4000-a000-000000000050', NULL, NULL,
  '69000000-0000-4000-a000-000000000050', 1, 0, 0, 1,
  '79000000-0000-4000-a000-000000000055', 1, 'synthetic-case-fingerprint',
  '39000000-0000-4000-a000-000000000051', 'm49_contract_form', 'web', 0,
  '[]'::jsonb, false, 2, 0, 0, 0, '[]'::jsonb
);
SELECT pg_temp.m49_mark('case_owned_receipt_context_is_supported',
  (SELECT case_id = '49000000-0000-4000-a000-000000000050'
      AND contract_id IS NULL AND contract_sop_assignment_id IS NULL
      AND sop_template_id = '69000000-0000-4000-a000-000000000050'
      AND task_index = 0 AND step_index = 0
      AND effective_mapping_fingerprint = 'synthetic-case-fingerprint'
     FROM public.fill_sessions
    WHERE id = '79000000-0000-4000-a000-000000000055')
);
SELECT pg_temp.m49_mark('case_receipt_rejects_partial_sop_context', pg_temp.m49_expect_state(
  '23514',
  $$INSERT INTO public.fill_sessions(
      id, org_id, case_id, contract_id, contract_sop_assignment_id,
      sop_template_id, sop_version, task_index, step_index, context_version,
      launch_receipt_id, mapping_generation, effective_mapping_fingerprint,
      provider_id, portal_key, fill_mode, fields_filled, fields_skipped, is_test,
      event_schema_version, fields_attempted, fields_verified, fields_rejected,
      field_outcomes
    ) VALUES (
      '79000000-0000-4000-a000-000000000056',
      '19000000-0000-4000-a000-000000000049',
      '49000000-0000-4000-a000-000000000050', NULL, NULL,
      '69000000-0000-4000-a000-000000000050', 1, 0, NULL, 1,
      '79000000-0000-4000-a000-000000000056', 1, 'synthetic-case-fingerprint',
      '39000000-0000-4000-a000-000000000051', 'm49_contract_form', 'web', 0,
      '[]'::jsonb, false, 2, 0, 0, 0, '[]'::jsonb
    )$$
));

RESET ROLE;
SELECT pg_temp.m49_mark('assignment_audit_tracks_only_create_and_replace',
  (SELECT count(*) = 2 FROM public.audit_log
    WHERE entity_type = 'contract_sop_assignment'
      AND entity_id = (SELECT id FROM public.contract_sop_assignments
                        WHERE contract_id = '29000000-0000-4000-a000-000000000050'))
);

DO $$
DECLARE failures text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO failures
    FROM pg_temp.m49_results WHERE NOT passed;
  IF failures IS NOT NULL THEN
    RAISE EXCEPTION 'MINT-49 Contract SOP assignment checks failed: %', failures;
  END IF;
END;
$$;

TABLE pg_temp.m49_results;
ROLLBACK;
