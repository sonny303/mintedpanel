-- MINT-48 independent portal configuration regression packet.
-- Run after MINT-45, MINT-44, and MINT-48 migrations in an owned disposable
-- local database. All fixtures are synthetic and rolled back.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE m48_results (name text PRIMARY KEY, passed boolean NOT NULL);
CREATE FUNCTION pg_temp.m48_mark(p_name text, p_passed boolean) RETURNS void
LANGUAGE sql AS $$ INSERT INTO pg_temp.m48_results VALUES (p_name, p_passed) $$;
CREATE FUNCTION pg_temp.m48_expect_state(p_state text, p_statement text) RETURNS boolean
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

INSERT INTO public.organizations(id, name)
VALUES ('18000000-0000-4000-a000-000000000048', 'MINT-48 synthetic organization');
INSERT INTO public.payers(id, org_id, name)
VALUES ('28000000-0000-4000-a000-000000000048',
        '18000000-0000-4000-a000-000000000048', 'MINT-48 synthetic payer');

-- A historical NULL row can still be classified by MINT-44 and stays on the
-- legacy URL-selected path. Its proof and map remain attached to its old key.
INSERT INTO public.portals(
  id, org_id, portal_key, name, payer_id, form_url, is_verified,
  last_verified_at, proven_at, case_type, requires_explicit_selection
) VALUES (
  '38000000-0000-4000-a000-000000000048',
  '18000000-0000-4000-a000-000000000048', 'm48_legacy_classify',
  'Historical legacy config', '28000000-0000-4000-a000-000000000048',
  'https://payer.example/forms', true, now(), now(), NULL, false
);
INSERT INTO public.portal_field_maps(
  org_id, portal_key, map_type, selector, source, token, field_type, status
) VALUES (
  '18000000-0000-4000-a000-000000000048', 'm48_legacy_classify', 'web',
  '#member-id', 'token', 'provider.npi', 'text', 'approved'
);
UPDATE public.portals
   SET case_type = 'enrollment'
 WHERE id = '38000000-0000-4000-a000-000000000048';
UPDATE public.portals
   SET name = 'Historical typed legacy config'
 WHERE id = '38000000-0000-4000-a000-000000000048';

SELECT pg_temp.m48_mark('historical_typed_row_remains_legacy_and_proven',
  (SELECT case_type = 'enrollment'
      AND requires_explicit_selection = false
      AND is_verified = true
      AND proven_at IS NOT NULL
     FROM public.portals
    WHERE id = '38000000-0000-4000-a000-000000000048')
  AND (SELECT count(*) = 1 FROM public.portal_field_maps
        WHERE portal_key = 'm48_legacy_classify'));

-- Two fresh independent configs may share payer, case type, and URL. Their
-- keys are distinct, both start unverified/unproven, and neither has maps.
INSERT INTO public.portals(
  id, org_id, portal_key, name, payer_id, form_url, case_type,
  requires_explicit_selection, is_verified, last_verified_at, proven_at
) VALUES
  ('38000000-0000-4000-a000-000000000049',
   '18000000-0000-4000-a000-000000000048', 'm48_enrollment_a',
   'BCBS Kansas Enrollment', '28000000-0000-4000-a000-000000000048',
   'https://payer.example/forms', 'enrollment', false, true, now(), now()),
  ('38000000-0000-4000-a000-000000000050',
   '18000000-0000-4000-a000-000000000048', 'm48_enrollment_b',
   'BCBS Kansas Enrollment', '28000000-0000-4000-a000-000000000048',
   'https://payer.example/forms', 'enrollment', false, true, now(), now());

SELECT pg_temp.m48_mark('same_url_configs_are_distinct_empty_and_explicit',
  (SELECT count(*) = 2
      AND count(DISTINCT portal_key) = 2
      AND bool_and(requires_explicit_selection)
      AND bool_and(NOT is_verified)
      AND bool_and(last_verified_at IS NULL)
      AND bool_and(proven_at IS NULL)
      AND bool_and(mapping_generation = 1)
     FROM public.portals
    WHERE id IN ('38000000-0000-4000-a000-000000000049',
                 '38000000-0000-4000-a000-000000000050')
      AND form_url = 'https://payer.example/forms')
  AND NOT EXISTS (
    SELECT 1 FROM public.portal_field_maps
     WHERE portal_key IN ('m48_enrollment_a', 'm48_enrollment_b')
  ));
SELECT pg_temp.m48_mark('fresh_typed_config_requires_payer', pg_temp.m48_expect_state(
  '23514',
  $$INSERT INTO public.portals(org_id, portal_key, name, form_url, case_type)
      VALUES ('18000000-0000-4000-a000-000000000048', 'm48_missing_payer',
              'Missing payer', 'https://payer.example/forms', 'enrollment')$$
));

SELECT pg_temp.m48_mark('flagged_key_is_immutable', pg_temp.m48_expect_state(
  '42501',
  $$UPDATE public.portals SET portal_key = 'm48_changed_key'
      WHERE id = '38000000-0000-4000-a000-000000000049'$$
));
SELECT pg_temp.m48_mark('explicit_selection_cannot_be_downgraded', pg_temp.m48_expect_state(
  '42501',
  $$UPDATE public.portals SET requires_explicit_selection = false
      WHERE id = '38000000-0000-4000-a000-000000000049'$$
));
SELECT pg_temp.m48_mark('flagged_configuration_payer_is_immutable', pg_temp.m48_expect_state(
  '42501',
  $$UPDATE public.portals SET payer_id = NULL
      WHERE id = '38000000-0000-4000-a000-000000000049'$$
));

-- MINT-44's typed global RPC remains the only global write path. Its insert
-- runs the same MINT-48 trigger and keeps the established authenticated-only
-- authorization boundary.
SELECT pg_temp.m48_mark('global_rpc_grants_authenticated_not_anon',
  has_function_privilege(
    'authenticated',
    'public.upsert_global_portal(uuid,text,text,uuid,text,text)'::regprocedure,
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.upsert_global_portal(uuid,text,text,uuid,text,text)'::regprocedure,
    'EXECUTE'
  ));
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT public.upsert_global_portal(
  NULL,
  'MINT-48 global enrollment',
  'm48_global_enrollment',
  '28000000-0000-4000-a000-000000000048',
  'https://payer.example/global-form',
  'enrollment'
);
RESET ROLE;
SELECT pg_temp.m48_mark('global_rpc_creates_explicit_empty_config',
  (SELECT requires_explicit_selection
      AND case_type = 'enrollment'
      AND NOT is_verified
      AND last_verified_at IS NULL
      AND proven_at IS NULL
     FROM public.portals
    WHERE org_id IS NULL AND portal_key = 'm48_global_enrollment')
  AND NOT EXISTS (
    SELECT 1 FROM public.portal_field_maps WHERE portal_key = 'm48_global_enrollment'
  ));
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT pg_temp.m48_mark('global_rpc_rejects_anon', pg_temp.m48_expect_state(
  'P0001',
  $$SELECT public.upsert_global_portal(
      NULL, 'MINT-48 anon attempt', 'm48_anon_attempt',
      '28000000-0000-4000-a000-000000000048',
      'https://payer.example/anon-form', 'enrollment'
    )$$
));
SELECT set_config('request.jwt.claim.role', '', true);

DO $$
DECLARE failures text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO failures
    FROM pg_temp.m48_results WHERE NOT passed;
  IF failures IS NOT NULL THEN
    RAISE EXCEPTION 'MINT-48 portal configuration checks failed: %', failures;
  END IF;
END;
$$;

TABLE pg_temp.m48_results;
ROLLBACK;
