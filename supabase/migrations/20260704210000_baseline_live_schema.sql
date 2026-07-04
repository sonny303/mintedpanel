-- ============================================================================
-- BASELINE SQUASH — public schema of hosted project fkvuhfsqcmujywzgczmc
-- Generated 2026-07-04 from the LIVE database (the source of truth), replacing
-- the 15 partial-mirror migration files now parked in supabase/migrations_archive/.
-- The 23 hosted migration versions this squashes remain listed in
-- docs/migration-baseline.md, which also documents the repo-first rule and the
-- verification run (fresh local Postgres built from this file, fingerprint-
-- diffed against live).
--
-- Assumptions: runs on a Supabase-provisioned Postgres (auth schema + roles
-- anon/authenticated/service_role + extensions schema already exist). Schema
-- only — org-scoped seed data lives in supabase/seed.sql.
-- ============================================================================

SET check_function_bodies = false;

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

CREATE TABLE public.audit_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  ts timestamp with time zone DEFAULT now(),
  user_id uuid,
  user_name text,
  action_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before jsonb,
  after jsonb,
  description text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.contracts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  group_id uuid,
  payer_id uuid,
  state text NOT NULL,
  effective_date date,
  expiration_date date,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  contracting_status_id uuid,
  payer_group_id text
);

CREATE TABLE public.credential_cases (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  group_id uuid,
  facility_id uuid,
  payer_id uuid NOT NULL,
  state text NOT NULL,
  specialty text DEFAULT 'Physical Therapy'::text,
  credentialing_status_id uuid,
  mso_id uuid,
  submitted_date date,
  approved_date date,
  expected_effective_date date,
  confirmed_effective_date date,
  termination_date date,
  assigned_to uuid,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  case_email_token text DEFAULT substr(md5((gen_random_uuid())::text), 1, 12) NOT NULL
);

CREATE TABLE public.facilities (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  group_id uuid,
  name text NOT NULL,
  street text,
  city text,
  state text,
  zip text,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  suite text,
  county text,
  phone text,
  fax text,
  email text,
  appointment_phone text,
  contact_name text,
  accepting_new_patients boolean DEFAULT true,
  language_line boolean DEFAULT false,
  languages_offered text[] DEFAULT '{}'::text[],
  interpreter_languages text[] DEFAULT '{}'::text[],
  hours jsonb DEFAULT '{}'::jsonb,
  ada_compliance jsonb DEFAULT '{}'::jsonb,
  service_types jsonb DEFAULT '{}'::jsonb,
  treating_categories jsonb DEFAULT '{}'::jsonb,
  status_id uuid,
  effective_date date
);

CREATE TABLE public.fill_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  case_id uuid NOT NULL,
  provider_id uuid,
  portal_key text NOT NULL,
  fill_mode text DEFAULT 'web'::text NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  fields_filled integer DEFAULT 0 NOT NULL,
  fields_skipped jsonb,
  docs_attached jsonb,
  performed_by uuid
);

