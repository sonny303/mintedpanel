-- MINT-51 credential-case owner-context version guard.
-- Run after all migrations in the disposable PostgreSQL CI database. The
-- authenticated org writer uses only synthetic rows; the transaction rolls
-- back every fixture.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE m51_results (name text PRIMARY KEY, passed boolean NOT NULL);
GRANT ALL ON m51_results TO authenticated;
CREATE FUNCTION pg_temp.m51_mark(p_name text, p_passed boolean) RETURNS void
LANGUAGE sql AS $$ INSERT INTO pg_temp.m51_results VALUES (p_name, p_passed) $$;
GRANT EXECUTE ON FUNCTION pg_temp.m51_mark(text, boolean) TO authenticated;

INSERT INTO auth.users(id, email)
VALUES ('39000000-0000-4000-a000-000000000051', 'm51-writer@example.invalid');
INSERT INTO public.profiles(id, full_name, email)
VALUES ('39000000-0000-4000-a000-000000000051', 'MINT-51 Synthetic Writer', 'm51-writer@example.invalid');
INSERT INTO public.organizations(id, name)
VALUES ('19000000-0000-4000-a000-000000000051', 'MINT-51 Synthetic Org');
INSERT INTO public.memberships(org_id, user_id, role)
VALUES (
  '19000000-0000-4000-a000-000000000051',
  '39000000-0000-4000-a000-000000000051',
  'specialist'
);
INSERT INTO public.payers(id, org_id, name)
VALUES (
  '29000000-0000-4000-a000-000000000051',
  '19000000-0000-4000-a000-000000000051',
  'MINT-51 Synthetic Payer'
);
INSERT INTO public.provider_groups(id, org_id, name)
VALUES (
  '49000000-0000-4000-a000-000000000051',
  '19000000-0000-4000-a000-000000000051',
  'MINT-51 Synthetic Group'
);
INSERT INTO public.providers(id, org_id, group_id, first_name, last_name, status)
VALUES
  (
    '39000000-0000-4000-a000-000000000052',
    '19000000-0000-4000-a000-000000000051',
    '49000000-0000-4000-a000-000000000051',
    'Synthetic', 'Writer', 'active'
  ),
  (
    '39000000-0000-4000-a000-000000000053',
    '19000000-0000-4000-a000-000000000051',
    '49000000-0000-4000-a000-000000000051',
    'Synthetic', 'Second Writer', 'active'
  );

SELECT set_config('request.jwt.claim.sub', '39000000-0000-4000-a000-000000000051', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-a000-000000000051","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

INSERT INTO public.credential_cases(
  id, org_id, provider_id, group_id, payer_id, state, case_type
) VALUES (
  '49000000-0000-4000-a000-000000000052',
  '19000000-0000-4000-a000-000000000051',
  '39000000-0000-4000-a000-000000000052',
  '49000000-0000-4000-a000-000000000051',
  '29000000-0000-4000-a000-000000000051',
  'KS', 'enrollment'
);
SELECT pg_temp.m51_mark(
  'authenticated_insert_starts_context_at_one',
  (SELECT context_version = 1 FROM public.credential_cases
    WHERE id = '49000000-0000-4000-a000-000000000052')
);

UPDATE public.credential_cases
   SET specialty = specialty, context_version = 99
 WHERE id = '49000000-0000-4000-a000-000000000052';
SELECT pg_temp.m51_mark(
  'no_op_owner_update_keeps_context_version',
  (SELECT context_version = 1 FROM public.credential_cases
    WHERE id = '49000000-0000-4000-a000-000000000052')
);

UPDATE public.credential_cases
   SET state = 'MO', context_version = 99
 WHERE id = '49000000-0000-4000-a000-000000000052';
SELECT pg_temp.m51_mark(
  'owner_state_change_increments_once_and_ignores_forged_value',
  (SELECT context_version = 2 AND state = 'MO' FROM public.credential_cases
    WHERE id = '49000000-0000-4000-a000-000000000052')
);

UPDATE public.credential_cases
   SET case_status = 'in_progress', context_version = 99
 WHERE id = '49000000-0000-4000-a000-000000000052';
SELECT pg_temp.m51_mark(
  'canonical_status_change_increments_context_once',
  (SELECT context_version = 3 AND case_status = 'in_progress' FROM public.credential_cases
    WHERE id = '49000000-0000-4000-a000-000000000052')
);

UPDATE public.credential_cases
   SET specialty = 'Synthetic specialty', context_version = 99
 WHERE id = '49000000-0000-4000-a000-000000000052';
SELECT pg_temp.m51_mark(
  'unrelated_profile_edit_does_not_increment_context',
  (SELECT context_version = 3 FROM public.credential_cases
    WHERE id = '49000000-0000-4000-a000-000000000052')
);

INSERT INTO public.credential_cases(
  id, org_id, provider_id, group_id, payer_id, state, case_type, context_version
) VALUES (
  '49000000-0000-4000-a000-000000000053',
  '19000000-0000-4000-a000-000000000051',
  '39000000-0000-4000-a000-000000000053',
  '49000000-0000-4000-a000-000000000051',
  '29000000-0000-4000-a000-000000000051',
  'KS', 'enrollment', 88
);
SELECT pg_temp.m51_mark(
  'caller_cannot_forge_initial_context_version',
  (SELECT context_version = 1 FROM public.credential_cases
    WHERE id = '49000000-0000-4000-a000-000000000053')
);

RESET ROLE;
SELECT pg_temp.m51_mark(
  'trigger_function_is_not_directly_executable',
  NOT has_function_privilege(
    'authenticated', 'public.bump_credential_case_context_version()', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon', 'public.bump_credential_case_context_version()', 'EXECUTE'
  )
);

SELECT name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END
FROM pg_temp.m51_results ORDER BY name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_temp.m51_results WHERE NOT passed) THEN
    RAISE EXCEPTION 'MINT-51 case context version regression failed';
  END IF;
END;
$$;

ROLLBACK;
