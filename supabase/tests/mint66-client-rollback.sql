-- MINT-66 disposable database retention rehearsal.
-- Run only after all repository migrations in disposable migration CI:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/mint66-client-rollback.sql
-- Every synthetic identity, row and test helper is inside this transaction
-- and is removed by the final ROLLBACK. This checks data preservation around
-- one exact-key reset; it does not exercise HTTP clients or an app deployment.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE m66_results (name text PRIMARY KEY, passed boolean NOT NULL);
CREATE TEMP TABLE m66_prior_reset_receipt AS
SELECT * FROM public.form_mapping_reset_events WHERE false;
CREATE TEMP TABLE m66_selected_reset_receipt AS
SELECT * FROM public.form_mapping_reset_events WHERE false;
GRANT ALL ON m66_prior_reset_receipt, m66_selected_reset_receipt TO authenticated;

CREATE FUNCTION pg_temp.m66_mark(p_name text, p_passed boolean) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO pg_temp.m66_results VALUES (p_name, COALESCE(p_passed, false))
$$;

INSERT INTO auth.users(id, email) VALUES
  ('39000000-0000-4000-a000-000000000066', 'm66-operator@example.invalid');
INSERT INTO public.profiles(id, full_name, email) VALUES
  ('39000000-0000-4000-a000-000000000066', 'MINT-66 Synthetic Operator', 'm66-operator@example.invalid');
INSERT INTO public.organizations(id, name) VALUES
  ('18000000-0000-4000-a000-000000000066', 'MINT-66 Synthetic Organization');
INSERT INTO public.memberships(org_id, user_id, role) VALUES
  ('18000000-0000-4000-a000-000000000066',
   '39000000-0000-4000-a000-000000000066', 'specialist');
INSERT INTO public.payers(id, org_id, name) VALUES
  ('28000000-0000-4000-a000-000000000066',
   '18000000-0000-4000-a000-000000000066', 'MINT-66 Synthetic Payer');
INSERT INTO public.provider_groups(id, org_id, name) VALUES
  ('49000000-0000-4000-a000-000000000066',
   '18000000-0000-4000-a000-000000000066', 'MINT-66 Synthetic Group');
INSERT INTO public.providers(id, org_id, group_id, first_name, last_name, status) VALUES
  ('39000000-0000-4000-a000-000000000067',
   '18000000-0000-4000-a000-000000000066',
   '49000000-0000-4000-a000-000000000066', 'Synthetic', 'Provider', 'active');
INSERT INTO public.provider_group_assignments(org_id, provider_id, group_id, is_primary, start_date)
VALUES ('18000000-0000-4000-a000-000000000066',
        '39000000-0000-4000-a000-000000000067',
        '49000000-0000-4000-a000-000000000066', true, current_date);

INSERT INTO public.contracts(id, org_id, group_id, payer_id, state) VALUES (
  '29000000-0000-4000-a000-000000000066',
  '18000000-0000-4000-a000-000000000066',
  '49000000-0000-4000-a000-000000000066',
  '28000000-0000-4000-a000-000000000066', 'NY'
);
INSERT INTO public.credential_cases(
  id, org_id, provider_id, group_id, payer_id, state, case_type, case_status, created_by
) VALUES (
  '49000000-0000-4000-a000-000000000067',
  '18000000-0000-4000-a000-000000000066',
  '39000000-0000-4000-a000-000000000067',
  '49000000-0000-4000-a000-000000000066',
  '28000000-0000-4000-a000-000000000066', 'NY', 'enrollment', 'in_progress',
  '39000000-0000-4000-a000-000000000066'
);