CREATE TABLE public.group_insurance_policies (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  group_id uuid NOT NULL,
  insurance_type text NOT NULL,
  insurer_name text NOT NULL,
  policy_number text NOT NULL,
  policy_start_date date NOT NULL,
  policy_end_date date NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.launches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  group_id uuid NOT NULL,
  name text NOT NULL,
  gym_name text,
  address text,
  city text,
  state text NOT NULL,
  status text DEFAULT 'prospect'::text NOT NULL,
  target_month date,
  confirmed_start_date date,
  clinic_director_provider_id uuid,
  clinic_director_name text,
  facility_id uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.memberships (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.mso_routing_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  payer_id uuid,
  state text NOT NULL,
  specialty text DEFAULT 'All'::text NOT NULL,
  route_type text NOT NULL,
  mso_id uuid,
  notes text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.msos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  name text NOT NULL,
  portal_url text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.notes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  content text NOT NULL,
  author_id uuid,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.organizations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.payers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  name text NOT NULL,
  is_active boolean DEFAULT true,
  avg_decision_days integer,
  provisional_billing_allowed boolean DEFAULT false,
  provisional_billing_notes text,
  retro_billing_allowed boolean DEFAULT false,
  retro_billing_window_days integer,
  caqh_pull_deadline_days integer,
  provider_type_path text,
  prior_auth_vendor text,
  payer_billing_id text,
  portal_url text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.pending_invites (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  full_name text,
  invited_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.portal_field_maps (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid,
  portal_key text NOT NULL,
  url_pattern text,
  page_step text,
  map_type text NOT NULL,
  selector text NOT NULL,
  selector_fallbacks jsonb,
  source text NOT NULL,
  token text,
  hardcoded_value text,
  transform text,
  field_type text NOT NULL,
  notes text,
  status text DEFAULT 'proposed'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  full_name text,
  email text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.provider_documents (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  provider_id uuid,
  group_id uuid,
  case_id uuid,
  doc_type text NOT NULL,
  file_path text NOT NULL,
  file_name text NOT NULL,
  effective_date date,
  expiration_date date,
  uploaded_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.provider_facility_assignments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  provider_id uuid,
  facility_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  is_primary boolean DEFAULT false,
  start_date date,
  practice_frequency text
);

CREATE TABLE public.provider_groups (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  name text NOT NULL,
  tin text,
  npi_type2 text,
  states text[],
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  billing_street text,
  billing_city text,
  billing_state text,
  billing_zip text,
  correspondence_street text,
  correspondence_city text,
  correspondence_state text,
  correspondence_zip text,
  billing_suite text,
  billing_contact_name text,
  billing_phone text,
  billing_fax text,
  billing_email text,
  correspondence_suite text,
  correspondence_contact_name text,
  correspondence_phone text,
  correspondence_fax text,
  correspondence_email text,
  credentialing_street text,
  credentialing_suite text,
  credentialing_city text,
  credentialing_state text,
  credentialing_zip text,
  credentialing_contact_name text,
  credentialing_phone text,
  credentialing_fax text,
  credentialing_email text,
  contracting_contact_name text,
  contracting_contact_title text,
  contracting_contact_email text,
  website_url text,
  tax_id_type text,
  preferred_contact_method text,
  contract_signer_name text,
  contract_signer_email text
);

CREATE TABLE public.providers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  group_id uuid,
  first_name text NOT NULL,
  last_name text NOT NULL,
  credentials text,
  date_of_birth date,
  ssn_last4 text,
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
  taxonomy_code text DEFAULT '225100000X'::text,
  specialty text DEFAULT 'Physical Therapy'::text,
  start_date date,
  status text DEFAULT 'onboarding'::text NOT NULL,
  is_new_grad boolean DEFAULT false,
  terminated_date date,
  degree text,
  school_name text,
  graduation_date date,
  malpractice_carrier text,
  malpractice_policy_number text,
  malpractice_coverage_start date,
  malpractice_coverage_end date,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  license_number text,
  license_state text,
  license_issue_date date,
  license_expiration_date date,
  middle_initial text,
  suffix text,
  gender text,
  ethnicity text,
  dea_expiration_date date,
  board_certified boolean DEFAULT false,
  sub_specialty text,
  languages text[] DEFAULT '{}'::text[],
  medicaid_attested boolean DEFAULT false,
  cultural_competency_training boolean DEFAULT false,
  additional_certifications jsonb DEFAULT '[]'::jsonb,
  age_groups_served text[] DEFAULT '{}'::text[],
  launch_id uuid
);

CREATE TABLE public.sop_templates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  name text NOT NULL,
  group_id uuid,
  state text,
  specialty text,
  payer_id uuid,
  task_definitions jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  archived boolean DEFAULT false NOT NULL
);

CREATE TABLE public.state_licenses (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  provider_id uuid,
  state text NOT NULL,
  license_number text,
  license_type text,
  issue_date date,
  expiration_date date,
  status text DEFAULT 'active'::text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.status_configs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  track text NOT NULL,
  label text NOT NULL,
  color text NOT NULL,
  sort_order integer NOT NULL,
  required_fields jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  action_bucket text DEFAULT 'ours'::text NOT NULL
);

CREATE TABLE public.status_history (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  case_id uuid,
  contract_id uuid,
  track text NOT NULL,
  from_status_id uuid,
  to_status_id uuid,
  metadata jsonb,
  changed_by uuid,
  changed_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.tasks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  case_id uuid,
  provider_id uuid,
  title text NOT NULL,
  description text,
  sop_content jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'not_started'::text NOT NULL,
  sort_order integer DEFAULT 0,
  due_date date,
  completed_date date,
  is_auto_generated boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.touches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL,
  case_id uuid NOT NULL,
  touch_date date NOT NULL,
  touch_type text NOT NULL,
  outcome text NOT NULL,
  next_follow_up_date date,
  notes text,
  coordinator_id uuid,
  source text DEFAULT 'manual'::text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.user_table_prefs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  page_key text NOT NULL,
  prefs jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ----------------------------------------------------------------------------
-- Functions
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_invites()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_case_with_tasks(p_input jsonb, p_tasks jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := NULLIF(p_input->>'org_id','')::uuid;
  v_status uuid := NULLIF(p_input->>'credentialing_status_id','')::uuid;
  v_case public.credential_cases;
  v_task jsonb;
  v_task_id uuid;
  v_task_ids uuid[] := '{}';
  v_user uuid := auth.uid();
  v_user_name text;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'org_id is required';
  END IF;

  IF v_status IS NULL THEN
    SELECT id INTO v_status
    FROM public.status_configs
    WHERE org_id = v_org AND track = 'credentialing'
    ORDER BY sort_order ASC
    LIMIT 1;
    IF v_status IS NULL THEN
      RAISE EXCEPTION 'No credentialing status configured for this organization. Add at least one credentialing status before creating cases.';
    END IF;
  END IF;

  SELECT COALESCE(full_name, email) INTO v_user_name
  FROM public.profiles WHERE id = v_user;

  INSERT INTO public.credential_cases (
    org_id, provider_id, payer_id, state, group_id, facility_id, specialty,
    credentialing_status_id, mso_id, assigned_to,
    submitted_date, expected_effective_date, created_by
  ) VALUES (
    v_org,
    NULLIF(p_input->>'provider_id','')::uuid,
    NULLIF(p_input->>'payer_id','')::uuid,
    p_input->>'state',
    NULLIF(p_input->>'group_id','')::uuid,
    NULLIF(p_input->>'facility_id','')::uuid,
    NULLIF(p_input->>'specialty',''),
    v_status,
    NULLIF(p_input->>'mso_id','')::uuid,
    NULLIF(p_input->>'assigned_to','')::uuid,
    NULLIF(p_input->>'submitted_date','')::date,
    NULLIF(p_input->>'expected_effective_date','')::date,
    v_user
  )
  RETURNING * INTO v_case;

  INSERT INTO public.status_history (
    org_id, case_id, track, from_status_id, to_status_id, metadata, changed_by
  ) VALUES (
    v_org, v_case.id, 'credentialing', NULL, v_status, '{}'::jsonb, v_user
  );

  FOR v_task IN SELECT * FROM jsonb_array_elements(COALESCE(p_tasks, '[]'::jsonb)) LOOP
    INSERT INTO public.tasks (
      org_id, case_id, provider_id, title, description, sop_content,
      status, sort_order, due_date, is_auto_generated
    ) VALUES (
      v_org, v_case.id, v_case.provider_id,
      COALESCE(NULLIF(v_task->>'title',''), 'Task'),
      v_task->>'description',
      COALESCE(v_task->'sop_content', '[]'::jsonb),
      'not_started',
      COALESCE((v_task->>'sort_order')::int, 0),
      NULLIF(v_task->>'due_date','')::date,
      true
    )
    RETURNING id INTO v_task_id;
    v_task_ids := v_task_ids || v_task_id;
  END LOOP;

  INSERT INTO public.audit_log (
    org_id, user_id, user_name, action_type, entity_type, entity_id,
    before, after, description
  ) VALUES (
    v_org, v_user, v_user_name, 'CREATE', 'credential_case', v_case.id,
    NULL, to_jsonb(v_case), 'Created credentialing case'
  );

  IF COALESCE(array_length(v_task_ids, 1), 0) > 0 THEN
    INSERT INTO public.audit_log (
      org_id, user_id, user_name, action_type, entity_type, entity_id,
      before, after, description
    ) VALUES (
      v_org, v_user, v_user_name, 'CREATE', 'task', v_case.id,
      NULL,
      jsonb_build_object(
        'caseId', v_case.id,
        'count', array_length(v_task_ids, 1),
        'taskIds', to_jsonb(v_task_ids)
      ),
      'Auto-generated ' || array_length(v_task_ids, 1) || ' SOP task'
        || CASE WHEN array_length(v_task_ids, 1) = 1 THEN '' ELSE 's' END
        || ' for case'
    );
  END IF;

  RETURN to_jsonb(v_case);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_sop_field_tokens()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb := '[]'::jsonb;
  rec record;
  table_prefix text;
  camel_name text;
  parts text[];
  i int;
BEGIN
  FOR rec IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'providers',
        'provider_groups',
        'facilities',
        'msos',
        'group_insurance_policies',
        'payers',
        'contracts',
        'state_licenses',
        'provider_facility_assignments'
      )
      AND column_name NOT IN (
        'id','org_id','created_at','updated_at',
        'group_id','facility_id','provider_id','payer_id','mso_id',
        'status','is_active','is_new_grad',
        'contracting_status_id'
      )
    ORDER BY
      CASE table_name
        WHEN 'providers' THEN 1
        WHEN 'provider_groups' THEN 2
        WHEN 'facilities' THEN 3
        WHEN 'payers' THEN 4
        WHEN 'msos' THEN 5
        WHEN 'contracts' THEN 6
        WHEN 'state_licenses' THEN 7
        WHEN 'provider_facility_assignments' THEN 8
        WHEN 'group_insurance_policies' THEN 9
      END,
      ordinal_position
  LOOP
    table_prefix := CASE rec.table_name
      WHEN 'providers' THEN 'provider'
      WHEN 'provider_groups' THEN 'group'
      WHEN 'facilities' THEN 'facility'
      WHEN 'payers' THEN 'payer'
      WHEN 'msos' THEN 'mso'
      WHEN 'contracts' THEN 'contract'
      WHEN 'state_licenses' THEN 'license'
      WHEN 'provider_facility_assignments' THEN 'assignment'
      WHEN 'group_insurance_policies' THEN 'groupInsurance'
    END;

    parts := string_to_array(rec.column_name, '_');
    camel_name := parts[1];
    FOR i IN 2..array_length(parts, 1) LOOP
      camel_name := camel_name || initcap(parts[i]);
    END LOOP;

    result := result || jsonb_build_object(
      'token', table_prefix || '.' || camel_name,
      'table', rec.table_name,
      'column', rec.column_name
    );
  END LOOP;

  RETURN result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$
;

CREATE OR REPLACE FUNCTION public.user_org_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT org_id FROM public.memberships WHERE user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.user_role(p_org uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role FROM public.memberships
  WHERE user_id = auth.uid() AND org_id = p_org
  LIMIT 1;
$function$
;

-- ----------------------------------------------------------------------------
-- Primary keys, unique constraints, check constraints
-- ----------------------------------------------------------------------------

ALTER TABLE ONLY public.audit_log ADD CONSTRAINT audit_log_action_type_check CHECK ((action_type = ANY (ARRAY['CREATE'::text, 'UPDATE'::text, 'STATUS_CHANGE'::text, 'TOUCH_LOGGED'::text, 'TERMINATION'::text])));
ALTER TABLE ONLY public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.contracts ADD CONSTRAINT contracts_group_id_payer_id_state_key UNIQUE (group_id, payer_id, state);
ALTER TABLE ONLY public.contracts ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.credential_cases ADD CONSTRAINT credential_cases_case_email_token_key UNIQUE (case_email_token);
ALTER TABLE ONLY public.credential_cases ADD CONSTRAINT credential_cases_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.credential_cases ADD CONSTRAINT credential_cases_provider_id_payer_id_state_key UNIQUE (provider_id, payer_id, state);
ALTER TABLE ONLY public.facilities ADD CONSTRAINT facilities_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.fill_sessions ADD CONSTRAINT fill_sessions_fill_mode_check CHECK ((fill_mode = ANY (ARRAY['web'::text, 'pdf'::text])));
ALTER TABLE ONLY public.fill_sessions ADD CONSTRAINT fill_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.group_insurance_policies ADD CONSTRAINT group_insurance_policies_insurance_type_check CHECK ((insurance_type = ANY (ARRAY['professional_liability'::text, 'general_liability'::text])));
ALTER TABLE ONLY public.group_insurance_policies ADD CONSTRAINT group_insurance_policies_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.launches ADD CONSTRAINT launches_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.launches ADD CONSTRAINT launches_status_check CHECK ((status = ANY (ARRAY['prospect'::text, 'interviewing'::text, 'planned'::text, 'pending_fulfillment'::text, 'ready_for_launch'::text, 'live'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.memberships ADD CONSTRAINT memberships_org_id_user_id_key UNIQUE (org_id, user_id);
ALTER TABLE ONLY public.memberships ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.memberships ADD CONSTRAINT memberships_role_check CHECK ((role = ANY (ARRAY['specialist'::text, 'billing'::text, 'admin'::text])));
ALTER TABLE ONLY public.mso_routing_rules ADD CONSTRAINT mso_routing_rules_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.mso_routing_rules ADD CONSTRAINT mso_routing_rules_route_type_check CHECK ((route_type = ANY (ARRAY['direct'::text, 'mso'::text])));
ALTER TABLE ONLY public.msos ADD CONSTRAINT msos_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notes ADD CONSTRAINT notes_entity_type_check CHECK ((entity_type = ANY (ARRAY['case'::text, 'task'::text, 'provider'::text])));
ALTER TABLE ONLY public.notes ADD CONSTRAINT notes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.organizations ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payers ADD CONSTRAINT payers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payers ADD CONSTRAINT payers_provider_type_path_check CHECK ((provider_type_path = ANY (ARRAY['individual'::text, 'organizational'::text])));
ALTER TABLE ONLY public.pending_invites ADD CONSTRAINT pending_invites_org_id_email_key UNIQUE (org_id, email);
ALTER TABLE ONLY public.pending_invites ADD CONSTRAINT pending_invites_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pending_invites ADD CONSTRAINT pending_invites_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'specialist'::text, 'billing'::text])));
ALTER TABLE ONLY public.portal_field_maps ADD CONSTRAINT portal_field_maps_field_type_check CHECK ((field_type = ANY (ARRAY['text'::text, 'select'::text, 'radio'::text, 'checkbox'::text, 'date'::text, 'file'::text])));
ALTER TABLE ONLY public.portal_field_maps ADD CONSTRAINT portal_field_maps_hardcoded_required CHECK (((source <> 'hardcoded'::text) OR (hardcoded_value IS NOT NULL)));
ALTER TABLE ONLY public.portal_field_maps ADD CONSTRAINT portal_field_maps_map_type_check CHECK ((map_type = ANY (ARRAY['web'::text, 'pdf'::text])));
ALTER TABLE ONLY public.portal_field_maps ADD CONSTRAINT portal_field_maps_notes_required CHECK (((source <> ALL (ARRAY['manual'::text, 'manual_partial'::text])) OR (notes IS NOT NULL)));
ALTER TABLE ONLY public.portal_field_maps ADD CONSTRAINT portal_field_maps_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.portal_field_maps ADD CONSTRAINT portal_field_maps_source_check CHECK ((source = ANY (ARRAY['token'::text, 'manual'::text, 'manual_partial'::text, 'hardcoded'::text])));
ALTER TABLE ONLY public.portal_field_maps ADD CONSTRAINT portal_field_maps_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'approved'::text, 'retired'::text])));
ALTER TABLE ONLY public.portal_field_maps ADD CONSTRAINT portal_field_maps_token_required CHECK (((source <> ALL (ARRAY['token'::text, 'manual_partial'::text])) OR (token IS NOT NULL)));
ALTER TABLE ONLY public.portal_field_maps ADD CONSTRAINT portal_field_maps_transform_check CHECK ((transform = ANY (ARRAY['date_mmddyyyy'::text, 'phone_digits'::text, 'state_abbrev'::text, 'uppercase'::text])));
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.provider_documents ADD CONSTRAINT provider_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['w9'::text, 'coi'::text, 'state_license'::text, 'dea'::text, 'diploma'::text, 'board_cert'::text, 'voided_check'::text, 'filled_form'::text, 'other'::text])));
ALTER TABLE ONLY public.provider_documents ADD CONSTRAINT provider_documents_owner_required CHECK (((provider_id IS NOT NULL) OR (group_id IS NOT NULL) OR (case_id IS NOT NULL)));
ALTER TABLE ONLY public.provider_documents ADD CONSTRAINT provider_documents_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.provider_facility_assignments ADD CONSTRAINT provider_facility_assignments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.provider_facility_assignments ADD CONSTRAINT provider_facility_assignments_provider_id_facility_id_key UNIQUE (provider_id, facility_id);
ALTER TABLE ONLY public.provider_groups ADD CONSTRAINT provider_groups_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.providers ADD CONSTRAINT providers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.providers ADD CONSTRAINT providers_ssn_last4_check CHECK ((char_length(ssn_last4) = 4));
ALTER TABLE ONLY public.providers ADD CONSTRAINT providers_status_check CHECK ((status = ANY (ARRAY['onboarding'::text, 'active'::text, 'terminated'::text])));
ALTER TABLE ONLY public.sop_templates ADD CONSTRAINT sop_templates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.state_licenses ADD CONSTRAINT state_licenses_license_type_check CHECK ((license_type = ANY (ARRAY['full'::text, 'compact'::text])));
ALTER TABLE ONLY public.state_licenses ADD CONSTRAINT state_licenses_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.status_configs ADD CONSTRAINT status_configs_action_bucket_check CHECK ((action_bucket = ANY (ARRAY['ours'::text, 'waiting_payer'::text, 'waiting_provider'::text, 'complete'::text])));
ALTER TABLE ONLY public.status_configs ADD CONSTRAINT status_configs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.status_configs ADD CONSTRAINT status_configs_track_check CHECK ((track = ANY (ARRAY['credentialing'::text, 'contracting'::text, 'location'::text])));
ALTER TABLE ONLY public.status_history ADD CONSTRAINT status_history_check CHECK (((((case_id IS NOT NULL))::integer + ((contract_id IS NOT NULL))::integer) = 1));
ALTER TABLE ONLY public.status_history ADD CONSTRAINT status_history_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tasks ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tasks ADD CONSTRAINT tasks_status_check CHECK ((status = ANY (ARRAY['not_started'::text, 'in_progress'::text, 'completed'::text, 'blocked'::text])));
ALTER TABLE ONLY public.touches ADD CONSTRAINT touches_outcome_check CHECK ((outcome = ANY (ARRAY['reached'::text, 'left_voicemail'::text, 'no_answer'::text, 'response_received'::text, 'submitted'::text, 'no_response'::text, 'form_filled'::text])));
ALTER TABLE ONLY public.touches ADD CONSTRAINT touches_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.touches ADD CONSTRAINT touches_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'email_webhook'::text, 'extension'::text])));
ALTER TABLE ONLY public.touches ADD CONSTRAINT touches_touch_type_check CHECK ((touch_type = ANY (ARRAY['call'::text, 'email'::text, 'portal'::text, 'fax'::text])));
ALTER TABLE ONLY public.user_table_prefs ADD CONSTRAINT user_table_prefs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_table_prefs ADD CONSTRAINT user_table_prefs_user_id_page_key_key UNIQUE (user_id, page_key);

