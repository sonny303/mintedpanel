-- MINT-57 mapping-generation write guard regression packet.
-- Run after MINT-45, MINT-48, MINT-49, and MINT-52 in disposable PostgreSQL.
-- All identities and mapping data are synthetic and rolled back.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE m57_results (name text PRIMARY KEY, passed boolean NOT NULL);
GRANT ALL ON m57_results TO authenticated;
CREATE FUNCTION pg_temp.m57_mark(p_name text, p_passed boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- Treat a NULL expression as a failed check so the final exception names
  -- every failing assertion instead of stopping at the first NULL.
  INSERT INTO pg_temp.m57_results VALUES (p_name, coalesce(p_passed, false));
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.m57_mark(text, boolean) TO authenticated;
CREATE FUNCTION pg_temp.m57_expect_state(p_state text, p_statement text) RETURNS boolean
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
GRANT EXECUTE ON FUNCTION pg_temp.m57_expect_state(text, text) TO authenticated;

INSERT INTO auth.users(id, email) VALUES
  ('39000000-0000-4000-a000-000000000057', 'm57-writer@example.invalid'),
  ('39000000-0000-4000-a000-000000000058', 'm57-outsider@example.invalid');
INSERT INTO public.profiles(id, full_name, email) VALUES
  ('39000000-0000-4000-a000-000000000057', 'MINT-57 Writer', 'm57-writer@example.invalid'),
  ('39000000-0000-4000-a000-000000000058', 'MINT-57 Outsider', 'm57-outsider@example.invalid');
INSERT INTO public.organizations(id, name) VALUES
  ('18000000-0000-4000-a000-000000000057', 'MINT-57 Writer Org'),
  ('18000000-0000-4000-a000-000000000058', 'MINT-57 Other Org');
INSERT INTO public.memberships(org_id, user_id, role) VALUES
  ('18000000-0000-4000-a000-000000000057', '39000000-0000-4000-a000-000000000057', 'specialist'),
  ('18000000-0000-4000-a000-000000000058', '39000000-0000-4000-a000-000000000058', 'specialist');
INSERT INTO public.payers(id, org_id, name) VALUES
  ('28000000-0000-4000-a000-000000000057', '18000000-0000-4000-a000-000000000057', 'MINT-57 Payer');
INSERT INTO public.sop_templates(
  id, org_id, name, payer_id, state, states, task_definitions,
  archived, current_version, required_profile_attributes, case_type
) VALUES (
  '69000000-0000-4000-a000-000000000057',
  '18000000-0000-4000-a000-000000000057', 'MINT-57 PDF template',
  '28000000-0000-4000-a000-000000000057', 'CA', ARRAY['CA']::text[], '[]'::jsonb,
  false, 1, '[]'::jsonb, 'enrollment'
);
INSERT INTO public.payer_forms(
  id, template_id, payer_id, family_id, version, label, file_name,
  storage_path, byte_size
) VALUES (
  '89000000-0000-4000-a000-000000000057',
  '69000000-0000-4000-a000-000000000057',
  '28000000-0000-4000-a000-000000000057',
  '79000000-0000-4000-a000-000000000057', 1, 'MINT-57 PDF form',
  'm57-form.pdf', 'payer/28000000-0000-4000-a000-000000000057/79000000-0000-4000-a000-000000000057/1/m57-form.pdf', 42
);

INSERT INTO public.portals(
  id, org_id, portal_key, name, payer_id, form_url, case_type,
  requires_explicit_selection, is_verified, last_verified_at, proven_at
) VALUES
  ('38000000-0000-4000-a000-000000000057',
   '18000000-0000-4000-a000-000000000057', 'm57_explicit', 'MINT-57 Explicit',
   '28000000-0000-4000-a000-000000000057', 'https://m57.example.invalid/form',
   'enrollment', false, true, now(), now()),
  ('38000000-0000-4000-a000-000000000058',
   '18000000-0000-4000-a000-000000000057', 'm57_legacy', 'MINT-57 Legacy',
   NULL, 'https://m57.example.invalid/legacy', NULL, false, false, NULL, NULL),
  ('38000000-0000-4000-a000-000000000059',
   NULL, 'm57_shared_base', 'MINT-57 Shared Base',
   '28000000-0000-4000-a000-000000000057', 'https://m57.example.invalid/shared',
   'enrollment', true, false, NULL, NULL),
  ('38000000-0000-4000-a000-000000000060',
   '18000000-0000-4000-a000-000000000057', 'm57_shared_base', 'MINT-57 Org Override',
   '28000000-0000-4000-a000-000000000057', 'https://m57.example.invalid/shared',
   'enrollment', true, false, NULL, NULL),
  ('38000000-0000-4000-a000-000000000061',
   NULL, 'm57_combined_reset', 'MINT-57 Combined Shared',
   '28000000-0000-4000-a000-000000000057', 'https://m57.example.invalid/combined',
   'enrollment', true, false, NULL, NULL),
  ('38000000-0000-4000-a000-000000000062',
   '18000000-0000-4000-a000-000000000057', 'm57_combined_reset', 'MINT-57 Combined Org',
   '28000000-0000-4000-a000-000000000057', 'https://m57.example.invalid/combined',
   'enrollment', true, false, NULL, NULL),
  ('38000000-0000-4000-a000-000000000063',
   NULL, 'm57_shared_dedupe', 'MINT-57 Shared Dedupe',
   '28000000-0000-4000-a000-000000000057', 'https://m57.example.invalid/dedupe',
   'enrollment', true, false, NULL, NULL),
  ('38000000-0000-4000-a000-000000000064',
   '18000000-0000-4000-a000-000000000057', 'm57_shared_dedupe', 'MINT-57 Org Dedupe',
   '28000000-0000-4000-a000-000000000057', 'https://m57.example.invalid/dedupe',
   'enrollment', true, false, NULL, NULL);

SELECT pg_temp.m57_mark('typed_portal_is_explicit_and_starts_at_generation_one',
  (SELECT requires_explicit_selection AND mapping_generation = 1
      AND NOT is_verified AND last_verified_at IS NULL AND proven_at IS NULL
     FROM public.portals
    WHERE id = '38000000-0000-4000-a000-000000000057'));

-- Seed a captured row through the same service-role RPC used by the extension.
SELECT public.capture_org_portal_field_map(
  '18000000-0000-4000-a000-000000000057', 1,
  '{"portal_key":"m57_explicit","selector":"#member-id","field_label":"Member ID","field_type":"text"}'::jsonb
);
SELECT pg_temp.m57_mark('capture_rpc_is_service_role_only',
  has_function_privilege(
    'service_role', 'public.capture_org_portal_field_map(uuid,integer,jsonb)', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated', 'public.capture_org_portal_field_map(uuid,integer,jsonb)', 'EXECUTE'
  ));
SELECT pg_temp.m57_mark('org_mapping_rpc_is_authenticated_and_not_anon',
  has_function_privilege(
    'authenticated', 'public.update_org_portal_field_map(uuid,uuid,integer,jsonb)', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon', 'public.update_org_portal_field_map(uuid,uuid,integer,jsonb)', 'EXECUTE'
  ));

SELECT set_config('request.jwt.claim.sub', '39000000-0000-4000-a000-000000000057', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-a000-000000000057","role":"authenticated"}',
  true
);

SELECT public.update_org_portal_field_map(
  '18000000-0000-4000-a000-000000000057',
  (SELECT id FROM public.portal_field_maps WHERE org_id = '18000000-0000-4000-a000-000000000057' AND portal_key = 'm57_explicit'),
  1, '{"status":"approved","source":"token","token":"provider.npi"}'::jsonb
);
CREATE TEMP TABLE m57_same_generation_capture AS
SELECT public.capture_org_portal_field_map(
    '18000000-0000-4000-a000-000000000057', 1,
    '{"portal_key":"m57_explicit","selector":"#member-id","field_label":"Member ID","field_type":"text","control_options":["a","b"]}'::jsonb
  ) AS result;
SELECT pg_temp.m57_mark('same_generation_recapture_preserves_approved_decision',
  (SELECT result->>'kind' = 'existing' FROM m57_same_generation_capture)
  AND (SELECT status = 'approved' AND token = 'provider.npi'
              AND control_options = '["a","b"]'::jsonb
         FROM public.portal_field_maps
        WHERE org_id = '18000000-0000-4000-a000-000000000057'
          AND portal_key = 'm57_explicit' AND selector = '#member-id'));

SET LOCAL ROLE authenticated;
INSERT INTO public.portal_field_maps(
    org_id, portal_key, map_type, selector, source, token, field_type, status
  ) VALUES (
    '18000000-0000-4000-a000-000000000057', 'm57_explicit', 'web',
    '#without-token', 'token', 'provider.npi', 'text', 'approved'
  );
SELECT pg_temp.m57_mark('direct_rls_insert_without_generation_succeeds',
  EXISTS (
    SELECT 1 FROM public.portal_field_maps
     WHERE org_id = '18000000-0000-4000-a000-000000000057'
       AND portal_key = 'm57_explicit'
       AND selector = '#without-token'
  ));

UPDATE public.portal_field_maps SET notes = 'direct update succeeds'
 WHERE org_id = '18000000-0000-4000-a000-000000000057'
   AND portal_key = 'm57_explicit' AND selector = '#member-id';
SELECT pg_temp.m57_mark('direct_rls_update_without_generation_succeeds',
  (SELECT notes = 'direct update succeeds'
     FROM public.portal_field_maps
    WHERE org_id = '18000000-0000-4000-a000-000000000057'
      AND portal_key = 'm57_explicit' AND selector = '#member-id'));
RESET ROLE;

SELECT pg_temp.m57_mark('cross_org_writer_cannot_use_mapping_rpc',
  pg_temp.m57_expect_state(
    '42501',
    $$SELECT public.update_org_portal_field_map(
        '18000000-0000-4000-a000-000000000058',
        (SELECT id FROM public.portal_field_maps
          WHERE org_id = '18000000-0000-4000-a000-000000000057'
            AND portal_key = 'm57_explicit'
          LIMIT 1),
        1, '{"status":"approved"}'::jsonb
      )$$
  ));
SELECT pg_temp.m57_mark('missing_token_is_rejected_by_configuration_rpc',
  pg_temp.m57_expect_state(
    '40001',
    $$SELECT public.update_org_portal_configuration(
        '18000000-0000-4000-a000-000000000057',
        '38000000-0000-4000-a000-000000000057', NULL,
        '{"name":"Missing generation"}'::jsonb
      )$$
  ));
SELECT public.update_org_portal_configuration(
  '18000000-0000-4000-a000-000000000057',
  '38000000-0000-4000-a000-000000000057', 1,
  '{"name":"Generation checked"}'::jsonb
);
SELECT pg_temp.m57_mark('global_proof_write_requires_generation',
  pg_temp.m57_expect_state(
    '40001',
    $$SELECT public.set_global_portal_flags(
        '38000000-0000-4000-a000-000000000059', true, true, NULL
      )$$
  ));
SELECT public.set_global_portal_flags(
  '38000000-0000-4000-a000-000000000059', true, true, 1
);
SELECT pg_temp.m57_mark('global_proof_write_accepts_current_generation',
  (SELECT is_verified AND proven_at IS NOT NULL
     FROM public.portals WHERE id = '38000000-0000-4000-a000-000000000059'));
SELECT pg_temp.m57_mark('global_configuration_edit_requires_generation',
  pg_temp.m57_expect_state(
    '40001',
    $$SELECT public.upsert_global_portal(
        '38000000-0000-4000-a000-000000000059', 'Missing generation',
        'm57_shared_base', '28000000-0000-4000-a000-000000000057',
        'https://m57.example.invalid/shared', 'enrollment', NULL
      )$$
  ));
SELECT public.upsert_global_portal(
  '38000000-0000-4000-a000-000000000059', 'MINT-57 Shared Base Reviewed',
  'm57_shared_base', '28000000-0000-4000-a000-000000000057',
  'https://m57.example.invalid/shared', 'enrollment', 1
);
SELECT pg_temp.m57_mark('global_configuration_edit_accepts_current_generation',
  (SELECT name = 'MINT-57 Shared Base Reviewed' FROM public.portals
    WHERE id = '38000000-0000-4000-a000-000000000059'));
SELECT pg_temp.m57_mark('shared_map_proposal_requires_generation',
  pg_temp.m57_expect_state(
    '40001',
    $$SELECT public.propose_shared_field_map(
        'm57_shared_base', '#shared-map', 'Shared field', NULL, NULL,
        'text', NULL, NULL, NULL, 'web', NULL
      )$$
  ));
SELECT public.propose_shared_field_map(
  'm57_shared_base', '#shared-map', 'Shared field', NULL, NULL,
  'text', NULL, NULL, NULL, 'web', 1
);
SELECT public.train_global_field_map(
  (SELECT id FROM public.portal_field_maps
    WHERE org_id IS NULL AND portal_key = 'm57_shared_base' AND selector = '#shared-map'),
  'approved', 'token', 'provider.npi', 'NPI', NULL, NULL, 1
);
SELECT public.update_shared_field_registry(
  jsonb_build_array(jsonb_build_object(
    'id', (SELECT id FROM public.portal_field_maps
      WHERE org_id IS NULL AND portal_key = 'm57_shared_base' AND selector = '#shared-map'),
    'display_label', 'NPI', 'expected_mapping_generation', 1
  ))
);
SELECT pg_temp.m57_mark('shared_capture_decision_and_registry_use_current_generation',
  (SELECT status = 'approved' AND token = 'provider.npi' AND display_label = 'NPI'
     FROM public.portal_field_maps
    WHERE org_id IS NULL AND portal_key = 'm57_shared_base' AND selector = '#shared-map'));

SELECT public.propose_shared_field_map(
  'm57_shared_dedupe', '#shared-npi', 'Shared NPI', NULL, NULL,
  'text', NULL, NULL, NULL, 'web', 1
);
SELECT public.train_global_field_map(
  (SELECT id FROM public.portal_field_maps
    WHERE org_id IS NULL AND portal_key = 'm57_shared_dedupe' AND selector = '#shared-npi'),
  'approved', 'token', 'provider.npi', 'Shared NPI', NULL, NULL, 1
);
WITH capture AS (
  SELECT public.capture_org_portal_field_map(
    '18000000-0000-4000-a000-000000000057', 1,
    '{"portal_key":"m57_shared_dedupe","selector":"#shared-npi","field_label":"Shared NPI"}'::jsonb
  ) AS result
)
SELECT pg_temp.m57_mark('org_capture_returns_current_shared_selector_without_shadowing_it',
  (SELECT result->>'kind' = 'existing'
       AND result#>>'{map,org_id}' IS NULL
       AND result#>>'{map,status}' = 'approved'
       AND result#>>'{map,token}' = 'provider.npi'
     FROM capture)
  AND NOT EXISTS (
    SELECT 1 FROM public.portal_field_maps
     WHERE org_id = '18000000-0000-4000-a000-000000000057'
       AND portal_key = 'm57_shared_dedupe' AND selector = '#shared-npi'
  ));

INSERT INTO public.portal_field_maps(
  id, org_id, portal_key, map_type, selector, field_label,
  source, token, field_type, status
) VALUES (
  '99000000-0000-4000-a000-000000000057',
  '18000000-0000-4000-a000-000000000057', 'm57_shared_dedupe', 'web',
  '#shared-npi', 'Organization NPI', 'token', 'provider.npi', 'text', 'approved'
);
WITH capture AS (
  SELECT public.capture_org_portal_field_map(
    '18000000-0000-4000-a000-000000000057', 1,
    '{"portal_key":"m57_shared_dedupe","selector":"#shared-npi","field_label":"Recaptured NPI"}'::jsonb
  ) AS result
)
SELECT pg_temp.m57_mark('org_recapture_preserves_existing_org_override_over_shared_map',
  (SELECT result->>'kind' = 'existing'
       AND result#>>'{map,id}' = '99000000-0000-4000-a000-000000000057'
       AND result#>>'{map,org_id}' = '18000000-0000-4000-a000-000000000057'
       AND result#>>'{map,status}' = 'approved'
       AND result#>>'{map,token}' = 'provider.npi'
     FROM capture));

SELECT pg_temp.m57_mark('missing_web_configuration_still_fails_closed',
  pg_temp.m57_expect_state(
    'P0002',
    $$SELECT public.propose_shared_field_map(
        'm57_unregistered_web_key', '#web-field', 'Web field', NULL, NULL,
        'text', NULL, NULL, NULL, 'web', 1
      )$$
  ));

SELECT pg_temp.m57_mark('pdf_import_requires_explicit_legacy_generation_one',
  pg_temp.m57_expect_state(
    '40001',
    $$SELECT public.propose_shared_field_map(
        'payer-form:79000000-0000-4000-a000-000000000057', '#missing-generation',
        'PDF field', NULL, NULL, 'text', NULL, NULL, NULL, 'pdf', NULL
      )$$
  ));
SELECT pg_temp.m57_mark('pdf_key_without_active_family_is_not_a_generic_missing_config_exception',
  pg_temp.m57_expect_state(
    'P0002',
    $$SELECT public.propose_shared_field_map(
        'payer-form:79000000-0000-4000-a000-000000000099', '#unknown-family',
        'PDF field', NULL, NULL, 'text', NULL, NULL, NULL, 'pdf', 1
      )$$
  ));
SELECT pg_temp.m57_mark('pdf_stale_generation_is_rejected',
  pg_temp.m57_expect_state(
    '40001',
    $$SELECT public.propose_shared_field_map(
        'payer-form:79000000-0000-4000-a000-000000000057', '#stale-generation',
        'PDF field', NULL, NULL, 'text', NULL, NULL, NULL, 'pdf', 2
      )$$
  ));
-- Keep the side-effecting proposal separate from its consumers. SQL does not
-- guarantee evaluation order for function calls embedded in one boolean
-- expression, so training could otherwise run before proposal inserts the row.
SELECT public.propose_shared_field_map(
  'payer-form:79000000-0000-4000-a000-000000000057', '#pdf-npi',
  'NPI', NULL, NULL, 'text', NULL, NULL, NULL, 'pdf', 1
);
SELECT pg_temp.m57_mark('pdf_import_proposal_uses_fixed_generation_one',
  (SELECT mapping_generation = 1 FROM public.portal_field_maps
    WHERE org_id IS NULL
      AND portal_key = 'payer-form:79000000-0000-4000-a000-000000000057'
      AND selector = '#pdf-npi' AND map_type = 'pdf'));
SELECT public.train_global_field_map(
  (SELECT id FROM public.portal_field_maps
    WHERE org_id IS NULL
      AND portal_key = 'payer-form:79000000-0000-4000-a000-000000000057'
      AND selector = '#pdf-npi' AND map_type = 'pdf'),
  'approved', 'token', 'provider.npi', 'NPI', NULL, NULL, 1
);
SELECT public.update_shared_field_registry(
  jsonb_build_array(jsonb_build_object(
    'id', (SELECT id FROM public.portal_field_maps
      WHERE org_id IS NULL
        AND portal_key = 'payer-form:79000000-0000-4000-a000-000000000057'
        AND selector = '#pdf-npi' AND map_type = 'pdf'),
    'display_label', 'PDF NPI', 'expected_mapping_generation', 1
  ))
);
SELECT pg_temp.m57_mark('pdf_import_decision_and_registry_rename_use_fixed_generation_one',
  (SELECT status = 'approved' AND token = 'provider.npi'
        AND display_label = 'PDF NPI' AND mapping_generation = 1
     FROM public.portal_field_maps
    WHERE org_id IS NULL
      AND portal_key = 'payer-form:79000000-0000-4000-a000-000000000057'
      AND selector = '#pdf-npi' AND map_type = 'pdf')
  AND NOT EXISTS (
    SELECT 1 FROM public.portals
     WHERE portal_key = 'payer-form:79000000-0000-4000-a000-000000000057'
  ));

SELECT pg_temp.m57_mark('learning_rpc_requires_and_accepts_current_generation',
  pg_temp.m57_expect_state(
    '40001',
    $$SELECT public.learn_portal_field_maps_from_touch(
        '18000000-0000-4000-a000-000000000057',
        '39000000-0000-4000-a000-000000000057',
        '49000000-0000-4000-a000-000000000057',
        '39000000-0000-4000-a000-000000000057',
        '59000000-0000-4000-a000-000000000057',
        'm57_explicit', 'https://m57.example.invalid/form', '[]'::jsonb, NULL
      )$$
  )
  AND (public.learn_portal_field_maps_from_touch(
        '18000000-0000-4000-a000-000000000057',
        '39000000-0000-4000-a000-000000000057',
        '49000000-0000-4000-a000-000000000057',
        '39000000-0000-4000-a000-000000000057',
        '59000000-0000-4000-a000-000000000057',
        'm57_explicit', 'https://m57.example.invalid/form', '[]'::jsonb, 1
      )->>'reason') = 'invalid_batch');

-- Model the reset half of M60's lock contract: the future reset RPC must lock
-- the same portal row, validate generation 1, then set these transaction-local
-- capabilities before advancing to generation 2. No production reset API is
-- introduced here.
UPDATE public.portals
   SET mapping_generation = 2
 WHERE id = '38000000-0000-4000-a000-000000000057';
SELECT pg_temp.m57_mark('stale_decision_write_rejected_after_generation_advance',
  pg_temp.m57_expect_state(
    '40001',
    $$SELECT public.update_org_portal_field_map(
        '18000000-0000-4000-a000-000000000057',
        (SELECT id FROM public.portal_field_maps
          WHERE org_id = '18000000-0000-4000-a000-000000000057'
            AND portal_key = 'm57_explicit' AND selector = '#member-id'),
        1, '{"status":"approved"}'::jsonb
      )$$
  ));
SELECT public.capture_org_portal_field_map(
  '18000000-0000-4000-a000-000000000057', 2,
  '{"portal_key":"m57_explicit","selector":"#member-id","field_label":"Member ID after reset","field_type":"text"}'::jsonb
);
SELECT pg_temp.m57_mark('new_generation_recapture_clears_prior_decision_and_presentation',
  (SELECT mapping_generation = 2 AND status = 'proposed' AND token IS NULL
      AND source = 'manual' AND display_label IS NULL AND section IS NULL
      AND sort_order IS NULL
     FROM public.portal_field_maps
    WHERE org_id = '18000000-0000-4000-a000-000000000057'
      AND portal_key = 'm57_explicit' AND selector = '#member-id'));
SELECT pg_temp.m57_mark('learning_rejects_pre_reset_generation',
  pg_temp.m57_expect_state(
    '40001',
    $$SELECT public.learn_portal_field_maps_from_touch(
        '18000000-0000-4000-a000-000000000057',
        '39000000-0000-4000-a000-000000000057',
        '49000000-0000-4000-a000-000000000057',
        '39000000-0000-4000-a000-000000000057',
        '59000000-0000-4000-a000-000000000057',
        'm57_explicit', 'https://m57.example.invalid/form', '[]'::jsonb, 1
      )$$
  ));
SELECT public.update_org_portal_field_map(
  '18000000-0000-4000-a000-000000000057',
  (SELECT id FROM public.portal_field_maps WHERE org_id = '18000000-0000-4000-a000-000000000057' AND portal_key = 'm57_explicit' AND selector = '#member-id'),
  2, '{"status":"approved","source":"token","token":"provider.npi"}'::jsonb
);
SELECT pg_temp.m57_mark('same_generation_after_recapture_keeps_new_decision',
  (public.capture_org_portal_field_map(
    '18000000-0000-4000-a000-000000000057', 2,
    '{"portal_key":"m57_explicit","selector":"#member-id","field_label":"Member ID refreshed","field_type":"text"}'::jsonb
  )->>'kind') = 'existing'
  AND (SELECT mapping_generation = 2 AND status = 'approved' AND token = 'provider.npi'
         FROM public.portal_field_maps
        WHERE org_id = '18000000-0000-4000-a000-000000000057'
          AND portal_key = 'm57_explicit' AND selector = '#member-id'));

-- Untouched generation-1 legacy NULL rows remain writable without a token.
SET LOCAL ROLE authenticated;
INSERT INTO public.portal_field_maps(
  org_id, portal_key, map_type, selector, source, token, field_type, status
) VALUES (
  '18000000-0000-4000-a000-000000000057', 'm57_legacy', 'web',
  '#legacy-field', 'token', 'provider.npi', 'text', 'approved'
);
UPDATE public.portal_field_maps SET notes = 'legacy write remains compatible'
 WHERE org_id = '18000000-0000-4000-a000-000000000057'
   AND portal_key = 'm57_legacy' AND selector = '#legacy-field';
RESET ROLE;
SELECT pg_temp.m57_mark('untouched_legacy_generation_one_allows_tokenless_rls_write',
  (SELECT mapping_generation = 1 AND notes = 'legacy write remains compatible'
     FROM public.portal_field_maps
    WHERE org_id = '18000000-0000-4000-a000-000000000057'
      AND portal_key = 'm57_legacy' AND selector = '#legacy-field'));

-- Shared reset leaves org overrides visible for review but cannot silently
-- keep them eligible against a newer shared base.
SELECT public.capture_org_portal_field_map(
  '18000000-0000-4000-a000-000000000057', 1,
  '{"portal_key":"m57_shared_base","selector":"#org-override","field_label":"Org override","field_type":"text"}'::jsonb
);
SELECT public.update_org_portal_field_map(
  '18000000-0000-4000-a000-000000000057',
  (SELECT id FROM public.portal_field_maps WHERE org_id = '18000000-0000-4000-a000-000000000057' AND portal_key = 'm57_shared_base' AND selector = '#org-override'),
  1, '{"status":"approved","source":"token","token":"provider.npi"}'::jsonb
);
UPDATE public.portals SET mapping_generation = 2
 WHERE id = '38000000-0000-4000-a000-000000000059';
SELECT pg_temp.m57_mark('org_override_write_against_stale_shared_base_requires_review',
  pg_temp.m57_expect_state(
    '40001',
    $$SELECT public.update_org_portal_field_map(
        '18000000-0000-4000-a000-000000000057',
        (SELECT id FROM public.portal_field_maps
          WHERE org_id = '18000000-0000-4000-a000-000000000057'
            AND portal_key = 'm57_shared_base' AND selector = '#org-override'),
        1, '{"status":"approved"}'::jsonb
      )$$
  ));
SELECT pg_temp.m57_mark('review_rejects_a_stale_observed_shared_generation',
  pg_temp.m57_expect_state(
    '40001',
    $$SELECT public.review_org_portal_field_map_base(
        '18000000-0000-4000-a000-000000000057',
        (SELECT id FROM public.portal_field_maps
          WHERE org_id = '18000000-0000-4000-a000-000000000057'
            AND portal_key = 'm57_shared_base' AND selector = '#org-override'),
        1, 1
      )$$
  ));
SELECT public.review_org_portal_field_map_base(
  '18000000-0000-4000-a000-000000000057',
  (SELECT id FROM public.portal_field_maps
    WHERE org_id = '18000000-0000-4000-a000-000000000057'
      AND portal_key = 'm57_shared_base' AND selector = '#org-override'),
  1, 2
);
SELECT pg_temp.m57_mark('explicit_override_review_preserves_decision_and_audits',
  (SELECT shared_base_generation = 2 AND status = 'approved' AND token = 'provider.npi'
     FROM public.portal_field_maps
    WHERE org_id = '18000000-0000-4000-a000-000000000057'
      AND portal_key = 'm57_shared_base' AND selector = '#org-override')
  AND (SELECT count(*) = 1 FROM public.audit_log
        WHERE org_id = '18000000-0000-4000-a000-000000000057'
          AND entity_type = 'portal_field_map'
          AND entity_id = (SELECT id FROM public.portal_field_maps
                            WHERE org_id = '18000000-0000-4000-a000-000000000057'
                              AND portal_key = 'm57_shared_base' AND selector = '#org-override')
          AND after->>'sharedBaseGeneration' = '2'));
SELECT public.update_org_portal_field_map(
  '18000000-0000-4000-a000-000000000057',
  (SELECT id FROM public.portal_field_maps WHERE org_id = '18000000-0000-4000-a000-000000000057' AND portal_key = 'm57_shared_base' AND selector = '#org-override'),
  1, '{"notes":"reviewed override is writable"}'::jsonb
);
SELECT pg_temp.m57_mark('reviewed_override_is_current_for_guarded_writes',
  (SELECT shared_base_generation = 2 AND notes = 'reviewed override is writable'
     FROM public.portal_field_maps
    WHERE org_id = '18000000-0000-4000-a000-000000000057'
      AND portal_key = 'm57_shared_base' AND selector = '#org-override'));

-- If both the org config and shared base advance, a fresh capture is a new
-- proposal and may refresh both generations while clearing the old decision.
SELECT public.capture_org_portal_field_map(
  '18000000-0000-4000-a000-000000000057', 1,
  '{"portal_key":"m57_combined_reset","selector":"#combined","field_label":"Combined field","field_type":"text"}'::jsonb
);
SELECT public.update_org_portal_field_map(
  '18000000-0000-4000-a000-000000000057',
  (SELECT id FROM public.portal_field_maps
    WHERE org_id = '18000000-0000-4000-a000-000000000057'
      AND portal_key = 'm57_combined_reset' AND selector = '#combined'),
  1, '{"status":"approved","source":"token","token":"provider.npi"}'::jsonb
);
UPDATE public.portals SET mapping_generation = 2
 WHERE id = '38000000-0000-4000-a000-000000000061';
UPDATE public.portals SET mapping_generation = 2
 WHERE id = '38000000-0000-4000-a000-000000000062';
SELECT public.capture_org_portal_field_map(
  '18000000-0000-4000-a000-000000000057', 2,
  '{"portal_key":"m57_combined_reset","selector":"#combined","field_label":"Combined field refreshed","field_type":"text"}'::jsonb
);
SELECT pg_temp.m57_mark('recapture_refreshes_both_changed_generations_and_clears_decision',
  (SELECT mapping_generation = 2 AND shared_base_generation = 2
      AND status = 'proposed' AND source = 'manual' AND token IS NULL
     FROM public.portal_field_maps
    WHERE org_id = '18000000-0000-4000-a000-000000000057'
      AND portal_key = 'm57_combined_reset' AND selector = '#combined'));

DO $$
DECLARE failures text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO failures
    FROM pg_temp.m57_results WHERE NOT passed;
  IF failures IS NOT NULL THEN
    RAISE EXCEPTION 'MINT-57 generation guard checks failed: %', failures;
  END IF;
END;
$$;

TABLE pg_temp.m57_results;
ROLLBACK;
