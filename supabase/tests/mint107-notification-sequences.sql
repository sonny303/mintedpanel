-- MINT-107 notification sequences regression packet: RLS, grants, CHECKs,
-- triggers, Minted's platform defaults and save_notification_sequence
-- (supabase/migrations/20261031051500_notification_sequences.sql).
--
-- Run after all migrations in a disposable PostgreSQL database, never against
-- hosted. CI's Migration dry-run job runs it right after the MINT-106 packet:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/mint107-notification-sequences.sql
-- Every row it writes is synthetic and rolled back.
--
-- It needs a superuser connection (it writes fixtures, switches role, toggles
-- a trigger and a column grant) and the anon, authenticated and service_role
-- roles. CI creates those as bare NOLOGIN roles, so the packet emulates the
-- two hosted Supabase attributes it relies on, inside its own transaction:
-- USAGE on schema auth (auth.uid()) and BYPASSRLS on service_role. The first
-- block checks the prerequisites and stops with a plain message.
--
-- A check reads its statement's snapshot, so a write whose effect is checked
-- runs as its own statement first, never inside the checking statement.
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
    RAISE EXCEPTION 'mint107-notification-sequences.sql must run as a superuser';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles
       WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3 THEN
    RAISE EXCEPTION 'mint107-notification-sequences.sql needs the anon, authenticated and service_role roles';
  END IF;
  IF to_regclass('public.notification_sequences') IS NULL
     OR to_regclass('public.notification_sequence_steps') IS NULL
     OR to_regclass('public.notification_sequence_defaults') IS NULL
     OR to_regclass('public.notification_sequence_default_steps') IS NULL
     OR to_regclass('public.sms_consents') IS NULL
     OR to_regprocedure('public.save_notification_sequence(uuid, text, jsonb)') IS NULL
     OR to_regprocedure('private.notification_cc_recipients_valid(jsonb)') IS NULL
     OR to_regprocedure('private.notification_stop_conditions_valid(text[])') IS NULL
     OR to_regprocedure('private.notification_time_zone_valid(text)') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'apply every migration through 20261031051500_notification_sequences.sql first';
  END IF;
END;
$$;

-- CI seeds authenticated and service_role without the hosted attributes this
-- packet relies on. Emulate them only inside this rollback-only transaction
-- (the mint19 / mint60 precedent); both are restored before the ROLLBACK.
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
ALTER ROLE service_role BYPASSRLS;
-- Fire the deferred step-set checks at the end of each statement, so a
-- probe sees them inside this transaction (it never commits).
SET CONSTRAINTS ALL IMMEDIATE;

CREATE TEMP TABLE m107_results (name text PRIMARY KEY, passed boolean NOT NULL);
GRANT ALL ON m107_results TO authenticated, service_role;

CREATE FUNCTION pg_temp.m107_mark(p_name text, p_passed boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pg_temp.m107_results VALUES (p_name, coalesce(p_passed, false));
END;
$$;

CREATE FUNCTION pg_temp.m107_expect_state(p_state text, p_statement text) RETURNS boolean
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

CREATE FUNCTION pg_temp.m107_expect_message(p_fragment text, p_statement text) RETURNS boolean
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

CREATE FUNCTION pg_temp.m107_as(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true
  );
END;
$$;

-- An intake payload: steps on the given offsets, step 3 cc'ing the
-- specialist and then all admins; its own stop conditions, Minted's target.
CREATE FUNCTION pg_temp.m107_intake(p_offsets int[], p_expected int DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'enabled', false,
    'stop_conditions', jsonb_build_array('submitted', 'withdrawn'),
    'target_days_to_ready', NULL,
    'expected_revision', p_expected,
    'steps', (
      SELECT jsonb_agg(jsonb_build_object(
               'offset_days', o.offset_days,
               'channel', 'email',
               'template_key', 'intake_reminder_first',
               'cc_recipients', CASE WHEN o.ordinal = 3 THEN jsonb_build_array(
                 jsonb_build_object('kind', 'user', 'user_id', '10700000-0000-4000-a000-000000000002'),
                 jsonb_build_object('kind', 'role', 'role', 'admin'))
                 ELSE '[]'::jsonb END)
             ORDER BY o.ordinal)
        FROM unnest(p_offsets) WITH ORDINALITY AS o(offset_days, ordinal)
    )
  );
$$;

-- A digest payload: one daily email step with the given cc list.
CREATE FUNCTION pg_temp.m107_digest(p_expected int DEFAULT NULL, p_cc jsonb DEFAULT '[]')
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'enabled', true,
    'expected_revision', p_expected,
    'steps', jsonb_build_array(jsonb_build_object(
      'offset_days', 0,
      'channel', 'email',
      'template_key', 'followup_digest_daily',
      'cc_recipients', p_cc))
  );
$$;

