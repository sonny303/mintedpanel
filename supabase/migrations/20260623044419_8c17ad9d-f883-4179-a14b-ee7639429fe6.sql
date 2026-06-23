CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.group_insurance_policies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.provider_groups(id) ON DELETE CASCADE,
  insurance_type TEXT NOT NULL CHECK (insurance_type IN ('professional_liability','general_liability')),
  insurer_name TEXT NOT NULL,
  policy_number TEXT NOT NULL,
  policy_start_date DATE NOT NULL,
  policy_end_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX group_insurance_policies_group_idx ON public.group_insurance_policies(group_id);
CREATE INDEX group_insurance_policies_org_idx ON public.group_insurance_policies(org_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_insurance_policies TO authenticated;
GRANT ALL ON public.group_insurance_policies TO service_role;

ALTER TABLE public.group_insurance_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_insurance_policies_select_org ON public.group_insurance_policies
  FOR SELECT USING (org_id IN (SELECT user_org_ids()));

CREATE POLICY group_insurance_policies_insert_writer ON public.group_insurance_policies
  FOR INSERT WITH CHECK (
    org_id IN (SELECT user_org_ids())
    AND user_role(org_id) = ANY (ARRAY['specialist','admin'])
  );

CREATE POLICY group_insurance_policies_update_writer ON public.group_insurance_policies
  FOR UPDATE USING (
    org_id IN (SELECT user_org_ids())
    AND user_role(org_id) = ANY (ARRAY['specialist','admin'])
  ) WITH CHECK (
    org_id IN (SELECT user_org_ids())
    AND user_role(org_id) = ANY (ARRAY['specialist','admin'])
  );

CREATE TRIGGER group_insurance_policies_set_updated_at
  BEFORE UPDATE ON public.group_insurance_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();