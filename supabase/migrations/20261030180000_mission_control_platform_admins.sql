-- Mission Control M1: platform administration foundations.
--
-- A platform admin is a Minted operator who works across organizations. This
-- migration adds who they are (platform_admins + is_platform_admin()), what
-- they did (admin_audit_log), the only way the list changes from the browser
-- (grant_platform_admin / revoke_platform_admin), one permissive SELECT policy
-- each on organizations, memberships, profiles and pending_invites, and the
-- cross-org dashboard aggregate (platform_metrics()).
--
-- Additive and idempotent. No existing policy, grant, table or function is
-- dropped, renamed or restated. Tenant tables (providers, cases, documents,
-- ...) are NOT widened: to work inside an organization a platform admin needs a
-- membership like anyone else.
--
-- There is no self-bootstrap path. The first platform admin is an operator SQL
-- insert (docs/ops/mission-control-bootstrap.md).

-- ---------------------------------------------------------------------------
-- platform_admins
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_admins FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.platform_admins TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_admins TO service_role;

-- The browser may ask "am I one" and nothing else. No write policy exists:
-- writes happen inside the definer RPCs below or by an operator.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'platform_admins'
       AND policyname = 'mc_platform_admins_select_self'
  ) THEN
    CREATE POLICY mc_platform_admins_select_self
      ON public.platform_admins FOR SELECT TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;
END
$$;

-- Is the caller an active platform admin? SECURITY DEFINER so policies that
-- call it never recurse through platform_admins' own RLS.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = auth.uid() AND pa.revoked_at IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- admin_audit_log: the platform-scoped ledger. audit_log stays untouched (its
-- org_id is NOT NULL and its action vocabulary is case-centric).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  actor_email text,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  org_id uuid REFERENCES public.organizations(id),
  before jsonb,
  after jsonb,
  description text
);

