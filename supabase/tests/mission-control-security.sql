-- Mission Control M1 security packet: platform_admins, is_platform_admin(),
-- admin_audit_log, grant/revoke, the four additive metadata policies, and
-- platform_metrics().
-- Run after repository migrations in an owned disposable local database
-- (scripts/security/verify-mission-control.mjs). Every fixture row is
-- synthetic and the outer transaction rolls back. Output is labels only.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE mc_results (
  ordinal bigint GENERATED ALWAYS AS IDENTITY,
  label text PRIMARY KEY,
  passed boolean NOT NULL
);

CREATE FUNCTION pg_temp.mc_assert(p_label text, p_condition boolean)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
AS $$
  INSERT INTO pg_temp.mc_results (label, passed)
  VALUES (p_label, coalesce(p_condition, false));
$$;

-- Impersonate a user the way PostgREST does; both claim spellings are set so
-- either auth.uid() implementation resolves the same subject.
CREATE FUNCTION pg_temp.mc_claims(p_user uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Runs one statement under the current role; returns '00000' or
-- '<sqlstate>:<message>'. The failed statement's effects roll back with it.
CREATE FUNCTION pg_temp.mc_try(p_sql text)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_state text;
  v_message text;
BEGIN
  EXECUTE p_sql;
  RETURN '00000';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
  RETURN v_state || ':' || v_message;
END;
$$;

CREATE FUNCTION pg_temp.mc_keys(p_doc jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::text[]) FROM jsonb_object_keys(p_doc) AS k;
$$;

-- Synthetic fixtures. ORG_A/B/C; ADMIN is a platform admin and an org_a
-- member; MEMBER belongs to org_a and org_b; OTHER belongs to org_c only;
-- TARGET has no membership.
INSERT INTO auth.users (id, email) VALUES
  ('7c100000-0000-4000-8000-000000000001', 'mc-admin@example.invalid'),
  ('7c100000-0000-4000-8000-000000000002', 'mc-member@example.invalid'),
  ('7c100000-0000-4000-8000-000000000003', 'mc-other@example.invalid'),
  ('7c100000-0000-4000-8000-000000000004', 'mc-target@example.invalid');

INSERT INTO public.profiles (id, full_name, email) VALUES
  ('7c100000-0000-4000-8000-000000000001', 'Synthetic MC Admin', 'mc-admin@example.invalid'),
  ('7c100000-0000-4000-8000-000000000002', 'Synthetic MC Member', 'mc-member@example.invalid'),
  ('7c100000-0000-4000-8000-000000000003', 'Synthetic MC Other', 'mc-other@example.invalid'),
  ('7c100000-0000-4000-8000-000000000004', 'Synthetic MC Target', 'mc-target@example.invalid')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, lifecycle_state) VALUES
  ('7c200000-0000-4000-8000-000000000001', 'MC synthetic org A', 'active'),
  ('7c200000-0000-4000-8000-000000000002', 'MC synthetic org B', 'prospect'),
  ('7c200000-0000-4000-8000-000000000003', 'MC synthetic org C', 'inactive');

INSERT INTO public.memberships (org_id, user_id, role) VALUES
  ('7c200000-0000-4000-8000-000000000001', '7c100000-0000-4000-8000-000000000001', 'admin'),
  ('7c200000-0000-4000-8000-000000000001', '7c100000-0000-4000-8000-000000000002', 'specialist'),
  ('7c200000-0000-4000-8000-000000000002', '7c100000-0000-4000-8000-000000000002', 'admin'),
  ('7c200000-0000-4000-8000-000000000003', '7c100000-0000-4000-8000-000000000003', 'admin');

INSERT INTO public.pending_invites (org_id, email, role) VALUES
  ('7c200000-0000-4000-8000-000000000002', 'mc-invite-b@example.invalid', 'specialist'),
  ('7c200000-0000-4000-8000-000000000003', 'mc-invite-c@example.invalid', 'billing');

INSERT INTO public.payers (id, org_id, name) VALUES
  ('7c300000-0000-4000-8000-000000000001', '7c200000-0000-4000-8000-000000000001', 'MC synthetic payer A'),
  ('7c300000-0000-4000-8000-000000000003', '7c200000-0000-4000-8000-000000000003', 'MC synthetic payer C');

