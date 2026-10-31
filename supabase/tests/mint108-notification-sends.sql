-- MINT-108 notification_sends packet: claim_notification_send /
-- finish_notification_send and the ledger's access boundary
-- (supabase/migrations/20261031060000_notification_sends.sql).
--
-- Run after all migrations in a disposable PostgreSQL database, never against
-- hosted. CI's Migration dry-run job runs it right after the MINT-107 packet:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/mint108-notification-sends.sql
-- Every row it writes is synthetic and rolled back.
--
-- It needs only what that job seeds: a superuser connection (it writes
-- fixtures, reads notification_sends and switches role) and the anon,
-- authenticated and service_role roles, created NOLOGIN with none of
-- Supabase's attributes. So service_role has no BYPASSRLS here, and the
-- packet reads notification_sends only as the superuser. The first block
-- checks these and stops with a plain message.
--
-- Single session. Concurrency rests on notification_sends_one_live_send,
-- which is proved here by a direct second live insert failing 23505.
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
    RAISE EXCEPTION 'mint108-notification-sends.sql must run as a superuser';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles
       WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    RAISE EXCEPTION 'mint108-notification-sends.sql needs the anon, authenticated and service_role roles';
  END IF;
  IF to_regclass('public.notification_sends') IS NULL
     OR to_regclass('public.organizations') IS NULL
     OR to_regprocedure('public.claim_notification_send(text, text, uuid, uuid)') IS NULL
     OR to_regprocedure('public.finish_notification_send(uuid, text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'mint108-notification-sends.sql runs after supabase/migrations/20261031060000_notification_sends.sql';
  END IF;
END;
$$;

CREATE TEMP TABLE m108_results (name text PRIMARY KEY, passed boolean NOT NULL);
CREATE TEMP TABLE m108_ids (name text PRIMARY KEY, id uuid);
GRANT ALL ON m108_results TO authenticated, service_role;
GRANT ALL ON m108_ids TO authenticated, service_role;

CREATE FUNCTION pg_temp.m108_mark(p_name text, p_passed boolean) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO pg_temp.m108_results VALUES (p_name, coalesce(p_passed, false))
$$;

CREATE FUNCTION pg_temp.m108_id(p_name text) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT id FROM pg_temp.m108_ids WHERE name = p_name
$$;

CREATE FUNCTION pg_temp.m108_expect_state(p_state text, p_statement text) RETURNS boolean
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

-- Two synthetic orgs and two recipients (actor ids; no profile needed).
INSERT INTO public.organizations (id, name) VALUES
  ('10800000-0000-4000-a000-0000000000a1', 'MINT-108 packet org A'),
  ('10800000-0000-4000-a000-0000000000a2', 'MINT-108 packet org B');

-- ---------------------------------------------------------------------------
-- Key A: claim, skip while claimed, finish sent, skip after sent.
-- ---------------------------------------------------------------------------
INSERT INTO pg_temp.m108_ids VALUES ('a1', public.claim_notification_send(
  'followup-digest', '2026-10-31',
  '10800000-0000-4000-a000-0000000000a1', '10800000-0000-4000-a000-0000000000b1'));
INSERT INTO pg_temp.m108_ids VALUES ('a2', public.claim_notification_send(
  'followup-digest', '2026-10-31',
  '10800000-0000-4000-a000-0000000000a1', '10800000-0000-4000-a000-0000000000b1'));

SELECT pg_temp.m108_mark('claim_returns_a_claimed_row',
  EXISTS (
    SELECT 1 FROM public.notification_sends
     WHERE id = pg_temp.m108_id('a1')
       AND job = 'followup-digest' AND run_key = '2026-10-31'
       AND org_id = '10800000-0000-4000-a000-0000000000a1'
       AND recipient_user_id = '10800000-0000-4000-a000-0000000000b1'
       AND outcome = 'claimed' AND finished_at IS NULL
       AND provider_message_id IS NULL AND error_code IS NULL
  ));

SELECT pg_temp.m108_mark('claim_while_claimed_returns_null_and_writes_nothing',
  pg_temp.m108_id('a2') IS NULL
  AND (SELECT count(*) FROM public.notification_sends
        WHERE org_id = '10800000-0000-4000-a000-0000000000a1'
          AND recipient_user_id = '10800000-0000-4000-a000-0000000000b1') = 1);

SELECT pg_temp.m108_mark('finish_records_sent_with_the_message_id',
  public.finish_notification_send(pg_temp.m108_id('a1'), 'sent', 'W5Z1yLQe.Qiqcjv3z1dQ5DQ'));

SELECT pg_temp.m108_mark('sent_row_is_finished_with_its_message_id',
  EXISTS (
    SELECT 1 FROM public.notification_sends
     WHERE id = pg_temp.m108_id('a1')
       AND outcome = 'sent' AND finished_at IS NOT NULL
       AND provider_message_id = 'W5Z1yLQe.Qiqcjv3z1dQ5DQ' AND error_code IS NULL
  ));

INSERT INTO pg_temp.m108_ids VALUES ('a3', public.claim_notification_send(
  'followup-digest', '2026-10-31',
  '10800000-0000-4000-a000-0000000000a1', '10800000-0000-4000-a000-0000000000b1'));
SELECT pg_temp.m108_mark('claim_after_sent_returns_null_and_writes_nothing',
  pg_temp.m108_id('a3') IS NULL
  AND (SELECT count(*) FROM public.notification_sends
        WHERE org_id = '10800000-0000-4000-a000-0000000000a1'
          AND recipient_user_id = '10800000-0000-4000-a000-0000000000b1') = 1);

SELECT pg_temp.m108_mark('finish_on_a_finished_row_returns_false',
  NOT public.finish_notification_send(pg_temp.m108_id('a1'), 'failed', NULL, 'network')
  AND (SELECT outcome FROM public.notification_sends WHERE id = pg_temp.m108_id('a1')) = 'sent');

-- Each part of the key is its own slot: another day, org, recipient or job.
SELECT pg_temp.m108_mark('every_part_of_the_key_is_its_own_slot',
  public.claim_notification_send('followup-digest', '2026-11-01',
    '10800000-0000-4000-a000-0000000000a1', '10800000-0000-4000-a000-0000000000b1') IS NOT NULL
  AND public.claim_notification_send('followup-digest', '2026-10-31',
    '10800000-0000-4000-a000-0000000000a2', '10800000-0000-4000-a000-0000000000b1') IS NOT NULL
  AND public.claim_notification_send('followup-digest', '2026-10-31',
    '10800000-0000-4000-a000-0000000000a1', '10800000-0000-4000-a000-0000000000b2') IS NOT NULL
  AND public.claim_notification_send('intake-reminders', '2026-10-31',
    '10800000-0000-4000-a000-0000000000a1', '10800000-0000-4000-a000-0000000000b1') IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Key B: a failed send may be claimed again, as a new row; a sent row with no
-- message id is allowed (sandbox mode returns none).
-- ---------------------------------------------------------------------------
INSERT INTO pg_temp.m108_ids VALUES ('b1', public.claim_notification_send(
  'followup-digest', '2026-10-31',
  '10800000-0000-4000-a000-0000000000a2', '10800000-0000-4000-a000-0000000000b2'));
SELECT pg_temp.m108_mark('finish_records_failure_with_its_code',
  public.finish_notification_send(pg_temp.m108_id('b1'), 'failed', NULL, 'provider_rejected'));
INSERT INTO pg_temp.m108_ids VALUES ('b2', public.claim_notification_send(
  'followup-digest', '2026-10-31',
  '10800000-0000-4000-a000-0000000000a2', '10800000-0000-4000-a000-0000000000b2'));

SELECT pg_temp.m108_mark('claim_after_failure_takes_a_new_row',
  pg_temp.m108_id('b2') IS NOT NULL
  AND pg_temp.m108_id('b2') <> pg_temp.m108_id('b1')
  AND (
    SELECT array_agg(outcome || ':' || coalesce(error_code, '-') ORDER BY outcome)
      FROM public.notification_sends
     WHERE org_id = '10800000-0000-4000-a000-0000000000a2'
       AND recipient_user_id = '10800000-0000-4000-a000-0000000000b2'
       AND run_key = '2026-10-31'
  ) = ARRAY['claimed:-', 'failed:provider_rejected']);

SELECT pg_temp.m108_mark('index_refuses_a_second_live_row',
  pg_temp.m108_expect_state('23505',
    $$INSERT INTO public.notification_sends (job, run_key, org_id, recipient_user_id)
      VALUES ('followup-digest', '2026-10-31',
              '10800000-0000-4000-a000-0000000000a2', '10800000-0000-4000-a000-0000000000b2')$$));
SELECT pg_temp.m108_mark('index_refuses_a_claimed_row_beside_a_sent_one',
  pg_temp.m108_expect_state('23505',
    $$INSERT INTO public.notification_sends (job, run_key, org_id, recipient_user_id)
      VALUES ('followup-digest', '2026-10-31',
              '10800000-0000-4000-a000-0000000000a1', '10800000-0000-4000-a000-0000000000b1')$$));
-- The claim's ON CONFLICT names the partial index, so it swallows only a
-- live-key conflict; a primary key collision on a free key still raises.
SELECT pg_temp.m108_mark('named_conflict_target_lets_a_primary_key_collision_raise',
  pg_temp.m108_expect_state('23505',
    format($$INSERT INTO public.notification_sends (id, job, run_key, org_id, recipient_user_id)
             VALUES (%L, 'followup-digest', '2026-12-25',
                     '10800000-0000-4000-a000-0000000000a1', '10800000-0000-4000-a000-0000000000b1')
             ON CONFLICT (job, run_key, org_id, recipient_user_id)
               WHERE outcome IN ('claimed', 'sent') DO NOTHING$$,
           pg_temp.m108_id('a1'))));

-- ---------------------------------------------------------------------------
-- Input checks. b2 is claimed; every refused finish leaves it claimed.
-- ---------------------------------------------------------------------------
SELECT pg_temp.m108_mark('claim_refuses_an_invalid_job_name',
  pg_temp.m108_expect_state('23514',
    $$SELECT public.claim_notification_send('Followup Digest', '2026-10-31',
        '10800000-0000-4000-a000-0000000000a1', '10800000-0000-4000-a000-0000000000b3')$$));
SELECT pg_temp.m108_mark('claim_refuses_an_invalid_run_key',
  pg_temp.m108_expect_state('23514',
    $$SELECT public.claim_notification_send('followup-digest', '2026 10 31',
        '10800000-0000-4000-a000-0000000000a1', '10800000-0000-4000-a000-0000000000b3')$$));
SELECT pg_temp.m108_mark('claim_refuses_an_unknown_org',
  pg_temp.m108_expect_state('23503',
    $$SELECT public.claim_notification_send('followup-digest', '2026-10-31',
        '10800000-0000-4000-a000-00000000ffff', '10800000-0000-4000-a000-0000000000b3')$$));
SELECT pg_temp.m108_mark('claim_refuses_a_missing_recipient',
  pg_temp.m108_expect_state('23502',
    $$SELECT public.claim_notification_send('followup-digest', '2026-10-31',
        '10800000-0000-4000-a000-0000000000a1', NULL)$$));

SELECT pg_temp.m108_mark('finish_refuses_' || label,
  pg_temp.m108_expect_state(state,
    format('SELECT public.finish_notification_send(%L::uuid, %L, %L, %L)',
           pg_temp.m108_id('b2'), outcome, message_id, code)))
  FROM (VALUES
    ('a_claimed_outcome', '22023', 'claimed', NULL, NULL),
    ('a_null_outcome', '22023', NULL, NULL, NULL),
    ('an_identifier_outside_the_closed_codes', '22023', 'failed', NULL, 'smtp_bounced'),
    ('free_text_as_an_error_code', '22023', 'failed', NULL, 'DOB 1961-04-12'),
    ('failure_without_an_error_code', '23514', 'failed', NULL, NULL),
    ('success_with_an_error_code', '23514', 'sent', NULL, 'network'),
    ('a_message_id_on_a_failure', '23514', 'failed', 'W5Z1yLQeQiqcjv3z1dQ5DQ', 'network'),
    ('a_message_id_with_spaces', '23514', 'sent', 'jane doe 1961-04-12', NULL),
    ('a_message_id_with_an_address', '23514', 'sent', 'jane@example.com', NULL),
    ('a_message_id_over_128_characters', '23514', 'sent', repeat('a', 129), NULL)
  ) AS t(label, state, outcome, message_id, code);

SELECT pg_temp.m108_mark('check_refuses_an_error_code_outside_the_closed_set',
  pg_temp.m108_expect_state('23514',
    format($$UPDATE public.notification_sends
                SET outcome = 'failed', error_code = 'other_code', finished_at = now()
              WHERE id = %L$$,
           pg_temp.m108_id('b2'))));
SELECT pg_temp.m108_mark('check_refuses_a_finished_claim',
  pg_temp.m108_expect_state('23514',
    format($$UPDATE public.notification_sends SET finished_at = now() WHERE id = %L$$,
           pg_temp.m108_id('b2'))));

SELECT pg_temp.m108_mark('refused_finishes_leave_the_row_claimed',
  (SELECT outcome FROM public.notification_sends WHERE id = pg_temp.m108_id('b2')) = 'claimed');

SELECT pg_temp.m108_mark('finish_records_sent_without_a_message_id',
  public.finish_notification_send(pg_temp.m108_id('b2'), 'sent')
  AND EXISTS (
    SELECT 1 FROM public.notification_sends
     WHERE id = pg_temp.m108_id('b2') AND outcome = 'sent' AND provider_message_id IS NULL
  ));

SELECT pg_temp.m108_mark('every_closed_error_code_is_accepted',
  (SELECT bool_and(public.finish_notification_send(
            public.claim_notification_send('followup-digest', 'codes-' || code,
              '10800000-0000-4000-a000-0000000000a1', '10800000-0000-4000-a000-0000000000b1'),
            'failed', NULL, code))
     FROM unnest(ARRAY['misconfigured', 'invalid_input', 'provider_rejected', 'network',
                       'send_error']) AS code));

-- ---------------------------------------------------------------------------
-- Access boundary.
-- ---------------------------------------------------------------------------
SELECT pg_temp.m108_mark('rls_is_enabled_with_no_policy',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notification_sends'::regclass)
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'notification_sends'
  ));

SELECT pg_temp.m108_mark('anon_and_authenticated_cannot_touch_the_table',
  NOT has_table_privilege('anon', 'public.notification_sends',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  AND NOT has_table_privilege('authenticated', 'public.notification_sends',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  AND NOT has_table_privilege('public', 'public.notification_sends',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'));

SELECT pg_temp.m108_mark('service_role_reads_the_table_and_writes_only_through_the_rpcs',
  has_table_privilege('service_role', 'public.notification_sends', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.notification_sends',
        'INSERT, UPDATE, DELETE, TRUNCATE'));

SELECT pg_temp.m108_mark('only_service_role_executes_the_rpcs',
  has_function_privilege('service_role',
    'public.claim_notification_send(text, text, uuid, uuid)', 'EXECUTE')
  AND has_function_privilege('service_role',
    'public.finish_notification_send(uuid, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.claim_notification_send(text, text, uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.finish_notification_send(uuid, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.claim_notification_send(text, text, uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.finish_notification_send(uuid, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('public',
    'public.claim_notification_send(text, text, uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('public',
    'public.finish_notification_send(uuid, text, text, text)', 'EXECUTE'));

SELECT pg_temp.m108_mark('rpcs_are_security_definer_with_an_empty_search_path',
  (SELECT count(*) FROM pg_proc AS p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('claim_notification_send', 'finish_notification_send')
       AND p.prosecdef
       AND EXISTS (
         SELECT 1 FROM unnest(p.proconfig) AS c WHERE c IN ('search_path=""', 'search_path=')
       )) = 2);

SET LOCAL ROLE service_role;
INSERT INTO pg_temp.m108_ids VALUES ('s1', public.claim_notification_send(
  'followup-digest', 'slot-s',
  '10800000-0000-4000-a000-0000000000a1', '10800000-0000-4000-a000-0000000000b1'));
SELECT pg_temp.m108_mark('service_role_can_finish',
  public.finish_notification_send(pg_temp.m108_id('s1'), 'sent', 'abc123'));
RESET ROLE;
SELECT pg_temp.m108_mark('service_role_can_claim',
  EXISTS (
    SELECT 1 FROM public.notification_sends
     WHERE id = pg_temp.m108_id('s1') AND outcome = 'sent' AND provider_message_id = 'abc123'
  ));

SET LOCAL ROLE authenticated;
SELECT pg_temp.m108_mark('authenticated_cannot_call_the_claim',
  pg_temp.m108_expect_state('42501',
    $$SELECT public.claim_notification_send('followup-digest', 'slot-x',
        '10800000-0000-4000-a000-0000000000a1', '10800000-0000-4000-a000-0000000000b1')$$));
RESET ROLE;

SELECT name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END
  FROM pg_temp.m108_results ORDER BY name;

DO $$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO v_failed
    FROM pg_temp.m108_results WHERE NOT passed;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'MINT-108 notification_sends assertions failed: %', v_failed;
  END IF;
END;
$$;

ROLLBACK;
\echo MINT-108 notification_sends packet passed.