-- ----------------------------------------------------------------------------
-- Foreign keys
-- ----------------------------------------------------------------------------

ALTER TABLE ONLY public.audit_log ADD CONSTRAINT audit_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.contracts ADD CONSTRAINT contracts_contracting_status_id_fkey FOREIGN KEY (contracting_status_id) REFERENCES status_configs(id);
ALTER TABLE ONLY public.contracts ADD CONSTRAINT contracts_group_id_fkey FOREIGN KEY (group_id) REFERENCES provider_groups(id);
ALTER TABLE ONLY public.contracts ADD CONSTRAINT contracts_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.contracts ADD CONSTRAINT contracts_payer_id_fkey FOREIGN KEY (payer_id) REFERENCES payers(id);
ALTER TABLE ONLY public.credential_cases ADD CONSTRAINT credential_cases_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES profiles(id);
ALTER TABLE ONLY public.credential_cases ADD CONSTRAINT credential_cases_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
ALTER TABLE ONLY public.credential_cases ADD CONSTRAINT credential_cases_credentialing_status_id_fkey FOREIGN KEY (credentialing_status_id) REFERENCES status_configs(id);
ALTER TABLE ONLY public.credential_cases ADD CONSTRAINT credential_cases_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id);
ALTER TABLE ONLY public.credential_cases ADD CONSTRAINT credential_cases_group_id_fkey FOREIGN KEY (group_id) REFERENCES provider_groups(id);
ALTER TABLE ONLY public.credential_cases ADD CONSTRAINT credential_cases_mso_id_fkey FOREIGN KEY (mso_id) REFERENCES msos(id);
ALTER TABLE ONLY public.credential_cases ADD CONSTRAINT credential_cases_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.credential_cases ADD CONSTRAINT credential_cases_payer_id_fkey FOREIGN KEY (payer_id) REFERENCES payers(id);
ALTER TABLE ONLY public.credential_cases ADD CONSTRAINT credential_cases_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id);
ALTER TABLE ONLY public.facilities ADD CONSTRAINT facilities_group_id_fkey FOREIGN KEY (group_id) REFERENCES provider_groups(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.facilities ADD CONSTRAINT facilities_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.facilities ADD CONSTRAINT facilities_status_id_fkey FOREIGN KEY (status_id) REFERENCES status_configs(id);
ALTER TABLE ONLY public.fill_sessions ADD CONSTRAINT fill_sessions_case_id_fkey FOREIGN KEY (case_id) REFERENCES credential_cases(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.fill_sessions ADD CONSTRAINT fill_sessions_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.fill_sessions ADD CONSTRAINT fill_sessions_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.group_insurance_policies ADD CONSTRAINT group_insurance_policies_group_id_fkey FOREIGN KEY (group_id) REFERENCES provider_groups(id);
ALTER TABLE ONLY public.group_insurance_policies ADD CONSTRAINT group_insurance_policies_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.launches ADD CONSTRAINT launches_clinic_director_provider_id_fkey FOREIGN KEY (clinic_director_provider_id) REFERENCES providers(id);
ALTER TABLE ONLY public.launches ADD CONSTRAINT launches_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id);
ALTER TABLE ONLY public.launches ADD CONSTRAINT launches_group_id_fkey FOREIGN KEY (group_id) REFERENCES provider_groups(id);
ALTER TABLE ONLY public.launches ADD CONSTRAINT launches_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.memberships ADD CONSTRAINT memberships_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.memberships ADD CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.mso_routing_rules ADD CONSTRAINT mso_routing_rules_mso_id_fkey FOREIGN KEY (mso_id) REFERENCES msos(id);
ALTER TABLE ONLY public.mso_routing_rules ADD CONSTRAINT mso_routing_rules_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.mso_routing_rules ADD CONSTRAINT mso_routing_rules_payer_id_fkey FOREIGN KEY (payer_id) REFERENCES payers(id);
ALTER TABLE ONLY public.msos ADD CONSTRAINT msos_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.notes ADD CONSTRAINT notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES profiles(id);
ALTER TABLE ONLY public.notes ADD CONSTRAINT notes_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.payers ADD CONSTRAINT payers_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.pending_invites ADD CONSTRAINT pending_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id);
ALTER TABLE ONLY public.pending_invites ADD CONSTRAINT pending_invites_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.portal_field_maps ADD CONSTRAINT portal_field_maps_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.provider_documents ADD CONSTRAINT provider_documents_case_id_fkey FOREIGN KEY (case_id) REFERENCES credential_cases(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.provider_documents ADD CONSTRAINT provider_documents_group_id_fkey FOREIGN KEY (group_id) REFERENCES provider_groups(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.provider_documents ADD CONSTRAINT provider_documents_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.provider_documents ADD CONSTRAINT provider_documents_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.provider_facility_assignments ADD CONSTRAINT provider_facility_assignments_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id);
ALTER TABLE ONLY public.provider_facility_assignments ADD CONSTRAINT provider_facility_assignments_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.provider_facility_assignments ADD CONSTRAINT provider_facility_assignments_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id);
ALTER TABLE ONLY public.provider_groups ADD CONSTRAINT provider_groups_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.providers ADD CONSTRAINT providers_group_id_fkey FOREIGN KEY (group_id) REFERENCES provider_groups(id);
ALTER TABLE ONLY public.providers ADD CONSTRAINT providers_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES launches(id);
ALTER TABLE ONLY public.providers ADD CONSTRAINT providers_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.sop_templates ADD CONSTRAINT sop_templates_group_id_fkey FOREIGN KEY (group_id) REFERENCES provider_groups(id);
ALTER TABLE ONLY public.sop_templates ADD CONSTRAINT sop_templates_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.sop_templates ADD CONSTRAINT sop_templates_payer_id_fkey FOREIGN KEY (payer_id) REFERENCES payers(id);
ALTER TABLE ONLY public.state_licenses ADD CONSTRAINT state_licenses_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.state_licenses ADD CONSTRAINT state_licenses_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id);
ALTER TABLE ONLY public.status_configs ADD CONSTRAINT status_configs_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.status_history ADD CONSTRAINT status_history_case_id_fkey FOREIGN KEY (case_id) REFERENCES credential_cases(id);
ALTER TABLE ONLY public.status_history ADD CONSTRAINT status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES profiles(id);
ALTER TABLE ONLY public.status_history ADD CONSTRAINT status_history_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES contracts(id);
ALTER TABLE ONLY public.status_history ADD CONSTRAINT status_history_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.tasks ADD CONSTRAINT tasks_case_id_fkey FOREIGN KEY (case_id) REFERENCES credential_cases(id);
ALTER TABLE ONLY public.tasks ADD CONSTRAINT tasks_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.tasks ADD CONSTRAINT tasks_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES providers(id);
ALTER TABLE ONLY public.touches ADD CONSTRAINT touches_case_id_fkey FOREIGN KEY (case_id) REFERENCES credential_cases(id);
ALTER TABLE ONLY public.touches ADD CONSTRAINT touches_coordinator_id_fkey FOREIGN KEY (coordinator_id) REFERENCES profiles(id);
ALTER TABLE ONLY public.touches ADD CONSTRAINT touches_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
ALTER TABLE ONLY public.user_table_prefs ADD CONSTRAINT user_table_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ----------------------------------------------------------------------------
-- Standalone indexes (constraint-backed indexes are created by the constraints)
-- ----------------------------------------------------------------------------