INSERT INTO public.providers (id, org_id, first_name, last_name, status, verification_state) VALUES
  ('7c400000-0000-4000-8000-000000000001', '7c200000-0000-4000-8000-000000000001', 'Synthetic', 'Provider A', 'active', 'verified'),
  ('7c400000-0000-4000-8000-000000000002', '7c200000-0000-4000-8000-000000000002', 'Synthetic', 'Provider B', 'onboarding', 'pending_verification'),
  ('7c400000-0000-4000-8000-000000000003', '7c200000-0000-4000-8000-000000000003', 'Synthetic', 'Provider C', 'active', 'pending_verification');

INSERT INTO public.credential_cases (id, org_id, provider_id, payer_id, state, case_status) VALUES
  ('7c500000-0000-4000-8000-000000000001', '7c200000-0000-4000-8000-000000000001', '7c400000-0000-4000-8000-000000000001', '7c300000-0000-4000-8000-000000000001', 'CO', 'not_started'),
  ('7c500000-0000-4000-8000-000000000003', '7c200000-0000-4000-8000-000000000003', '7c400000-0000-4000-8000-000000000003', '7c300000-0000-4000-8000-000000000003', 'KS', 'not_started');

INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
VALUES ('7c200000-0000-4000-8000-000000000003', '7c100000-0000-4000-8000-000000000003',
        'CREATE', 'organization', '7c200000-0000-4000-8000-000000000003', 'MC synthetic org C audit row');

-- The operator bootstrap from docs/ops/mission-control-bootstrap.md.
INSERT INTO public.platform_admins (user_id, granted_by, note)
SELECT id, id, 'bootstrap' FROM auth.users WHERE lower(email) = lower('MC-Admin@example.invalid')
ON CONFLICT (user_id) DO UPDATE SET revoked_at = NULL, revoked_by = NULL, updated_at = now();