-- A historical URL-selected mixed configuration keeps its own proof and maps.
-- The two new configurations deliberately share its URL while using distinct
-- exact keys, owner types, generations, maps, SOP versions and proof state.
INSERT INTO public.portals(
  id, org_id, portal_key, name, payer_id, form_url, case_type,
  requires_explicit_selection, mapping_generation, is_verified,
  last_verified_at, proven_at
) VALUES
  ('38000000-0000-4000-a000-000000000066',
   '18000000-0000-4000-a000-000000000066', 'm66_aetna_mixed',
   'MINT-66 historical mixed Aetna configuration',
   '28000000-0000-4000-a000-000000000066', 'https://aetna.example.invalid/application',
   NULL, false, 1, true, '2026-09-01T12:00:00Z', '2026-09-01T12:00:00Z'),
  ('38000000-0000-4000-a000-000000000067',
   '18000000-0000-4000-a000-000000000066', 'm66_aetna_contract',
   'MINT-66 Contract configuration',
   '28000000-0000-4000-a000-000000000066', 'https://aetna.example.invalid/application',
   'contract', true, 1, true, '2026-09-02T12:00:00Z', '2026-09-02T12:00:00Z'),
  ('38000000-0000-4000-a000-000000000068',
   '18000000-0000-4000-a000-000000000066', 'm66_aetna_enrollment',
   'MINT-66 Enrollment configuration',
   '28000000-0000-4000-a000-000000000066', 'https://aetna.example.invalid/application',
   'enrollment', true, 1, true, '2026-09-03T12:00:00Z', '2026-09-03T12:00:00Z'),
  ('38000000-0000-4000-a000-000000000069',
   '18000000-0000-4000-a000-000000000066', 'm66_prior_reset_history',
   'MINT-66 prior reset receipt fixture',
   '28000000-0000-4000-a000-000000000066', 'https://history.example.invalid/application',
   'enrollment', true, 1, true, '2026-09-04T12:00:00Z', '2026-09-04T12:00:00Z');

INSERT INTO public.sop_templates(
  id, org_id, name, payer_id, state, states, group_id, task_definitions,
  archived, current_version, required_profile_attributes, case_type
) VALUES
  ('69000000-0000-4000-a000-000000000066',
   '18000000-0000-4000-a000-000000000066', 'MINT-66 Contract SOP',
   '28000000-0000-4000-a000-000000000066', 'NY', ARRAY['NY']::text[],
   '49000000-0000-4000-a000-000000000066',
   '[{"title":"Contract application","steps":[{"stepType":"online_form","portalKey":"m66_aetna_contract"}]}]'::jsonb,
   false, 1, '[]'::jsonb, 'contract'),
  ('69000000-0000-4000-a000-000000000067',
   '18000000-0000-4000-a000-000000000066', 'MINT-66 Enrollment SOP',
   '28000000-0000-4000-a000-000000000066', 'NY', ARRAY['NY']::text[], NULL,
   '[{"title":"Enrollment application","steps":[{"stepType":"online_form","portalKey":"m66_aetna_enrollment"}]}]'::jsonb,
   false, 1, '[]'::jsonb, 'enrollment');

INSERT INTO public.contract_sop_assignments(
  id, org_id, contract_id, sop_template_id, sop_version, context_version,
  created_by, updated_by
) VALUES (
  '79000000-0000-4000-a000-000000000066',
  '18000000-0000-4000-a000-000000000066',
  '29000000-0000-4000-a000-000000000066',
  '69000000-0000-4000-a000-000000000066', 1, 1,
  '39000000-0000-4000-a000-000000000066',
  '39000000-0000-4000-a000-000000000066'
);

SET LOCAL minted.expected_mapping_generation = '1';
INSERT INTO public.portal_field_maps(
  org_id, portal_key, map_type, selector, source, field_type, status, notes,
  token, mapping_generation
) VALUES
  ('18000000-0000-4000-a000-000000000066', 'm66_aetna_mixed', 'web', '#old-contract-tin',
   'token', 'text', 'approved', 'Synthetic historical mixed Contract map', 'group.tin', 1),
  ('18000000-0000-4000-a000-000000000066', 'm66_aetna_mixed', 'web', '#old-enrollment-npi',
   'token', 'text', 'approved', 'Synthetic historical mixed Enrollment map', 'provider.npi', 1),
  ('18000000-0000-4000-a000-000000000066', 'm66_aetna_contract', 'web', '#contract-tin',
   'token', 'text', 'approved', 'Synthetic Contract-only map', 'group.tin', 1),
  ('18000000-0000-4000-a000-000000000066', 'm66_aetna_enrollment', 'web', '#enrollment-npi',
   'token', 'text', 'approved', 'Synthetic Enrollment-only map', 'provider.npi', 1);