GRANT EXECUTE ON FUNCTION pg_temp.m107_mark(text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.m107_expect_state(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.m107_expect_message(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.m107_as(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.m107_intake(int[], int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.m107_digest(int, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures: org A (admin, specialist, billing), org B (admin), a signed-in
-- user with no membership, and one provider in each org.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users(id, email) VALUES
  ('10700000-0000-4000-a000-000000000001', 'm107-admin-a@example.invalid'),
  ('10700000-0000-4000-a000-000000000002', 'm107-specialist-a@example.invalid'),
  ('10700000-0000-4000-a000-000000000003', 'm107-billing-a@example.invalid'),
  ('10700000-0000-4000-a000-000000000004', 'm107-admin-b@example.invalid'),
  ('10700000-0000-4000-a000-000000000005', 'm107-no-org@example.invalid');
INSERT INTO public.profiles(id, full_name, email) VALUES
  ('10700000-0000-4000-a000-000000000001', 'MINT-107 Admin A', 'm107-admin-a@example.invalid'),
  ('10700000-0000-4000-a000-000000000002', 'MINT-107 Specialist A', 'm107-specialist-a@example.invalid'),
  ('10700000-0000-4000-a000-000000000003', 'MINT-107 Billing A', 'm107-billing-a@example.invalid'),
  ('10700000-0000-4000-a000-000000000004', 'MINT-107 Admin B', 'm107-admin-b@example.invalid'),
  ('10700000-0000-4000-a000-000000000005', 'MINT-107 No Org', 'm107-no-org@example.invalid');
INSERT INTO public.organizations(id, name) VALUES
  ('10700000-0000-4000-a000-00000000000a', 'MINT-107 Synthetic Org A'),
  ('10700000-0000-4000-a000-00000000000b', 'MINT-107 Synthetic Org B');
INSERT INTO public.memberships(org_id, user_id, role) VALUES
  ('10700000-0000-4000-a000-00000000000a', '10700000-0000-4000-a000-000000000001', 'admin'),
  ('10700000-0000-4000-a000-00000000000a', '10700000-0000-4000-a000-000000000002', 'specialist'),
  ('10700000-0000-4000-a000-00000000000a', '10700000-0000-4000-a000-000000000003', 'billing'),
  ('10700000-0000-4000-a000-00000000000b', '10700000-0000-4000-a000-000000000004', 'admin');
INSERT INTO public.providers(id, org_id, first_name, last_name, status) VALUES
  ('10700000-0000-4000-a000-0000000a0001', '10700000-0000-4000-a000-00000000000a',
   'Synthetic', 'Provider A', 'onboarding'),
  ('10700000-0000-4000-a000-0000000b0001', '10700000-0000-4000-a000-00000000000b',
   'Synthetic', 'Provider B', 'onboarding');

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.m107_mark('rpc_execute_authenticated_only',
  has_function_privilege('authenticated',
    'public.save_notification_sequence(uuid,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.save_notification_sequence(uuid,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('service_role',
    'public.save_notification_sequence(uuid,text,jsonb)', 'EXECUTE'));
SELECT pg_temp.m107_mark('rpc_is_security_invoker_with_empty_search_path',
  (SELECT NOT p.prosecdef
          AND EXISTS (SELECT 1 FROM unnest(p.proconfig) AS c
                       WHERE c IN ('search_path=""', 'search_path='))
     FROM pg_proc AS p
    WHERE p.oid = 'public.save_notification_sequence(uuid,text,jsonb)'::regprocedure));
SELECT pg_temp.m107_mark('validators_are_private_and_executable_by_writers',
  to_regprocedure('public.notification_cc_recipients_valid(jsonb)') IS NULL
  AND to_regprocedure('public.notification_stop_conditions_valid(text[])') IS NULL
  AND to_regprocedure('public.notification_time_zone_valid(text)') IS NULL
  AND has_function_privilege('authenticated',
    'private.notification_cc_recipients_valid(jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role',
    'private.notification_stop_conditions_valid(text[])', 'EXECUTE')
  AND has_function_privilege('authenticated',
    'private.notification_time_zone_valid(text)', 'EXECUTE')
  AND has_function_privilege('service_role',
    'private.notification_time_zone_valid(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'private.notification_cc_recipients_valid(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'private.notification_time_zone_valid(text)', 'EXECUTE'));
SELECT pg_temp.m107_mark('anon_has_no_table_access',
  NOT has_table_privilege('anon', 'public.notification_sequences', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.notification_sequence_steps', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.notification_sequence_defaults', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.notification_sequence_default_steps', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.sms_consents', 'SELECT'));
-- One privilege per call: a comma list is true when ANY listed privilege is held.
SELECT pg_temp.m107_mark('authenticated_table_grants',
  has_table_privilege('authenticated', 'public.notification_sequences', 'SELECT')
  AND has_column_privilege('authenticated', 'public.notification_sequences', 'enabled', 'INSERT')
  AND has_column_privilege('authenticated', 'public.notification_sequences', 'enabled', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.notification_sequences',
    'stop_conditions', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.notification_sequences',
    'target_days_to_ready', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.notification_sequences', 'DELETE')
  AND has_table_privilege('authenticated', 'public.notification_sequence_steps', 'SELECT')
  AND has_table_privilege('authenticated', 'public.notification_sequence_steps', 'INSERT')
  AND has_table_privilege('authenticated', 'public.notification_sequence_steps', 'UPDATE')
  AND has_table_privilege('authenticated', 'public.notification_sequence_steps', 'DELETE')
  AND has_table_privilege('authenticated', 'public.sms_consents', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.sms_consents', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.sms_consents', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.sms_consents', 'DELETE'));
-- Answer 4 and 5: compression, the send hour and the time zone are Minted's.
SELECT pg_temp.m107_mark('platform_columns_have_no_authenticated_write_grant',
  (SELECT bool_and(
            NOT has_column_privilege('authenticated', 'public.notification_sequences', c, 'INSERT')
            AND NOT has_column_privilege('authenticated', 'public.notification_sequences', c, 'UPDATE')
            AND has_column_privilege('service_role', 'public.notification_sequences', c, 'UPDATE'))
     FROM unnest(ARRAY['compress_toward_start_date', 'send_hour', 'send_time_zone']) AS c)
  -- Nor the columns the stamp trigger owns.
  AND NOT has_column_privilege('authenticated', 'public.notification_sequences',
    'updated_by', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.notification_sequences',
    'revision', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.notification_sequences',
    'purpose', 'UPDATE'));
-- Answer 3: the defaults are read-only for every browser role.
SELECT pg_temp.m107_mark('defaults_are_read_only_for_authenticated',
  has_table_privilege('authenticated', 'public.notification_sequence_defaults', 'SELECT')
  AND has_table_privilege('authenticated', 'public.notification_sequence_default_steps', 'SELECT')
  AND NOT has_any_column_privilege('authenticated',
    'public.notification_sequence_defaults', 'INSERT')
  AND NOT has_any_column_privilege('authenticated',
    'public.notification_sequence_defaults', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.notification_sequence_defaults', 'DELETE')
  AND NOT has_any_column_privilege('authenticated',
    'public.notification_sequence_default_steps', 'INSERT')
  AND NOT has_any_column_privilege('authenticated',
    'public.notification_sequence_default_steps', 'UPDATE')
  AND NOT has_table_privilege('authenticated',
    'public.notification_sequence_default_steps', 'DELETE')
  AND has_table_privilege('service_role', 'public.notification_sequence_defaults', 'UPDATE')
  AND has_table_privilege('service_role', 'public.notification_sequence_default_steps', 'INSERT'));
SELECT pg_temp.m107_mark('rls_enabled_on_all_five',
  (SELECT count(*) = 5 AND bool_and(relrowsecurity) FROM pg_class
    WHERE oid IN ('public.notification_sequences'::regclass,
                  'public.notification_sequence_steps'::regclass,
                  'public.notification_sequence_defaults'::regclass,
                  'public.notification_sequence_default_steps'::regclass,
                  'public.sms_consents'::regclass)));

-- ---------------------------------------------------------------------------
-- The shape of inheritance (answer 3).
-- ---------------------------------------------------------------------------
-- A default has no org, no PHI, no cc list, and no enabled column: it can
-- never switch an org on.
SELECT pg_temp.m107_mark('defaults_have_no_org_no_enabled_no_cc',
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('notification_sequence_defaults', 'notification_sequence_default_steps')
       AND column_name IN ('org_id', 'enabled', 'cc_recipients')));
-- An org row's settings start unset (inherit); enabled starts false.
SELECT pg_temp.m107_mark('org_settings_default_to_inherit',
  (SELECT count(*) = 5 AND bool_and(is_nullable = 'YES' AND column_default IS NULL)
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_sequences'
      AND column_name IN ('stop_conditions', 'target_days_to_ready',
                          'compress_toward_start_date', 'send_hour', 'send_time_zone'))
  AND (SELECT is_nullable = 'NO' AND column_default = 'false'
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'notification_sequences'
          AND column_name = 'enabled'));
SELECT pg_temp.m107_mark('defaults_seeded_with_compression_off_and_8am_central',
  (SELECT stop_conditions = '{submitted,paused,withdrawn,provider_replied}'
          AND target_days_to_ready = 14
          AND compress_toward_start_date = false
          AND send_hour IS NULL AND send_time_zone IS NULL
     FROM public.notification_sequence_defaults WHERE purpose = 'intake_reminder')
  AND (SELECT send_hour = 8 AND send_time_zone = 'America/Chicago'
              AND stop_conditions IS NULL AND target_days_to_ready IS NULL
              AND compress_toward_start_date IS NULL
         FROM public.notification_sequence_defaults WHERE purpose = 'followup_digest')
  AND (SELECT array_agg(offset_days ORDER BY position) = '{2,4,7}'
              AND array_agg(template_key ORDER BY position)
                  = '{intake_reminder_first,intake_reminder_second,intake_reminder_final}'
              AND bool_and(channel = 'email')
         FROM public.notification_sequence_default_steps WHERE purpose = 'intake_reminder')
  AND (SELECT count(*) = 1 AND bool_and(offset_days = 0 AND channel = 'email'
                                        AND template_key = 'followup_digest_daily')
         FROM public.notification_sequence_default_steps WHERE purpose = 'followup_digest')
  AND (SELECT count(*) = 2 FROM public.notification_sequence_defaults));

-- ---------------------------------------------------------------------------
-- Validators (pure, apart from the zone list).
-- ---------------------------------------------------------------------------
SELECT pg_temp.m107_mark('cc_validator_truth_table',
  private.notification_cc_recipients_valid('[]')
  AND private.notification_cc_recipients_valid(
    '[{"kind":"user","user_id":"10700000-0000-4000-a000-000000000002"},{"kind":"role","role":"admin"}]')
  AND NOT private.notification_cc_recipients_valid('{}')
  AND NOT private.notification_cc_recipients_valid('[{"kind":"role","role":"owner"}]')
  AND NOT private.notification_cc_recipients_valid('[{"kind":"role","role":"admin","extra":1}]')
  AND NOT private.notification_cc_recipients_valid('[{"kind":"user"}]')
  AND NOT private.notification_cc_recipients_valid(
    '[{"kind":"user","user_id":"10700000-0000-4000-A000-000000000002"}]')
  AND NOT private.notification_cc_recipients_valid('[{"kind":"role","role":"admin"},{"kind":"role","role":"admin"}]')
  AND NOT private.notification_cc_recipients_valid('["admin"]')
  AND NOT private.notification_cc_recipients_valid(
    (SELECT jsonb_agg(jsonb_build_object('kind', 'user', 'user_id',
              lpad(g::text, 8, '0') || '-0000-4000-8000-000000000000'))
       FROM generate_series(1, 21) AS g)));
SELECT pg_temp.m107_mark('stop_condition_validator_truth_table',
  private.notification_stop_conditions_valid('{}')
  AND private.notification_stop_conditions_valid('{submitted,paused,withdrawn,provider_replied}')
  AND NOT private.notification_stop_conditions_valid('{submitted,submitted}')
  AND NOT private.notification_stop_conditions_valid('{bounced}')
  AND NOT private.notification_stop_conditions_valid(ARRAY['submitted', NULL]::text[])
  AND NOT coalesce(private.notification_stop_conditions_valid(NULL), false));
-- Answer 5: the digest's time zone is a real IANA zone.
SELECT pg_temp.m107_mark('time_zone_validator_truth_table',
  private.notification_time_zone_valid('America/Chicago')
  AND private.notification_time_zone_valid('America/New_York')
  AND private.notification_time_zone_valid('America/Argentina/Buenos_Aires')
  AND private.notification_time_zone_valid('Etc/UTC')
  AND NOT private.notification_time_zone_valid('Mars/Olympus_Mons')
  AND NOT private.notification_time_zone_valid('america/chicago')
  AND NOT private.notification_time_zone_valid('CST')
  AND NOT private.notification_time_zone_valid('EST5EDT')
  AND NOT private.notification_time_zone_valid('+05:00')
  AND NOT private.notification_time_zone_valid('')
  AND NOT coalesce(private.notification_time_zone_valid(NULL), false));

-- ---------------------------------------------------------------------------
-- The save RPC as org A's admin.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.m107_as('10700000-0000-4000-a000-000000000001');

-- Save 1: create intake (revision 1).
SELECT public.save_notification_sequence(
  '10700000-0000-4000-a000-00000000000a', 'intake_reminder', pg_temp.m107_intake('{2,4,7}'));
SELECT pg_temp.m107_mark('admin_creates_intake_off_leaving_unset_settings_to_inherit',
  (SELECT revision = 1 AND NOT enabled
      AND target_days_to_ready IS NULL
      AND compress_toward_start_date IS NULL
      AND send_hour IS NULL AND send_time_zone IS NULL
      AND stop_conditions = '{submitted,withdrawn}'
      AND updated_by = '10700000-0000-4000-a000-000000000001'
     FROM public.notification_sequences
    WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder'));
SELECT pg_temp.m107_mark('steps_saved_in_order_with_ordered_cc',
  (SELECT array_agg(offset_days ORDER BY position) = '{2,4,7}'
      AND array_agg(position ORDER BY position) = '{1,2,3}'
     FROM public.notification_sequence_steps
    WHERE org_id = '10700000-0000-4000-a000-00000000000a')
  AND (SELECT cc_recipients -> 0 ->> 'kind' = 'user' AND cc_recipients -> 1 ->> 'role' = 'admin'
         FROM public.notification_sequence_steps
        WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND position = 3));

-- Save 2: replace the steps (revision 2).
SELECT public.save_notification_sequence(
  '10700000-0000-4000-a000-00000000000a', 'intake_reminder', pg_temp.m107_intake('{3,9}', 1));
SELECT pg_temp.m107_mark('resave_replaces_steps_and_bumps_revision',
  (SELECT revision = 2 FROM public.notification_sequences
    WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder')
  AND (SELECT array_agg(offset_days ORDER BY position) = '{3,9}'
         FROM public.notification_sequence_steps
        WHERE org_id = '10700000-0000-4000-a000-00000000000a'));

SELECT pg_temp.m107_mark('stale_revision_is_a_conflict', pg_temp.m107_expect_message(
  'notification_sequence_conflict',
  $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
      'intake_reminder', pg_temp.m107_intake('{3,9}', 1))$$));
SELECT pg_temp.m107_mark('stale_revision_sqlstate_pt409', pg_temp.m107_expect_state(
  'PT409',
  $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
      'intake_reminder', pg_temp.m107_intake('{3,9}', NULL))$$));
SELECT pg_temp.m107_mark('create_with_a_revision_is_a_conflict', pg_temp.m107_expect_state(
  'PT409',
  $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
      'followup_digest', pg_temp.m107_digest(5))$$));

-- Save 3: create the digest (revision 1).
SELECT public.save_notification_sequence(
  '10700000-0000-4000-a000-00000000000a', 'followup_digest', pg_temp.m107_digest());
SELECT pg_temp.m107_mark('digest_saves_one_step_with_no_intake_settings',
  (SELECT enabled AND target_days_to_ready IS NULL AND stop_conditions IS NULL
      AND compress_toward_start_date IS NULL
      AND send_hour IS NULL AND send_time_zone IS NULL
     FROM public.notification_sequences
    WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'followup_digest')
  AND (SELECT count(*) = 1 AND bool_and(cc_recipients = '[]'::jsonb)
         FROM public.notification_sequence_steps
        WHERE org_id = '10700000-0000-4000-a000-00000000000a'
          AND template_key = 'followup_digest_daily'));
-- Answer 2: the digest goes to coordinators only.
SELECT pg_temp.m107_mark('digest_cc_rejected_by_the_rpc', pg_temp.m107_expect_message(
  'notification_digest_has_no_cc',
  $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
      'followup_digest', pg_temp.m107_digest(1, '[{"kind":"role","role":"specialist"}]'))$$));
SELECT pg_temp.m107_mark('digest_two_steps_rejected', pg_temp.m107_expect_message(
  'notification_digest_single_step',
  $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
      'followup_digest', '{"enabled":false,"expected_revision":1,"steps":[
        {"offset_days":0,"channel":"email","template_key":"followup_digest_daily","cc_recipients":[]},
        {"offset_days":1,"channel":"email","template_key":"followup_digest_daily","cc_recipients":[]}]}')$$));
SELECT pg_temp.m107_mark('digest_intake_settings_rejected', pg_temp.m107_expect_state(
  '22023',
  $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
      'followup_digest', pg_temp.m107_digest(1) || '{"stop_conditions":["submitted"]}'::jsonb)$$));
SELECT pg_temp.m107_mark('unknown_purpose_rejected', pg_temp.m107_expect_state(
  '22023',
  $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
      'payment_reminder', pg_temp.m107_intake('{2}'))$$));
SELECT pg_temp.m107_mark('cc_non_member_rejected', pg_temp.m107_expect_message(
  'notification_cc_user_not_member',
  $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
      'intake_reminder', jsonb_set(pg_temp.m107_intake('{2}', 2), '{steps,0,cc_recipients}',
        '[{"kind":"user","user_id":"10700000-0000-4000-a000-000000000004"}]'))$$));
SELECT pg_temp.m107_mark('offsets_must_increase', pg_temp.m107_expect_message(
  'notification_step_offsets_not_increasing',
  $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
      'intake_reminder', pg_temp.m107_intake('{4,4}', 2))$$));
SELECT pg_temp.m107_mark('template_must_match_purpose', pg_temp.m107_expect_message(
  'notification_step_template_purpose_mismatch',
  $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
      'intake_reminder', jsonb_set(pg_temp.m107_intake('{2}', 2), '{steps,0,template_key}',
        '"followup_digest_daily"'))$$));
-- Answers 4 and 5: the save path cannot carry a platform-managed setting, on
-- or off.
SELECT pg_temp.m107_mark('rpc_refuses_platform_managed_settings',
  pg_temp.m107_expect_message('notification_platform_setting',
    $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
        'intake_reminder',
        pg_temp.m107_intake('{3,9}', 2) || '{"compress_toward_start_date":true}'::jsonb)$$)
  AND pg_temp.m107_expect_state('42501',
    $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
        'intake_reminder',
        pg_temp.m107_intake('{3,9}', 2) || '{"compress_toward_start_date":false}'::jsonb)$$)
  AND pg_temp.m107_expect_message('notification_platform_setting',
    $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
        'followup_digest', pg_temp.m107_digest(1) || '{"send_hour":6}'::jsonb)$$)
  AND pg_temp.m107_expect_message('notification_platform_setting',
    $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
        'followup_digest',
        pg_temp.m107_digest(1) || '{"send_time_zone":"America/New_York"}'::jsonb)$$));
