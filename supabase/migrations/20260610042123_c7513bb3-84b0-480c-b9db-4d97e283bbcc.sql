
-- providers
CREATE TABLE public.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  group_id uuid REFERENCES public.provider_groups(id),
  first_name text NOT NULL,
  last_name text NOT NULL,
  credentials text,
  date_of_birth date,
  ssn_last4 text CHECK (char_length(ssn_last4) = 4),
  email text,
  phone text,
  home_street text,
  home_city text,
  home_state text,
  home_zip text,
  npi text,
  caqh_id text,
  caqh_last_attested_date date,
  dea_number text,
  taxonomy_code text DEFAULT '225100000X',
  specialty text DEFAULT 'Physical Therapy',
  start_date date,
  status text NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding','active','terminated')),
  is_new_grad boolean DEFAULT false,
  terminated_date date,
  degree text,
  school_name text,
  graduation_date date,
  malpractice_carrier text,
  malpractice_policy_number text,
  malpractice_coverage_start date,
  malpractice_coverage_end date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.providers TO authenticated;
GRANT ALL ON public.providers TO service_role;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;

-- state_licenses
CREATE TABLE public.state_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  provider_id uuid REFERENCES public.providers(id),
  state text NOT NULL,
  license_number text,
  license_type text CHECK (license_type IN ('full','compact')),
  issue_date date,
  expiration_date date,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.state_licenses TO authenticated;
GRANT ALL ON public.state_licenses TO service_role;
ALTER TABLE public.state_licenses ENABLE ROW LEVEL SECURITY;

-- provider_facility_assignments
CREATE TABLE public.provider_facility_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  provider_id uuid REFERENCES public.providers(id),
  facility_id uuid REFERENCES public.facilities(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE (provider_id, facility_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_facility_assignments TO authenticated;
GRANT ALL ON public.provider_facility_assignments TO service_role;
ALTER TABLE public.provider_facility_assignments ENABLE ROW LEVEL SECURITY;

-- payers
CREATE TABLE public.payers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  is_active boolean DEFAULT true,
  avg_decision_days int,
  provisional_billing_allowed boolean DEFAULT false,
  provisional_billing_notes text,
  retro_billing_allowed boolean DEFAULT false,
  retro_billing_window_days int,
  caqh_pull_deadline_days int,
  provider_type_path text CHECK (provider_type_path IN ('individual','organizational')),
  prior_auth_vendor text,
  payer_billing_id text,
  portal_url text,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payers TO authenticated;
GRANT ALL ON public.payers TO service_role;
ALTER TABLE public.payers ENABLE ROW LEVEL SECURITY;

-- msos
CREATE TABLE public.msos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  portal_url text,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.msos TO authenticated;
GRANT ALL ON public.msos TO service_role;
ALTER TABLE public.msos ENABLE ROW LEVEL SECURITY;

-- mso_routing_rules
CREATE TABLE public.mso_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  payer_id uuid REFERENCES public.payers(id),
  state text NOT NULL,
  specialty text NOT NULL DEFAULT 'All',
  route_type text NOT NULL CHECK (route_type IN ('direct','mso')),
  mso_id uuid REFERENCES public.msos(id),
  notes text,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mso_routing_rules TO authenticated;
GRANT ALL ON public.mso_routing_rules TO service_role;
ALTER TABLE public.mso_routing_rules ENABLE ROW LEVEL SECURITY;

-- contracts
CREATE TABLE public.contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  group_id uuid REFERENCES public.provider_groups(id),
  payer_id uuid REFERENCES public.payers(id),
  state text NOT NULL,
  effective_date date,
  expiration_date date,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (group_id, payer_id, state)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contracts TO authenticated;
GRANT ALL ON public.contracts TO service_role;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

-- Policies: select for any org member; insert/update for specialist/admin only; no delete.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['providers','state_licenses','provider_facility_assignments','payers','msos','mso_routing_rules','contracts'])
  LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (org_id IN (SELECT public.user_org_ids()))', t||'_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) IN (''specialist'',''admin''))', t||'_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) IN (''specialist'',''admin'')) WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) IN (''specialist'',''admin''))', t||'_update', t);
  END LOOP;
END $$;
