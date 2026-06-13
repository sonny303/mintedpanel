
CREATE POLICY "orgs_update_admin" ON public.organizations
  FOR UPDATE TO authenticated
  USING (id IN (SELECT user_org_ids()) AND public.user_role(id) = 'admin')
  WITH CHECK (id IN (SELECT user_org_ids()) AND public.user_role(id) = 'admin');

CREATE POLICY "memberships_update_admin" ON public.memberships
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT user_org_ids()) AND public.user_role(org_id) = 'admin')
  WITH CHECK (org_id IN (SELECT user_org_ids()) AND public.user_role(org_id) = 'admin');
