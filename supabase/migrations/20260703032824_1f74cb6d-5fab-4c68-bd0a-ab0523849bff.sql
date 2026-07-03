-- E1 (DB half): team-member invites. Applied to the dev project via MCP
-- as "member_invites_infrastructure".
-- pending_invites + admin membership management + claim_invites().

CREATE TABLE public.pending_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','specialist','billing')),
  full_name text,
  invited_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

ALTER TABLE public.pending_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY pending_invites_select ON public.pending_invites
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY pending_invites_insert_admin ON public.pending_invites
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT public.user_org_ids())
    AND public.user_role(org_id) = 'admin'
  );

CREATE POLICY pending_invites_delete_admin ON public.pending_invites
  FOR DELETE TO authenticated
  USING (
    org_id IN (SELECT public.user_org_ids())
    AND public.user_role(org_id) = 'admin'
  );

REVOKE ALL ON public.pending_invites FROM anon;
REVOKE ALL ON public.pending_invites FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.pending_invites TO authenticated;

CREATE POLICY memberships_insert_admin ON public.memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT public.user_org_ids())
    AND public.user_role(org_id) = 'admin'
  );

CREATE POLICY memberships_update_admin ON public.memberships
  FOR UPDATE TO authenticated
  USING (
    org_id IN (SELECT public.user_org_ids())
    AND public.user_role(org_id) = 'admin'
  )
  WITH CHECK (
    org_id IN (SELECT public.user_org_ids())
    AND public.user_role(org_id) = 'admin'
  );

GRANT DELETE ON public.memberships TO authenticated;
CREATE POLICY memberships_delete_admin ON public.memberships
  FOR DELETE TO authenticated
  USING (
    org_id IN (SELECT public.user_org_ids())
    AND public.user_role(org_id) = 'admin'
    AND user_id <> (SELECT auth.uid())
  );

CREATE OR REPLACE FUNCTION public.claim_invites()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_count integer := 0;
  r record;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS NULL THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT * FROM public.pending_invites WHERE lower(email) = lower(v_email)
  LOOP
    INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (r.org_id, auth.uid(), r.role)
    ON CONFLICT (user_id, org_id) DO NOTHING;

    UPDATE public.profiles
       SET full_name = COALESCE(full_name, r.full_name)
     WHERE id = auth.uid();

    DELETE FROM public.pending_invites WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_invites() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_invites() FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_invites() TO authenticated;
