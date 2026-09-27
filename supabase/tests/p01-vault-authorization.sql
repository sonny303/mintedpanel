-- P01 / DB-01. Run only in the runner's disposable synthetic database.
-- Identical expectations run before and after the additive P01 migration.
-- Sensitive test values remain in database memory; output is labels only.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE p01_results (ordinal bigint GENERATED ALWAYS AS IDENTITY, label text UNIQUE, passed boolean NOT NULL);
CREATE TEMP TABLE p01_ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());

CREATE FUNCTION pg_temp.p01_assert(p_label text, p_condition boolean)
RETURNS void LANGUAGE sql SECURITY INVOKER AS $$
  INSERT INTO pg_temp.p01_results (label, passed) VALUES (p_label, coalesce(p_condition, false));
$$;

-- Called only as the fixture owner, outside the tested role boundary.
CREATE FUNCTION pg_temp.p01_snapshot()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
  SELECT jsonb_build_object(
    'vault', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY provider_id), '[]') FROM public.provider_ssn_vault t),
    'links', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), '[]') FROM public.provider_ssn_intake_links t),
    'providers', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), '[]') FROM public.providers t),
    'audit', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), '[]') FROM public.audit_log t)
  );
$$;

-- SECURITY INVOKER is essential: this helper must never elevate a tested call.
-- Its exception block catches actual SQL failures only. A successful forbidden
-- write is NOT rolled back: the caller compares its persisted effects first.
CREATE FUNCTION pg_temp.p01_call(p_db_role text, p_actor uuid, p_sql text, p_args jsonb DEFAULT '{}')
RETURNS TABLE(succeeded boolean, role_ok boolean, result jsonb, error_code text, error_message text)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_actor::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_db_role);
  role_ok := current_user::text = p_db_role;
  succeeded := false;
  BEGIN
    EXECUTE p_sql INTO result USING p_args;
    succeeded := true;
  EXCEPTION WHEN OTHERS THEN
    error_code := SQLSTATE;
    error_message := SQLERRM;
  END;
  RESET ROLE;
  RETURN NEXT;
END;
$$;

INSERT INTO pg_temp.p01_ids(name) VALUES
  ('org_a'), ('org_b'), ('admin_a'), ('specialist_a'), ('billing_a'),
  ('admin_b'), ('outsider'), ('multi'), ('provider_a'), ('provider_a2'),
  ('provider_b'), ('provider_empty'), ('payer_a'), ('payer_b'),
  ('case_a'), ('case_a2'), ('case_b'), ('case_empty'), ('missing');

INSERT INTO public.organizations(id, name)
SELECT id, 'P01 synthetic ' || name FROM pg_temp.p01_ids WHERE name IN ('org_a', 'org_b');
INSERT INTO auth.users(id, email, raw_user_meta_data)
SELECT id, name || '@example.test', '{}'::jsonb FROM pg_temp.p01_ids
WHERE name IN ('admin_a', 'specialist_a', 'billing_a', 'admin_b', 'outsider', 'multi');
INSERT INTO public.profiles(id, full_name, email)
SELECT id, 'P01 synthetic ' || name, name || '@example.test' FROM pg_temp.p01_ids
WHERE name IN ('admin_a', 'specialist_a', 'billing_a', 'admin_b', 'outsider', 'multi');
INSERT INTO public.memberships(org_id, user_id, role)
SELECT org.id, actor.id, seed.role FROM (VALUES
  ('org_a', 'admin_a', 'admin'), ('org_a', 'specialist_a', 'specialist'),
  ('org_a', 'billing_a', 'billing'), ('org_b', 'admin_b', 'admin'),
  ('org_a', 'multi', 'admin'), ('org_b', 'multi', 'billing')
) AS seed(org_name, actor_name, role)
JOIN pg_temp.p01_ids org ON org.name = seed.org_name
JOIN pg_temp.p01_ids actor ON actor.name = seed.actor_name;
INSERT INTO public.providers(id, org_id, first_name, last_name)
SELECT provider.id, org.id, 'Synthetic', seed.provider_name FROM (VALUES
  ('provider_a', 'org_a'), ('provider_a2', 'org_a'),
  ('provider_b', 'org_b'), ('provider_empty', 'org_a')
) AS seed(provider_name, org_name)
JOIN pg_temp.p01_ids provider ON provider.name = seed.provider_name
JOIN pg_temp.p01_ids org ON org.name = seed.org_name;
INSERT INTO public.payers(id, org_id, name)
SELECT payer.id, org.id, 'P01 synthetic payer' FROM (VALUES
  ('payer_a', 'org_a'), ('payer_b', 'org_b')
) AS seed(payer_name, org_name)
JOIN pg_temp.p01_ids payer ON payer.name = seed.payer_name
JOIN pg_temp.p01_ids org ON org.name = seed.org_name;
INSERT INTO public.credential_cases(id, org_id, provider_id, payer_id, state)
SELECT c.id, org.id, provider.id, payer.id, 'CO' FROM (VALUES
  ('case_a', 'org_a', 'provider_a', 'payer_a'),
  ('case_a2', 'org_a', 'provider_a2', 'payer_a'),
  ('case_b', 'org_b', 'provider_b', 'payer_b'),
  ('case_empty', 'org_a', 'provider_empty', 'payer_a')
) AS seed(case_name, org_name, provider_name, payer_name)
JOIN pg_temp.p01_ids c ON c.name = seed.case_name
JOIN pg_temp.p01_ids org ON org.name = seed.org_name
JOIN pg_temp.p01_ids provider ON provider.name = seed.provider_name
JOIN pg_temp.p01_ids payer ON payer.name = seed.payer_name;

