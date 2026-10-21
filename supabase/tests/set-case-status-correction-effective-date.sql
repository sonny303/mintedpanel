-- set_case_status: an admin correction into Approved keeps its effective date.
-- Run after all migrations in the disposable PostgreSQL CI database (the
-- Migration dry-run job). Synthetic rows only; the transaction rolls back
-- every fixture.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

BEGIN;
SET LOCAL client_min_messages = warning;
-- Hosted Supabase lets authenticated reach auth.uid(); the bare CI Postgres
-- does not until this grant (rolled back with everything else).
GRANT USAGE ON SCHEMA auth TO authenticated;
\o /dev/null

CREATE TEMP TABLE csc_results (name text PRIMARY KEY, passed boolean NOT NULL);
CREATE FUNCTION pg_temp.csc_mark(p_name text, p_passed boolean) RETURNS void
LANGUAGE sql AS $$ INSERT INTO pg_temp.csc_results VALUES (p_name, COALESCE(p_passed, false)) $$;

-- One set_case_status call as the current role. Returns 'ok' or the raised
-- message, so a rejected call rolls back on its own and the suite goes on.
CREATE TEMP TABLE csc_calls (name text PRIMARY KEY, result text NOT NULL);
GRANT ALL ON csc_calls TO authenticated;
CREATE FUNCTION pg_temp.csc_set(
  p_case uuid,
  p_to text,
  p_expected text,
  p_note text,
  p_correction boolean,
  p_date date,
  p_individual text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.set_case_status(
    p_case_id => p_case,
    p_to_status => p_to,
    p_expected_status => p_expected,
    p_note => p_note,
    p_is_correction => p_correction,
    p_effective_date => p_date,
    p_individual_provider_id => p_individual
  );
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.csc_set(uuid, text, text, text, boolean, date, text)
  TO authenticated;
CREATE FUNCTION pg_temp.csc_call(p_name text, p_result text) RETURNS void
LANGUAGE sql AS $$ INSERT INTO pg_temp.csc_calls VALUES (p_name, p_result) $$;
GRANT EXECUTE ON FUNCTION pg_temp.csc_call(text, text) TO authenticated;

INSERT INTO auth.users(id, email) VALUES
  ('3c000000-0000-4000-a000-000000000001', 'csc-admin@example.invalid'),
  ('3c000000-0000-4000-a000-000000000002', 'csc-specialist@example.invalid');
INSERT INTO public.profiles(id, full_name, email) VALUES
  ('3c000000-0000-4000-a000-000000000001', 'CSC Synthetic Admin', 'csc-admin@example.invalid'),
  ('3c000000-0000-4000-a000-000000000002', 'CSC Synthetic Specialist', 'csc-specialist@example.invalid');
INSERT INTO public.organizations(id, name)
VALUES ('1c000000-0000-4000-a000-000000000001', 'CSC Synthetic Org');
INSERT INTO public.memberships(org_id, user_id, role) VALUES
  ('1c000000-0000-4000-a000-000000000001', '3c000000-0000-4000-a000-000000000001', 'admin'),
  ('1c000000-0000-4000-a000-000000000001', '3c000000-0000-4000-a000-000000000002', 'specialist');
-- The payer expects a provider ID at Approved, so the normal close needs one.
INSERT INTO public.payers(id, org_id, name, provider_id_expected, group_id_expected)
VALUES (
  '2c000000-0000-4000-a000-000000000001',
  '1c000000-0000-4000-a000-000000000001',
  'CSC Synthetic Payer', true, false
);
INSERT INTO public.provider_groups(id, org_id, name)
VALUES (
  '4c000000-0000-4000-a000-000000000001',
  '1c000000-0000-4000-a000-000000000001',
  'CSC Synthetic Group'
);
INSERT INTO public.providers(id, org_id, group_id, first_name, last_name, status)
VALUES (
  '5c000000-0000-4000-a000-000000000001',
  '1c000000-0000-4000-a000-000000000001',
  '4c000000-0000-4000-a000-000000000001',
  'Synthetic', 'Provider', 'active'
);
INSERT INTO public.credential_cases(
  id, org_id, provider_id, group_id, payer_id, state, case_type, case_status,
  confirmed_effective_date, payer_individual_provider_id
)
SELECT c.id::uuid, '1c000000-0000-4000-a000-000000000001',
       '5c000000-0000-4000-a000-000000000001', '4c000000-0000-4000-a000-000000000001',
       '2c000000-0000-4000-a000-000000000001', c.state, 'enrollment', c.status,
       c.effective_date::date, c.individual_id
FROM (VALUES
  -- backfill from a letter: denied -> approved, with a date
  ('6c000000-0000-4000-a000-000000000001', 'KS', 'denied', NULL, NULL),
  -- dateless correction, nothing on file
  ('6c000000-0000-4000-a000-000000000002', 'CO', 'not_pursuing', NULL, NULL),
  -- dateless correction, a date already recorded on the Dates card
  ('6c000000-0000-4000-a000-000000000003', 'NE', 'in_review', '2026-09-15', NULL),
  -- the normal (non-correction) Approved close
  ('6c000000-0000-4000-a000-000000000004', 'MO', 'in_review', NULL, NULL),
  -- rejected corrections
  ('6c000000-0000-4000-a000-000000000005', 'OK', 'denied', NULL, NULL),
  -- reversal, then a correction back into Approved
  ('6c000000-0000-4000-a000-000000000006', 'IA', 'approved', '2026-08-01', 'PTAN-6')
) AS c(id, state, status, effective_date, individual_id);

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

-- Admin calls.
SELECT set_config('request.jwt.claim.sub', '3c000000-0000-4000-a000-000000000001', true);
SELECT pg_temp.csc_call('backfill', pg_temp.csc_set(
  '6c000000-0000-4000-a000-000000000001', 'approved', 'denied',
  'Backfilled from the approval letter', true, '2026-10-01', 'PTAN-1'));
SELECT pg_temp.csc_call('dateless', pg_temp.csc_set(
  '6c000000-0000-4000-a000-000000000002', 'approved', 'not_pursuing',
  'Approved; letter date unknown', true, NULL));
SELECT pg_temp.csc_call('dateless_keeps', pg_temp.csc_set(
  '6c000000-0000-4000-a000-000000000003', 'approved', 'in_review',
  'Approval confirmed by phone', true, NULL));
SELECT pg_temp.csc_call('close_no_date', pg_temp.csc_set(
  '6c000000-0000-4000-a000-000000000004', 'approved', 'in_review', NULL, false, NULL, 'PTAN-4'));
SELECT pg_temp.csc_call('close_no_id', pg_temp.csc_set(
  '6c000000-0000-4000-a000-000000000004', 'approved', 'in_review', NULL, false, '2026-10-05'));
SELECT pg_temp.csc_call('close', pg_temp.csc_set(
  '6c000000-0000-4000-a000-000000000004', 'approved', 'in_review', NULL, false, '2026-10-05',
  'PTAN-4'));
SELECT pg_temp.csc_call('no_note', pg_temp.csc_set(
  '6c000000-0000-4000-a000-000000000005', 'approved', 'denied', '  ', true, '2026-10-01'));
SELECT pg_temp.csc_call('stale', pg_temp.csc_set(
  '6c000000-0000-4000-a000-000000000005', 'approved', 'in_review',
  'Backfilled from the approval letter', true, '2026-10-01'));
SELECT pg_temp.csc_call('reverse', pg_temp.csc_set(
  '6c000000-0000-4000-a000-000000000006', 'in_review', 'approved',
  'Letter was for the sibling case', true, NULL));
SELECT pg_temp.csc_call('restore', pg_temp.csc_set(
  '6c000000-0000-4000-a000-000000000006', 'approved', 'in_review',
  'Correct letter received', true, '2026-08-15'));

-- Specialist call.
SELECT set_config('request.jwt.claim.sub', '3c000000-0000-4000-a000-000000000002', true);
SELECT pg_temp.csc_call('specialist', pg_temp.csc_set(
  '6c000000-0000-4000-a000-000000000005', 'approved', 'denied',
  'Backfilled from the approval letter', true, '2026-10-01'));

RESET ROLE;

CREATE FUNCTION pg_temp.csc_result(p_name text) RETURNS text
LANGUAGE sql AS $$ SELECT result FROM pg_temp.csc_calls WHERE name = p_name $$;
CREATE FUNCTION pg_temp.csc_case(p_suffix text) RETURNS public.credential_cases
LANGUAGE sql AS $$
  SELECT * FROM public.credential_cases
  WHERE id = ('6c000000-0000-4000-a000-00000000000' || p_suffix)::uuid
$$;
CREATE FUNCTION pg_temp.csc_history_count(p_suffix text) RETURNS bigint
LANGUAGE sql AS $$
  SELECT count(*) FROM public.case_status_history
  WHERE case_id = ('6c000000-0000-4000-a000-00000000000' || p_suffix)::uuid
$$;

\o
-- The fix: a correction into Approved stores the date it is given.
SELECT pg_temp.csc_mark('backfill_succeeds', pg_temp.csc_result('backfill') = 'ok');
SELECT pg_temp.csc_mark(
  'backfill_stores_effective_date',
  (SELECT case_status = 'approved' AND confirmed_effective_date = '2026-10-01'
   FROM pg_temp.csc_case('1'))
);
-- Expected payer-ID handling is unchanged: a correction neither requires an
-- expected ID nor writes one.
SELECT pg_temp.csc_mark(
  'backfill_leaves_payer_id_unwritten',
  (SELECT payer_individual_provider_id IS NULL FROM pg_temp.csc_case('1'))
);
-- History and audit rows are the same shape as before.
SELECT pg_temp.csc_mark(
  'backfill_appends_one_correction_history_row',
  (SELECT count(*) = 1
     AND bool_and(from_status = 'denied' AND to_status = 'approved'
       AND is_correction AND actor_kind = 'user'
       AND note = 'Backfilled from the approval letter'
       AND changed_by = '3c000000-0000-4000-a000-000000000001')
   FROM public.case_status_history
   WHERE case_id = '6c000000-0000-4000-a000-000000000001')
);
SELECT pg_temp.csc_mark(
  'backfill_writes_one_unchanged_audit_row',
  (SELECT count(*) = 1
     AND bool_and(action_type = 'STATUS_CHANGE' AND entity_type = 'credential_case'
       AND description = 'Case status corrected'
       AND user_id = '3c000000-0000-4000-a000-000000000001'
       AND before = '{"caseStatus": "denied"}'::jsonb
       AND after = jsonb_build_object(
         'caseStatus', 'approved', 'isCorrection', true,
         'reasonCodeId', NULL, 'evidenceTouchId', NULL))
   FROM public.audit_log
   WHERE entity_id = '6c000000-0000-4000-a000-000000000001')
);

-- Decision: a correction into Approved with no date is still allowed.
SELECT pg_temp.csc_mark(
  'dateless_correction_allowed_and_leaves_date_null',
  pg_temp.csc_result('dateless') = 'ok'
  AND (SELECT case_status = 'approved' AND confirmed_effective_date IS NULL
       FROM pg_temp.csc_case('2'))
);
SELECT pg_temp.csc_mark(
  'dateless_correction_keeps_recorded_date',
  pg_temp.csc_result('dateless_keeps') = 'ok'
  AND (SELECT case_status = 'approved' AND confirmed_effective_date = '2026-09-15'
       FROM pg_temp.csc_case('3'))
);

-- The normal Approved close is unchanged.
SELECT pg_temp.csc_mark(
  'close_still_requires_effective_date',
  pg_temp.csc_result('close_no_date') = 'case_status_approved_needs_effective_date'
);
SELECT pg_temp.csc_mark(
  'close_still_requires_expected_provider_id',
  pg_temp.csc_result('close_no_id') = 'case_status_approved_needs_provider_id'
);
SELECT pg_temp.csc_mark(
  'close_stores_date_and_id',
  pg_temp.csc_result('close') = 'ok'
  AND (SELECT case_status = 'approved' AND confirmed_effective_date = '2026-10-05'
         AND payer_individual_provider_id = 'PTAN-4'
       FROM pg_temp.csc_case('4'))
  AND pg_temp.csc_history_count('4') = 1
);

-- Correction gates and optimistic concurrency are unchanged, and a rejected
-- call writes nothing.
SELECT pg_temp.csc_mark(
  'correction_still_admin_only',
  pg_temp.csc_result('specialist') = 'case_status_admin_only'
);
SELECT pg_temp.csc_mark(
  'correction_still_needs_note',
  pg_temp.csc_result('no_note') = 'case_status_correction_needs_note'
);
SELECT pg_temp.csc_mark(
  'stale_correction_still_conflicts',
  pg_temp.csc_result('stale') = 'case_status_conflict:denied'
);
SELECT pg_temp.csc_mark(
  'rejected_corrections_write_nothing',
  (SELECT case_status = 'denied' AND confirmed_effective_date IS NULL
   FROM pg_temp.csc_case('5'))
  AND pg_temp.csc_history_count('5') = 0
  AND NOT EXISTS (
    SELECT 1 FROM public.audit_log
    WHERE entity_id = '6c000000-0000-4000-a000-000000000005'
  )
);

-- Reversal still clears the approval facts; the correction back stores the
-- new date.
SELECT pg_temp.csc_mark(
  'reversal_then_restore',
  pg_temp.csc_result('reverse') = 'ok'
  AND pg_temp.csc_result('restore') = 'ok'
  AND (SELECT case_status = 'approved' AND confirmed_effective_date = '2026-08-15'
         AND payer_individual_provider_id IS NULL
       FROM pg_temp.csc_case('6'))
  AND pg_temp.csc_history_count('6') = 2
);

SELECT name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END
FROM pg_temp.csc_results ORDER BY name;
SELECT name, result FROM pg_temp.csc_calls ORDER BY name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_temp.csc_results WHERE NOT passed) THEN
    RAISE EXCEPTION 'set_case_status correction effective-date regression failed';
  END IF;
END;
$$;

ROLLBACK;