-- ---------------------------------------------------------------------------
-- Shape and ACLs
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
BEGIN
  PERFORM pg_temp.mc_assert('shape.rls_enabled',
    (SELECT bool_and(relrowsecurity) FROM pg_class
      WHERE oid IN ('public.platform_admins'::regclass, 'public.admin_audit_log'::regclass)));

  PERFORM pg_temp.mc_assert('shape.six_mc_select_policies',
    (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND policyname LIKE 'mc\_%'
        AND permissive = 'PERMISSIVE' AND cmd = 'SELECT' AND roles = '{authenticated}'
        AND (tablename, policyname) IN (
          ('platform_admins', 'mc_platform_admins_select_self'),
          ('admin_audit_log', 'mc_admin_audit_log_select_platform_admin'),
          ('organizations', 'mc_organizations_select_platform_admin'),
          ('memberships', 'mc_memberships_select_platform_admin'),
          ('profiles', 'mc_profiles_select_platform_admin'),
          ('pending_invites', 'mc_pending_invites_select_platform_admin'))) = 6
    AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'mc\_%') = 6);

  PERFORM pg_temp.mc_assert('shape.no_client_write_policies',
    NOT EXISTS (SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN ('platform_admins', 'admin_audit_log')
        AND cmd <> 'SELECT'));

  PERFORM pg_temp.mc_assert('shape.functions_definer_search_path_pinned',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('is_platform_admin', 'grant_platform_admin', 'revoke_platform_admin', 'platform_metrics')
        AND p.prosecdef
        AND p.proconfig @> ARRAY['search_path=public']) = 4);

  PERFORM pg_temp.mc_assert('shape.functions_single_overload_no_defaults',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('is_platform_admin', 'grant_platform_admin', 'revoke_platform_admin', 'platform_metrics')
        AND p.pronargdefaults = 0) = 4);

  PERFORM pg_temp.mc_assert('acl.platform_admins.authenticated_select_only',
    has_table_privilege('authenticated', 'public.platform_admins', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.platform_admins', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.platform_admins', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.platform_admins', 'DELETE')
    AND NOT has_table_privilege('authenticated', 'public.platform_admins', 'TRUNCATE'));
  PERFORM pg_temp.mc_assert('acl.platform_admins.anon_none',
    NOT has_table_privilege('anon', 'public.platform_admins', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'));
  PERFORM pg_temp.mc_assert('acl.admin_audit_log.authenticated_select_only',
    has_table_privilege('authenticated', 'public.admin_audit_log', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.admin_audit_log', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.admin_audit_log', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.admin_audit_log', 'DELETE')
    AND NOT has_table_privilege('authenticated', 'public.admin_audit_log', 'TRUNCATE'));
  PERFORM pg_temp.mc_assert('acl.admin_audit_log.anon_none',
    NOT has_table_privilege('anon', 'public.admin_audit_log', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'));
  PERFORM pg_temp.mc_assert('acl.admin_audit_log.service_role_insert',
    has_table_privilege('service_role', 'public.admin_audit_log', 'SELECT,INSERT'));

  FOREACH v_fn IN ARRAY ARRAY[
    'public.is_platform_admin()',
    'public.grant_platform_admin(uuid,text)',
    'public.revoke_platform_admin(uuid,text)',
    'public.platform_metrics()'
  ] LOOP
    PERFORM pg_temp.mc_assert('acl.execute.' || split_part(split_part(v_fn, '.', 2), '(', 1),
      has_function_privilege('authenticated', v_fn, 'EXECUTE')
      AND has_function_privilege('service_role', v_fn, 'EXECUTE')
      AND NOT has_function_privilege('anon', v_fn, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
          FROM pg_proc p,
               aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         WHERE p.oid = v_fn::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'));
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- A non-admin sees exactly what their memberships already allowed. The
-- "before" counts come from the same session with the four mc_ policies
-- dropped inside a subtransaction that is then rolled back.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_member uuid := '7c100000-0000-4000-8000-000000000002';
  v_after bigint[];
  v_before bigint[];
  v_orgs uuid[];
  v_profiles uuid[];
  v_invites text[];
  v_is_admin boolean;
  v_pa bigint;
  v_ledger bigint;
BEGIN
  PERFORM pg_temp.mc_claims(v_member);
  SET LOCAL ROLE authenticated;
  v_after := ARRAY[
    (SELECT count(*) FROM public.organizations),
    (SELECT count(*) FROM public.memberships),
    (SELECT count(*) FROM public.profiles),
    (SELECT count(*) FROM public.pending_invites)
  ];
  SELECT array_agg(id ORDER BY id) INTO v_orgs FROM public.organizations;
  SELECT array_agg(id ORDER BY id) INTO v_profiles FROM public.profiles;
  SELECT array_agg(email ORDER BY email) INTO v_invites FROM public.pending_invites;
  v_is_admin := public.is_platform_admin();
  SELECT count(*) INTO v_pa FROM public.platform_admins;
  SELECT count(*) INTO v_ledger FROM public.admin_audit_log;
  RESET ROLE;

  BEGIN
    DROP POLICY mc_organizations_select_platform_admin ON public.organizations;
    DROP POLICY mc_memberships_select_platform_admin ON public.memberships;
    DROP POLICY mc_profiles_select_platform_admin ON public.profiles;
    DROP POLICY mc_pending_invites_select_platform_admin ON public.pending_invites;
    SET LOCAL ROLE authenticated;
    v_before := ARRAY[
      (SELECT count(*) FROM public.organizations),
      (SELECT count(*) FROM public.memberships),
      (SELECT count(*) FROM public.profiles),
      (SELECT count(*) FROM public.pending_invites)
    ];
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'mc_restore_policies';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;

  PERFORM pg_temp.mc_assert('member.is_platform_admin_false', v_is_admin = false);
  PERFORM pg_temp.mc_assert('member.platform_admins_zero_rows', v_pa = 0);
  PERFORM pg_temp.mc_assert('member.admin_audit_log_zero_rows', v_ledger = 0);
  PERFORM pg_temp.mc_assert('member.metadata_counts_unchanged_by_mc_policies', v_after = v_before);
  PERFORM pg_temp.mc_assert('member.metadata_counts_nonzero', v_before[1] > 0 AND v_before[2] > 0 AND v_before[3] > 0 AND v_before[4] > 0);
  PERFORM pg_temp.mc_assert('member.organizations_exact',
    v_orgs = ARRAY['7c200000-0000-4000-8000-000000000001', '7c200000-0000-4000-8000-000000000002']::uuid[]);
  PERFORM pg_temp.mc_assert('member.memberships_exact', v_after[2] = 3);
  PERFORM pg_temp.mc_assert('member.profiles_exact',
    v_profiles = ARRAY['7c100000-0000-4000-8000-000000000001', '7c100000-0000-4000-8000-000000000002']::uuid[]);
  PERFORM pg_temp.mc_assert('member.pending_invites_exact', v_invites = ARRAY['mc-invite-b@example.invalid']);
  PERFORM pg_temp.mc_assert('member.mc_policies_restored',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'mc\_%') = 6);
END
$$;

-- ---------------------------------------------------------------------------
-- A non-admin cannot grant, revoke, read metrics or self-bootstrap.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_member uuid := '7c100000-0000-4000-8000-000000000002';
  v_ledger_before bigint := (SELECT count(*) FROM public.admin_audit_log);
  v_pa_before jsonb := (SELECT coalesce(jsonb_agg(to_jsonb(pa) ORDER BY pa.user_id), '[]') FROM public.platform_admins pa);
  v_grant text;
  v_revoke text;
  v_metrics text;
  v_self_insert text;
BEGIN
  PERFORM pg_temp.mc_claims(v_member);
  SET LOCAL ROLE authenticated;
  v_grant := pg_temp.mc_try(format('SELECT public.grant_platform_admin(%L::uuid, %L)', v_member, 'self'));
  v_revoke := pg_temp.mc_try(format('SELECT public.revoke_platform_admin(%L::uuid, %L)',
    '7c100000-0000-4000-8000-000000000001', 'coup'));
  v_metrics := pg_temp.mc_try('SELECT public.platform_metrics()');
  v_self_insert := pg_temp.mc_try(format(
    'INSERT INTO public.platform_admins (user_id, granted_by, note) VALUES (%L, %L, %L)',
    v_member, v_member, 'self'));
  RESET ROLE;

  PERFORM pg_temp.mc_assert('member.grant_denied_42501', v_grant = '42501:platform_admin_required');
  PERFORM pg_temp.mc_assert('member.revoke_denied_42501', v_revoke = '42501:platform_admin_required');
  PERFORM pg_temp.mc_assert('member.metrics_denied_42501', v_metrics = '42501:platform_admin_required');
  PERFORM pg_temp.mc_assert('member.direct_insert_denied_42501', v_self_insert LIKE '42501:%');
  PERFORM pg_temp.mc_assert('member.no_ledger_row_written',
    (SELECT count(*) FROM public.admin_audit_log) = v_ledger_before);
  PERFORM pg_temp.mc_assert('member.platform_admins_unchanged',
    (SELECT coalesce(jsonb_agg(to_jsonb(pa) ORDER BY pa.user_id), '[]') FROM public.platform_admins pa) = v_pa_before);
END
$$;

-- ---------------------------------------------------------------------------
-- A platform admin reads metadata across every organization, and nothing
-- else beyond their own memberships.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_admin uuid := '7c100000-0000-4000-8000-000000000001';
  v_org_a uuid := '7c200000-0000-4000-8000-000000000001';
  v_seen bigint[];
  v_truth bigint[];
  v_fixture_orgs bigint;
  v_is_admin boolean;
  v_pa_rows uuid[];
  v_providers_a bigint;
  v_providers_other bigint;
  v_cases_a bigint;
  v_cases_other bigint;
  v_audit_c bigint;
BEGIN
  v_truth := ARRAY[
    (SELECT count(*) FROM public.organizations),
    (SELECT count(*) FROM public.memberships),
    (SELECT count(*) FROM public.profiles),
    (SELECT count(*) FROM public.pending_invites)
  ];

  PERFORM pg_temp.mc_claims(v_admin);
  SET LOCAL ROLE authenticated;
  v_is_admin := public.is_platform_admin();
  SELECT array_agg(user_id) INTO v_pa_rows FROM public.platform_admins;
  v_seen := ARRAY[
    (SELECT count(*) FROM public.organizations),
    (SELECT count(*) FROM public.memberships),
    (SELECT count(*) FROM public.profiles),
    (SELECT count(*) FROM public.pending_invites)
  ];
  SELECT count(*) INTO v_fixture_orgs FROM public.organizations WHERE name LIKE 'MC synthetic org %';
  SELECT count(*) FILTER (WHERE org_id = v_org_a), count(*) FILTER (WHERE org_id <> v_org_a)
    INTO v_providers_a, v_providers_other FROM public.providers;
  SELECT count(*) FILTER (WHERE org_id = v_org_a), count(*) FILTER (WHERE org_id <> v_org_a)
    INTO v_cases_a, v_cases_other FROM public.credential_cases;
  SELECT count(*) INTO v_audit_c FROM public.audit_log
   WHERE org_id = '7c200000-0000-4000-8000-000000000003';
  RESET ROLE;

  PERFORM pg_temp.mc_assert('admin.is_platform_admin_true', v_is_admin);
  PERFORM pg_temp.mc_assert('admin.platform_admins_self_row_only', v_pa_rows = ARRAY[v_admin]);
  PERFORM pg_temp.mc_assert('admin.sees_every_organization', v_seen[1] = v_truth[1] AND v_fixture_orgs = 3);
  PERFORM pg_temp.mc_assert('admin.sees_every_membership', v_seen[2] = v_truth[2]);
  PERFORM pg_temp.mc_assert('admin.sees_every_profile', v_seen[3] = v_truth[3]);
  PERFORM pg_temp.mc_assert('admin.sees_every_pending_invite', v_seen[4] = v_truth[4] AND v_truth[4] >= 2);
  PERFORM pg_temp.mc_assert('admin.member_org_providers_visible', v_providers_a = 1);
  PERFORM pg_temp.mc_assert('admin.nonmember_org_providers_zero', v_providers_other = 0);
  PERFORM pg_temp.mc_assert('admin.member_org_cases_visible', v_cases_a = 1);
  PERFORM pg_temp.mc_assert('admin.nonmember_org_cases_zero', v_cases_other = 0);
  PERFORM pg_temp.mc_assert('admin.nonmember_org_audit_log_zero', v_audit_c = 0);
END
$$;

-- ---------------------------------------------------------------------------
-- platform_metrics(): the pinned shape, integer leaves, and the definitions.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_admin uuid := '7c100000-0000-4000-8000-000000000001';
  v_metrics jsonb;
  v_expected jsonb;
BEGIN
  PERFORM pg_temp.mc_claims(v_admin);
  SET LOCAL ROLE authenticated;
  v_metrics := public.platform_metrics();
  RESET ROLE;

  v_expected := jsonb_build_object(
    'organizations', jsonb_build_object(
      'total', (SELECT count(*) FROM public.organizations),
      'active', (SELECT count(*) FROM public.organizations WHERE lifecycle_state = 'active'),
      'prospect', (SELECT count(*) FROM public.organizations WHERE lifecycle_state = 'prospect'),
      'inactive', (SELECT count(*) FROM public.organizations WHERE lifecycle_state = 'inactive')),
    'users', jsonb_build_object(
      'total', (SELECT count(*) FROM auth.users WHERE deleted_at IS NULL),
      'platformAdmins', (SELECT count(*) FROM public.platform_admins WHERE revoked_at IS NULL)),
    'providers', jsonb_build_object(
      'total', (SELECT count(*) FROM public.providers),
      'active', (SELECT count(*) FROM public.providers WHERE status = 'active'),
      'onboarding', (SELECT count(*) FROM public.providers WHERE status = 'onboarding'),
      'pendingVerification', (SELECT count(*) FROM public.providers WHERE verification_state = 'pending_verification')),
    'cases', jsonb_build_object(
      'total', (SELECT count(*) FROM public.credential_cases),
      'open', (SELECT count(*) FROM public.credential_cases
                WHERE case_status NOT IN ('approved', 'denied', 'not_pursuing'))),
    'pendingInvites', (SELECT count(*) FROM public.pending_invites));

  PERFORM pg_temp.mc_assert('metrics.top_level_keys_exact',
    pg_temp.mc_keys(v_metrics) = ARRAY['cases', 'generatedAt', 'organizations', 'pendingInvites', 'providers', 'users']);
  PERFORM pg_temp.mc_assert('metrics.nested_keys_exact',
    pg_temp.mc_keys(v_metrics->'organizations') = ARRAY['active', 'inactive', 'prospect', 'total']
    AND pg_temp.mc_keys(v_metrics->'users') = ARRAY['platformAdmins', 'total']
    AND pg_temp.mc_keys(v_metrics->'providers') = ARRAY['active', 'onboarding', 'pendingVerification', 'total']
    AND pg_temp.mc_keys(v_metrics->'cases') = ARRAY['open', 'total']);
  PERFORM pg_temp.mc_assert('metrics.thirteen_integer_leaves',
    (SELECT count(*) FILTER (WHERE jsonb_typeof(v) = 'number' AND (v::text)::numeric = trunc((v::text)::numeric))
       FROM jsonb_path_query(v_metrics - 'generatedAt', 'strict $.**') AS v
      WHERE jsonb_typeof(v) <> 'object') = 13
    AND (SELECT count(*) FROM jsonb_path_query(v_metrics - 'generatedAt', 'strict $.**') AS v
          WHERE jsonb_typeof(v) <> 'object') = 13);
  PERFORM pg_temp.mc_assert('metrics.generated_at_iso_utc',
    jsonb_typeof(v_metrics->'generatedAt') = 'string'
    AND (v_metrics->>'generatedAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$');
  PERFORM pg_temp.mc_assert('metrics.values_match_definitions', (v_metrics - 'generatedAt') = v_expected);
  PERFORM pg_temp.mc_assert('metrics.fixture_counts_present',
    (v_metrics #>> '{organizations,inactive}')::int >= 1
    AND (v_metrics #>> '{providers,onboarding}')::int >= 1
    AND (v_metrics #>> '{providers,pendingVerification}')::int >= 2
    AND (v_metrics #>> '{cases,open}')::int >= 2
    AND (v_metrics #>> '{users,platformAdmins}')::int = 1);
END
$$;

-- ---------------------------------------------------------------------------
-- Grant then revoke: one ledger row each, with the right action, actor and
-- target; no-ops write nothing; the last active admin cannot be revoked.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_admin uuid := '7c100000-0000-4000-8000-000000000001';
  v_member uuid := '7c100000-0000-4000-8000-000000000002';
  v_target uuid := '7c100000-0000-4000-8000-000000000004';
  v_result jsonb;
  v_state text;
  v_flag boolean;
  v_ledger_count bigint;
  v_admin_sees bigint;
  v_member_sees bigint;
  v_row public.admin_audit_log%ROWTYPE;
BEGIN
  -- Grant.
  PERFORM pg_temp.mc_claims(v_admin);
  SET LOCAL ROLE authenticated;
  v_result := public.grant_platform_admin(v_target, '  first grant  ');
  RESET ROLE;
  PERFORM pg_temp.mc_assert('grant.returns_active_changed',
    v_result->>'userId' = v_target::text
    AND (v_result->>'active')::boolean
    AND (v_result->>'changed')::boolean
    AND v_result->>'grantedBy' = v_admin::text
    AND v_result->>'note' = 'first grant'
    AND v_result->>'auditId' IS NOT NULL);
  SELECT * INTO v_row FROM public.admin_audit_log WHERE id = (v_result->>'auditId')::uuid;
  PERFORM pg_temp.mc_assert('grant.ledger_row',
    v_row.action = 'platform_admin.grant'
    AND v_row.actor_user_id = v_admin
    AND v_row.actor_email = 'mc-admin@example.invalid'
    AND v_row.target_type = 'user'
    AND v_row.target_id = v_target::text
    AND v_row.org_id IS NULL
    AND v_row.before IS NULL
    AND v_row.after->>'user_id' = v_target::text
    AND v_row.after->>'revoked_at' IS NULL);

  PERFORM pg_temp.mc_claims(v_target);
  SET LOCAL ROLE authenticated;
  v_flag := public.is_platform_admin();
  RESET ROLE;
  PERFORM pg_temp.mc_assert('grant.target_is_platform_admin', v_flag);

  -- The ledger is readable by platform admins only; platform_admins stays
  -- self-only even for a platform admin.
  PERFORM pg_temp.mc_claims(v_admin);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_admin_sees FROM public.admin_audit_log;
  SELECT bool_and(user_id = v_admin) AND count(*) = 1 INTO v_flag FROM public.platform_admins;
  RESET ROLE;
  PERFORM pg_temp.mc_assert('grant.platform_admins_still_self_only',
    v_flag AND (SELECT count(*) FROM public.platform_admins WHERE revoked_at IS NULL) = 2);
  PERFORM pg_temp.mc_claims(v_member);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_member_sees FROM public.admin_audit_log;
  RESET ROLE;
  PERFORM pg_temp.mc_assert('ledger.platform_admin_reads_rows', v_admin_sees = (SELECT count(*) FROM public.admin_audit_log) AND v_admin_sees >= 1);
  PERFORM pg_temp.mc_assert('ledger.member_reads_zero_rows', v_member_sees = 0);

  -- Re-granting an active admin changes nothing and writes nothing.
  v_ledger_count := (SELECT count(*) FROM public.admin_audit_log);
  PERFORM pg_temp.mc_claims(v_admin);
  SET LOCAL ROLE authenticated;
  v_result := public.grant_platform_admin(v_target, 'again');
  RESET ROLE;
  PERFORM pg_temp.mc_assert('grant.active_target_noop',
    NOT (v_result->>'changed')::boolean
    AND (v_result->>'active')::boolean
    AND v_result->>'note' = 'first grant'
    AND (SELECT count(*) FROM public.admin_audit_log) = v_ledger_count);

  -- Unknown target.
  PERFORM pg_temp.mc_claims(v_admin);
  SET LOCAL ROLE authenticated;
  v_state := pg_temp.mc_try(format('SELECT public.grant_platform_admin(%L::uuid, NULL)', gen_random_uuid()));
  RESET ROLE;
  PERFORM pg_temp.mc_assert('grant.unknown_user_p0002',
    v_state = 'P0002:user_not_found' AND (SELECT count(*) FROM public.admin_audit_log) = v_ledger_count);

  -- Revoke.
  PERFORM pg_temp.mc_claims(v_admin);
  SET LOCAL ROLE authenticated;
  v_result := public.revoke_platform_admin(v_target, 'rotation');
  RESET ROLE;
  PERFORM pg_temp.mc_assert('revoke.returns_inactive_changed',
    v_result->>'userId' = v_target::text
    AND NOT (v_result->>'active')::boolean
    AND (v_result->>'changed')::boolean
    AND v_result->>'revokedBy' = v_admin::text
    AND v_result->>'revokedAt' IS NOT NULL);
  SELECT * INTO v_row FROM public.admin_audit_log WHERE id = (v_result->>'auditId')::uuid;
  PERFORM pg_temp.mc_assert('revoke.ledger_row',
    v_row.action = 'platform_admin.revoke'
    AND v_row.actor_user_id = v_admin
    AND v_row.actor_email = 'mc-admin@example.invalid'
    AND v_row.target_type = 'user'
    AND v_row.target_id = v_target::text
    AND v_row.before->>'revoked_at' IS NULL
    AND v_row.after->>'revoked_at' IS NOT NULL
    AND v_row.after->>'revoked_by' = v_admin::text);
  PERFORM pg_temp.mc_assert('grant_then_revoke.two_ledger_rows',
    (SELECT array_agg(action ORDER BY action) FROM public.admin_audit_log WHERE target_id = v_target::text)
      = ARRAY['platform_admin.grant', 'platform_admin.revoke']
    AND (SELECT count(*) FROM public.admin_audit_log) = v_ledger_count + 1);

  PERFORM pg_temp.mc_claims(v_target);
  SET LOCAL ROLE authenticated;
  v_flag := public.is_platform_admin();
  v_state := pg_temp.mc_try('SELECT public.platform_metrics()');
  RESET ROLE;
  PERFORM pg_temp.mc_assert('revoke.target_no_longer_admin', NOT v_flag AND v_state = '42501:platform_admin_required');

  -- Revoking an inactive row changes nothing.
  v_ledger_count := (SELECT count(*) FROM public.admin_audit_log);
  PERFORM pg_temp.mc_claims(v_admin);
  SET LOCAL ROLE authenticated;
  v_result := public.revoke_platform_admin(v_target, 'again');
  RESET ROLE;
  PERFORM pg_temp.mc_assert('revoke.inactive_target_noop',
    NOT (v_result->>'changed')::boolean AND (SELECT count(*) FROM public.admin_audit_log) = v_ledger_count);

  -- The last active admin cannot revoke themself.
  PERFORM pg_temp.mc_claims(v_admin);
  SET LOCAL ROLE authenticated;
  v_state := pg_temp.mc_try(format('SELECT public.revoke_platform_admin(%L::uuid, %L)', v_admin, 'leaving'));
  v_flag := public.is_platform_admin();
  RESET ROLE;
  PERFORM pg_temp.mc_assert('revoke.last_admin_23514',
    v_state = '23514:last_platform_admin'
    AND v_flag
    AND (SELECT count(*) FROM public.admin_audit_log) = v_ledger_count);

  -- Granting a revoked row re-activates it.
  PERFORM pg_temp.mc_claims(v_admin);
  SET LOCAL ROLE authenticated;
  v_result := public.grant_platform_admin(v_target, NULL);
  RESET ROLE;
  SELECT * INTO v_row FROM public.admin_audit_log WHERE id = (v_result->>'auditId')::uuid;
  PERFORM pg_temp.mc_assert('grant.reactivates_revoked_row',
    (v_result->>'changed')::boolean
    AND (SELECT revoked_at IS NULL AND revoked_by IS NULL AND granted_by = v_admin AND note IS NULL
           FROM public.platform_admins WHERE user_id = v_target)
    AND v_row.before->>'revoked_at' IS NOT NULL
    AND v_row.after->>'revoked_at' IS NULL);
END
$$;

-- ---------------------------------------------------------------------------
-- The ledger and the admin list are append/RPC-only for every client role,
-- platform admins included.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_admin uuid := '7c100000-0000-4000-8000-000000000001';
  v_update text;
  v_delete text;
  v_insert text;
  v_truncate text;
  v_pa_update text;
  v_pa_delete text;
  v_ledger jsonb := (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.admin_audit_log a);
BEGIN
  PERFORM pg_temp.mc_claims(v_admin);
  SET LOCAL ROLE authenticated;
  v_update := pg_temp.mc_try($sql$UPDATE public.admin_audit_log SET description = 'tampered'$sql$);
  v_delete := pg_temp.mc_try('DELETE FROM public.admin_audit_log');
  v_insert := pg_temp.mc_try(format(
    $sql$INSERT INTO public.admin_audit_log (actor_user_id, action, target_type) VALUES (%L, 'forged', 'user')$sql$,
    v_admin));
  v_truncate := pg_temp.mc_try('TRUNCATE public.admin_audit_log');
  v_pa_update := pg_temp.mc_try('UPDATE public.platform_admins SET revoked_at = now()');
  v_pa_delete := pg_temp.mc_try('DELETE FROM public.platform_admins');
  RESET ROLE;

  PERFORM pg_temp.mc_assert('ledger.update_denied_42501', v_update LIKE '42501:%');
  PERFORM pg_temp.mc_assert('ledger.delete_denied_42501', v_delete LIKE '42501:%');
  PERFORM pg_temp.mc_assert('ledger.insert_denied_42501', v_insert LIKE '42501:%');
  PERFORM pg_temp.mc_assert('ledger.truncate_denied_42501', v_truncate LIKE '42501:%');
  PERFORM pg_temp.mc_assert('ledger.rows_unchanged',
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.admin_audit_log a) = v_ledger);
  PERFORM pg_temp.mc_assert('platform_admins.direct_update_denied_42501', v_pa_update LIKE '42501:%');
  PERFORM pg_temp.mc_assert('platform_admins.direct_delete_denied_42501', v_pa_delete LIKE '42501:%');
END
$$;

SELECT label || '|' || CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END
FROM pg_temp.mc_results
ORDER BY ordinal;

DO $$
DECLARE
  failed bigint;
BEGIN
  SELECT count(*) INTO failed FROM pg_temp.mc_results WHERE NOT passed;
  IF failed <> 0 THEN
    RAISE EXCEPTION 'MISSION_CONTROL_SECURITY_TEST_FAILED: %',
      (SELECT string_agg(label, ', ' ORDER BY ordinal) FROM pg_temp.mc_results WHERE NOT passed);
  END IF;
END
$$;

SELECT 'MISSION_CONTROL_SECURITY|PASS';
ROLLBACK;