CREATE INDEX idx_audit_log_org_id_ts ON public.audit_log USING btree (org_id, ts DESC);
CREATE INDEX idx_credential_cases_facility_id ON public.credential_cases USING btree (facility_id);
CREATE INDEX idx_credential_cases_org_id ON public.credential_cases USING btree (org_id);
CREATE INDEX idx_credential_cases_provider_id ON public.credential_cases USING btree (provider_id);
CREATE INDEX idx_facilities_status_id ON public.facilities USING btree (status_id);
CREATE INDEX fill_sessions_case_idx ON public.fill_sessions USING btree (case_id);
CREATE INDEX portal_field_maps_portal_status_idx ON public.portal_field_maps USING btree (portal_key, status);
CREATE INDEX provider_documents_case_idx ON public.provider_documents USING btree (case_id);
CREATE INDEX provider_documents_group_idx ON public.provider_documents USING btree (group_id);
CREATE INDEX provider_documents_provider_idx ON public.provider_documents USING btree (provider_id);
CREATE UNIQUE INDEX uq_state_licenses_provider_state_number ON public.state_licenses USING btree (provider_id, state, license_number);
CREATE INDEX idx_status_history_case_id ON public.status_history USING btree (case_id);
CREATE INDEX idx_tasks_case_id ON public.tasks USING btree (case_id);
CREATE INDEX idx_tasks_org_id ON public.tasks USING btree (org_id);
CREATE INDEX idx_touches_case_id ON public.touches USING btree (case_id);
CREATE INDEX idx_touches_org_id ON public.touches USING btree (org_id);

