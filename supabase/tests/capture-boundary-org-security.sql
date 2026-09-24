-- Capture boundary security regression packet.
-- Run after repository migrations in an owned disposable local database. Every fixture row is synthetic and
-- the outer transaction rolls back. Output is labels only; no token, row, or
-- provider value is emitted.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE cb_results (
  ordinal bigint GENERATED ALWAYS AS IDENTITY,
  label text PRIMARY KEY,
  passed boolean NOT NULL
);
CREATE TEMP TABLE cb_ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());

CREATE FUNCTION pg_temp.cb_assert(p_label text, p_condition boolean)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
AS $$
  INSERT INTO pg_temp.cb_results (label, passed)
  VALUES (p_label, coalesce(p_condition, false));
$$;

CREATE FUNCTION pg_temp.cb_party_snapshot(p_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
AS $$
  SELECT coalesce((SELECT to_jsonb(p) FROM public.parties p WHERE p.id = p_id), '{}'::jsonb);
$$;

CREATE FUNCTION pg_temp.cb_link_snapshot(p_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
AS $$
  SELECT coalesce((SELECT to_jsonb(l) FROM public.party_capture_links l WHERE l.id = p_id), '{}'::jsonb);
$$;

CREATE FUNCTION pg_temp.cb_audit_snapshot()
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
AS $$
  SELECT jsonb_build_object(
    'count', count(*),
    'digest', md5(coalesce(string_agg(md5(to_jsonb(a)::text), ',' ORDER BY a.id::text), ''))
  )
  FROM public.audit_log a;
$$;

INSERT INTO pg_temp.cb_ids(name) VALUES
  ('org_a'), ('org_b'), ('org_c'), ('org_d'), ('actor'),
  ('party_used_cross'), ('party_active_cross'), ('party_active_same'), ('party_expired_same'),
  ('link_used_cross'), ('link_active_cross'), ('link_active_same'), ('link_expired_same');

INSERT INTO public.organizations(id, name)
SELECT id, 'CB synthetic ' || name
FROM pg_temp.cb_ids
WHERE name IN ('org_a', 'org_b', 'org_c', 'org_d');

INSERT INTO public.parties (
  id, org_id, party_type, name, first_name, last_name, email, phone_office, address_line1,
  city, state, postal_code, created_by
)
SELECT id, org_id, 'person', party_name, first_name, last_name, email,
       '303-555-0100', '1 Synthetic Way', 'Denver', 'CO', '80202',
       (SELECT id FROM pg_temp.cb_ids WHERE name = 'actor')
FROM (
  SELECT
    party.id,
    org.id,
    p.party_name,
    p.first_name,
    p.last_name,
    p.email
  FROM (
    VALUES
      ('party_used_cross', 'org_b', 'Used Cross Contact', 'Used', 'Cross', 'used-cross@example.test'),
      ('party_active_cross', 'org_b', 'Active Cross Contact', 'Active', 'Cross', 'active-cross@example.test'),
      ('party_active_same', 'org_c', 'Same Org Contact', 'Same', 'Org', 'same-org@example.test'),
      ('party_expired_same', 'org_d', 'Expired Contact', 'Expired', 'Same', 'expired@example.test')
  ) AS p(name, org_name, party_name, first_name, last_name, email)
  JOIN pg_temp.cb_ids party ON party.name = p.name
  JOIN pg_temp.cb_ids org ON org.name = p.org_name
) AS seeded(id, org_id, party_name, first_name, last_name, email);

INSERT INTO public.party_role_assignments (org_id, party_id, role_key, scope_type, is_default)
SELECT org.id, party.id, 'owner', 'org', false
FROM (
  VALUES
    ('org_b', 'party_used_cross'),
    ('org_b', 'party_active_cross'),
    ('org_c', 'party_active_same'),
    ('org_d', 'party_expired_same')
) AS seeded(org_name, party_name)
JOIN pg_temp.cb_ids org ON org.name = seeded.org_name
JOIN pg_temp.cb_ids party ON party.name = seeded.party_name;

INSERT INTO public.party_capture_links (
  id, org_id, party_id, recipient_email, token_hash, state, expires_at, created_by
)
SELECT link.id, org.id, party.id, seeded.email,
       encode(sha256(convert_to(seeded.token, 'UTF8')), 'hex'),
       seeded.state, seeded.expires_at, actor.id
FROM (
  VALUES
    ('link_used_cross', 'org_a', 'party_used_cross', 'used-cross@example.test', 'cb-used-cross-token', 'used', now() - interval '1 hour'),
    ('link_active_cross', 'org_a', 'party_active_cross', 'active-cross@example.test', 'cb-active-cross-token', 'active', now() + interval '1 hour'),
    ('link_active_same', 'org_c', 'party_active_same', 'same-org@example.test', 'cb-active-same-token', 'active', now() + interval '1 hour'),
    ('link_expired_same', 'org_d', 'party_expired_same', 'expired@example.test', 'cb-expired-same-token', 'active', now() - interval '1 hour')
) AS seeded(link_name, org_name, party_name, email, token, state, expires_at)
JOIN pg_temp.cb_ids link ON link.name = seeded.link_name
JOIN pg_temp.cb_ids org ON org.name = seeded.org_name
JOIN pg_temp.cb_ids party ON party.name = seeded.party_name
JOIN pg_temp.cb_ids actor ON actor.name = 'actor';

DO $$
DECLARE
  ids jsonb := (SELECT jsonb_object_agg(name, id) FROM pg_temp.cb_ids);
  result jsonb;
  before_party jsonb;
  before_link jsonb;
  before_audit jsonb;
  after_party jsonb;
  after_link jsonb;
  after_audit jsonb;
  terminal_state text;
  payload jsonb := jsonb_build_object(
    'name', 'Updated Synthetic Contact',
    'first_name', 'Updated',
    'last_name', 'Synthetic',
    'title', 'Practice Manager',
    'phone_extension', '123',
    'fax', '303-555-0198',
    'email', 'updated@example.test',
    'phone_office', '303-555-0199',
    'address_line1', '2 Synthetic Way',
    'city', 'Denver',
    'state', 'CO',
    'postal_code', '80203'
  );
BEGIN
  -- A historical used link with a cross-org party is denied without leaking
  -- terminal details or changing the party, link, or audit log.
  before_party := pg_temp.cb_party_snapshot((ids->>'party_used_cross')::uuid);
  before_link := pg_temp.cb_link_snapshot((ids->>'link_used_cross')::uuid);
  before_audit := pg_temp.cb_audit_snapshot();
  SET LOCAL ROLE anon;
  result := public.validate_capture_token('cb-used-cross-token');
  RESET ROLE;
  PERFORM pg_temp.cb_assert(
    'used_cross_org.validate_exact_invalid',
    result = jsonb_build_object('state', 'invalid')
  );
  SET LOCAL ROLE anon;
  result := public.submit_capture('cb-used-cross-token', payload);
  RESET ROLE;
  PERFORM pg_temp.cb_assert(
    'used_cross_org.submit_exact_invalid',
    result = jsonb_build_object('ok', false, 'state', 'invalid')
  );
  after_party := pg_temp.cb_party_snapshot((ids->>'party_used_cross')::uuid);
  after_link := pg_temp.cb_link_snapshot((ids->>'link_used_cross')::uuid);
  after_audit := pg_temp.cb_audit_snapshot();
  PERFORM pg_temp.cb_assert('used_cross_org.party_unchanged', before_party = after_party);
  PERFORM pg_temp.cb_assert('used_cross_org.link_unchanged', before_link = after_link);
  PERFORM pg_temp.cb_assert('used_cross_org.audit_unchanged', before_audit = after_audit);

  FOREACH terminal_state IN ARRAY ARRAY['expired', 'revoked'] LOOP
    UPDATE public.party_capture_links SET state = terminal_state
     WHERE id = (ids->>'link_used_cross')::uuid;
    before_link := pg_temp.cb_link_snapshot((ids->>'link_used_cross')::uuid);
    SET LOCAL ROLE authenticated;
    result := public.validate_capture_token('cb-used-cross-token');
    RESET ROLE;
    PERFORM pg_temp.cb_assert(terminal_state || '_cross_org.validate_exact_invalid', result = jsonb_build_object('state', 'invalid'));
    SET LOCAL ROLE authenticated;
    result := public.submit_capture('cb-used-cross-token', payload);
    RESET ROLE;
    PERFORM pg_temp.cb_assert(terminal_state || '_cross_org.submit_exact_invalid', result = jsonb_build_object('ok', false, 'state', 'invalid'));
    PERFORM pg_temp.cb_assert(terminal_state || '_cross_org.rows_unchanged',
      pg_temp.cb_party_snapshot((ids->>'party_used_cross')::uuid) = before_party
      AND pg_temp.cb_link_snapshot((ids->>'link_used_cross')::uuid) = before_link
      AND pg_temp.cb_audit_snapshot() = before_audit);
  END LOOP;

  -- Active mismatches must deny both public calls without any contact data.
  before_party := pg_temp.cb_party_snapshot((ids->>'party_active_cross')::uuid);
  before_link := pg_temp.cb_link_snapshot((ids->>'link_active_cross')::uuid);
  before_audit := pg_temp.cb_audit_snapshot();
  SET LOCAL ROLE anon;
  result := public.validate_capture_token('cb-active-cross-token');
  RESET ROLE;
  PERFORM pg_temp.cb_assert('active_cross_org.validate_exact_invalid', result = jsonb_build_object('state', 'invalid'));
  SET LOCAL ROLE anon;
  result := public.submit_capture('cb-active-cross-token', payload);
  RESET ROLE;
  PERFORM pg_temp.cb_assert('active_cross_org.submit_exact_invalid', result = jsonb_build_object('ok', false, 'state', 'invalid'));
  PERFORM pg_temp.cb_assert('active_cross_org.rows_unchanged',
    pg_temp.cb_party_snapshot((ids->>'party_active_cross')::uuid) = before_party
    AND pg_temp.cb_link_snapshot((ids->>'link_active_cross')::uuid) = before_link
    AND pg_temp.cb_audit_snapshot() = before_audit);

  SET LOCAL ROLE anon;
  result := public.validate_capture_token(NULL);
  RESET ROLE;
  PERFORM pg_temp.cb_assert('null_token.invalid', result = jsonb_build_object('state', 'invalid'));
  SET LOCAL ROLE anon;
  result := public.submit_capture('missing-token', payload);
  RESET ROLE;
  PERFORM pg_temp.cb_assert('missing_token.invalid', result = jsonb_build_object('ok', false, 'state', 'invalid'));

  -- A same-org active link validates without exposing unrelated rows and can
  -- submit exactly once, changing one party, one link, and one audit row.
  before_party := pg_temp.cb_party_snapshot((ids->>'party_active_same')::uuid);
  before_link := pg_temp.cb_link_snapshot((ids->>'link_active_same')::uuid);
  before_audit := pg_temp.cb_audit_snapshot();
  SET LOCAL ROLE anon;
  result := public.validate_capture_token('cb-active-same-token');
  RESET ROLE;
  PERFORM pg_temp.cb_assert(
    'same_org.active_validate',
    result->>'state' = 'active'
      AND result->>'org_name' = 'CB synthetic org_c'
      AND result->>'recipient_name' = 'Same Org Contact'
      AND NOT (result ? 'party_id')
  );
  SET LOCAL ROLE authenticated;
  result := public.submit_capture('cb-active-same-token', payload);
  RESET ROLE;
  PERFORM pg_temp.cb_assert(
    'same_org.active_submit',
    result = jsonb_build_object('ok', true, 'state', 'used')
  );
  SELECT pg_temp.cb_party_snapshot((ids->>'party_active_same')::uuid)
    INTO after_party;
  SELECT pg_temp.cb_link_snapshot((ids->>'link_active_same')::uuid)
    INTO after_link;
  SELECT pg_temp.cb_audit_snapshot() INTO after_audit;
  PERFORM pg_temp.cb_assert(
    'same_org.active_submit_mutations',
    (after_party->>'name') = 'Updated Synthetic Contact'
      AND (after_party->>'email') = 'updated@example.test'
      AND (after_party->>'first_name') = 'Updated'
      AND (after_party->>'last_name') = 'Synthetic'
      AND (after_party->>'title') = 'Practice Manager'
      AND (after_party->>'phone_extension') = '123'
      AND (after_party->>'fax') = '303-555-0198'
      AND (after_link->>'state') = 'used'
      AND (after_link->>'used_at') IS NOT NULL
      AND (after_audit->>'count')::bigint = (before_audit->>'count')::bigint + 1
  );
  PERFORM pg_temp.cb_assert('same_org.active_party_was_changed', before_party <> after_party);
  PERFORM pg_temp.cb_assert('same_org.active_link_was_changed', before_link <> after_link);

  before_party := pg_temp.cb_party_snapshot((ids->>'party_active_same')::uuid);
  before_audit := pg_temp.cb_audit_snapshot();
  SET LOCAL ROLE authenticated;
  result := public.submit_capture('cb-active-same-token', payload);
  RESET ROLE;
  PERFORM pg_temp.cb_assert('same_org.replay_denied', result = jsonb_build_object('ok', false, 'state', 'used'));
  PERFORM pg_temp.cb_assert('same_org.replay_unchanged',
    pg_temp.cb_party_snapshot((ids->>'party_active_same')::uuid) = before_party
    AND pg_temp.cb_audit_snapshot() = before_audit);

  -- Same-org expiry keeps the terminal response and changes only the link
  -- state. A subsequent submit remains terminal and cannot write the party.
  before_party := pg_temp.cb_party_snapshot((ids->>'party_expired_same')::uuid);
  before_audit := pg_temp.cb_audit_snapshot();
  SET LOCAL ROLE anon;
  result := public.validate_capture_token('cb-expired-same-token');
  RESET ROLE;
  PERFORM pg_temp.cb_assert(
    'same_org.expired_validate',
    result->>'state' = 'expired'
      AND result->>'org_name' = 'CB synthetic org_d'
      AND result->>'recipient_name' = 'Expired Contact'
      AND NOT (result ? 'current')
  );
  PERFORM pg_temp.cb_assert(
    'same_org.expired_link_state',
    (pg_temp.cb_link_snapshot((ids->>'link_expired_same')::uuid)->>'state') = 'expired'
  );
  SET LOCAL ROLE anon;
  result := public.submit_capture('cb-expired-same-token', payload);
  RESET ROLE;
  PERFORM pg_temp.cb_assert(
    'same_org.expired_submit_terminal',
    result = jsonb_build_object('ok', false, 'state', 'expired')
  );
  PERFORM pg_temp.cb_assert(
    'same_org.expired_no_party_or_audit_write',
    pg_temp.cb_party_snapshot((ids->>'party_expired_same')::uuid) = before_party
      AND pg_temp.cb_audit_snapshot() = before_audit
  );

  -- The correction must expose only its two public RPCs. Service role access
  -- and direct helper access are not implicit caller grants.
  PERFORM pg_temp.cb_assert(
    'acl.anon_submit',
    has_function_privilege('anon', 'public.submit_capture(text,jsonb)', 'EXECUTE')
  );
  PERFORM pg_temp.cb_assert(
    'acl.authenticated_submit',
    has_function_privilege('authenticated', 'public.submit_capture(text,jsonb)', 'EXECUTE')
  );
  PERFORM pg_temp.cb_assert(
    'acl.anon_validate',
    has_function_privilege('anon', 'public.validate_capture_token(text)', 'EXECUTE')
  );
  PERFORM pg_temp.cb_assert(
    'acl.authenticated_validate',
    has_function_privilege('authenticated', 'public.validate_capture_token(text)', 'EXECUTE')
  );
  PERFORM pg_temp.cb_assert(
    'acl.service_role_submit_denied',
    NOT has_function_privilege('service_role', 'public.submit_capture(text,jsonb)', 'EXECUTE')
  );
  PERFORM pg_temp.cb_assert(
    'acl.service_role_validate_denied',
    NOT has_function_privilege('service_role', 'public.validate_capture_token(text)', 'EXECUTE')
  );
  PERFORM pg_temp.cb_assert(
    'acl.anon_throttle_helper_denied',
    NOT has_function_privilege('anon', 'public.check_rpc_throttle(text,integer,integer,boolean)', 'EXECUTE')
  );
  PERFORM pg_temp.cb_assert(
    'acl.anon_mark_valid_helper_denied',
    NOT has_function_privilege('anon', 'public.mark_rpc_attempt_valid(text)', 'EXECUTE')
  );
END
$$;

-- Prove the permission boundary through actual calls, including the helper's
-- defaulted fourth argument; a PUBLIC grant must not rescue a denied role.
DO $$
DECLARE
  caller_role text;
  statement_sql text;
  probe_number integer;
  denied boolean;
  caller record;
BEGIN
  FOREACH caller_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    probe_number := 0;
    FOREACH statement_sql IN ARRAY ARRAY[
      $probe$SELECT public.check_rpc_throttle('cb-permission-probe', 20, 15)$probe$,
      $probe$SELECT public.check_rpc_throttle('cb-permission-probe', 20, 15, false)$probe$,
      $probe$SELECT public.mark_rpc_attempt_valid('cb-permission-probe')$probe$
    ] LOOP
      probe_number := probe_number + 1;
      denied := false;
      BEGIN
        PERFORM set_config('role', caller_role, true);
        EXECUTE statement_sql;
      EXCEPTION WHEN insufficient_privilege THEN
        denied := true;
      END;
      RESET ROLE;
      PERFORM pg_temp.cb_assert('acl.direct_' || caller_role || '_helper_' || probe_number, denied);
    END LOOP;
  END LOOP;

  probe_number := 0;
  FOREACH statement_sql IN ARRAY ARRAY[
    $probe$SELECT public.submit_capture(NULL, '{}'::jsonb)$probe$,
    $probe$SELECT public.validate_capture_token(NULL)$probe$
  ] LOOP
    probe_number := probe_number + 1;
    denied := false;
    BEGIN
      SET LOCAL ROLE service_role;
      EXECUTE statement_sql;
    EXCEPTION WHEN insufficient_privilege THEN
      denied := true;
    END;
    RESET ROLE;
    PERFORM pg_temp.cb_assert('acl.direct_service_capture_' || probe_number, denied);
  END LOOP;

  -- Existing SECURITY DEFINER consumers must retain helper access through their
  -- actual owners; do not require a caller-facing browser grant for nested calls.
  FOR caller IN
    SELECT p.proname, p.proowner
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN ('submit_capture', 'validate_capture_token', 'validate_report_share',
                       'submit_inbound_lead', 'validate_ssn_intake_token', 'submit_ssn_intake')
  LOOP
    PERFORM pg_temp.cb_assert('acl.owner_throttle_' || caller.proname,
      has_function_privilege(caller.proowner, 'public.check_rpc_throttle(text,integer,integer,boolean)'::regprocedure, 'EXECUTE'));
    IF caller.proname <> 'submit_inbound_lead' THEN
      PERFORM pg_temp.cb_assert('acl.owner_mark_valid_' || caller.proname,
        has_function_privilege(caller.proowner, 'public.mark_rpc_attempt_valid(text)'::regprocedure, 'EXECUTE'));
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  failed bigint;
BEGIN
  SELECT count(*) INTO failed FROM pg_temp.cb_results WHERE NOT passed;
  IF failed <> 0 THEN
    RAISE EXCEPTION 'CAPTURE_BOUNDARY_SECURITY_TEST_FAILED: %', (SELECT string_agg(label, ', ') FROM pg_temp.cb_results WHERE NOT passed);
  END IF;
END
$$;

SELECT 'CAPTURE_BOUNDARY_SECURITY|PASS';
ROLLBACK;
