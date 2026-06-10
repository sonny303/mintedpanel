
-- ============ TABLES ============

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('specialist','billing','admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memberships TO authenticated;
GRANT ALL ON public.memberships TO service_role;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.provider_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  tin text,
  npi_type2 text,
  states text[],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_groups TO authenticated;
GRANT ALL ON public.provider_groups TO service_role;
ALTER TABLE public.provider_groups ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  group_id uuid REFERENCES public.provider_groups(id) ON DELETE SET NULL,
  name text NOT NULL,
  street text,
  city text,
  state text,
  zip text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facilities TO authenticated;
GRANT ALL ON public.facilities TO service_role;
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;

-- ============ HELPER FUNCTIONS ============

CREATE OR REPLACE FUNCTION public.user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.memberships WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.user_role(p_org uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.memberships
  WHERE user_id = auth.uid() AND org_id = p_org
  LIMIT 1;
$$;

-- ============ RLS POLICIES ============

-- organizations
CREATE POLICY "orgs_select_member" ON public.organizations
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.user_org_ids()));

-- profiles
CREATE POLICY "profiles_select_self" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- memberships
CREATE POLICY "memberships_select_org" ON public.memberships
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));

-- provider_groups
CREATE POLICY "provider_groups_select_org" ON public.provider_groups
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "provider_groups_insert_writer" ON public.provider_groups
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT public.user_org_ids())
    AND public.user_role(org_id) IN ('specialist','admin')
  );

CREATE POLICY "provider_groups_update_writer" ON public.provider_groups
  FOR UPDATE TO authenticated
  USING (
    org_id IN (SELECT public.user_org_ids())
    AND public.user_role(org_id) IN ('specialist','admin')
  )
  WITH CHECK (
    org_id IN (SELECT public.user_org_ids())
    AND public.user_role(org_id) IN ('specialist','admin')
  );

-- facilities
CREATE POLICY "facilities_select_org" ON public.facilities
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.user_org_ids()));

CREATE POLICY "facilities_insert_writer" ON public.facilities
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT public.user_org_ids())
    AND public.user_role(org_id) IN ('specialist','admin')
  );

CREATE POLICY "facilities_update_writer" ON public.facilities
  FOR UPDATE TO authenticated
  USING (
    org_id IN (SELECT public.user_org_ids())
    AND public.user_role(org_id) IN ('specialist','admin')
  )
  WITH CHECK (
    org_id IN (SELECT public.user_org_ids())
    AND public.user_role(org_id) IN ('specialist','admin')
  );

-- ============ SIGNUP TRIGGER ============

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