CREATE INDEX IF NOT EXISTS admin_audit_log_ts_idx
  ON public.admin_audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_ts_idx
  ON public.admin_audit_log (actor_user_id, ts DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_org_ts_idx
  ON public.admin_audit_log (org_id, ts DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_action_ts_idx
  ON public.admin_audit_log (action, ts DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Append-only for every client role: SELECT is the only grant, and there is no
-- INSERT/UPDATE/DELETE policy. Rows are written inside SECURITY DEFINER RPCs
-- or by the service role, which keeps its elevated privileges like audit_log.
REVOKE ALL ON TABLE public.admin_audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.admin_audit_log TO authenticated;
GRANT SELECT, INSERT ON TABLE public.admin_audit_log TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'admin_audit_log'
       AND policyname = 'mc_admin_audit_log_select_platform_admin'
  ) THEN
    CREATE POLICY mc_admin_audit_log_select_platform_admin
      ON public.admin_audit_log FOR SELECT TO authenticated
      USING ((SELECT public.is_platform_admin()));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- grant / revoke. Both serialize on one advisory lock so two admins revoking
-- each other cannot leave zero active admins, re-check the caller after the
-- lock, write one ledger row per change in the same transaction, and return
-- jsonb (RETURNS platform_admins would re-apply the self-only SELECT policy to
-- the returned row). A call that changes nothing writes no ledger row and
-- returns changed = false.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.grant_platform_admin(p_user_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_note text := NULLIF(btrim(p_note), '');
  v_before public.platform_admins%ROWTYPE;
  v_after public.platform_admins%ROWTYPE;
  v_audit_id uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'platform_admin_required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.platform_admins', 0));

  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'platform_admin_required';
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'user_not_found';
  END IF;

  SELECT * INTO v_before FROM public.platform_admins WHERE user_id = p_user_id FOR UPDATE;

  IF FOUND AND v_before.revoked_at IS NULL THEN
    v_after := v_before;
  ELSE
    INSERT INTO public.platform_admins (user_id, granted_by, granted_at, note)
    VALUES (p_user_id, v_actor, now(), v_note)
    ON CONFLICT (user_id) DO UPDATE
      SET granted_by = EXCLUDED.granted_by,
          granted_at = EXCLUDED.granted_at,
          revoked_at = NULL,
          revoked_by = NULL,
          note = EXCLUDED.note,
          updated_at = now()
    RETURNING * INTO v_after;

    INSERT INTO public.admin_audit_log
      (actor_user_id, actor_email, action, target_type, target_id, before, after, description)
    VALUES (
      v_actor,
      (SELECT u.email FROM auth.users u WHERE u.id = v_actor),
      'platform_admin.grant',
      'user',
      p_user_id::text,
      CASE WHEN v_before.user_id IS NULL THEN NULL ELSE to_jsonb(v_before) END,
      to_jsonb(v_after),
      'Granted platform admin'
    )
    RETURNING id INTO v_audit_id;
  END IF;

  RETURN jsonb_build_object(
    'userId', v_after.user_id,
    'active', v_after.revoked_at IS NULL,
    'grantedBy', v_after.granted_by,
    'grantedAt', v_after.granted_at,
    'revokedBy', v_after.revoked_by,
    'revokedAt', v_after.revoked_at,
    'note', v_after.note,
    'changed', v_audit_id IS NOT NULL,
    'auditId', v_audit_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.grant_platform_admin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_platform_admin(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revoke_platform_admin(p_user_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_note text := NULLIF(btrim(p_note), '');
  v_before public.platform_admins%ROWTYPE;
  v_after public.platform_admins%ROWTYPE;
  v_audit_id uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'platform_admin_required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.platform_admins', 0));

  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'platform_admin_required';
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'user_not_found';
  END IF;

  SELECT * INTO v_before FROM public.platform_admins WHERE user_id = p_user_id FOR UPDATE;

  IF NOT FOUND OR v_before.revoked_at IS NOT NULL THEN
    v_after := v_before;
  ELSE
    IF (SELECT count(*) FROM public.platform_admins WHERE revoked_at IS NULL) <= 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'last_platform_admin';
    END IF;

    UPDATE public.platform_admins
       SET revoked_at = now(),
           revoked_by = v_actor,
           note = v_note,
           updated_at = now()
     WHERE user_id = p_user_id
    RETURNING * INTO v_after;

    INSERT INTO public.admin_audit_log
      (actor_user_id, actor_email, action, target_type, target_id, before, after, description)
    VALUES (
      v_actor,
      (SELECT u.email FROM auth.users u WHERE u.id = v_actor),
      'platform_admin.revoke',
      'user',
      p_user_id::text,
      to_jsonb(v_before),
      to_jsonb(v_after),
      'Revoked platform admin'
    )
    RETURNING id INTO v_audit_id;
  END IF;

  RETURN jsonb_build_object(
    'userId', p_user_id,
    'active', v_after.user_id IS NOT NULL AND v_after.revoked_at IS NULL,
    'grantedBy', v_after.granted_by,
    'grantedAt', v_after.granted_at,
    'revokedBy', v_after.revoked_by,
    'revokedAt', v_after.revoked_at,
    'note', v_after.note,
    'changed', v_audit_id IS NOT NULL,
    'auditId', v_audit_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_platform_admin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_platform_admin(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Metadata reads for platform admins without a membership. One additive
-- permissive SELECT policy per table; permissive policies OR together, so the
-- existing member policies are neither copied nor changed.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['organizations', 'memberships', 'profiles', 'pending_invites'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = v_table
         AND policyname = 'mc_' || v_table || '_select_platform_admin'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()))',
        'mc_' || v_table || '_select_platform_admin',
        v_table
      );
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- platform_metrics(): the Mission Control Home tiles. Every key is always
-- present and integer-valued. cases.open counts the five open unified
-- statuses (src/lib/caseStatus.ts OPEN_CASE_STATUSES); approved, denied and
-- not_pursuing are terminal. plpgsql so the auth.users read is resolved at
-- call time, not at creation.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.platform_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'platform_admin_required';
  END IF;

  RETURN jsonb_build_object(
    'generatedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'organizations', (
      SELECT jsonb_build_object(
        'total', count(*),
        'active', count(*) FILTER (WHERE o.lifecycle_state = 'active'),
        'prospect', count(*) FILTER (WHERE o.lifecycle_state = 'prospect'),
        'inactive', count(*) FILTER (WHERE o.lifecycle_state = 'inactive')
      )
      FROM public.organizations o
    ),
    'users', jsonb_build_object(
      'total', (SELECT count(*) FROM auth.users u WHERE u.deleted_at IS NULL),
      'platformAdmins', (SELECT count(*) FROM public.platform_admins pa WHERE pa.revoked_at IS NULL)
    ),
    'providers', (
      SELECT jsonb_build_object(
        'total', count(*),
        'active', count(*) FILTER (WHERE p.status = 'active'),
        'onboarding', count(*) FILTER (WHERE p.status = 'onboarding'),
        'pendingVerification', count(*) FILTER (WHERE p.verification_state = 'pending_verification')
      )
      FROM public.providers p
    ),
    'cases', (
      SELECT jsonb_build_object(
        'total', count(*),
        'open', count(*) FILTER (
          WHERE c.case_status IN ('not_started', 'in_progress', 'submitted', 'in_review', 'action_required')
        )
      )
      FROM public.credential_cases c
    ),
    'pendingInvites', (SELECT count(*) FROM public.pending_invites)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.platform_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_metrics() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
