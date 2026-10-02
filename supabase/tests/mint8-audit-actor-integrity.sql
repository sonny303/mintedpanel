-- MINT-8 actor-integrity tests. Run only in the verifier's owned, disposable
-- PostgreSQL database. All organizations, users, and events are synthetic.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE mint8_results (
  ordinal bigint GENERATED ALWAYS AS IDENTITY,
  label text UNIQUE,
  passed boolean NOT NULL
);

CREATE FUNCTION pg_temp.mint8_assert(p_label text, p_passed boolean)
RETURNS void LANGUAGE sql SECURITY INVOKER AS $$
  INSERT INTO pg_temp.mint8_results (label, passed)
  VALUES (p_label, COALESCE(p_passed, false));
$$;

-- This helper executes one statement under the same database role and JWT
-- settings PostgREST supplies. It catches only SQL failures; each caller then
-- checks the persisted result before the fixture rolls back.
CREATE FUNCTION pg_temp.mint8_run(
  p_db_role text,
  p_actor uuid,
  p_statement text
)
RETURNS TABLE (
  role_ok boolean,
  succeeded boolean,
  result jsonb,
  error_code text,
  error_message text
)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_actor::text, ''), true);
  PERFORM pg_catalog.set_config('request.jwt.claim.role', p_db_role, true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', p_actor, 'role', p_db_role)::text,
    true
  );
  EXECUTE pg_catalog.format('SET LOCAL ROLE %I', p_db_role);
  role_ok := current_user::text = p_db_role;
  succeeded := false;

  BEGIN
    EXECUTE p_statement INTO result;
    succeeded := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      error_code = RETURNED_SQLSTATE,
      error_message = MESSAGE_TEXT;
  END;

  RESET ROLE;
  RETURN NEXT;
END;
$$;

INSERT INTO public.organizations (id, name) VALUES
  ('10000000-0000-4000-8000-000000000001', 'MINT-8 synthetic org A'),
  ('10000000-0000-4000-8000-000000000002', 'MINT-8 synthetic org B');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('20000000-0000-4000-8000-000000000001', 'mint8-a@example.test', '{}'::jsonb),
  ('20000000-0000-4000-8000-000000000002', 'mint8-b@example.test', '{}'::jsonb),
  ('20000000-0000-4000-8000-000000000003', 'mint8-billing@example.test', '{}'::jsonb),
  ('20000000-0000-4000-8000-000000000004', 'mint8-outsider@example.test', '{}'::jsonb);

INSERT INTO public.profiles (id, full_name, email) VALUES
  ('20000000-0000-4000-8000-000000000001', 'MINT-8 Actor A', 'mint8-a@example.test'),
  ('20000000-0000-4000-8000-000000000002', 'MINT-8 Actor B', 'mint8-b@example.test'),
  ('20000000-0000-4000-8000-000000000003', 'MINT-8 Billing A', 'mint8-billing@example.test'),
  ('20000000-0000-4000-8000-000000000004', 'MINT-8 Outsider', 'mint8-outsider@example.test')
ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;

INSERT INTO public.memberships (org_id, user_id, role) VALUES
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'specialist'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'specialist'),
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'billing');

-- Models submit_capture's intentional attribution: an authenticated recipient
-- submits a one-time link, while the stored issuer remains the audit actor.
CREATE TEMP TABLE mint8_test_link_context (
  link_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  created_by uuid NOT NULL
);
INSERT INTO pg_temp.mint8_test_link_context (link_id, org_id, created_by)
VALUES (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002'
);

