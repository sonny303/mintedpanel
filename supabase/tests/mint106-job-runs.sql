-- MINT-106 job_runs packet: claim_job_run / finish_job_run and the ledger's
-- access boundary (supabase/migrations/20261031050000_job_runs.sql).
--
-- Run after all migrations in a disposable PostgreSQL database, never against
-- hosted. CI's Migration dry-run job runs it right after applying them:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/mint106-job-runs.sql
-- Every row it writes is rolled back.
--
-- It needs only what that job seeds: a superuser connection (it writes
-- job_runs directly and switches role) and the anon, authenticated and
-- service_role roles, created NOLOGIN with none of Supabase's attributes. So
-- service_role has no BYPASSRLS here, and the packet reads job_runs only as
-- the superuser. The first block checks these and stops with a plain message.
--
-- Single session. Concurrency rests on job_runs_one_live_run, which is proved
-- here by a direct second live insert failing 23505; a two-session race (in
-- the style of scripts/security/verify-mint19-atomic-sop.mjs) is not included.
--
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF NOT coalesce(
    (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user), false
  ) THEN
    RAISE EXCEPTION 'mint106-job-runs.sql must run as a superuser';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles
       WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    RAISE EXCEPTION 'mint106-job-runs.sql needs the anon, authenticated and service_role roles';
  END IF;
  IF to_regclass('public.job_runs') IS NULL
     OR to_regprocedure('public.claim_job_run(text, text)') IS NULL
     OR to_regprocedure('public.finish_job_run(uuid, text, jsonb, text)') IS NULL THEN
    RAISE EXCEPTION 'mint106-job-runs.sql runs after supabase/migrations/20261031050000_job_runs.sql';
  END IF;
END;
$$;

CREATE TEMP TABLE m106_results (name text PRIMARY KEY, passed boolean NOT NULL);
CREATE TEMP TABLE m106_ids (name text PRIMARY KEY, id uuid);
GRANT ALL ON m106_results TO service_role;
GRANT ALL ON m106_ids TO service_role;

CREATE FUNCTION pg_temp.m106_mark(p_name text, p_passed boolean) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO pg_temp.m106_results VALUES (p_name, coalesce(p_passed, false))
$$;

CREATE FUNCTION pg_temp.m106_id(p_name text) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT id FROM pg_temp.m106_ids WHERE name = p_name
$$;

CREATE FUNCTION pg_temp.m106_expect_state(p_state text, p_statement text) RETURNS boolean
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

-- ---------------------------------------------------------------------------
-- Slot A: claim, skip while running, finish succeeded, skip after success.
-- ---------------------------------------------------------------------------
INSERT INTO pg_temp.m106_ids VALUES ('a1', public.claim_job_run('m106-job', 'slot-a'));
INSERT INTO pg_temp.m106_ids VALUES ('a2', public.claim_job_run('m106-job', 'slot-a'));

SELECT pg_temp.m106_mark('claim_returns_a_running_row',
  EXISTS (
    SELECT 1 FROM public.job_runs
     WHERE id = pg_temp.m106_id('a1')
       AND job = 'm106-job' AND run_key = 'slot-a'
       AND outcome = 'running' AND finished_at IS NULL
       AND counts = '{}'::jsonb AND error_code IS NULL
  ));

SELECT pg_temp.m106_mark('claim_while_running_returns_null_and_writes_nothing',
  pg_temp.m106_id('a2') IS NULL
  AND (SELECT count(*) FROM public.job_runs WHERE job = 'm106-job' AND run_key = 'slot-a') = 1);

SELECT pg_temp.m106_mark('finish_records_success',
  public.finish_job_run(pg_temp.m106_id('a1'), 'succeeded', '{"orgs": 3, "sent": 2}'::jsonb));

SELECT pg_temp.m106_mark('success_row_is_finished_with_its_counts',
  EXISTS (
    SELECT 1 FROM public.job_runs
     WHERE id = pg_temp.m106_id('a1')
       AND outcome = 'succeeded' AND finished_at IS NOT NULL
       AND counts = '{"orgs": 3, "sent": 2}'::jsonb AND error_code IS NULL
  ));