-- Fresh typed configurations intentionally start without proof; establish
-- current-generation synthetic proof only after their exact maps exist.
UPDATE public.portals
   SET is_verified = true,
       last_verified_at = '2026-09-02T12:00:00Z',
       proven_at = '2026-09-02T12:00:00Z'
 WHERE id = '38000000-0000-4000-a000-000000000067'
   AND mapping_generation = 1;
UPDATE public.portals
   SET is_verified = true,
       last_verified_at = '2026-09-03T12:00:00Z',
       proven_at = '2026-09-03T12:00:00Z'
 WHERE id = '38000000-0000-4000-a000-000000000068'
   AND mapping_generation = 1;

-- Retain one legacy-shaped fill receipt as historical data. It has no typed
-- launch tuple and is not upgraded or consumed by this rehearsal.
INSERT INTO public.fill_sessions(
  id, org_id, case_id, provider_id, portal_key, fill_mode,
  fields_filled, fields_skipped, is_test, event_schema_version, performed_by
) VALUES (
  '79000000-0000-4000-a000-000000000067',
  '18000000-0000-4000-a000-000000000066',
  '49000000-0000-4000-a000-000000000067',
  '39000000-0000-4000-a000-000000000067', 'm66_aetna_mixed', 'web',
  0, '[]'::jsonb, false, 1, '39000000-0000-4000-a000-000000000066'
);