CREATE FUNCTION public.mint8_test_invoker_writer(
  p_org_id uuid,
  p_forged_actor uuid,
  p_forged_name text,
  p_forged_time timestamptz,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  INSERT INTO public.audit_log (
    id, org_id, user_id, user_name, action_type, entity_type, entity_id,
    ts, created_at, description
  ) VALUES (
    p_id, p_org_id, p_forged_actor, p_forged_name, 'CREATE', 'mint8_invoker',
    NULL, p_forged_time, p_forged_time, 'synthetic invoker writer'
  )
  RETURNING pg_catalog.jsonb_build_object(
    'id', id, 'org_id', org_id, 'user_id', user_id, 'user_name', user_name,
    'ts', ts, 'created_at', created_at
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE FUNCTION public.mint8_test_definer_writer(
  p_link_id uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_link pg_temp.mint8_test_link_context%ROWTYPE;
  v_user_name text;
  v_result jsonb;
BEGIN
  SELECT * INTO STRICT v_link
    FROM pg_temp.mint8_test_link_context
   WHERE link_id = p_link_id;
  SELECT COALESCE(NULLIF(pg_catalog.btrim(p.full_name), ''), p.email)
    INTO v_user_name
    FROM public.profiles AS p
   WHERE p.id = v_link.created_by;

  INSERT INTO public.audit_log (
    id, org_id, user_id, user_name, action_type, entity_type, entity_id,
    description
  ) VALUES (
    p_id, v_link.org_id, v_link.created_by, v_user_name, 'UPDATE', 'party',
    NULL, 'synthetic capture-link submission'
  )
  RETURNING pg_catalog.jsonb_build_object(
    'id', id, 'org_id', org_id, 'user_id', user_id, 'user_name', user_name,
    'ts', ts, 'created_at', created_at
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.mint8_test_invoker_writer(uuid, uuid, text, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mint8_test_definer_writer(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mint8_test_invoker_writer(uuid, uuid, text, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mint8_test_definer_writer(uuid, uuid) TO authenticated;

DO $$
DECLARE
  r record;
  v_direct_id uuid := '30000000-0000-4000-8000-000000000001';
  v_invoker_id uuid := '30000000-0000-4000-8000-000000000002';
  v_definer_id uuid := '30000000-0000-4000-8000-000000000003';
  v_service_id uuid := '30000000-0000-4000-8000-000000000004';
  v_other_org_id uuid := '30000000-0000-4000-8000-000000000005';
  v_cross_org_id uuid := '30000000-0000-4000-8000-000000000006';
  v_billing_id uuid := '30000000-0000-4000-8000-000000000007';
  v_missing_actor_id uuid := '30000000-0000-4000-8000-000000000008';
  v_anon_id uuid := '30000000-0000-4000-8000-000000000009';
  v_org_a uuid := '10000000-0000-4000-8000-000000000001';
  v_org_b uuid := '10000000-0000-4000-8000-000000000002';
  v_actor_a uuid := '20000000-0000-4000-8000-000000000001';
  v_actor_b uuid := '20000000-0000-4000-8000-000000000002';
  v_billing_a uuid := '20000000-0000-4000-8000-000000000003';
  v_outsider uuid := '20000000-0000-4000-8000-000000000004';
  v_forged_time timestamptz := '2001-01-01 00:00:00+00';
  v_count bigint;
BEGIN
  -- Direct authenticated INSERT cannot choose actor, display name, or time.
  SELECT * INTO r FROM pg_temp.mint8_run('authenticated', v_actor_a, pg_catalog.format(
    'INSERT INTO public.audit_log (id, org_id, user_id, user_name, action_type, entity_type, ts, created_at, description) VALUES (%L, %L, %L, %L, ''CREATE'', ''mint8_direct'', %L, %L, ''synthetic direct writer'') RETURNING pg_catalog.jsonb_build_object(''id'', id, ''org_id'', org_id, ''user_id'', user_id, ''user_name'', user_name, ''ts'', ts, ''created_at'', created_at)',
    v_direct_id, v_org_a, v_actor_b, 'Forged Display Name', v_forged_time, v_forged_time
  ));
  PERFORM pg_temp.mint8_assert('direct.authenticated_actor_and_time',
    r.role_ok AND r.succeeded
    AND r.result->>'user_id' = v_actor_a::text
    AND r.result->>'user_name' = 'MINT-8 Actor A'
    AND r.result->>'org_id' = v_org_a::text
    AND (r.result->>'ts')::timestamptz > v_forged_time
    AND r.result->>'ts' = r.result->>'created_at');

  -- A SECURITY INVOKER mutation keeps using the caller's RLS boundary and gets
  -- the same verified attribution even when it supplies forged audit fields.
  SELECT * INTO r FROM pg_temp.mint8_run('authenticated', v_actor_a, pg_catalog.format(
    'SELECT public.mint8_test_invoker_writer(%L, %L, %L, %L, %L)',
    v_org_a, v_actor_b, 'Forged Invoker Name', v_forged_time, v_invoker_id
  ));
  PERFORM pg_temp.mint8_assert('rpc.security_invoker_actor_and_time',
    r.role_ok AND r.succeeded
    AND r.result->>'user_id' = v_actor_a::text
    AND r.result->>'user_name' = 'MINT-8 Actor A'
    AND (r.result->>'ts')::timestamptz > v_forged_time
    AND r.result->>'ts' = r.result->>'created_at');

  -- A SECURITY DEFINER writer called by actor A retains its trusted stored
  -- attribution to link issuer B. This is the deliberate exception to the
  -- direct/SECURITY INVOKER actor stamper.
  SELECT * INTO r FROM pg_temp.mint8_run('authenticated', v_actor_a, pg_catalog.format(
    'SELECT public.mint8_test_definer_writer(%L, %L)',
    '40000000-0000-4000-8000-000000000001', v_definer_id
  ));
  PERFORM pg_temp.mint8_assert('rpc.security_definer_trusted_actor_preserved',
    r.role_ok AND r.succeeded
    AND r.result->>'org_id' = v_org_b::text
    AND r.result->>'user_id' = v_actor_b::text
    AND r.result->>'user_name' = 'MINT-8 Actor B'
    AND (r.result->>'ts')::timestamptz > v_forged_time
    AND r.result->>'ts' = r.result->>'created_at');

  -- A service-role write has no browser JWT actor. Its verified server actor
  -- remains intact, and the table defaults still provide database timestamps.
  SELECT * INTO r FROM pg_temp.mint8_run('service_role', NULL, pg_catalog.format(
    'INSERT INTO public.audit_log (id, org_id, user_id, user_name, action_type, entity_type, description) VALUES (%L, %L, %L, %L, ''CREATE'', ''mint8_service'', ''synthetic service writer'') RETURNING pg_catalog.jsonb_build_object(''id'', id, ''org_id'', org_id, ''user_id'', user_id, ''user_name'', user_name, ''ts'', ts, ''created_at'', created_at)',
    v_service_id, v_org_a, v_actor_a, 'Verified Server Actor A'
  ));
  PERFORM pg_temp.mint8_assert('service_role_writer_preserved',
    r.role_ok AND r.succeeded
    AND r.result->>'user_id' = v_actor_a::text
    AND r.result->>'user_name' = 'Verified Server Actor A'
    AND (r.result->>'ts')::timestamptz > v_forged_time
    AND r.result->>'ts' = r.result->>'created_at');

  PERFORM pg_temp.mint8_assert('trusted.service_role_elevated_privileges_unchanged',
    pg_catalog.has_table_privilege('service_role', 'public.audit_log', 'INSERT')
    AND pg_catalog.has_table_privilege('service_role', 'public.audit_log', 'UPDATE')
    AND pg_catalog.has_table_privilege('service_role', 'public.audit_log', 'DELETE')
    AND pg_catalog.has_table_privilege('service_role', 'public.audit_log', 'TRUNCATE'));

  -- A second organization can record its own audit row with its own actor.
  SELECT * INTO r FROM pg_temp.mint8_run('authenticated', v_actor_b, pg_catalog.format(
    'INSERT INTO public.audit_log (id, org_id, user_id, user_name, action_type, entity_type, ts, created_at) VALUES (%L, %L, %L, ''Forged B Name'', ''CREATE'', ''mint8_org_b'', %L, %L) RETURNING pg_catalog.jsonb_build_object(''id'', id, ''org_id'', org_id, ''user_id'', user_id, ''user_name'', user_name)',
    v_other_org_id, v_org_b, v_actor_a, v_forged_time, v_forged_time
  ));
  PERFORM pg_temp.mint8_assert('authorized.second_org',
    r.role_ok AND r.succeeded
    AND r.result->>'org_id' = v_org_b::text
    AND r.result->>'user_id' = v_actor_b::text
    AND r.result->>'user_name' = 'MINT-8 Actor B');

  -- Org A cannot write an audit row under org B even with a valid writer role.
  SELECT * INTO r FROM pg_temp.mint8_run('authenticated', v_actor_a, pg_catalog.format(
    'INSERT INTO public.audit_log (id, org_id, user_id, action_type, entity_type) VALUES (%L, %L, %L, ''CREATE'', ''mint8_cross_org'')',
    v_cross_org_id, v_org_b, v_actor_a
  ));
  PERFORM pg_temp.mint8_assert('deny.cross_org',
    r.role_ok AND NOT r.succeeded AND r.error_code = '42501'
    AND NOT EXISTS (SELECT 1 FROM public.audit_log WHERE id = v_cross_org_id));

  -- Billing, nonmembers, unauthenticated JWTs, and anon cannot use the browser
  -- audit path. A missing auth.uid() is explicitly rejected by the trigger.
  SELECT * INTO r FROM pg_temp.mint8_run('authenticated', v_billing_a, pg_catalog.format(
    'INSERT INTO public.audit_log (id, org_id, user_id, action_type, entity_type) VALUES (%L, %L, %L, ''CREATE'', ''mint8_billing'')',
    v_billing_id, v_org_a, v_billing_a
  ));
  PERFORM pg_temp.mint8_assert('deny.billing_writer',
    r.role_ok AND NOT r.succeeded AND r.error_code = '42501'
    AND NOT EXISTS (SELECT 1 FROM public.audit_log WHERE id = v_billing_id));

  SELECT * INTO r FROM pg_temp.mint8_run('authenticated', v_outsider, pg_catalog.format(
    'INSERT INTO public.audit_log (id, org_id, user_id, action_type, entity_type) VALUES (%L, %L, %L, ''CREATE'', ''mint8_nonmember'')',
    v_billing_id, v_org_a, v_outsider
  ));
  PERFORM pg_temp.mint8_assert('deny.nonmember',
    r.role_ok AND NOT r.succeeded AND r.error_code = '42501'
    AND NOT EXISTS (SELECT 1 FROM public.audit_log WHERE id = v_billing_id));

  SELECT * INTO r FROM pg_temp.mint8_run('authenticated', NULL, pg_catalog.format(
    'INSERT INTO public.audit_log (id, org_id, user_id, action_type, entity_type) VALUES (%L, %L, %L, ''CREATE'', ''mint8_missing_actor'')',
    v_missing_actor_id, v_org_a, v_actor_b
  ));
  PERFORM pg_temp.mint8_assert('deny.auth_uid_null',
    r.role_ok AND NOT r.succeeded AND r.error_code = '42501'
    AND r.error_message = 'audit_authentication_required'
    AND NOT EXISTS (SELECT 1 FROM public.audit_log WHERE id = v_missing_actor_id));

  SELECT * INTO r FROM pg_temp.mint8_run('anon', NULL, pg_catalog.format(
    'INSERT INTO public.audit_log (id, org_id, user_id, action_type, entity_type) VALUES (%L, %L, %L, ''CREATE'', ''mint8_anon'')',
    v_anon_id, v_org_a, v_actor_a
  ));
  PERFORM pg_temp.mint8_assert('deny.anon',
    r.role_ok AND NOT r.succeeded AND r.error_code = '42501'
    AND NOT EXISTS (SELECT 1 FROM public.audit_log WHERE id = v_anon_id));

  -- Authenticated UPDATE's table grant is now revoked as defense in depth;
  -- the pre-migration verifier separately proves RLS already denied it.
  SELECT * INTO r FROM pg_temp.mint8_run('authenticated', v_actor_a,
    pg_catalog.format(
      'WITH changed AS (UPDATE public.audit_log SET description = ''tampered'' WHERE id = %L RETURNING id) SELECT pg_catalog.jsonb_build_object(''updated'', pg_catalog.count(*)) FROM changed',
      v_direct_id
    ));
  SELECT count(*) INTO v_count FROM public.audit_log
   WHERE id = v_direct_id AND description = 'synthetic direct writer';
  PERFORM pg_temp.mint8_assert('append_only.authenticated_update_denied',
    r.role_ok AND NOT r.succeeded AND r.error_code = '42501'
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.audit_log', 'UPDATE')
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'public' AND tablename = 'audit_log' AND cmd IN ('ALL', 'UPDATE')
    )
    AND v_count = 1);

  SELECT * INTO r FROM pg_temp.mint8_run('authenticated', v_actor_a,
    pg_catalog.format(
      'DELETE FROM public.audit_log WHERE id = %L RETURNING id',
      v_direct_id
    ));
  SELECT count(*) INTO v_count FROM public.audit_log
   WHERE id = v_direct_id AND description = 'synthetic direct writer';
  PERFORM pg_temp.mint8_assert('append_only.authenticated_delete_denied',
    r.role_ok AND NOT r.succeeded AND r.error_code = '42501'
    AND NOT pg_catalog.has_table_privilege('authenticated', 'public.audit_log', 'DELETE')
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'public' AND tablename = 'audit_log' AND cmd IN ('ALL', 'DELETE')
    )
    AND v_count = 1);
END;
$$;

SELECT 'MINT8|' || label || '|' || CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END
  FROM pg_temp.mint8_results ORDER BY ordinal;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_temp.mint8_results WHERE NOT passed) THEN
    RAISE EXCEPTION 'MINT8_TESTS_FAILED';
  END IF;
END;
$$;

ROLLBACK;
