
-- 1. status_configs
CREATE TABLE public.status_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  track text NOT NULL CHECK (track IN ('credentialing','contracting')),
  label text NOT NULL,
  color text NOT NULL,
  sort_order int NOT NULL,
  required_fields jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.status_configs TO authenticated;
GRANT ALL ON public.status_configs TO service_role;
ALTER TABLE public.status_configs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.contracts ADD COLUMN contracting_status_id uuid REFERENCES public.status_configs(id);

-- 2. credential_cases
CREATE TABLE public.credential_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  provider_id uuid NOT NULL REFERENCES public.providers(id),
  group_id uuid REFERENCES public.provider_groups(id),
  facility_id uuid REFERENCES public.facilities(id),
  payer_id uuid NOT NULL REFERENCES public.payers(id),
  state text NOT NULL,
  specialty text DEFAULT 'Physical Therapy',
  credentialing_status_id uuid REFERENCES public.status_configs(id),
  mso_id uuid REFERENCES public.msos(id),
  submitted_date date,
  approved_date date,
  expected_effective_date date,
  confirmed_effective_date date,
  termination_date date,
  assigned_to uuid REFERENCES public.profiles(id),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (provider_id, payer_id, state)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credential_cases TO authenticated;
GRANT ALL ON public.credential_cases TO service_role;
ALTER TABLE public.credential_cases ENABLE ROW LEVEL SECURITY;

-- 3. touches
CREATE TABLE public.touches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  case_id uuid NOT NULL REFERENCES public.credential_cases(id),
  touch_date date NOT NULL,
  touch_type text NOT NULL CHECK (touch_type IN ('call','email','portal','fax')),
  outcome text NOT NULL CHECK (outcome IN ('reached','left_voicemail','no_answer','response_received','submitted','no_response')),
  next_follow_up_date date,
  notes text,
  coordinator_id uuid REFERENCES public.profiles(id),
  source text DEFAULT 'manual' CHECK (source IN ('manual','email_webhook')),
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.touches TO authenticated;
GRANT ALL ON public.touches TO service_role;
ALTER TABLE public.touches ENABLE ROW LEVEL SECURITY;

-- 4. tasks
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  case_id uuid REFERENCES public.credential_cases(id),
  provider_id uuid REFERENCES public.providers(id),
  title text NOT NULL,
  description text,
  sop_content jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed','blocked')),
  sort_order int DEFAULT 0,
  due_date date,
  completed_date date,
  is_auto_generated boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- 5. notes
CREATE TABLE public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  entity_type text NOT NULL CHECK (entity_type IN ('case','task','provider')),
  entity_id uuid NOT NULL,
  content text NOT NULL,
  author_id uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO authenticated;
GRANT ALL ON public.notes TO service_role;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

-- 6. sop_templates
CREATE TABLE public.sop_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  group_id uuid REFERENCES public.provider_groups(id),
  state text,
  specialty text,
  payer_id uuid REFERENCES public.payers(id),
  task_definitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sop_templates TO authenticated;
GRANT ALL ON public.sop_templates TO service_role;
ALTER TABLE public.sop_templates ENABLE ROW LEVEL SECURITY;

-- 7. status_history
CREATE TABLE public.status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  case_id uuid REFERENCES public.credential_cases(id),
  contract_id uuid REFERENCES public.contracts(id),
  track text NOT NULL,
  from_status_id uuid,
  to_status_id uuid,
  metadata jsonb,
  changed_by uuid REFERENCES public.profiles(id),
  changed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  CHECK ((case_id IS NOT NULL)::int + (contract_id IS NOT NULL)::int = 1)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.status_history TO authenticated;
GRANT ALL ON public.status_history TO service_role;
ALTER TABLE public.status_history ENABLE ROW LEVEL SECURITY;

-- 8. audit_log
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  ts timestamptz DEFAULT now(),
  user_id uuid,
  user_name text,
  action_type text NOT NULL CHECK (action_type IN ('CREATE','UPDATE','STATUS_CHANGE','TOUCH_LOGGED','TERMINATION')),
  entity_type text NOT NULL,
  entity_id uuid,
  before jsonb,
  after jsonb,
  description text,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Policies
-- Editable tables (select + insert + update) for specialist/admin
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['credential_cases','tasks','notes']) LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (org_id IN (SELECT public.user_org_ids()))', t||'_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) IN (''specialist'',''admin''))', t||'_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) IN (''specialist'',''admin'')) WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) IN (''specialist'',''admin''))', t||'_update', t);
  END LOOP;
END $$;

-- Admin-only tables (status_configs, sop_templates)
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['status_configs','sop_templates']) LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (org_id IN (SELECT public.user_org_ids()))', t||'_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) = ''admin'')', t||'_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) = ''admin'') WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) = ''admin'')', t||'_update', t);
  END LOOP;
END $$;

-- Append-only tables (touches, status_history, audit_log): select + insert only, no update, no delete
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['touches','status_history','audit_log']) LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (org_id IN (SELECT public.user_org_ids()))', t||'_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (org_id IN (SELECT public.user_org_ids()) AND public.user_role(org_id) IN (''specialist'',''admin''))', t||'_insert', t);
  END LOOP;
END $$;
