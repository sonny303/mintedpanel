-- Smoke test for 20261025120000_provider_intake_invites.sql. Run it after the
-- migration is applied, as the postgres user (the owner of the tables and the
-- SECURITY DEFINER functions: on a local `supabase start`, or the SQL editor
-- on staging). The RPCs run as their owner, so no SET ROLE is needed:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/sql/provider-intake-smoke.sql
--
-- Everything runs in one transaction and is rolled back, so it leaves no rows.
-- Every UPDATE that moves a clock is scoped to the smoke's own rows, so a run
-- on staging never locks a real invite. Any failed check raises and stops the
-- script.
BEGIN;

DO $$
DECLARE
  v_org uuid;
  v_other_org uuid;
  v_group uuid;
  v_other_group uuid;
  v_actor uuid := gen_random_uuid();
  r jsonb;
  v_provider uuid;
  v_key bigint;
  i int;
BEGIN
  INSERT INTO public.organizations (name) VALUES ('Smoke Rehab') RETURNING id INTO v_org;
  INSERT INTO public.organizations (name) VALUES ('Other Org') RETURNING id INTO v_other_org;
  INSERT INTO public.provider_groups (org_id, name) VALUES (v_org, 'Smoke Group') RETURNING id INTO v_group;
  INSERT INTO public.provider_groups (org_id, name) VALUES (v_other_org, 'Other Group') RETURNING id INTO v_other_group;

  -- A group from another org is refused, and nothing is written.
  r := public.create_provider_intake_invite(v_org, v_actor, 'Smoke', jsonb_build_object(
    'first_name', 'Anita', 'last_name', 'Rao', 'email', 'Anita@Example.test', 'group_id', v_other_group),
    'hash-link-1', now() + interval '30 days');
  ASSERT r->>'result' = 'group_not_found', format('cross-org group: %s', r);

  -- Create: provider + primary assignment + invite + two audit rows.
  r := public.create_provider_intake_invite(v_org, v_actor, 'Smoke', jsonb_build_object(
    'first_name', 'Anita', 'last_name', 'Rao', 'email', 'Anita@Example.test', 'group_id', v_group,
    'npi', '1234567893'), 'hash-link-1', now() + interval '30 days');
  ASSERT r->>'result' = 'created', format('create: %s', r);
  v_provider := (r->>'provider_id')::uuid;
  ASSERT (SELECT status FROM public.providers WHERE id = v_provider) = 'onboarding', 'status';
  ASSERT (SELECT email FROM public.providers WHERE id = v_provider) = 'anita@example.test', 'email lowercased';
  ASSERT (SELECT count(*) FROM public.provider_group_assignments
           WHERE provider_id = v_provider AND group_id = v_group AND is_primary) = 1, 'primary assignment';
  ASSERT (SELECT count(*) FROM public.audit_log
           WHERE org_id = v_org AND entity_type IN ('provider', 'provider_intake_invite')) = 2, 'audit rows';

  -- Duplicates: same email (any case), or same NPI in the same group.
  r := public.create_provider_intake_invite(v_org, v_actor, 'Smoke', jsonb_build_object(
    'first_name', 'A', 'last_name', 'R', 'email', 'ANITA@example.test', 'group_id', v_group),
    'hash-link-x', now() + interval '30 days');
  ASSERT r->>'result' = 'duplicate' AND (r->>'provider_id')::uuid = v_provider, format('dup email: %s', r);
  r := public.create_provider_intake_invite(v_org, v_actor, 'Smoke', jsonb_build_object(
    'first_name', 'A', 'last_name', 'R', 'email', 'other@example.test', 'group_id', v_group,
    'npi', '1234567893'), 'hash-link-y', now() + interval '30 days');
  ASSERT r->>'result' = 'duplicate', format('dup npi: %s', r);

  -- The link reads back; an unknown one is null.
  ASSERT public.read_intake_link('hash-link-1')->>'email' = 'anita@example.test', 'read link';
  ASSERT public.read_intake_link('nope') IS NULL, 'unknown link';

  -- Codes: at most 3 per 10 minutes.
  ASSERT (public.issue_intake_code('hash-link-1', 'code-a')->>'send')::boolean, 'code 1';
  ASSERT (public.issue_intake_code('hash-link-1', 'code-b')->>'send')::boolean, 'code 2';
  ASSERT (public.issue_intake_code('hash-link-1', 'code-c')->>'send')::boolean, 'code 3';
  ASSERT NOT (public.issue_intake_code('hash-link-1', 'code-d')->>'send')::boolean, 'code 4 refused';
  ASSERT NOT (public.issue_intake_code('nope', 'code-z')->>'send')::boolean, 'unknown link gets no code';

  -- Only the newest code counts; an older one is already consumed.
  ASSERT public.verify_intake_code('hash-link-1', 'code-a', 'hash-sess-0', now() + interval '2 hours') = 'invalid', 'old code';
  -- Four more wrong tries (five in all), then even the right code is refused.
  FOR i IN 1..4 LOOP
    ASSERT public.verify_intake_code('hash-link-1', 'wrong', 'hash-sess-0', now() + interval '2 hours') = 'invalid', 'wrong';
  END LOOP;
  ASSERT public.verify_intake_code('hash-link-1', 'code-c', 'hash-sess-0', now() + interval '2 hours') = 'invalid', 'locked after 5';

  -- A fresh code (limits reset by moving earlier codes back in time) opens a session.
  UPDATE public.provider_intake_codes SET created_at = created_at - interval '1 day'
   WHERE invite_id IN (SELECT id FROM public.provider_intake_invites WHERE provider_id = v_provider);
  ASSERT (public.issue_intake_code('hash-link-1', 'code-e')->>'send')::boolean, 'fresh code';
  ASSERT public.verify_intake_code('hash-link-1', 'code-e', 'hash-sess-1', now() + interval '2 hours') = 'ok', 'right code';
  ASSERT public.verify_intake_code('hash-link-1', 'code-e', 'hash-sess-2', now() + interval '2 hours') = 'invalid', 'code is single use';

  -- The session reads back only with its own link.
  ASSERT public.read_intake_session('hash-sess-1', 'hash-link-1')->>'first_name' = 'Anita', 'session read';
  ASSERT public.read_intake_session('hash-sess-1', 'nope') IS NULL, 'session bound to its link';

  -- Resend: cooldown first, then a new link that ends the old session.
  r := public.resend_provider_intake_invite(v_org, v_actor, 'Smoke', v_provider, 'hash-link-2', now() + interval '30 days');
  ASSERT r->>'result' = 'cooldown', format('cooldown: %s', r);
  -- Every resend serializes on the provider (transaction advisory lock), so a
  -- double submit answers cooldown instead of racing the one-open-invite index.
  v_key := hashtextextended('provider_intake_invite:' || v_provider::text, 0);
  ASSERT EXISTS (
    SELECT 1 FROM pg_locks
     WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND objsubid = 1
       AND classid::bigint = ((v_key >> 32) & 4294967295)
       AND objid::bigint = (v_key & 4294967295)), 'resend holds the provider lock';
  UPDATE public.provider_intake_invites SET created_at = created_at - interval '11 minutes'
   WHERE provider_id = v_provider AND revoked_at IS NULL;
  r := public.resend_provider_intake_invite(v_org, v_actor, 'Smoke', v_provider, 'hash-link-2', now() + interval '30 days');
  ASSERT r->>'result' = 'resent' AND r->>'email' = 'anita@example.test', format('resend: %s', r);
  ASSERT public.read_intake_link('hash-link-1') IS NULL, 'old link dead';
  ASSERT public.read_intake_session('hash-sess-1', 'hash-link-1') IS NULL, 'old session dead';
  ASSERT (SELECT count(*) FROM public.provider_intake_invites
           WHERE provider_id = v_provider AND revoked_at IS NULL) = 1, 'one open invite';

  -- A corrected record email is where the next resend goes.
  UPDATE public.providers SET email = 'Anita.New@example.test' WHERE id = v_provider;
  UPDATE public.provider_intake_invites SET created_at = created_at - interval '11 minutes'
   WHERE provider_id = v_provider AND revoked_at IS NULL;
  r := public.resend_provider_intake_invite(v_org, v_actor, 'Smoke', v_provider, 'hash-link-3', now() + interval '30 days');
  ASSERT r->>'result' = 'resent' AND r->>'email' = 'anita.new@example.test', format('resend to corrected email: %s', r);
  ASSERT public.read_intake_link('hash-link-3')->>'email' = 'anita.new@example.test', 'new link carries the corrected email';
  ASSERT public.read_intake_link('hash-link-2') IS NULL, 'replaced link dead';

  r := public.resend_provider_intake_invite(v_other_org, v_actor, 'Smoke', v_provider, 'hash-link-4', now() + interval '30 days');
  ASSERT r->>'result' = 'not_found', 'cross-org resend';

  -- A provider added by hand (no invite yet) gets a first invite, no cooldown.
  INSERT INTO public.providers (org_id, first_name, last_name, email, status)
    VALUES (v_org, 'Hand', 'Added', 'hand@example.test', 'active') RETURNING id INTO v_provider;
  r := public.resend_provider_intake_invite(v_org, v_actor, 'Smoke', v_provider, 'hash-link-5', now() + interval '30 days');
  ASSERT r->>'result' = 'resent' AND r->>'email' = 'hand@example.test', format('first invite: %s', r);
  -- A provider with no email on record can't be invited.
  INSERT INTO public.providers (org_id, first_name, last_name, status)
    VALUES (v_org, 'No', 'Email', 'active') RETURNING id INTO v_provider;
  r := public.resend_provider_intake_invite(v_org, v_actor, 'Smoke', v_provider, 'hash-link-6', now() + interval '30 days');
  ASSERT r->>'result' = 'not_found', format('no email: %s', r);

  -- Sign-out.
  PERFORM public.revoke_intake_session('hash-sess-1');

  -- Nobody but service_role may call the RPCs or read the tables.
  ASSERT NOT has_function_privilege('anon', 'public.verify_intake_code(text, text, text, timestamptz)', 'EXECUTE'), 'anon rpc';
  ASSERT NOT has_function_privilege('authenticated', 'public.create_provider_intake_invite(uuid, uuid, text, jsonb, text, timestamptz)', 'EXECUTE'), 'authenticated rpc';
  ASSERT has_function_privilege('service_role', 'public.read_intake_session(text, text)', 'EXECUTE'), 'service_role rpc';
  ASSERT NOT has_table_privilege('anon', 'public.provider_intake_codes', 'SELECT'), 'anon table';
  ASSERT NOT has_table_privilege('authenticated', 'public.provider_intake_sessions', 'SELECT'), 'authenticated table';

  RAISE NOTICE 'provider intake smoke: all checks passed';
END;
$$;

ROLLBACK;