DO $$
DECLARE
  ids jsonb := (SELECT jsonb_object_agg(name, id) FROM pg_temp.p01_ids);
  fake text := '9' || repeat('0', 8);
  alternate text := '9' || repeat('1', 8);
  key_value text := encode(extensions.gen_random_bytes(32), 'hex');
  before_state jsonb;
  before_audit bigint;
  r record;
  c record;
  op record;
  args jsonb;
  expected text;
  actor uuid;
  provider uuid;
  token_value text;
  prior_token text;
  issued_tokens text[] := '{}';
  computed_hash text;
  link_id uuid;
  keyless_state jsonb;
  other_providers jsonb;
  other_vault jsonb;
BEGIN
  PERFORM set_config('app.settings.ssn_vault_key', key_value, true);

  -- Membership is the actual production SECURITY DEFINER query, not a mock.
  FOR c IN SELECT * FROM (VALUES
    ('admin_a', 'org_a', 'admin'), ('specialist_a', 'org_a', 'specialist'),
    ('billing_a', 'org_a', 'billing'), ('outsider', 'org_a', NULL),
    ('admin_b', 'org_a', NULL), ('multi', 'org_a', 'admin'), ('multi', 'org_b', 'billing')
  ) AS cases(actor_name, org_name, expected_role) LOOP
    SELECT * INTO r FROM pg_temp.p01_call('authenticated', (ids->>c.actor_name)::uuid,
      'SELECT to_jsonb(public.user_role(($1->>''org'')::uuid))', jsonb_build_object('org', ids->>c.org_name));
    PERFORM pg_temp.p01_assert('membership.' || c.actor_name || '.' || c.org_name,
      r.role_ok AND r.succeeded AND r.result IS NOT DISTINCT FROM to_jsonb(c.expected_role));
  END LOOP;

  -- Positive ingress controls also create encrypted values for denial/reveal cases.
  FOR c IN SELECT * FROM (VALUES
    ('admin_a', 'provider_a', 'org_a'), ('specialist_a', 'provider_a2', 'org_a'),
    ('admin_b', 'provider_b', 'org_b'), ('multi', 'provider_a', 'org_a')
  ) AS cases(actor_name, provider_name, org_name) LOOP
    actor := (ids->>c.actor_name)::uuid;
    provider := (ids->>c.provider_name)::uuid;
    SELECT count(*) INTO before_audit FROM public.audit_log;
    SELECT * INTO r FROM pg_temp.p01_call('authenticated', actor,
      'SELECT public.store_ssn(($1->>''provider'')::uuid, $1->>''value'')',
      jsonb_build_object('provider', provider, 'value', fake));
    PERFORM pg_temp.p01_assert('store.allowed.' || c.actor_name,
      r.role_ok AND r.succeeded AND r.result = jsonb_build_object('ok', true, 'ssn_last4', right(fake, 4), 'mask', '***--' || right(fake, 4))
      AND EXISTS (SELECT 1 FROM public.providers WHERE id = provider AND ssn_last4 = right(fake, 4))
      AND EXISTS (SELECT 1 FROM public.provider_ssn_vault WHERE provider_id = provider AND org_id = (ids->>c.org_name)::uuid
        AND ssn_ciphertext <> convert_to(fake, 'UTF8') AND updated_by = actor)
      AND (SELECT count(*) = before_audit + 1 FROM public.audit_log)
      AND EXISTS (SELECT 1 FROM public.audit_log WHERE entity_id = provider AND user_id = actor
        AND org_id = (ids->>c.org_name)::uuid AND action_type = 'UPDATE' AND entity_type = 'provider_ssn_vault'));
  END LOOP;

  -- Denied issuance must preserve a real, already active recipient link.
  FOR c IN SELECT * FROM (VALUES
    ('admin_a', 'provider_a'), ('admin_b', 'provider_b')
  ) AS cases(actor_name, provider_name) LOOP
    SELECT * INTO r FROM pg_temp.p01_call('authenticated', (ids->>c.actor_name)::uuid,
      'SELECT public.create_ssn_intake_link(($1->>''provider'')::uuid, ''recipient@example.test'', NULL)',
      jsonb_build_object('provider', ids->>c.provider_name));
    issued_tokens := array_append(issued_tokens, r.result->>'token');
    PERFORM pg_temp.p01_assert('issue.active_before_denials.' || c.provider_name, r.role_ok AND r.succeeded
      AND EXISTS (SELECT 1 FROM public.provider_ssn_intake_links WHERE provider_id = (ids->>c.provider_name)::uuid AND state = 'active'));
  END LOOP;

  -- Every denied operator case checks all four persistent surfaces BEFORE any
  -- cleanup. A baseline null-role bypass therefore remains visible and fails.
  FOR c IN SELECT * FROM (VALUES
    ('nonmember', 'outsider', 'provider_a', 'authenticated'),
    ('wrong_org', 'admin_b', 'provider_a', 'authenticated'),
    ('billing', 'billing_a', 'provider_a', 'authenticated'),
    ('multi_target_billing', 'multi', 'provider_b', 'authenticated'),
    ('missing_subject', NULL, 'provider_a', 'authenticated'),
    ('anon', NULL, 'provider_a', 'anon'),
    ('missing_provider', 'admin_a', 'missing', 'authenticated'),
    ('null_provider', 'admin_a', NULL, 'authenticated')
  ) AS cases(label, actor_name, provider_name, db_role) LOOP
    FOR op IN SELECT * FROM (VALUES
      ('store', 'SELECT public.store_ssn(($1->>''provider'')::uuid, $1->>''value'')', 'Not authorized to store an SSN for this provider'),
      ('reveal', 'SELECT public.reveal_ssn(($1->>''provider'')::uuid, ''P01 synthetic purpose'')', 'Only an administrator can reveal a full SSN'),
      ('issue', 'SELECT public.create_ssn_intake_link(($1->>''provider'')::uuid, ''recipient@example.test'', NULL)', 'Not authorized to issue an SSN intake link for this provider')
    ) AS operations(label, sql_text, denial_message) LOOP
      before_state := pg_temp.p01_snapshot();
      args := jsonb_build_object('provider', ids->>c.provider_name, 'value', alternate);
      expected := CASE WHEN c.label = 'missing_subject' THEN 'Not authenticated'
        WHEN c.label IN ('missing_provider', 'null_provider') THEN 'Provider not found'
        ELSE op.denial_message END;
      SELECT * INTO r FROM pg_temp.p01_call(c.db_role, (ids->>c.actor_name)::uuid, op.sql_text, args);
      IF r.result ? 'token' THEN issued_tokens := array_append(issued_tokens, r.result->>'token'); END IF;
      PERFORM pg_temp.p01_assert('deny.' || c.label || '.' || op.label,
        r.role_ok AND NOT r.succeeded
        AND ((c.db_role = 'anon' AND r.error_code = '42501')
          OR (c.db_role = 'authenticated' AND r.error_code = 'P0001' AND r.error_message = expected))
        AND before_state = pg_temp.p01_snapshot());
    END LOOP;
  END LOOP;

  before_state := pg_temp.p01_snapshot();
  SELECT * INTO r FROM pg_temp.p01_call('authenticated', (ids->>'admin_a')::uuid,
    'SELECT public.store_ssn(($1->>''provider'')::uuid, ''bad synthetic value'')', jsonb_build_object('provider', ids->>'provider_a'));
  PERFORM pg_temp.p01_assert('store.invalid_value_atomic', r.role_ok AND NOT r.succeeded
    AND r.error_code = 'P0001' AND r.error_message = 'A valid 9-digit Social Security Number is required'
    AND before_state = pg_temp.p01_snapshot());

  before_state := pg_temp.p01_snapshot();
  SELECT * INTO r FROM pg_temp.p01_call('authenticated', (ids->>'admin_a')::uuid,
    'SELECT public.reveal_ssn(($1->>''provider'')::uuid, ''P01 synthetic purpose'')', jsonb_build_object('provider', ids->>'provider_empty'));
  PERFORM pg_temp.p01_assert('reveal.missing_vault', r.role_ok AND NOT r.succeeded
    AND r.error_code = 'P0001' AND r.error_message = 'No SSN on file for this provider'
    AND before_state = pg_temp.p01_snapshot());

  -- Restore the intended value through the real allowed boundary after baseline
  -- defect probes. This happens only AFTER their side effects were assessed.
  SELECT * INTO r FROM pg_temp.p01_call('authenticated', (ids->>'admin_a')::uuid,
    'SELECT public.store_ssn(($1->>''provider'')::uuid, $1->>''value'')',
    jsonb_build_object('provider', ids->>'provider_a', 'value', fake));
  PERFORM pg_temp.p01_assert('store.positive_after_denials', r.role_ok AND r.succeeded);

  FOR c IN SELECT * FROM (VALUES ('null', NULL), ('empty', ''), ('whitespace', '   ')) AS cases(label, justification) LOOP
    before_state := pg_temp.p01_snapshot();
    SELECT * INTO r FROM pg_temp.p01_call('authenticated', (ids->>'admin_a')::uuid,
      'SELECT public.reveal_ssn(($1->>''provider'')::uuid, $1->>''justification'')',
      jsonb_build_object('provider', ids->>'provider_a', 'justification', c.justification));
    PERFORM pg_temp.p01_assert('reveal.justification.' || c.label,
      r.role_ok AND NOT r.succeeded AND r.error_code = 'P0001'
      AND r.error_message = 'A justification is required to reveal a full SSN'
      AND before_state = pg_temp.p01_snapshot());
  END LOOP;

  before_state := pg_temp.p01_snapshot();
  SELECT * INTO r FROM pg_temp.p01_call('authenticated', (ids->>'specialist_a')::uuid,
    'SELECT public.reveal_ssn(($1->>''provider'')::uuid, ''P01 synthetic purpose'')', jsonb_build_object('provider', ids->>'provider_a'));
  PERFORM pg_temp.p01_assert('reveal.specialist_denied', r.role_ok AND NOT r.succeeded
    AND r.error_code = 'P0001' AND r.error_message = 'Only an administrator can reveal a full SSN'
    AND before_state = pg_temp.p01_snapshot());

  FOR c IN SELECT * FROM (VALUES ('admin_a'), ('multi')) AS cases(actor_name) LOOP
    SELECT count(*) INTO before_audit FROM public.audit_log;
    SELECT * INTO r FROM pg_temp.p01_call('authenticated', (ids->>c.actor_name)::uuid,
      'SELECT public.reveal_ssn(($1->>''provider'')::uuid, ''  P01 synthetic purpose  '')', jsonb_build_object('provider', ids->>'provider_a'));
    PERFORM pg_temp.p01_assert('reveal.allowed.' || c.actor_name,
      r.role_ok AND r.succeeded AND r.result = jsonb_build_object('ssn', fake, 'ssn_last4', right(fake, 4))
      AND (SELECT count(*) = before_audit + 1 FROM public.audit_log)
      AND EXISTS (SELECT 1 FROM public.audit_log WHERE entity_id = (ids->>'provider_a')::uuid
        AND user_id = (ids->>c.actor_name)::uuid AND org_id = (ids->>'org_a')::uuid AND action_type = 'READ'
        AND entity_type = 'provider_ssn_vault' AND after = jsonb_build_object('justification', 'P01 synthetic purpose')));
  END LOOP;

  -- Grant checks execute actual calls, including helpers that expose plaintext
  -- or accept caller-chosen organization/actor parameters if ever made public.
  FOR c IN SELECT * FROM (VALUES ('anon', NULL::text), ('authenticated', 'admin_a')) AS roles(db_role, actor_name) LOOP
    FOR op IN SELECT * FROM (VALUES
      ('vault_select', 'SELECT to_jsonb(v) FROM public.provider_ssn_vault v LIMIT 1'),
      ('vault_insert', 'WITH changed AS (INSERT INTO public.provider_ssn_vault(provider_id, org_id, ssn_ciphertext) VALUES (($1->>''provider'')::uuid, ($1->>''org'')::uuid, decode('''', ''hex'')) RETURNING provider_id) SELECT to_jsonb(count(*)) FROM changed'),
      ('vault_update', 'WITH changed AS (UPDATE public.provider_ssn_vault SET updated_at = now() RETURNING provider_id) SELECT to_jsonb(count(*)) FROM changed'),
      ('vault_delete', 'WITH changed AS (DELETE FROM public.provider_ssn_vault RETURNING provider_id) SELECT to_jsonb(count(*)) FROM changed'),
      ('link_update', 'WITH changed AS (UPDATE public.provider_ssn_intake_links SET state = ''revoked'' RETURNING id) SELECT to_jsonb(count(*)) FROM changed'),
      ('link_delete', 'WITH changed AS (DELETE FROM public.provider_ssn_intake_links RETURNING id) SELECT to_jsonb(count(*)) FROM changed'),
      ('key', 'SELECT to_jsonb(public._ssn_vault_key())'),
      ('digits', 'SELECT to_jsonb(public._ssn_digits($1->>''value''))'),
      ('encrypt', 'SELECT to_jsonb(public._ssn_encrypt($1->>''value''))'),
      ('decrypt', 'SELECT to_jsonb(public._ssn_decrypt(decode('''', ''hex'')))'),
      ('upsert', 'SELECT to_jsonb(public._ssn_vault_upsert(($1->>''provider'')::uuid, ($1->>''org'')::uuid, $1->>''value'', ($1->>''actor'')::uuid))'),
      ('throttle', 'SELECT to_jsonb(public.check_rpc_throttle(''p01'', 20, 15))'),
      ('mark_valid', 'SELECT to_jsonb(public.mark_rpc_attempt_valid(''p01''))'),
      ('fill', 'SELECT public.release_ssn_for_fill(($1->>''provider'')::uuid, ($1->>''org'')::uuid, ($1->>''case'')::uuid)')
    ) AS operations(label, sql_text) LOOP
      before_state := pg_temp.p01_snapshot();
      SELECT * INTO r FROM pg_temp.p01_call(c.db_role, (ids->>c.actor_name)::uuid, op.sql_text,
        jsonb_build_object('provider', ids->>'provider_a', 'org', ids->>'org_a', 'case', ids->>'case_a', 'actor', ids->>'admin_a', 'value', fake));
      PERFORM pg_temp.p01_assert('grant.' || c.db_role || '.' || op.label,
        r.role_ok AND NOT r.succeeded AND r.error_code = '42501' AND before_state = pg_temp.p01_snapshot());
    END LOOP;
  END LOOP;

  SELECT * INTO r FROM pg_temp.p01_call('service_role', NULL, 'SELECT jsonb_build_object(''uid_is_null'', auth.uid() IS NULL)');
  PERFORM pg_temp.p01_assert('fill.service_without_subject', r.role_ok AND r.succeeded AND r.result = '{"uid_is_null":true}'::jsonb);

  FOR c IN SELECT * FROM (VALUES
    ('valid', 'provider_a', 'org_a', 'case_a', true),
    ('wrong_org', 'provider_a', 'org_b', 'case_a', false),
    ('wrong_provider', 'provider_a2', 'org_a', 'case_a', false),
    ('wrong_case', 'provider_a', 'org_a', 'case_b', false),
    ('missing_case', 'provider_a', 'org_a', 'missing', false),
    ('missing_vault', 'provider_empty', 'org_a', 'case_empty', false),
    ('null_case', 'provider_a', 'org_a', NULL, false),
    ('null_org', 'provider_a', NULL, 'case_a', false),
    ('null_provider', NULL, 'org_a', 'case_a', false)
  ) AS cases(label, provider_name, org_name, case_name, allowed) LOOP
    before_state := pg_temp.p01_snapshot();
    SELECT * INTO r FROM pg_temp.p01_call('service_role', NULL,
      'SELECT public.release_ssn_for_fill(($1->>''provider'')::uuid, ($1->>''org'')::uuid, ($1->>''case'')::uuid)',
      jsonb_build_object('provider', ids->>c.provider_name, 'org', ids->>c.org_name, 'case', ids->>c.case_name));
    PERFORM pg_temp.p01_assert('fill.service.' || c.label,
      r.role_ok AND CASE WHEN c.allowed THEN r.succeeded AND r.result = jsonb_build_object('ssn', fake, 'ssn_last4', right(fake, 4))
        ELSE NOT r.succeeded AND r.error_code = 'P0001' AND r.error_message = CASE WHEN c.label = 'missing_vault'
          THEN 'No SSN on file for this provider' ELSE 'SSN release requires an active fill context' END END
      AND before_state = pg_temp.p01_snapshot());
  END LOOP;

  -- A missing key is a genuine crypto failure, never an authorization pass.
  keyless_state := pg_temp.p01_snapshot();
  PERFORM set_config('app.settings.ssn_vault_key', '', true);
  SELECT * INTO r FROM pg_temp.p01_call('authenticated', (ids->>'admin_a')::uuid,
    'SELECT public.store_ssn(($1->>''provider'')::uuid, $1->>''value'')',
    jsonb_build_object('provider', ids->>'provider_a', 'value', alternate));
  PERFORM pg_temp.p01_assert('crypto.missing_key_fails_closed', r.role_ok AND NOT r.succeeded
    AND r.error_code = 'P0001' AND r.error_message = 'SSN vault key is not configured'
    AND keyless_state = pg_temp.p01_snapshot());
  PERFORM set_config('app.settings.ssn_vault_key', key_value, true);

  -- Issue as each permitted writer. Verify hashed-only persistence, expiry,
  -- provider scope, attribution, and reissue revocation using real RPC results.
  FOR c IN SELECT * FROM (VALUES ('admin_a'), ('specialist_a'), ('multi')) AS cases(actor_name) LOOP
    actor := (ids->>c.actor_name)::uuid;
    SELECT count(*) INTO before_audit FROM public.audit_log;
    SELECT * INTO r FROM pg_temp.p01_call('authenticated', actor,
      'SELECT public.create_ssn_intake_link(($1->>''provider'')::uuid, ''recipient@example.test'', ''Synthetic recipient'')',
      jsonb_build_object('provider', ids->>'provider_a2'));
    token_value := r.result->>'token';
    issued_tokens := array_append(issued_tokens, token_value);
    computed_hash := encode(sha256(convert_to(token_value, 'UTF8')), 'hex');
    SELECT id INTO link_id FROM public.provider_ssn_intake_links WHERE token_hash = computed_hash AND provider_id = (ids->>'provider_a2')::uuid AND state = 'active';
    PERFORM pg_temp.p01_assert('issue.allowed.' || c.actor_name, r.role_ok AND r.succeeded
      AND length(token_value) = 64 AND r.result->>'provider_id' = ids->>'provider_a2'
      AND EXISTS (SELECT 1 FROM public.provider_ssn_intake_links l WHERE l.id = link_id
        AND l.token_hash = computed_hash AND l.token_hash <> token_value AND l.org_id = (ids->>'org_a')::uuid
        AND l.created_by = actor AND l.expires_at = now() + interval '72 hours')
      AND (SELECT count(*) = before_audit + 1 FROM public.audit_log)
      AND EXISTS (SELECT 1 FROM public.audit_log WHERE entity_id = link_id AND user_id = actor AND action_type = 'CREATE'));
    IF prior_token IS NOT NULL THEN
      SELECT * INTO r FROM pg_temp.p01_call('anon', NULL, 'SELECT public.validate_ssn_intake_token($1->>''token'')', jsonb_build_object('token', prior_token));
      PERFORM pg_temp.p01_assert('token.reissue_revokes_prior.' || c.actor_name, r.role_ok AND r.succeeded AND r.result->>'state' = 'revoked');
    END IF;
    prior_token := token_value;
  END LOOP;

  SELECT * INTO r FROM pg_temp.p01_call('anon', NULL, 'SELECT public.validate_ssn_intake_token($1->>''token'')', jsonb_build_object('token', token_value));
  PERFORM pg_temp.p01_assert('token.valid_context', r.role_ok AND r.succeeded AND r.result = jsonb_build_object(
    'state', 'active', 'org_name', 'P01 synthetic org_a', 'provider_name', 'Synthetic provider_a2',
    'recipient_email', 'recipient@example.test', 'expires_at', now() + interval '72 hours'));

  before_state := pg_temp.p01_snapshot();
  SELECT * INTO r FROM pg_temp.p01_call('anon', NULL, 'SELECT public.submit_ssn_intake($1->>''token'', $1->>''value'')',
    jsonb_build_object('token', token_value, 'value', 'bad synthetic value'));
  PERFORM pg_temp.p01_assert('token.invalid_value_atomic', r.role_ok AND NOT r.succeeded AND r.error_code = 'P0001'
    AND r.error_message = 'A valid 9-digit Social Security Number is required' AND before_state = pg_temp.p01_snapshot());

  SELECT count(*) INTO before_audit FROM public.audit_log;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY id) INTO other_providers FROM public.providers p WHERE id <> (ids->>'provider_a2')::uuid;
  SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY provider_id), '[]') INTO other_vault FROM public.provider_ssn_vault v WHERE provider_id <> (ids->>'provider_a2')::uuid;
  SELECT * INTO r FROM pg_temp.p01_call('anon', NULL, 'SELECT public.submit_ssn_intake($1->>''token'', $1->>''value'')',
    jsonb_build_object('token', token_value, 'value', alternate));
  PERFORM pg_temp.p01_assert('token.submit_once', r.role_ok AND r.succeeded
    AND r.result = jsonb_build_object('ok', true, 'state', 'used', 'mask', '***--' || right(alternate, 4))
    AND EXISTS (SELECT 1 FROM public.provider_ssn_intake_links WHERE id = link_id AND state = 'used' AND used_at IS NOT NULL)
    AND EXISTS (SELECT 1 FROM public.providers WHERE id = (ids->>'provider_a2')::uuid AND ssn_last4 = right(alternate, 4))
    AND EXISTS (SELECT 1 FROM public.provider_ssn_vault WHERE provider_id = (ids->>'provider_a2')::uuid AND updated_by = (ids->>'multi')::uuid)
    AND other_providers = (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.providers p WHERE id <> (ids->>'provider_a2')::uuid)
    AND other_vault = (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY provider_id), '[]') FROM public.provider_ssn_vault v WHERE provider_id <> (ids->>'provider_a2')::uuid)
    AND (SELECT count(*) = before_audit + 1 FROM public.audit_log)
    AND EXISTS (SELECT 1 FROM public.audit_log WHERE entity_id = (ids->>'provider_a2')::uuid AND user_id = (ids->>'multi')::uuid
      AND action_type = 'UPDATE' AND description = 'Full SSN captured via secure intake link'));

  SELECT * INTO r FROM pg_temp.p01_call('service_role', NULL,
    'SELECT public.release_ssn_for_fill(($1->>''provider'')::uuid, ($1->>''org'')::uuid, ($1->>''case'')::uuid)',
    jsonb_build_object('provider', ids->>'provider_a2', 'org', ids->>'org_a', 'case', ids->>'case_a2'));
  PERFORM pg_temp.p01_assert('token.encrypted_value_roundtrip', r.role_ok AND r.succeeded
    AND r.result = jsonb_build_object('ssn', alternate, 'ssn_last4', right(alternate, 4)));

  SELECT * INTO r FROM pg_temp.p01_call('anon', NULL, 'SELECT public.validate_ssn_intake_token($1->>''token'')', jsonb_build_object('token', token_value));
  PERFORM pg_temp.p01_assert('token.validate.used', r.role_ok AND r.succeeded AND r.result = jsonb_build_object(
    'state', 'used', 'org_name', 'P01 synthetic org_a', 'provider_name', 'Synthetic provider_a2'));

  FOR c IN SELECT * FROM (VALUES ('anon', NULL::text), ('authenticated', 'outsider')) AS roles(db_role, actor_name) LOOP
    before_state := pg_temp.p01_snapshot();
    SELECT * INTO r FROM pg_temp.p01_call(c.db_role, (ids->>c.actor_name)::uuid,
      'SELECT public.submit_ssn_intake($1->>''token'', $1->>''value'')', jsonb_build_object('token', token_value, 'value', fake));
    PERFORM pg_temp.p01_assert('token.used.' || c.db_role, r.role_ok AND r.succeeded
      AND r.result = jsonb_build_object('ok', false, 'state', 'used') AND before_state = pg_temp.p01_snapshot());
  END LOOP;

  FOR c IN SELECT * FROM (VALUES ('invalid', 'not-a-valid-token'), ('empty', ''), ('null', NULL)) AS cases(label, value) LOOP
    FOR op IN SELECT * FROM (VALUES
      ('validate', 'SELECT public.validate_ssn_intake_token($1->>''token'')'),
      ('submit', 'SELECT public.submit_ssn_intake($1->>''token'', $1->>''value'')')
    ) AS operations(label, sql_text) LOOP
      before_state := pg_temp.p01_snapshot();
      SELECT * INTO r FROM pg_temp.p01_call('anon', NULL, op.sql_text, jsonb_build_object('token', c.value, 'value', fake));
      PERFORM pg_temp.p01_assert('token.' || c.label || '.' || op.label,
        r.role_ok AND r.succeeded AND r.result = CASE WHEN op.label = 'validate'
          THEN jsonb_build_object('state', 'invalid') ELSE jsonb_build_object('ok', false, 'state', 'invalid') END
        AND before_state = pg_temp.p01_snapshot());
    END LOOP;
  END LOOP;

  -- Each expiry/revocation case starts with a genuinely issued token. Only the
  -- fixture owner advances its state/time; denied submissions cannot mutate it.
  FOR c IN SELECT * FROM (VALUES ('expired'), ('revoked')) AS cases(target_state) LOOP
    SELECT * INTO r FROM pg_temp.p01_call('authenticated', (ids->>'admin_a')::uuid,
      'SELECT public.create_ssn_intake_link(($1->>''provider'')::uuid, ''recipient@example.test'', NULL)', jsonb_build_object('provider', ids->>'provider_a2'));
    PERFORM pg_temp.p01_assert('token.setup.' || c.target_state, r.role_ok AND r.succeeded);
    token_value := r.result->>'token';
    issued_tokens := array_append(issued_tokens, token_value);
    IF c.target_state = 'expired' THEN
      UPDATE public.provider_ssn_intake_links SET expires_at = now() - interval '1 second'
      WHERE provider_id = (ids->>'provider_a2')::uuid AND state = 'active';
      before_state := pg_temp.p01_snapshot();
      SELECT * INTO r FROM pg_temp.p01_call('anon', NULL, 'SELECT public.submit_ssn_intake($1->>''token'', $1->>''value'')',
        jsonb_build_object('token', token_value, 'value', fake));
      PERFORM pg_temp.p01_assert('token.expired_direct_submit', r.role_ok AND r.succeeded
        AND r.result = jsonb_build_object('ok', false, 'state', 'expired')
        AND before_state - 'links' = pg_temp.p01_snapshot() - 'links'
        AND EXISTS (SELECT 1 FROM public.provider_ssn_intake_links WHERE token_hash = encode(sha256(convert_to(token_value, 'UTF8')), 'hex') AND state = 'expired'));
    ELSE
      UPDATE public.provider_ssn_intake_links SET state = 'revoked'
      WHERE provider_id = (ids->>'provider_a2')::uuid AND state = 'active';
    END IF;
    SELECT * INTO r FROM pg_temp.p01_call('anon', NULL, 'SELECT public.validate_ssn_intake_token($1->>''token'')', jsonb_build_object('token', token_value));
    PERFORM pg_temp.p01_assert('token.validate.' || c.target_state, r.role_ok AND r.succeeded AND r.result = jsonb_build_object(
      'state', c.target_state, 'org_name', 'P01 synthetic org_a', 'provider_name', 'Synthetic provider_a2'));
    before_state := pg_temp.p01_snapshot();
    SELECT * INTO r FROM pg_temp.p01_call('anon', NULL, 'SELECT public.submit_ssn_intake($1->>''token'', $1->>''value'')',
      jsonb_build_object('token', token_value, 'value', fake));
    PERFORM pg_temp.p01_assert('token.submit.' || c.target_state, r.role_ok AND r.succeeded
      AND r.result = jsonb_build_object('ok', false, 'state', c.target_state) AND before_state = pg_temp.p01_snapshot());
  END LOOP;

  -- Authenticated recipients retain the same token capability as anonymous
  -- recipients. Submission attribution remains the issuing operator's identity.
  SELECT * INTO r FROM pg_temp.p01_call('authenticated', (ids->>'admin_a')::uuid,
    'SELECT public.create_ssn_intake_link(($1->>''provider'')::uuid, ''recipient@example.test'', NULL)', jsonb_build_object('provider', ids->>'provider_a2'));
  PERFORM pg_temp.p01_assert('token.authenticated_setup', r.role_ok AND r.succeeded);
  token_value := r.result->>'token';
  issued_tokens := array_append(issued_tokens, token_value);
  SELECT jsonb_agg(to_jsonb(p) ORDER BY id) INTO other_providers FROM public.providers p WHERE id <> (ids->>'provider_a2')::uuid;
  SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY provider_id), '[]') INTO other_vault FROM public.provider_ssn_vault v WHERE provider_id <> (ids->>'provider_a2')::uuid;
  SELECT count(*) INTO before_audit FROM public.audit_log;
  SELECT * INTO r FROM pg_temp.p01_call('authenticated', (ids->>'outsider')::uuid,
    'SELECT public.submit_ssn_intake($1->>''token'', $1->>''value'')', jsonb_build_object('token', token_value, 'value', alternate));
  PERFORM pg_temp.p01_assert('token.authenticated_recipient', r.role_ok AND r.succeeded
    AND r.result = jsonb_build_object('ok', true, 'state', 'used', 'mask', '***--' || right(alternate, 4))
    AND other_providers = (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.providers p WHERE id <> (ids->>'provider_a2')::uuid)
    AND other_vault = (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY provider_id), '[]') FROM public.provider_ssn_vault v WHERE provider_id <> (ids->>'provider_a2')::uuid)
    AND (SELECT count(*) = before_audit + 1 FROM public.audit_log)
    AND EXISTS (SELECT 1 FROM public.provider_ssn_vault WHERE provider_id = (ids->>'provider_a2')::uuid AND updated_by = (ids->>'admin_a')::uuid)
    AND NOT EXISTS (SELECT 1 FROM public.audit_log WHERE user_id = (ids->>'outsider')::uuid AND description = 'Full SSN captured via secure intake link'));

  PERFORM pg_temp.p01_assert('audit.no_sensitive_values', NOT EXISTS (
    SELECT 1 FROM public.audit_log WHERE strpos(to_jsonb(audit_log)::text, fake) > 0
      OR strpos(to_jsonb(audit_log)::text, alternate) > 0
      OR strpos(to_jsonb(audit_log)::text, key_value) > 0
      OR EXISTS (SELECT 1 FROM unnest(issued_tokens) AS issued(value) WHERE strpos(to_jsonb(audit_log)::text, issued.value) > 0)
  ));
  PERFORM pg_temp.p01_assert('harness.owner_restored', current_user = session_user);
END;
$$;

SELECT 'P01|' || CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END || '|' || label FROM pg_temp.p01_results ORDER BY ordinal;
SELECT 'P01|COUNT|' || count(*) FROM pg_temp.p01_results;
ROLLBACK;
