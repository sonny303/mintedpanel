
-- Scope group_insurance_policies to authenticated
DROP POLICY IF EXISTS group_insurance_policies_select_org ON public.group_insurance_policies;
DROP POLICY IF EXISTS group_insurance_policies_insert_writer ON public.group_insurance_policies;
DROP POLICY IF EXISTS group_insurance_policies_update_writer ON public.group_insurance_policies;

CREATE POLICY group_insurance_policies_select_org ON public.group_insurance_policies
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids()));

CREATE POLICY group_insurance_policies_insert_writer ON public.group_insurance_policies
  FOR INSERT TO authenticated
  WITH CHECK ((org_id IN (SELECT user_org_ids())) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])));

CREATE POLICY group_insurance_policies_update_writer ON public.group_insurance_policies
  FOR UPDATE TO authenticated
  USING ((org_id IN (SELECT user_org_ids())) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))
  WITH CHECK ((org_id IN (SELECT user_org_ids())) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])));

-- Add explicit admin-only INSERT policy on memberships
CREATE POLICY memberships_insert_admin ON public.memberships
  FOR INSERT TO authenticated
  WITH CHECK ((org_id IN (SELECT user_org_ids())) AND (user_role(org_id) = 'admin'::text));

-- Allow org members to read each other's profiles
CREATE POLICY profiles_select_org_members ON public.profiles
  FOR SELECT TO authenticated
  USING (id IN (SELECT user_id FROM public.memberships WHERE org_id IN (SELECT user_org_ids())));

-- Scope user_table_prefs to authenticated
DROP POLICY IF EXISTS "Users manage own table prefs" ON public.user_table_prefs;
CREATE POLICY "Users manage own table prefs" ON public.user_table_prefs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