-- ----------------------------------------------------------------------------
-- Triggers
-- ----------------------------------------------------------------------------

CREATE TRIGGER portal_field_maps_set_updated_at BEFORE UPDATE ON public.portal_field_maps FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- Row level security
-- ----------------------------------------------------------------------------

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fill_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_insurance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mso_routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.msos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_field_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_facility_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sop_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.state_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.touches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_table_prefs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- Policies
-- ----------------------------------------------------------------------------

CREATE POLICY audit_log_insert ON public.audit_log FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY audit_log_select ON public.audit_log FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY contracts_insert ON public.contracts FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY contracts_select ON public.contracts FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY contracts_update ON public.contracts FOR UPDATE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))) WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY credential_cases_insert ON public.credential_cases FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY credential_cases_select ON public.credential_cases FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY credential_cases_update ON public.credential_cases FOR UPDATE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))) WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY facilities_insert_writer ON public.facilities FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY facilities_select_org ON public.facilities FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY facilities_update_writer ON public.facilities FOR UPDATE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))) WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY fill_sessions_insert_writer ON public.fill_sessions FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY fill_sessions_select_org ON public.fill_sessions FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY group_insurance_policies_insert ON public.group_insurance_policies FOR INSERT TO public WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY group_insurance_policies_select ON public.group_insurance_policies FOR SELECT TO public USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY group_insurance_policies_update ON public.group_insurance_policies FOR UPDATE TO public USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY launches_insert ON public.launches FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY launches_select ON public.launches FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY launches_update ON public.launches FOR UPDATE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))) WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY memberships_delete_admin ON public.memberships FOR DELETE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = 'admin'::text) AND (user_id <> ( SELECT auth.uid() AS uid))));
CREATE POLICY memberships_insert_admin ON public.memberships FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = 'admin'::text)));
CREATE POLICY memberships_select_org ON public.memberships FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY memberships_update_admin ON public.memberships FOR UPDATE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = 'admin'::text))) WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = 'admin'::text)));
CREATE POLICY mso_routing_rules_insert ON public.mso_routing_rules FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY mso_routing_rules_select ON public.mso_routing_rules FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY mso_routing_rules_update ON public.mso_routing_rules FOR UPDATE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))) WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY msos_insert ON public.msos FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY msos_select ON public.msos FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY msos_update ON public.msos FOR UPDATE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))) WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY notes_delete ON public.notes FOR DELETE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY notes_insert ON public.notes FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY notes_select ON public.notes FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY notes_update ON public.notes FOR UPDATE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))) WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY orgs_select_member ON public.organizations FOR SELECT TO authenticated USING ((id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY payers_insert ON public.payers FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY payers_select ON public.payers FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY payers_update ON public.payers FOR UPDATE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))) WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY pending_invites_delete_admin ON public.pending_invites FOR DELETE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = 'admin'::text)));
CREATE POLICY pending_invites_insert_admin ON public.pending_invites FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = 'admin'::text)));
CREATE POLICY pending_invites_select ON public.pending_invites FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY portal_field_maps_insert_writer ON public.portal_field_maps FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY portal_field_maps_select_org ON public.portal_field_maps FOR SELECT TO authenticated USING (((org_id IS NULL) OR (org_id IN ( SELECT user_org_ids() AS user_org_ids))));
CREATE POLICY portal_field_maps_update_writer ON public.portal_field_maps FOR UPDATE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))) WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY profiles_select_org_members ON public.profiles FOR SELECT TO public USING ((id IN ( SELECT m.user_id
   FROM memberships m
  WHERE (m.org_id IN ( SELECT user_org_ids() AS user_org_ids)))));