INSERT INTO pg_temp.m106_ids VALUES ('a3', public.claim_job_run('m106-job', 'slot-a'));
SELECT pg_temp.m106_mark('claim_after_success_returns_null_and_writes_nothing',
  pg_temp.m106_id('a3') IS NULL
  AND (SELECT count(*) FROM public.job_runs WHERE job = 'm106-job' AND run_key = 'slot-a') = 1);

SELECT pg_temp.m106_mark('finish_on_a_finished_row_returns_false',
  NOT public.finish_job_run(pg_temp.m106_id('a1'), 'failed', '{}'::jsonb, 'job_error')
  AND (SELECT outcome FROM public.job_runs WHERE id = pg_temp.m106_id('a1')) = 'succeeded');

SELECT pg_temp.m106_mark('another_run_key_is_its_own_slot',
  public.claim_job_run('m106-job', 'slot-a2') IS NOT NULL
  AND public.claim_job_run('m106-other', 'slot-a') IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Slot B: a failed run may be retried, as a new row.
-- ---------------------------------------------------------------------------
INSERT INTO pg_temp.m106_ids VALUES ('b1', public.claim_job_run('m106-job', 'slot-b'));
SELECT pg_temp.m106_mark('finish_records_failure',
  public.finish_job_run(pg_temp.m106_id('b1'), 'failed', '{}'::jsonb, 'job_error'));
INSERT INTO pg_temp.m106_ids VALUES ('b2', public.claim_job_run('m106-job', 'slot-b'));

SELECT pg_temp.m106_mark('claim_after_failure_takes_a_new_row',
  pg_temp.m106_id('b2') IS NOT NULL
  AND pg_temp.m106_id('b2') <> pg_temp.m106_id('b1')
  AND (
    SELECT array_agg(outcome || ':' || coalesce(error_code, '-') ORDER BY outcome)
      FROM public.job_runs WHERE job = 'm106-job' AND run_key = 'slot-b'
  ) = ARRAY['failed:job_error', 'running:-']);

-- ---------------------------------------------------------------------------
-- Slots C and D: a running row older than 15 minutes is timed out; a younger
-- one still holds the slot.
-- ---------------------------------------------------------------------------
INSERT INTO public.job_runs (id, job, run_key, started_at)
VALUES ('10600000-0000-4000-a000-000000000001', 'm106-job', 'slot-c', now() - interval '16 minutes');
INSERT INTO pg_temp.m106_ids VALUES ('c1', public.claim_job_run('m106-job', 'slot-c'));

SELECT pg_temp.m106_mark('stale_running_row_is_marked_timed_out',
  EXISTS (
    SELECT 1 FROM public.job_runs
     WHERE id = '10600000-0000-4000-a000-000000000001'
       AND outcome = 'failed' AND error_code = 'timed_out' AND finished_at = now()
  ));
SELECT pg_temp.m106_mark('claim_after_a_stale_row_takes_a_new_row',
  EXISTS (
    SELECT 1 FROM public.job_runs
     WHERE id = pg_temp.m106_id('c1') AND outcome = 'running'
  ));
SELECT pg_temp.m106_mark('finish_on_a_timed_out_row_returns_false',
  NOT public.finish_job_run('10600000-0000-4000-a000-000000000001', 'succeeded', '{}'::jsonb));

INSERT INTO public.job_runs (id, job, run_key, started_at)
VALUES ('10600000-0000-4000-a000-000000000002', 'm106-job', 'slot-d', now() - interval '14 minutes');
INSERT INTO pg_temp.m106_ids VALUES ('d1', public.claim_job_run('m106-job', 'slot-d'));

SELECT pg_temp.m106_mark('running_row_inside_the_timeout_blocks_the_claim',
  pg_temp.m106_id('d1') IS NULL
  AND (SELECT outcome FROM public.job_runs WHERE id = '10600000-0000-4000-a000-000000000002') = 'running'
  AND (SELECT count(*) FROM public.job_runs WHERE job = 'm106-job' AND run_key = 'slot-d') = 1);

-- ---------------------------------------------------------------------------
-- Slot E: the sweep covers every slot of the job. A daily job never claims
-- yesterday's slot again, so its crashed row is retired by today's claim.
-- Another job's stale row is not touched.
-- ---------------------------------------------------------------------------
INSERT INTO public.job_runs (id, job, run_key, started_at)
VALUES
  ('10600000-0000-4000-a000-000000000003', 'm106-job', 'slot-e-day1', now() - interval '25 hours'),
  ('10600000-0000-4000-a000-000000000004', 'm106-other', 'slot-e-day1', now() - interval '25 hours');
INSERT INTO pg_temp.m106_ids VALUES ('e1', public.claim_job_run('m106-job', 'slot-e-day2'));

SELECT pg_temp.m106_mark('sweep_times_out_a_stale_row_in_another_slot_of_the_job',
  EXISTS (
    SELECT 1 FROM public.job_runs
     WHERE id = '10600000-0000-4000-a000-000000000003'
       AND outcome = 'failed' AND error_code = 'timed_out' AND finished_at = now()
  )
  AND EXISTS (
    SELECT 1 FROM public.job_runs WHERE id = pg_temp.m106_id('e1') AND outcome = 'running'
  ));
SELECT pg_temp.m106_mark('sweep_leaves_another_jobs_stale_row_alone',
  (SELECT outcome FROM public.job_runs WHERE id = '10600000-0000-4000-a000-000000000004') = 'running');
SELECT pg_temp.m106_mark('sweep_leaves_a_young_row_in_another_slot_alone',
  (SELECT outcome FROM public.job_runs WHERE id = '10600000-0000-4000-a000-000000000002') = 'running');

SELECT pg_temp.m106_mark('index_refuses_a_second_live_row',
  pg_temp.m106_expect_state('23505',
    $$INSERT INTO public.job_runs (job, run_key) VALUES ('m106-job', 'slot-d')$$));
SELECT pg_temp.m106_mark('index_refuses_a_running_row_beside_a_success',
  pg_temp.m106_expect_state('23505',
    $$INSERT INTO public.job_runs (job, run_key) VALUES ('m106-job', 'slot-a')$$));
-- The claim's ON CONFLICT names the partial index, so it infers that index
-- (no 42P10) and swallows only a live-slot conflict; a primary key collision
-- in a free slot still raises.
SELECT pg_temp.m106_mark('named_conflict_target_lets_a_primary_key_collision_raise',
  pg_temp.m106_expect_state('23505',
    format($$INSERT INTO public.job_runs (id, job, run_key) VALUES (%L, 'm106-job', 'slot-z')
             ON CONFLICT (job, run_key) WHERE outcome IN ('running', 'succeeded') DO NOTHING$$,
           pg_temp.m106_id('a1'))));

-- ---------------------------------------------------------------------------
-- Input checks. b2 is running; every refused finish leaves it running.
-- ---------------------------------------------------------------------------
SELECT pg_temp.m106_mark('claim_refuses_an_invalid_job_name',
  pg_temp.m106_expect_state('23514', $$SELECT public.claim_job_run('Daily Digest', 'slot-e')$$));
SELECT pg_temp.m106_mark('claim_refuses_an_invalid_run_key',
  pg_temp.m106_expect_state('23514', $$SELECT public.claim_job_run('m106-job', '2026 10 30')$$));

SELECT pg_temp.m106_mark('finish_refuses_' || label,
  pg_temp.m106_expect_state(state,
    format('SELECT public.finish_job_run(%L::uuid, %L, %L::jsonb%s)',
           pg_temp.m106_id('b2'), outcome, counts,
           CASE WHEN code IS NULL THEN '' ELSE format(', %L', code) END)))
  FROM (VALUES
    ('counts_that_are_an_array', '22023', 'succeeded', '[1]', NULL),
    ('counts_that_are_a_number', '22023', 'succeeded', '3', NULL),
    ('an_uppercase_key', '22023', 'succeeded', '{"Sent": 1}', NULL),
    ('a_key_with_digits', '22023', 'succeeded', '{"d1961_04_12": 1}', NULL),
    ('a_key_starting_with_underscore', '22023', 'succeeded', '{"_sent": 1}', NULL),
    ('a_negative_count', '22023', 'succeeded', '{"sent": -1}', NULL),
    ('a_fractional_count', '22023', 'succeeded', '{"sent": 1.5}', NULL),
    ('an_unsafe_integer', '22023', 'succeeded', '{"sent": 9007199254740992}', NULL),
    ('a_string_count_without_a_cast_error', '22023', 'succeeded', '{"sent": "1961-04-12"}', NULL),
    ('a_nested_count', '22023', 'succeeded', '{"sent": {"org": 1}}', NULL),
    ('a_running_outcome', '22023', 'running', '{}', NULL),
    ('success_with_an_error_code', '23514', 'succeeded', '{}', 'job_error'),
    ('failure_without_an_error_code', '23514', 'failed', '{}', NULL),
    ('an_identifier_outside_the_closed_codes', '22023', 'failed', '{}', 'job_failed_badly'),
    ('free_text_as_an_error_code', '22023', 'failed', '{}', 'DOB 1961-04-12')
  ) AS t(label, state, outcome, counts, code);

SELECT pg_temp.m106_mark('finish_refuses_more_than_32_keys',
  pg_temp.m106_expect_state('22023',
    format('SELECT public.finish_job_run(%L::uuid, ''succeeded'', %L::jsonb)',
           pg_temp.m106_id('b2'),
           (SELECT jsonb_object_agg('k' || repeat('a', g), 1)::text
              FROM generate_series(1, 33) AS g))));

SELECT pg_temp.m106_mark('check_refuses_an_error_code_outside_the_closed_set',
  pg_temp.m106_expect_state('23514',
    format($$UPDATE public.job_runs
                SET outcome = 'failed', error_code = 'other_code', finished_at = now()
              WHERE id = %L$$,
           pg_temp.m106_id('b2'))));

SELECT pg_temp.m106_mark('refused_finishes_leave_the_row_running',
  (SELECT outcome FROM public.job_runs WHERE id = pg_temp.m106_id('b2')) = 'running');

SELECT pg_temp.m106_mark('finish_accepts_32_snake_case_integer_counts',
  public.finish_job_run(pg_temp.m106_id('b2'), 'succeeded',
    (SELECT jsonb_object_agg('k' || repeat('a', g), g) FROM generate_series(1, 32) AS g)));

-- ---------------------------------------------------------------------------
-- Access boundary.
-- ---------------------------------------------------------------------------
SELECT pg_temp.m106_mark('rls_is_enabled_with_no_policy',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.job_runs'::regclass)
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'job_runs'
  ));

