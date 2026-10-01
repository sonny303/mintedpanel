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
   'https://failure.example.invalid/form', 'enrollment', true, 1, true, now(), now());

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
   'manual', 'text', 'proposed', 'Synthetic failure field', NULL, 1);

INSERT INTO public.sop_templates(
  id, org_id, name, payer_id, state, states, task_definitions,
  archived, current_version, required_profile_attributes, case_type
) VALUES (
  '69000000-0000-4000-a000-000000000060',
  '18000000-0000-4000-a000-000000000060', 'MINT-60 referenced SOP',
  '28000000-0000-4000-a000-000000000060', 'CA', ARRAY['CA']::text[],
  '[{"title":"Enrollment","steps":[{"stepType":"online_form","portalKey":"m60_shared"}]}]'::jsonb,
  false, 1, '[]'::jsonb, 'enrollment'
);
INSERT INTO public.fill_sessions(
  id, org_id, case_id, provider_id, portal_id, portal_key, performed_by, fields_filled
) VALUES (
  '78000000-0000-4000-a000-000000000060',
  '18000000-0000-4000-a000-000000000060',
  '58000000-0000-4000-a000-000000000060',
  '48000000-0000-4000-a000-000000000060',
  '38000000-0000-4000-a000-000000000060', 'm60_shared',
  '39000000-0000-4000-a000-000000000060', 2
);

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
GRANT ALL ON m60_first_receipt, m60_org_receipt TO authenticated;

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
        WHERE id = '78000000-0000-4000-a000-000000000060')
  AND (SELECT task_definitions @> '[{"steps":[{"portalKey":"m60_shared"}]}]'::jsonb
     FROM public.sop_templates WHERE id = '69000000-0000-4000-a000-000000000060'));
SELECT pg_temp.m60_mark('shared_reset_retains_org_override_but_leaves_old_base',
  (SELECT mapping_generation = 1 AND shared_base_generation = 1
     FROM public.portal_field_maps
    WHERE org_id = '18000000-0000-4000-a000-000000000060'
      AND portal_key = 'm60_shared' AND selector = '#org-override')
  AND (SELECT mapping_generation = 1 FROM public.portals
        WHERE id = '38000000-0000-4000-a000-000000000061'));

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