CREATE POLICY profiles_select_self ON public.profiles FOR SELECT TO authenticated USING ((id = auth.uid()));
CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));
CREATE POLICY provider_documents_delete_writer ON public.provider_documents FOR DELETE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY provider_documents_insert_writer ON public.provider_documents FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY provider_documents_select_org ON public.provider_documents FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY provider_facility_assignments_delete ON public.provider_facility_assignments FOR DELETE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY provider_facility_assignments_insert ON public.provider_facility_assignments FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY provider_facility_assignments_select ON public.provider_facility_assignments FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY provider_facility_assignments_update ON public.provider_facility_assignments FOR UPDATE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))) WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY provider_groups_insert_writer ON public.provider_groups FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY provider_groups_select_org ON public.provider_groups FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY provider_groups_update_writer ON public.provider_groups FOR UPDATE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))) WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY providers_insert ON public.providers FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY providers_select ON public.providers FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY providers_update ON public.providers FOR UPDATE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))) WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY sop_templates_insert ON public.sop_templates FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = 'admin'::text)));
CREATE POLICY sop_templates_select ON public.sop_templates FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY sop_templates_update ON public.sop_templates FOR UPDATE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = 'admin'::text))) WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = 'admin'::text)));
CREATE POLICY state_licenses_delete ON public.state_licenses FOR DELETE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY state_licenses_insert ON public.state_licenses FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY state_licenses_select ON public.state_licenses FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY state_licenses_update ON public.state_licenses FOR UPDATE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))) WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY status_configs_insert ON public.status_configs FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = 'admin'::text)));
CREATE POLICY status_configs_select ON public.status_configs FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY status_configs_update ON public.status_configs FOR UPDATE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = 'admin'::text))) WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = 'admin'::text)));
CREATE POLICY status_history_insert ON public.status_history FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY status_history_select ON public.status_history FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY tasks_insert ON public.tasks FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY tasks_select ON public.tasks FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY tasks_update ON public.tasks FOR UPDATE TO authenticated USING (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))) WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY touches_insert ON public.touches FOR INSERT TO authenticated WITH CHECK (((org_id IN ( SELECT user_org_ids() AS user_org_ids)) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text]))));
CREATE POLICY touches_select ON public.touches FOR SELECT TO authenticated USING ((org_id IN ( SELECT user_org_ids() AS user_org_ids)));
CREATE POLICY user_table_prefs_insert ON public.user_table_prefs FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY user_table_prefs_select ON public.user_table_prefs FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY user_table_prefs_update ON public.user_table_prefs FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------

