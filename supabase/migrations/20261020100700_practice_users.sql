-- 2026-10-20 — practice_users table + set_practice_user_role + list_practice_users
-- RPCs. Implements Q6: external roles (owner / coordinator / billing) and
-- per-report access gating.
--
-- practice_users is the practice-side authorization layer (extends E6.12's
-- private.client_access surface). Minted adds users + sets report access; the
-- practice view has no control for adding users.
--
-- Additive + idempotent.

CREATE TABLE IF NOT EXISTS public.practice_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'coordinator', 'billing')),
  report_access jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS practice_users_org_idx ON public.practice_users (org_id);
CREATE INDEX IF NOT EXISTS practice_users_user_idx ON public.practice_users (user_id);

ALTER TABLE public.practice_users ENABLE ROW LEVEL SECURITY;

-- Org members SELECT their own practice_users rows; admin mint-staff manage.
DROP POLICY IF EXISTS pu_select_org ON public.practice_users;
CREATE POLICY pu_select_org ON public.practice_users
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids() AS user_org_ids));

-- Writes go through SECURITY DEFINER RPCs (no authenticated INSERT/UPDATE/DELETE
-- policy).
GRANT SELECT ON public.practice_users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.practice_users TO service_role;

-- ---------------------------------------------------------------------------
-- set_practice_user_role — admin-only, writes one audit row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_practice_user_role(
  p_org_id uuid,
  p_user_id uuid,
  p_role text,
  p_report_access jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF public.user_role(p_org_id) <> 'admin' THEN
    RAISE EXCEPTION 'Only an administrator can set practice user roles';
  END IF;
  IF p_role NOT IN ('owner', 'coordinator', 'billing') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  INSERT INTO public.practice_users (org_id, user_id, role, report_access, created_by)
  VALUES (p_org_id, p_user_id, p_role, p_report_access, v_uid)
  ON CONFLICT (org_id, user_id) DO UPDATE SET
    role = excluded.role,
    report_access = excluded.report_access;

  INSERT INTO public.audit_log (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (p_org_id, v_uid, 'UPDATE', 'practice_user', p_user_id,
            'Practice user role set to ' || p_role);

  RETURN jsonb_build_object('ok', true, 'role', p_role);
END;
$$;
REVOKE ALL ON FUNCTION public.set_practice_user_role(uuid, uuid, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_practice_user_role(uuid, uuid, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- list_practice_users — org-scoped read.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_practice_users(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (p_org_id IN (SELECT user_org_ids())) THEN
    RAISE EXCEPTION 'Not authorized to list practice users for this org';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(row_to_json(u)), '[]'::jsonb)
    FROM (
      SELECT pu.id, pu.org_id, pu.user_id, pu.role, pu.report_access, pu.created_at
      FROM public.practice_users pu
      WHERE pu.org_id = p_org_id
      ORDER BY pu.created_at
    ) u
  );
END;
$$;
REVOKE ALL ON FUNCTION public.list_practice_users(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_practice_users(uuid) TO authenticated;