-- Establish an earlier append-only reset receipt on a separate fixture key so
-- the rehearsal can prove it remains byte-identical after the selected reset.
SELECT set_config('request.jwt.claim.sub', '39000000-0000-4000-a000-000000000066', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-a000-000000000066","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
WITH reset AS MATERIALIZED (
  SELECT public.reset_portal_mapping(
    '38000000-0000-4000-a000-000000000069', 1,
    '4fb29911-4b2e-4d83-a000-000000000066'
  ) AS event
)
INSERT INTO pg_temp.m66_prior_reset_receipt SELECT (event).* FROM reset;
RESET ROLE;

CREATE TEMP TABLE m66_selected_portal_before AS
SELECT to_jsonb(portal) AS row_data
  FROM public.portals AS portal
 WHERE portal.id = '38000000-0000-4000-a000-000000000068';

-- Capture full rows and stable keys. Comparing the complete JSON rows makes
-- this a retention assertion, not a partial column/count check.
CREATE TEMP TABLE m66_preserved_rows (
  relation_name text NOT NULL,
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (relation_name, row_key)
);
INSERT INTO pg_temp.m66_preserved_rows(relation_name, row_key, row_data)
SELECT 'portals', portal.id::text, to_jsonb(portal)
  FROM public.portals AS portal
 WHERE portal.id IN (
   '38000000-0000-4000-a000-000000000066',
   '38000000-0000-4000-a000-000000000067',
   '38000000-0000-4000-a000-000000000069'
 )
UNION ALL
SELECT 'portal_field_maps', field_map.id::text, to_jsonb(field_map)
  FROM public.portal_field_maps AS field_map
 WHERE field_map.org_id = '18000000-0000-4000-a000-000000000066'
   AND field_map.portal_key IN (
     'm66_aetna_mixed', 'm66_aetna_contract', 'm66_aetna_enrollment'
   )
UNION ALL
SELECT 'credential_cases', case_row.id::text, to_jsonb(case_row)
  FROM public.credential_cases AS case_row
 WHERE case_row.id = '49000000-0000-4000-a000-000000000067'
UNION ALL
SELECT 'contracts', contract_row.id::text, to_jsonb(contract_row)
  FROM public.contracts AS contract_row
 WHERE contract_row.id = '29000000-0000-4000-a000-000000000066'
UNION ALL
SELECT 'provider_group_assignments',
       assignment.org_id::text || ':' || assignment.provider_id::text || ':' || assignment.group_id::text,
       to_jsonb(assignment)
  FROM public.provider_group_assignments AS assignment
 WHERE assignment.org_id = '18000000-0000-4000-a000-000000000066'
   AND assignment.provider_id = '39000000-0000-4000-a000-000000000067'
   AND assignment.group_id = '49000000-0000-4000-a000-000000000066'
UNION ALL
SELECT 'contract_sop_assignments', assignment.id::text, to_jsonb(assignment)
  FROM public.contract_sop_assignments AS assignment
 WHERE assignment.id = '79000000-0000-4000-a000-000000000066'
UNION ALL
SELECT 'sop_templates', template.id::text, to_jsonb(template)
  FROM public.sop_templates AS template
 WHERE template.id IN (
   '69000000-0000-4000-a000-000000000066',
   '69000000-0000-4000-a000-000000000067'
 )
UNION ALL
SELECT 'sop_template_versions', version_row.template_id::text || ':' || version_row.version::text,
       to_jsonb(version_row)
  FROM public.sop_template_versions AS version_row
 WHERE version_row.template_id IN (
   '69000000-0000-4000-a000-000000000066',
   '69000000-0000-4000-a000-000000000067'
 )
UNION ALL
SELECT 'fill_sessions', fill_session.id::text, to_jsonb(fill_session)
  FROM public.fill_sessions AS fill_session
 WHERE fill_session.org_id = '18000000-0000-4000-a000-000000000066'
   AND (fill_session.case_id = '49000000-0000-4000-a000-000000000067'
        OR fill_session.portal_key IN (
          'm66_aetna_mixed', 'm66_aetna_contract', 'm66_aetna_enrollment'
        ))
UNION ALL
SELECT 'form_mapping_reset_events', reset_event.id::text, to_jsonb(reset_event)
  FROM public.form_mapping_reset_events AS reset_event
 WHERE reset_event.portal_id IN (
   '38000000-0000-4000-a000-000000000066',
   '38000000-0000-4000-a000-000000000067',
   '38000000-0000-4000-a000-000000000068',
   '38000000-0000-4000-a000-000000000069'
 );

SELECT pg_temp.m66_mark('fixture_has_historical_mixed_proof_and_two_exact_same_url_keys',
  (SELECT case_type IS NULL AND NOT requires_explicit_selection
          AND mapping_generation = 1 AND is_verified
          AND last_verified_at IS NOT NULL AND proven_at IS NOT NULL
     FROM public.portals WHERE id = '38000000-0000-4000-a000-000000000066')
  AND EXISTS (SELECT 1 FROM public.portals
               WHERE id = '38000000-0000-4000-a000-000000000067'
                 AND portal_key = 'm66_aetna_contract'
                 AND case_type = 'contract'
                 AND requires_explicit_selection
                 AND form_url = 'https://aetna.example.invalid/application')
  AND EXISTS (SELECT 1 FROM public.portals
               WHERE id = '38000000-0000-4000-a000-000000000068'
                 AND portal_key = 'm66_aetna_enrollment'
                 AND case_type = 'enrollment'
                 AND requires_explicit_selection
                 AND form_url = 'https://aetna.example.invalid/application')
  AND (SELECT count(*) = 4 AND count(DISTINCT portal_key) = 3
          AND bool_and(mapping_generation = 1)
     FROM public.portal_field_maps
    WHERE org_id = '18000000-0000-4000-a000-000000000066'
      AND portal_key IN ('m66_aetna_mixed', 'm66_aetna_contract', 'm66_aetna_enrollment'))
  AND EXISTS (SELECT 1 FROM public.credential_cases
               WHERE id = '49000000-0000-4000-a000-000000000067')
  AND EXISTS (SELECT 1 FROM public.contracts
               WHERE id = '29000000-0000-4000-a000-000000000066')
  AND EXISTS (SELECT 1 FROM public.contract_sop_assignments
               WHERE id = '79000000-0000-4000-a000-000000000066')
  AND (SELECT count(*) = 2 FROM public.sop_template_versions
        WHERE template_id IN ('69000000-0000-4000-a000-000000000066',
                              '69000000-0000-4000-a000-000000000067')
          AND version = 1)
  AND EXISTS (SELECT 1 FROM public.fill_sessions
               WHERE id = '79000000-0000-4000-a000-000000000067'
                 AND event_schema_version = 1)
  AND (SELECT count(*) = 1 FROM pg_temp.m66_prior_reset_receipt));

-- Exercise one selected-key reset only. The reset RPC increments that exact
-- row and appends a receipt; it does not delete the old map generation.
SET LOCAL ROLE authenticated;
WITH reset AS MATERIALIZED (
  SELECT public.reset_portal_mapping(
    '38000000-0000-4000-a000-000000000068', 1,
    '4fb29911-4b2e-4d83-a000-000000000067'
  ) AS event
)
INSERT INTO pg_temp.m66_selected_reset_receipt SELECT (event).* FROM reset;
RESET ROLE;

CREATE TEMP TABLE m66_current_rows (
  relation_name text NOT NULL,
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (relation_name, row_key)
);
INSERT INTO pg_temp.m66_current_rows(relation_name, row_key, row_data)
SELECT 'portals', portal.id::text, to_jsonb(portal)
  FROM public.portals AS portal
 WHERE portal.id IN (
   '38000000-0000-4000-a000-000000000066',
   '38000000-0000-4000-a000-000000000067',
   '38000000-0000-4000-a000-000000000069'
 )
UNION ALL
SELECT 'portal_field_maps', field_map.id::text, to_jsonb(field_map)
  FROM public.portal_field_maps AS field_map
 WHERE field_map.org_id = '18000000-0000-4000-a000-000000000066'
   AND field_map.portal_key IN (
     'm66_aetna_mixed', 'm66_aetna_contract', 'm66_aetna_enrollment'
   )
UNION ALL
SELECT 'credential_cases', case_row.id::text, to_jsonb(case_row)
  FROM public.credential_cases AS case_row
 WHERE case_row.id = '49000000-0000-4000-a000-000000000067'
UNION ALL
SELECT 'contracts', contract_row.id::text, to_jsonb(contract_row)
  FROM public.contracts AS contract_row
 WHERE contract_row.id = '29000000-0000-4000-a000-000000000066'
UNION ALL
SELECT 'provider_group_assignments',
       assignment.org_id::text || ':' || assignment.provider_id::text || ':' || assignment.group_id::text,
       to_jsonb(assignment)
  FROM public.provider_group_assignments AS assignment
 WHERE assignment.org_id = '18000000-0000-4000-a000-000000000066'
   AND assignment.provider_id = '39000000-0000-4000-a000-000000000067'
   AND assignment.group_id = '49000000-0000-4000-a000-000000000066'
UNION ALL
SELECT 'contract_sop_assignments', assignment.id::text, to_jsonb(assignment)
  FROM public.contract_sop_assignments AS assignment
 WHERE assignment.id = '79000000-0000-4000-a000-000000000066'
UNION ALL
SELECT 'sop_templates', template.id::text, to_jsonb(template)
  FROM public.sop_templates AS template
 WHERE template.id IN (
   '69000000-0000-4000-a000-000000000066',
   '69000000-0000-4000-a000-000000000067'
 )
UNION ALL
SELECT 'sop_template_versions', version_row.template_id::text || ':' || version_row.version::text,
       to_jsonb(version_row)
  FROM public.sop_template_versions AS version_row
 WHERE version_row.template_id IN (
   '69000000-0000-4000-a000-000000000066',
   '69000000-0000-4000-a000-000000000067'
 )
UNION ALL
SELECT 'fill_sessions', fill_session.id::text, to_jsonb(fill_session)
  FROM public.fill_sessions AS fill_session
 WHERE fill_session.org_id = '18000000-0000-4000-a000-000000000066'
   AND (fill_session.case_id = '49000000-0000-4000-a000-000000000067'
        OR fill_session.portal_key IN (
          'm66_aetna_mixed', 'm66_aetna_contract', 'm66_aetna_enrollment'
        ))
UNION ALL
SELECT 'form_mapping_reset_events', reset_event.id::text, to_jsonb(reset_event)
  FROM public.form_mapping_reset_events AS reset_event
 WHERE reset_event.portal_id IN (
   '38000000-0000-4000-a000-000000000066',
   '38000000-0000-4000-a000-000000000067',
   '38000000-0000-4000-a000-000000000068',
   '38000000-0000-4000-a000-000000000069'
 )
   AND reset_event.id NOT IN (SELECT id FROM pg_temp.m66_selected_reset_receipt);

SELECT pg_temp.m66_mark('selected_key_advances_generation_and_clears_only_current_proof',
  (SELECT (row_data->>'mapping_generation')::integer = 1
          AND (row_data->>'is_verified')::boolean
          AND row_data->>'last_verified_at' IS NOT NULL
          AND row_data->>'proven_at' IS NOT NULL
     FROM pg_temp.m66_selected_portal_before)
  AND (SELECT mapping_generation = 2 AND NOT is_verified
          AND last_verified_at IS NULL AND proven_at IS NULL
     FROM public.portals WHERE id = '38000000-0000-4000-a000-000000000068')
  AND (SELECT (snapshot_row.row_data - 'mapping_generation' - 'is_verified'
               - 'last_verified_at' - 'proven_at' - 'updated_at')
                IS NOT DISTINCT FROM
               (to_jsonb(after_row) - 'mapping_generation' - 'is_verified'
                - 'last_verified_at' - 'proven_at' - 'updated_at')
     FROM pg_temp.m66_selected_portal_before AS snapshot_row
     CROSS JOIN public.portals AS after_row
    WHERE after_row.id = '38000000-0000-4000-a000-000000000068'));

SELECT pg_temp.m66_mark('reset_preserves_all_nonselected_and_historical_rows_byte_for_byte',
  NOT EXISTS (
    SELECT 1
      FROM pg_temp.m66_preserved_rows AS before_row
      FULL OUTER JOIN pg_temp.m66_current_rows AS after_row
        USING (relation_name, row_key)
     WHERE before_row.row_data IS DISTINCT FROM after_row.row_data
  ));

SELECT pg_temp.m66_mark('old_maps_and_proofs_remain_historical_without_transfer',
  (SELECT count(*) = 4 AND count(DISTINCT id) = 4
          AND bool_and(mapping_generation = 1)
     FROM public.portal_field_maps
    WHERE org_id = '18000000-0000-4000-a000-000000000066'
      AND portal_key IN ('m66_aetna_mixed', 'm66_aetna_contract', 'm66_aetna_enrollment'))
  AND (SELECT is_verified AND proven_at = '2026-09-01T12:00:00Z'::timestamptz
     FROM public.portals WHERE id = '38000000-0000-4000-a000-000000000066')
  AND (SELECT is_verified AND proven_at = '2026-09-02T12:00:00Z'::timestamptz
     FROM public.portals WHERE id = '38000000-0000-4000-a000-000000000067')
  AND (SELECT count(*) = 1 AND bool_and(mapping_generation = 1)
     FROM public.portal_field_maps
    WHERE org_id = '18000000-0000-4000-a000-000000000066'
      AND portal_key = 'm66_aetna_enrollment'));

SELECT pg_temp.m66_mark('selected_reset_appends_exactly_one_new_receipt_and_keeps_prior_ids',
  (SELECT count(*) = 1
          AND bool_and(portal_id = '38000000-0000-4000-a000-000000000068')
          AND bool_and(portal_key = 'm66_aetna_enrollment')
          AND bool_and(owner_scope = 'organization')
          AND bool_and(org_id = '18000000-0000-4000-a000-000000000066')
          AND bool_and(old_mapping_generation = 1)
          AND bool_and(new_mapping_generation = 2)
          AND bool_and(actor_id = '39000000-0000-4000-a000-000000000066')
          AND bool_and(affected_field_count = 1)
          AND bool_and(idempotency_key = '4fb29911-4b2e-4d83-a000-000000000067')
     FROM pg_temp.m66_selected_reset_receipt)
  AND (SELECT count(*) = 1 FROM public.form_mapping_reset_events
        WHERE portal_id = '38000000-0000-4000-a000-000000000068')
  AND (SELECT count(*) = 1 FROM pg_temp.m66_prior_reset_receipt)
  AND NOT EXISTS (
    SELECT 1 FROM pg_temp.m66_preserved_rows AS before_row
     WHERE before_row.relation_name = 'form_mapping_reset_events'
       AND before_row.row_key = (SELECT id::text FROM pg_temp.m66_selected_reset_receipt)
  ));

DO $$
DECLARE failures text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO failures
    FROM pg_temp.m66_results WHERE NOT passed;
  IF failures IS NOT NULL THEN
    RAISE EXCEPTION 'MINT-66 retention rehearsal failed: %', failures;
  END IF;
END;
$$;

TABLE pg_temp.m66_results;
ROLLBACK;
\echo MINT-66 disposable retention rehearsal passed.