COMMENT ON COLUMN public.provider_groups.billing_street IS 'Street address where payers send checks and EOBs';
COMMENT ON COLUMN public.provider_groups.correspondence_street IS 'Street address where payers send credentialing and contracting mail';

-- ----------------------------------------------------------------------------
-- Table grants (deterministic: revoke, then grant the observed live set)
-- ----------------------------------------------------------------------------

REVOKE ALL ON public.audit_log FROM anon;
REVOKE ALL ON public.audit_log FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.audit_log TO authenticated;
REVOKE ALL ON public.audit_log FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.audit_log TO service_role;
REVOKE ALL ON public.contracts FROM anon;
REVOKE ALL ON public.contracts FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.contracts TO authenticated;
REVOKE ALL ON public.contracts FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.contracts TO service_role;
REVOKE ALL ON public.credential_cases FROM anon;
REVOKE ALL ON public.credential_cases FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.credential_cases TO authenticated;
REVOKE ALL ON public.credential_cases FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.credential_cases TO service_role;
REVOKE ALL ON public.facilities FROM anon;
REVOKE ALL ON public.facilities FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.facilities TO authenticated;
REVOKE ALL ON public.facilities FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.facilities TO service_role;
REVOKE ALL ON public.fill_sessions FROM anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.fill_sessions TO anon;
REVOKE ALL ON public.fill_sessions FROM authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.fill_sessions TO authenticated;
REVOKE ALL ON public.fill_sessions FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.fill_sessions TO service_role;
REVOKE ALL ON public.group_insurance_policies FROM anon;
REVOKE ALL ON public.group_insurance_policies FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.group_insurance_policies TO authenticated;
REVOKE ALL ON public.group_insurance_policies FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.group_insurance_policies TO service_role;
REVOKE ALL ON public.launches FROM anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.launches TO anon;
REVOKE ALL ON public.launches FROM authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.launches TO authenticated;
REVOKE ALL ON public.launches FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.launches TO service_role;
REVOKE ALL ON public.memberships FROM anon;
REVOKE ALL ON public.memberships FROM authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.memberships TO authenticated;
REVOKE ALL ON public.memberships FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.memberships TO service_role;
REVOKE ALL ON public.mso_routing_rules FROM anon;
REVOKE ALL ON public.mso_routing_rules FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.mso_routing_rules TO authenticated;
REVOKE ALL ON public.mso_routing_rules FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.mso_routing_rules TO service_role;
REVOKE ALL ON public.msos FROM anon;
REVOKE ALL ON public.msos FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.msos TO authenticated;
REVOKE ALL ON public.msos FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.msos TO service_role;
REVOKE ALL ON public.notes FROM anon;
REVOKE ALL ON public.notes FROM authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.notes TO authenticated;
REVOKE ALL ON public.notes FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.notes TO service_role;
REVOKE ALL ON public.organizations FROM anon;
REVOKE ALL ON public.organizations FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.organizations TO authenticated;
REVOKE ALL ON public.organizations FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.organizations TO service_role;
REVOKE ALL ON public.payers FROM anon;
REVOKE ALL ON public.payers FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.payers TO authenticated;
REVOKE ALL ON public.payers FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.payers TO service_role;
REVOKE ALL ON public.pending_invites FROM anon;
REVOKE ALL ON public.pending_invites FROM authenticated;
GRANT DELETE, INSERT, SELECT ON public.pending_invites TO authenticated;
REVOKE ALL ON public.pending_invites FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.pending_invites TO service_role;
REVOKE ALL ON public.portal_field_maps FROM anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.portal_field_maps TO anon;
REVOKE ALL ON public.portal_field_maps FROM authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.portal_field_maps TO authenticated;
REVOKE ALL ON public.portal_field_maps FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.portal_field_maps TO service_role;
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.profiles FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.profiles TO authenticated;
REVOKE ALL ON public.profiles FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.profiles TO service_role;
REVOKE ALL ON public.provider_documents FROM anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.provider_documents TO anon;
REVOKE ALL ON public.provider_documents FROM authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.provider_documents TO authenticated;
REVOKE ALL ON public.provider_documents FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.provider_documents TO service_role;
REVOKE ALL ON public.provider_facility_assignments FROM anon;
REVOKE ALL ON public.provider_facility_assignments FROM authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.provider_facility_assignments TO authenticated;
REVOKE ALL ON public.provider_facility_assignments FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.provider_facility_assignments TO service_role;
REVOKE ALL ON public.provider_groups FROM anon;
REVOKE ALL ON public.provider_groups FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.provider_groups TO authenticated;
REVOKE ALL ON public.provider_groups FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.provider_groups TO service_role;
REVOKE ALL ON public.providers FROM anon;
REVOKE ALL ON public.providers FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.providers TO authenticated;
REVOKE ALL ON public.providers FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.providers TO service_role;
REVOKE ALL ON public.sop_templates FROM anon;
REVOKE ALL ON public.sop_templates FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.sop_templates TO authenticated;
REVOKE ALL ON public.sop_templates FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sop_templates TO service_role;
REVOKE ALL ON public.state_licenses FROM anon;
REVOKE ALL ON public.state_licenses FROM authenticated;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.state_licenses TO authenticated;
REVOKE ALL ON public.state_licenses FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.state_licenses TO service_role;
REVOKE ALL ON public.status_configs FROM anon;
REVOKE ALL ON public.status_configs FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.status_configs TO authenticated;
REVOKE ALL ON public.status_configs FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.status_configs TO service_role;
REVOKE ALL ON public.status_history FROM anon;
REVOKE ALL ON public.status_history FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.status_history TO authenticated;
REVOKE ALL ON public.status_history FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.status_history TO service_role;
REVOKE ALL ON public.tasks FROM anon;
REVOKE ALL ON public.tasks FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.tasks TO authenticated;
REVOKE ALL ON public.tasks FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tasks TO service_role;
REVOKE ALL ON public.touches FROM anon;
REVOKE ALL ON public.touches FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.touches TO authenticated;
REVOKE ALL ON public.touches FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.touches TO service_role;
REVOKE ALL ON public.user_table_prefs FROM anon;
REVOKE ALL ON public.user_table_prefs FROM authenticated;
GRANT INSERT, SELECT, UPDATE ON public.user_table_prefs TO authenticated;
REVOKE ALL ON public.user_table_prefs FROM service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_table_prefs TO service_role;

-- ----------------------------------------------------------------------------
-- Function grants (deterministic, matching live)
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.claim_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_invites() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_case_with_tasks(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_case_with_tasks(jsonb, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_sop_field_tokens() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sop_field_tokens() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.user_org_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_org_ids() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.user_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_role(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Event trigger: auto-enable RLS on new public tables.
-- Guarded: creating event triggers needs elevated privileges; skip gracefully
-- where unavailable (matches the additive-guard rule for repo-only rebuilds).
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
    WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
    EXECUTE FUNCTION public.rls_auto_enable();
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ensure_rls event trigger not created (insufficient privilege)';
END $$;