SELECT pg_temp.m106_mark('anon_and_authenticated_cannot_touch_the_table',
  NOT has_table_privilege('anon', 'public.job_runs',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  AND NOT has_table_privilege('authenticated', 'public.job_runs',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  AND NOT has_table_privilege('public', 'public.job_runs',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'));

SELECT pg_temp.m106_mark('service_role_reads_the_table_and_writes_only_through_the_rpcs',
  has_table_privilege('service_role', 'public.job_runs', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.job_runs', 'INSERT, UPDATE, DELETE, TRUNCATE'));

SELECT pg_temp.m106_mark('only_service_role_executes_the_rpcs',
  has_function_privilege('service_role', 'public.claim_job_run(text, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.finish_job_run(uuid, text, jsonb, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.claim_job_run(text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.finish_job_run(uuid, text, jsonb, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.claim_job_run(text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.finish_job_run(uuid, text, jsonb, text)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'public.claim_job_run(text, text)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'public.finish_job_run(uuid, text, jsonb, text)', 'EXECUTE'));

SELECT pg_temp.m106_mark('rpcs_are_security_definer_with_an_empty_search_path',
  (SELECT count(*) FROM pg_proc AS p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('claim_job_run', 'finish_job_run')
       AND p.prosecdef
       AND EXISTS (
         SELECT 1 FROM unnest(p.proconfig) AS c WHERE c IN ('search_path=""', 'search_path=')
       )) = 2);

SET LOCAL ROLE service_role;
INSERT INTO pg_temp.m106_ids VALUES ('s1', public.claim_job_run('m106-job', 'slot-s'));
RESET ROLE;
SELECT pg_temp.m106_mark('service_role_can_claim',
  EXISTS (SELECT 1 FROM public.job_runs WHERE id = pg_temp.m106_id('s1') AND outcome = 'running'));

SELECT name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END
  FROM pg_temp.m106_results ORDER BY name;

DO $$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO v_failed
    FROM pg_temp.m106_results WHERE NOT passed;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'MINT-106 job_runs assertions failed: %', v_failed;
  END IF;
END;
$$;

ROLLBACK;
\echo MINT-106 job_runs packet passed.