SELECT pg_temp.m107_mark('rpc_refuses_unknown_settings', pg_temp.m107_expect_message(
  'notification_sequence_invalid: unknown setting',
  $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
      'intake_reminder', pg_temp.m107_intake('{3,9}', 2) || '{"cc_everyone":true}'::jsonb)$$));
SELECT pg_temp.m107_mark('failed_saves_left_the_saved_rows_alone',
  (SELECT revision = 2 AND compress_toward_start_date IS NULL
     FROM public.notification_sequences
    WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder')
  AND (SELECT revision = 1 AND send_hour IS NULL AND send_time_zone IS NULL
         FROM public.notification_sequences
        WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'followup_digest')
  AND (SELECT array_agg(offset_days ORDER BY position) = '{3,9}'
         FROM public.notification_sequence_steps
        WHERE org_id = '10700000-0000-4000-a000-00000000000a'
          AND sequence_id = (SELECT id FROM public.notification_sequences
                              WHERE org_id = '10700000-0000-4000-a000-00000000000a'
                                AND purpose = 'intake_reminder')));

-- Answer 3: an admin overrides a default, then goes back to it.
-- Save 4: override the target (revision 3).
SELECT public.save_notification_sequence(
  '10700000-0000-4000-a000-00000000000a', 'intake_reminder',
  jsonb_set(pg_temp.m107_intake('{3,9}', 2), '{target_days_to_ready}', '21'));
SELECT pg_temp.m107_mark('admin_overrides_the_default_target',
  (SELECT revision = 3 AND target_days_to_ready = 21
     FROM public.notification_sequences
    WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder'));
-- Save 5: back to Minted's target, stop conditions and steps (revision 4).
SELECT public.save_notification_sequence(
  '10700000-0000-4000-a000-00000000000a', 'intake_reminder',
  jsonb_set(jsonb_set(pg_temp.m107_intake('{3,9}', 3), '{steps}', 'null'),
            '{stop_conditions}', 'null'));
SELECT pg_temp.m107_mark('back_to_the_default_clears_the_overrides_and_own_steps',
  (SELECT revision = 4 AND target_days_to_ready IS NULL AND stop_conditions IS NULL
          AND NOT enabled
     FROM public.notification_sequences
    WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder')
  AND NOT EXISTS (
    SELECT 1 FROM public.notification_sequence_steps
     WHERE sequence_id = (SELECT id FROM public.notification_sequences
                           WHERE org_id = '10700000-0000-4000-a000-00000000000a'
                             AND purpose = 'intake_reminder'))
  -- The defaults themselves are untouched.
  AND (SELECT count(*) = 3 FROM public.notification_sequence_default_steps
        WHERE purpose = 'intake_reminder'));
-- Save 6: its own steps again, for the rest of the packet (revision 5).
SELECT public.save_notification_sequence(
  '10700000-0000-4000-a000-00000000000a', 'intake_reminder', pg_temp.m107_intake('{3,9}', 4));
SELECT pg_temp.m107_mark('own_steps_override_the_default_steps_again',
  (SELECT revision = 5 AND stop_conditions = '{submitted,withdrawn}'
     FROM public.notification_sequences
    WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder')
  AND (SELECT array_agg(offset_days ORDER BY position) = '{3,9}'
         FROM public.notification_sequence_steps
        WHERE org_id = '10700000-0000-4000-a000-00000000000a'
          AND template_key LIKE 'intake_reminder_%'));

-- ---------------------------------------------------------------------------
-- Direct PostgREST-style writes as org A's admin.
-- ---------------------------------------------------------------------------
-- Attributed to the verified caller (revision 6).
UPDATE public.notification_sequences SET enabled = true
 WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder';
SELECT pg_temp.m107_mark('direct_update_is_attributed_and_bumps_revision',
  (SELECT updated_by = '10700000-0000-4000-a000-000000000001' AND revision = 6 AND enabled
     FROM public.notification_sequences
    WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder'));
SELECT pg_temp.m107_mark('updated_by_cannot_be_written_directly', pg_temp.m107_expect_state(
  '42501',
  $$UPDATE public.notification_sequences SET updated_by = '10700000-0000-4000-a000-000000000004'
     WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder'$$));
-- Answers 4 and 5: no direct write reaches a platform-managed column either.
SELECT pg_temp.m107_mark('direct_platform_column_writes_are_refused',
  pg_temp.m107_expect_state('42501',
    $$UPDATE public.notification_sequences SET compress_toward_start_date = true
       WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder'$$)
  AND pg_temp.m107_expect_state('42501',
    $$UPDATE public.notification_sequences SET send_hour = 6
       WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'followup_digest'$$)
  AND pg_temp.m107_expect_state('42501',
    $$UPDATE public.notification_sequences SET send_time_zone = 'America/New_York'
       WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'followup_digest'$$)
  AND pg_temp.m107_expect_state('42501',
    $$INSERT INTO public.notification_sequences (org_id, purpose, compress_toward_start_date)
      VALUES ('10700000-0000-4000-a000-00000000000a', 'intake_reminder', true)$$));

-- The stamp trigger is a second wall: even with a widened column grant, an
-- authenticated write to a platform-managed column is refused.
RESET ROLE;
GRANT UPDATE (compress_toward_start_date, send_hour)
  ON TABLE public.notification_sequences TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.m107_as('10700000-0000-4000-a000-000000000001');
SELECT pg_temp.m107_mark('stamp_trigger_backs_up_the_column_grant',
  pg_temp.m107_expect_message('notification_platform_setting',
    $$UPDATE public.notification_sequences SET compress_toward_start_date = true
       WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder'$$)
  AND pg_temp.m107_expect_message('notification_platform_setting',
    $$UPDATE public.notification_sequences SET send_hour = 6
       WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'followup_digest'$$));
RESET ROLE;
REVOKE UPDATE (compress_toward_start_date, send_hour)
  ON TABLE public.notification_sequences FROM authenticated;

-- A direct step write bumps the sequence's revision once per transaction.
-- This whole packet is one transaction, so now() never moves and the
-- sequence was already stamped; backdate it (stamp trigger off, as the
-- owner) to look like a sequence last saved in an earlier transaction.
ALTER TABLE public.notification_sequences DISABLE TRIGGER notification_sequences_stamp;
UPDATE public.notification_sequences SET updated_at = now() - interval '1 hour'
 WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder';
ALTER TABLE public.notification_sequences ENABLE TRIGGER notification_sequences_stamp;
SET LOCAL ROLE authenticated;
SELECT pg_temp.m107_as('10700000-0000-4000-a000-000000000001');
UPDATE public.notification_sequence_steps SET cc_recipients = '[{"kind":"role","role":"billing"}]'
 WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND position = 1
   AND template_key LIKE 'intake_reminder_%';
UPDATE public.notification_sequence_steps SET cc_recipients = '[{"kind":"role","role":"admin"}]'
 WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND position = 2
   AND template_key LIKE 'intake_reminder_%';
SELECT pg_temp.m107_mark('direct_step_writes_bump_revision_once',
  (SELECT revision = 7 AND updated_by = '10700000-0000-4000-a000-000000000001'
     FROM public.notification_sequences
    WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder'));
SELECT pg_temp.m107_mark('save_holding_the_pre_step_write_revision_conflicts',
  pg_temp.m107_expect_message('notification_sequence_conflict',
    $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
        'intake_reminder', pg_temp.m107_intake('{3,9}', 6))$$));
-- Saves 1, 2, 4, 5 and 6 are audited; the direct writes are not.
SELECT pg_temp.m107_mark('direct_writes_are_not_audited',
  (SELECT count(*) = 5 FROM public.audit_log
    WHERE org_id = '10700000-0000-4000-a000-00000000000a'
      AND entity_type = 'notification_sequence'
      AND entity_id = (SELECT id FROM public.notification_sequences
                        WHERE org_id = '10700000-0000-4000-a000-00000000000a'
                          AND purpose = 'intake_reminder')));
-- Answer 2, by a direct write.
SELECT pg_temp.m107_mark('direct_digest_cc_rejected', pg_temp.m107_expect_message(
  'notification_digest_has_no_cc',
  $$UPDATE public.notification_sequence_steps SET cc_recipients = '[{"kind":"role","role":"admin"}]'
     WHERE org_id = '10700000-0000-4000-a000-00000000000a'
       AND template_key = 'followup_digest_daily'$$));

SELECT pg_temp.m107_mark('identity_columns_have_no_update_grant', pg_temp.m107_expect_state(
  '42501',
  $$UPDATE public.notification_sequences SET purpose = 'followup_digest'
     WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder'$$));
SELECT pg_temp.m107_mark('admin_cannot_delete_a_sequence', pg_temp.m107_expect_state(
  '42501',
  $$DELETE FROM public.notification_sequences
     WHERE org_id = '10700000-0000-4000-a000-00000000000a'$$));

-- Answer 3: an org admin cannot write Minted's defaults by any path.
SELECT pg_temp.m107_mark('org_admin_cannot_write_the_defaults',
  pg_temp.m107_expect_state('42501',
    $$UPDATE public.notification_sequence_defaults SET target_days_to_ready = 30
       WHERE purpose = 'intake_reminder'$$)
  AND pg_temp.m107_expect_state('42501',
    $$UPDATE public.notification_sequence_defaults SET compress_toward_start_date = true
       WHERE purpose = 'intake_reminder'$$)
  AND pg_temp.m107_expect_state('42501',
    $$UPDATE public.notification_sequence_defaults SET send_hour = 6
       WHERE purpose = 'followup_digest'$$)
  AND pg_temp.m107_expect_state('42501',
    $$INSERT INTO public.notification_sequence_defaults (purpose, send_hour, send_time_zone)
      VALUES ('followup_digest', 6, 'America/New_York')$$)
  AND pg_temp.m107_expect_state('42501',
    $$DELETE FROM public.notification_sequence_defaults$$)
  AND pg_temp.m107_expect_state('42501',
    $$UPDATE public.notification_sequence_default_steps SET offset_days = 1
       WHERE purpose = 'intake_reminder' AND position = 1$$)
  AND pg_temp.m107_expect_state('42501',
    $$INSERT INTO public.notification_sequence_default_steps
        (purpose, position, offset_days, channel, template_key)
      VALUES ('intake_reminder', 4, 9, 'email', 'intake_reminder_final')$$)
  AND pg_temp.m107_expect_state('42501',
    $$DELETE FROM public.notification_sequence_default_steps$$));
SELECT pg_temp.m107_mark('defaults_unchanged_after_the_admin_tried',
  (SELECT target_days_to_ready = 14 AND NOT compress_toward_start_date
     FROM public.notification_sequence_defaults WHERE purpose = 'intake_reminder')
  AND (SELECT send_hour = 8 FROM public.notification_sequence_defaults
        WHERE purpose = 'followup_digest')
  AND (SELECT count(*) = 4 FROM public.notification_sequence_default_steps));

-- ---------------------------------------------------------------------------
-- Other roles in org A.
-- ---------------------------------------------------------------------------
SELECT pg_temp.m107_as('10700000-0000-4000-a000-000000000002');
SELECT pg_temp.m107_mark('specialist_reads_but_cannot_save',
  (SELECT count(*) = 2 FROM public.notification_sequences)
  AND pg_temp.m107_expect_message('notification_sequence_not_authorized',
    $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
        'intake_reminder', pg_temp.m107_intake('{2}', 7))$$));

SELECT pg_temp.m107_as('10700000-0000-4000-a000-000000000003');
SELECT pg_temp.m107_mark('billing_reads_sequences_and_steps',
  (SELECT count(*) = 2 FROM public.notification_sequences)
  AND (SELECT count(*) = 3 FROM public.notification_sequence_steps));
SELECT pg_temp.m107_mark('org_a_member_reads_the_defaults',
  (SELECT count(*) = 2 FROM public.notification_sequence_defaults)
  AND (SELECT count(*) = 4 FROM public.notification_sequence_default_steps));
SELECT pg_temp.m107_mark('billing_cannot_insert', pg_temp.m107_expect_state(
  '42501',
  $$INSERT INTO public.notification_sequence_steps
      (sequence_id, org_id, position, offset_days, channel, template_key)
    SELECT id, org_id, 5, 50, 'email', 'intake_reminder_first'
      FROM public.notification_sequences WHERE purpose = 'intake_reminder'$$));
-- Data-modifying CTEs must be top-level statements.
WITH changed AS (
  UPDATE public.notification_sequences SET enabled = false RETURNING 1
)
SELECT pg_temp.m107_mark('billing_update_touches_nothing', count(*) = 0) FROM changed;
WITH gone AS (
  DELETE FROM public.notification_sequence_steps RETURNING 1
)
SELECT pg_temp.m107_mark('billing_delete_touches_nothing', count(*) = 0) FROM gone;

-- ---------------------------------------------------------------------------
-- Org B's admin sees nothing of org A and cannot write it, but reads the
-- same defaults.
-- ---------------------------------------------------------------------------
SELECT pg_temp.m107_as('10700000-0000-4000-a000-000000000004');
SELECT pg_temp.m107_mark('other_org_reads_nothing',
  (SELECT count(*) = 0 FROM public.notification_sequences)
  AND (SELECT count(*) = 0 FROM public.notification_sequence_steps)
  AND (SELECT count(*) = 0 FROM public.sms_consents));
SELECT pg_temp.m107_mark('org_b_member_reads_the_defaults',
  (SELECT count(*) = 2 FROM public.notification_sequence_defaults)
  AND (SELECT count(*) = 4 FROM public.notification_sequence_default_steps));
SELECT pg_temp.m107_mark('other_org_admin_cannot_save', pg_temp.m107_expect_state(
  '42501',
  $$SELECT public.save_notification_sequence('10700000-0000-4000-a000-00000000000a',
      'intake_reminder', pg_temp.m107_intake('{2}', 7))$$));
SELECT pg_temp.m107_mark('other_org_admin_cannot_insert_into_org_a', pg_temp.m107_expect_state(
  '42501',
  $$INSERT INTO public.notification_sequences (org_id, purpose)
    VALUES ('10700000-0000-4000-a000-00000000000a', 'followup_digest')$$));

-- A signed-in user who belongs to no org reads no defaults.
SELECT pg_temp.m107_as('10700000-0000-4000-a000-000000000005');
SELECT pg_temp.m107_mark('user_with_no_org_reads_no_defaults',
  (SELECT count(*) = 0 FROM public.notification_sequence_defaults)
  AND (SELECT count(*) = 0 FROM public.notification_sequence_default_steps)
  AND (SELECT count(*) = 0 FROM public.notification_sequences));

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Table CHECKs and keys, as the owner so RLS and grants are out of the way.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE m107_ids AS
  SELECT id AS intake_id FROM public.notification_sequences
   WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder';

SELECT pg_temp.m107_mark('check_channel', pg_temp.m107_expect_state('23514', $$
  INSERT INTO public.notification_sequence_steps
    (sequence_id, org_id, position, offset_days, channel, template_key)
  SELECT intake_id, '10700000-0000-4000-a000-00000000000a', 8, 80, 'fax', 'intake_reminder_first'
    FROM m107_ids$$));
SELECT pg_temp.m107_mark('check_template_key_format', pg_temp.m107_expect_state('23514', $$
  INSERT INTO public.notification_sequence_steps
    (sequence_id, org_id, position, offset_days, channel, template_key)
  SELECT intake_id, '10700000-0000-4000-a000-00000000000a', 8, 80, 'email', 'Intake Reminder'
    FROM m107_ids$$));
SELECT pg_temp.m107_mark('check_offset_bounds', pg_temp.m107_expect_state('23514', $$
  INSERT INTO public.notification_sequence_steps
    (sequence_id, org_id, position, offset_days, channel, template_key)
  SELECT intake_id, '10700000-0000-4000-a000-00000000000a', 8, 91, 'email', 'intake_reminder_first'
    FROM m107_ids$$));
SELECT pg_temp.m107_mark('check_position_bounds', pg_temp.m107_expect_state('23514', $$
  INSERT INTO public.notification_sequence_steps
    (sequence_id, org_id, position, offset_days, channel, template_key)
  SELECT intake_id, '10700000-0000-4000-a000-00000000000a', 11, 80, 'email', 'intake_reminder_first'
    FROM m107_ids$$));
SELECT pg_temp.m107_mark('check_cc_shape', pg_temp.m107_expect_state('23514', $$
  INSERT INTO public.notification_sequence_steps
    (sequence_id, org_id, position, offset_days, channel, template_key, cc_recipients)
  SELECT intake_id, '10700000-0000-4000-a000-00000000000a', 8, 80, 'email', 'intake_reminder_first',
         '[{"kind":"role","role":"owner"}]'
    FROM m107_ids$$));
SELECT pg_temp.m107_mark('unique_position_per_sequence', pg_temp.m107_expect_state('23505', $$
  INSERT INTO public.notification_sequence_steps
    (sequence_id, org_id, position, offset_days, channel, template_key)
  SELECT intake_id, '10700000-0000-4000-a000-00000000000a', 1, 1, 'email', 'intake_reminder_first'
    FROM m107_ids$$));
SELECT pg_temp.m107_mark('step_org_must_match_sequence_org', pg_temp.m107_expect_state('23503', $$
  INSERT INTO public.notification_sequence_steps
    (sequence_id, org_id, position, offset_days, channel, template_key)
  SELECT intake_id, '10700000-0000-4000-a000-00000000000b', 8, 80, 'email', 'intake_reminder_first'
    FROM m107_ids$$));
SELECT pg_temp.m107_mark('check_stop_conditions', pg_temp.m107_expect_state('23514', $$
  UPDATE public.notification_sequences SET stop_conditions = '{submitted,bounced}'
   WHERE id = (SELECT intake_id FROM m107_ids)$$));
SELECT pg_temp.m107_mark('check_target_bounds', pg_temp.m107_expect_state('23514', $$
  UPDATE public.notification_sequences SET target_days_to_ready = 91
   WHERE id = (SELECT intake_id FROM m107_ids)$$));
SELECT pg_temp.m107_mark('check_digest_has_no_intake_settings',
  pg_temp.m107_expect_state('23514', $$
    UPDATE public.notification_sequences SET stop_conditions = '{submitted}'
     WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'followup_digest'$$)
  AND pg_temp.m107_expect_state('23514', $$
    UPDATE public.notification_sequences SET stop_conditions = '{}'
     WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'followup_digest'$$)
  AND pg_temp.m107_expect_state('23514', $$
    UPDATE public.notification_sequences SET target_days_to_ready = 14
     WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'followup_digest'$$)
  AND pg_temp.m107_expect_state('23514', $$
    UPDATE public.notification_sequences SET compress_toward_start_date = false
     WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'followup_digest'$$));
SELECT pg_temp.m107_mark('check_intake_has_no_send_time',
  pg_temp.m107_expect_state('23514', $$
    UPDATE public.notification_sequences SET send_hour = 8
     WHERE id = (SELECT intake_id FROM m107_ids)$$)
  AND pg_temp.m107_expect_state('23514', $$
    UPDATE public.notification_sequences SET send_time_zone = 'America/Chicago'
     WHERE id = (SELECT intake_id FROM m107_ids)$$));
SELECT pg_temp.m107_mark('check_send_hour_bounds',
  pg_temp.m107_expect_state('23514', $$
    UPDATE public.notification_sequences SET send_hour = 24
     WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'followup_digest'$$)
  AND pg_temp.m107_expect_state('23514', $$
    UPDATE public.notification_sequences SET send_hour = -1
     WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'followup_digest'$$));
SELECT pg_temp.m107_mark('check_send_time_zone_is_iana',
  pg_temp.m107_expect_state('23514', $$
    UPDATE public.notification_sequences SET send_time_zone = 'Mars/Olympus_Mons'
     WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'followup_digest'$$)
  AND pg_temp.m107_expect_state('23514', $$
    UPDATE public.notification_sequences SET send_time_zone = 'CST'
     WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'followup_digest'$$)
  AND pg_temp.m107_expect_state('23514', $$
    UPDATE public.notification_sequence_defaults SET send_time_zone = 'america/chicago'
     WHERE purpose = 'followup_digest'$$));
SELECT pg_temp.m107_mark('unique_org_purpose', pg_temp.m107_expect_state('23505', $$
  INSERT INTO public.notification_sequences (org_id, purpose)
  VALUES ('10700000-0000-4000-a000-00000000000a', 'intake_reminder')$$));
SELECT pg_temp.m107_mark('direct_digest_second_step_rejected', pg_temp.m107_expect_message(
  'notification_digest_single_step', $$
  INSERT INTO public.notification_sequence_steps
    (sequence_id, org_id, position, offset_days, channel, template_key)
  SELECT id, org_id, 2, 1, 'email', 'followup_digest_daily'
    FROM public.notification_sequences
   WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'followup_digest'$$));
SELECT pg_temp.m107_mark('identity_is_immutable', pg_temp.m107_expect_message(
  'notification_sequence_identity_immutable',
  $$UPDATE public.notification_sequences SET purpose = 'followup_digest'
     WHERE id = (SELECT intake_id FROM m107_ids)$$));

-- The defaults keep the same rules as an org's steps, and stay complete.
SELECT pg_temp.m107_mark('default_steps_keep_the_step_rules',
  pg_temp.m107_expect_message('notification_digest_single_step', $$
    INSERT INTO public.notification_sequence_default_steps
      (purpose, position, offset_days, channel, template_key)
    VALUES ('followup_digest', 2, 1, 'email', 'followup_digest_daily')$$)
  AND pg_temp.m107_expect_message('notification_step_offsets_not_increasing', $$
    INSERT INTO public.notification_sequence_default_steps
      (purpose, position, offset_days, channel, template_key)
    VALUES ('intake_reminder', 4, 7, 'email', 'intake_reminder_final')$$)
  AND pg_temp.m107_expect_state('23514', $$
    INSERT INTO public.notification_sequence_default_steps
      (purpose, position, offset_days, channel, template_key)
    VALUES ('intake_reminder', 4, 9, 'email', 'followup_digest_daily')$$)
  AND pg_temp.m107_expect_state('23514', $$
    INSERT INTO public.notification_sequence_default_steps
      (purpose, position, offset_days, channel, template_key)
    VALUES ('intake_reminder', 4, 9, 'fax', 'intake_reminder_final')$$)
  AND pg_temp.m107_expect_state('23503', $$
    INSERT INTO public.notification_sequence_default_steps
      (purpose, position, offset_days, channel, template_key)
    VALUES ('payment_reminder', 1, 1, 'email', 'payment_reminder_first')$$));
SELECT pg_temp.m107_mark('defaults_stay_complete_for_their_purpose',
  pg_temp.m107_expect_state('23514', $$
    UPDATE public.notification_sequence_defaults SET compress_toward_start_date = NULL
     WHERE purpose = 'intake_reminder'$$)
  AND pg_temp.m107_expect_state('23514', $$
    UPDATE public.notification_sequence_defaults SET target_days_to_ready = NULL
     WHERE purpose = 'intake_reminder'$$)
  AND pg_temp.m107_expect_state('23514', $$
    UPDATE public.notification_sequence_defaults SET send_hour = NULL
     WHERE purpose = 'followup_digest'$$)
  AND pg_temp.m107_expect_state('23514', $$
    UPDATE public.notification_sequence_defaults SET send_hour = 24
     WHERE purpose = 'followup_digest'$$)
  AND pg_temp.m107_expect_state('23514', $$
    UPDATE public.notification_sequence_defaults SET send_hour = 8
     WHERE purpose = 'intake_reminder'$$)
  AND pg_temp.m107_expect_state('23514', $$
    UPDATE public.notification_sequence_defaults SET stop_conditions = '{bounced}'
     WHERE purpose = 'intake_reminder'$$)
  AND pg_temp.m107_expect_state('23514', $$
    INSERT INTO public.notification_sequence_defaults (purpose) VALUES ('payment_reminder')$$)
  AND pg_temp.m107_expect_message('notification_default_identity_immutable', $$
    UPDATE public.notification_sequence_defaults SET purpose = 'followup_digest'
     WHERE purpose = 'intake_reminder'$$));
SELECT pg_temp.m107_mark('no_row_means_off',
  NOT EXISTS (SELECT 1 FROM public.notification_sequences
               WHERE org_id = '10700000-0000-4000-a000-00000000000b'));

-- ---------------------------------------------------------------------------
-- Minted (service_role) sets the platform-managed settings: an org override
-- and the default itself. An admin's later save leaves the override alone.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE service_role;
UPDATE public.notification_sequences
   SET send_hour = 6, send_time_zone = 'America/New_York'
 WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'followup_digest';
UPDATE public.notification_sequences SET compress_toward_start_date = true
 WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder';
UPDATE public.notification_sequence_defaults SET send_hour = 7
 WHERE purpose = 'followup_digest';
SELECT pg_temp.m107_mark('service_role_writes_platform_settings',
  (SELECT send_hour = 6 AND send_time_zone = 'America/New_York'
     FROM public.notification_sequences
    WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'followup_digest')
  AND (SELECT compress_toward_start_date FROM public.notification_sequences
        WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder')
  AND (SELECT send_hour = 7 FROM public.notification_sequence_defaults
        WHERE purpose = 'followup_digest'));

SET LOCAL ROLE authenticated;
SELECT pg_temp.m107_as('10700000-0000-4000-a000-000000000001');
-- Save 7 (intake) and save 8 (digest), each at its current revision.
SELECT public.save_notification_sequence(
  '10700000-0000-4000-a000-00000000000a', 'intake_reminder',
  pg_temp.m107_intake('{3,9}', (SELECT revision FROM public.notification_sequences
                                 WHERE org_id = '10700000-0000-4000-a000-00000000000a'
                                   AND purpose = 'intake_reminder')));
SELECT public.save_notification_sequence(
  '10700000-0000-4000-a000-00000000000a', 'followup_digest',
  pg_temp.m107_digest((SELECT revision FROM public.notification_sequences
                        WHERE org_id = '10700000-0000-4000-a000-00000000000a'
                          AND purpose = 'followup_digest')));
SELECT pg_temp.m107_mark('admin_save_keeps_the_platform_overrides',
  (SELECT compress_toward_start_date AND NOT enabled
     FROM public.notification_sequences
    WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'intake_reminder')
  AND (SELECT send_hour = 6 AND send_time_zone = 'America/New_York'
         FROM public.notification_sequences
        WHERE org_id = '10700000-0000-4000-a000-00000000000a' AND purpose = 'followup_digest'));
RESET ROLE;

-- ---------------------------------------------------------------------------
-- sms_consents.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE service_role;
INSERT INTO public.sms_consents
  (id, org_id, provider_id, phone_e164, source, consent_text_version)
VALUES ('10700000-0000-4000-a000-0000000c0001', '10700000-0000-4000-a000-00000000000a',
        '10700000-0000-4000-a000-0000000a0001', '+15555550123', 'intake_form', 'sms-consent.v1');
SELECT pg_temp.m107_mark('service_role_records_consent',
  EXISTS (SELECT 1 FROM public.sms_consents WHERE id = '10700000-0000-4000-a000-0000000c0001'));
SELECT pg_temp.m107_mark('consent_phone_must_be_e164', pg_temp.m107_expect_state('23514', $$
  INSERT INTO public.sms_consents (org_id, provider_id, phone_e164, source, consent_text_version)
  VALUES ('10700000-0000-4000-a000-00000000000a', '10700000-0000-4000-a000-0000000a0001',
          '555-555-0123', 'intake_form', 'sms-consent.v1')$$));
SELECT pg_temp.m107_mark('consent_source_is_closed', pg_temp.m107_expect_state('23514', $$
  INSERT INTO public.sms_consents (org_id, provider_id, phone_e164, source, consent_text_version)
  VALUES ('10700000-0000-4000-a000-00000000000a', '10700000-0000-4000-a000-0000000a0001',
          '+15555550199', 'guessed', 'sms-consent.v1')$$));
SELECT pg_temp.m107_mark('staff_recorded_consent_names_the_recorder',
  pg_temp.m107_expect_state('23514', $$
    INSERT INTO public.sms_consents (org_id, provider_id, phone_e164, source, consent_text_version)
    VALUES ('10700000-0000-4000-a000-00000000000a', '10700000-0000-4000-a000-0000000a0001',
            '+15555550188', 'staff_recorded', 'sms-consent.v1')$$)
  -- This one succeeds, so its row stays: provider A now has a live consent
  -- for +15555550188 as well, which the counts below include.
  AND NOT pg_temp.m107_expect_state('23514', $$
    INSERT INTO public.sms_consents
      (org_id, provider_id, phone_e164, source, consent_text_version, recorded_by)
    VALUES ('10700000-0000-4000-a000-00000000000a', '10700000-0000-4000-a000-0000000a0001',
            '+15555550188', 'staff_recorded', 'sms-consent.v1',
            '10700000-0000-4000-a000-000000000001')$$));
SELECT pg_temp.m107_mark('consent_provider_must_be_in_org', pg_temp.m107_expect_state('23503', $$
  INSERT INTO public.sms_consents (org_id, provider_id, phone_e164, source, consent_text_version)
  VALUES ('10700000-0000-4000-a000-00000000000a', '10700000-0000-4000-a000-0000000b0001',
          '+15555550199', 'intake_form', 'sms-consent.v1')$$));
SELECT pg_temp.m107_mark('one_live_consent_per_number', pg_temp.m107_expect_state('23505', $$
  INSERT INTO public.sms_consents (org_id, provider_id, phone_e164, source, consent_text_version)
  VALUES ('10700000-0000-4000-a000-00000000000a', '10700000-0000-4000-a000-0000000a0001',
          '+15555550123', 'sms_keyword', 'sms-consent.v1')$$));
SELECT pg_temp.m107_mark('consent_evidence_is_immutable', pg_temp.m107_expect_message(
  'sms_consent_immutable', $$
  UPDATE public.sms_consents SET phone_e164 = '+15555550124'
   WHERE id = '10700000-0000-4000-a000-0000000c0001'$$));
SELECT pg_temp.m107_mark('revocation_needs_both_columns', pg_temp.m107_expect_state('23514', $$
  UPDATE public.sms_consents SET revoked_at = now()
   WHERE id = '10700000-0000-4000-a000-0000000c0001'$$));
UPDATE public.sms_consents SET revoked_at = now(), revoked_source = 'sms_stop'
 WHERE id = '10700000-0000-4000-a000-0000000c0001';
SELECT pg_temp.m107_mark('revocation_is_stamped_once',
  (SELECT revoked_source = 'sms_stop' FROM public.sms_consents
    WHERE id = '10700000-0000-4000-a000-0000000c0001')
  AND pg_temp.m107_expect_message('sms_consent_immutable', $$
    UPDATE public.sms_consents SET revoked_source = 'provider_request'
     WHERE id = '10700000-0000-4000-a000-0000000c0001'$$));
INSERT INTO public.sms_consents (org_id, provider_id, phone_e164, source, consent_text_version)
VALUES ('10700000-0000-4000-a000-00000000000a', '10700000-0000-4000-a000-0000000a0001',
        '+15555550123', 'sms_keyword', 'sms-consent.v2');
SELECT pg_temp.m107_mark('consent_can_be_given_again_after_revocation',
  (SELECT count(*) = 2 AND count(*) FILTER (WHERE revoked_at IS NULL) = 1
     FROM public.sms_consents
    WHERE provider_id = '10700000-0000-4000-a000-0000000a0001'
      AND phone_e164 = '+15555550123'));
SELECT pg_temp.m107_mark('service_role_cannot_delete_consent', pg_temp.m107_expect_state('42501', $$
  DELETE FROM public.sms_consents WHERE id = '10700000-0000-4000-a000-0000000c0001'$$));

SET LOCAL ROLE authenticated;
SELECT pg_temp.m107_as('10700000-0000-4000-a000-000000000003');
SELECT pg_temp.m107_mark('member_reads_own_org_consents',
  (SELECT count(*) = 3 FROM public.sms_consents));
SELECT pg_temp.m107_as('10700000-0000-4000-a000-000000000004');
SELECT pg_temp.m107_mark('other_org_reads_no_consents',
  (SELECT count(*) = 0 FROM public.sms_consents));
SELECT pg_temp.m107_as('10700000-0000-4000-a000-000000000001');
SELECT pg_temp.m107_mark('admin_cannot_write_consent', pg_temp.m107_expect_state('42501', $$
  INSERT INTO public.sms_consents (org_id, provider_id, phone_e164, source, consent_text_version)
  VALUES ('10700000-0000-4000-a000-00000000000a', '10700000-0000-4000-a000-0000000a0001',
          '+15555550177', 'staff_recorded', 'sms-consent.v1')$$));
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Audit rows: one per successful save (8: two creates, six updates),
-- attributed to the admin, config only.
-- ---------------------------------------------------------------------------
SELECT pg_temp.m107_mark('each_save_writes_one_attributed_audit_row',
  (SELECT count(*) = 8
      AND bool_and(user_id = '10700000-0000-4000-a000-000000000001')
      AND count(*) FILTER (WHERE action_type = 'CREATE') = 2
      AND count(*) FILTER (WHERE action_type = 'UPDATE') = 6
     FROM public.audit_log
    WHERE org_id = '10700000-0000-4000-a000-00000000000a'
      AND entity_type = 'notification_sequence'));

SELECT name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END
  FROM pg_temp.m107_results ORDER BY name;

DO $$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO v_failed
    FROM pg_temp.m107_results WHERE NOT passed;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'MINT-107 notification sequences assertions failed: %', v_failed;
  END IF;
END;
$$;

-- Undo the CI emulation (the ROLLBACK would too; this keeps it explicit).
ALTER ROLE service_role NOBYPASSRLS;
REVOKE USAGE ON SCHEMA auth FROM authenticated, service_role;
ROLLBACK;
\echo MINT-107 notification sequences packet passed.
