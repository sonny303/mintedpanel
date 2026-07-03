-- Portal fill infrastructure (extension build spec v1.2, section 6)
-- portal_field_maps, provider_documents, fill_sessions, touches constraint
-- updates, and the provider-documents / form-templates storage buckets.

-- Same definition as 20260623044419; the live database is missing it.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ PORTAL_FIELD_MAPS ============
CREATE TABLE public.portal_field_maps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  portal_key TEXT NOT NULL,
  url_pattern TEXT,
  page_step TEXT,
  map_type TEXT NOT NULL CHECK (map_type IN ('web','pdf')),
  selector TEXT NOT NULL,
  selector_fallbacks JSONB,
  source TEXT NOT NULL CHECK (source IN ('token','manual','manual_partial','hardcoded')),
  token TEXT,
  hardcoded_value TEXT,
  transform TEXT CHECK (transform IN ('date_mmddyyyy','phone_digits','state_abbrev','uppercase')),
  field_type TEXT NOT NULL CHECK (field_type IN ('text','select','radio','checkbox','date','file')),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT portal_field_maps_token_required
    CHECK (source NOT IN ('token','manual_partial') OR token IS NOT NULL),
  CONSTRAINT portal_field_maps_hardcoded_required
    CHECK (source <> 'hardcoded' OR hardcoded_value IS NOT NULL),
  CONSTRAINT portal_field_maps_notes_required
    CHECK (source NOT IN ('manual','manual_partial') OR notes IS NOT NULL)
);

CREATE INDEX portal_field_maps_portal_status_idx
  ON public.portal_field_maps (portal_key, status);

ALTER TABLE public.portal_field_maps ENABLE ROW LEVEL SECURITY;

-- A NULL org_id row is a shared/global map, readable by every org.
CREATE POLICY portal_field_maps_select_org ON public.portal_field_maps
  FOR SELECT TO authenticated
  USING (org_id IS NULL OR org_id IN (SELECT user_org_ids()));

CREATE POLICY portal_field_maps_insert_writer ON public.portal_field_maps
  FOR INSERT TO authenticated
  WITH CHECK ((org_id IN (SELECT user_org_ids())) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])));

CREATE POLICY portal_field_maps_update_writer ON public.portal_field_maps
  FOR UPDATE TO authenticated
  USING ((org_id IN (SELECT user_org_ids())) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])))
  WITH CHECK ((org_id IN (SELECT user_org_ids())) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])));

CREATE TRIGGER portal_field_maps_set_updated_at
  BEFORE UPDATE ON public.portal_field_maps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_field_maps TO authenticated;
GRANT ALL ON public.portal_field_maps TO service_role;

-- ============ PROVIDER_DOCUMENTS ============
CREATE TABLE public.provider_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES public.providers(id) ON DELETE CASCADE,
  group_id UUID REFERENCES public.provider_groups(id) ON DELETE CASCADE,
  case_id UUID REFERENCES public.credential_cases(id) ON DELETE SET NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('w9','coi','state_license','dea','diploma','board_cert','voided_check','filled_form','other')),
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  effective_date DATE,
  expiration_date DATE,
  uploaded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT provider_documents_owner_required
    CHECK (provider_id IS NOT NULL OR group_id IS NOT NULL OR case_id IS NOT NULL)
);

CREATE INDEX provider_documents_provider_idx ON public.provider_documents (provider_id);
CREATE INDEX provider_documents_group_idx ON public.provider_documents (group_id);
CREATE INDEX provider_documents_case_idx ON public.provider_documents (case_id);

ALTER TABLE public.provider_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY provider_documents_select_org ON public.provider_documents
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids()));

CREATE POLICY provider_documents_insert_writer ON public.provider_documents
  FOR INSERT TO authenticated
  WITH CHECK ((org_id IN (SELECT user_org_ids())) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])));

CREATE POLICY provider_documents_delete_writer ON public.provider_documents
  FOR DELETE TO authenticated
  USING ((org_id IN (SELECT user_org_ids())) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_documents TO authenticated;
GRANT ALL ON public.provider_documents TO service_role;

-- ============ FILL_SESSIONS (append-only, like touches) ============
CREATE TABLE public.fill_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES public.credential_cases(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES public.providers(id) ON DELETE SET NULL,
  portal_key TEXT NOT NULL,
  fill_mode TEXT NOT NULL DEFAULT 'web' CHECK (fill_mode IN ('web','pdf')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  fields_filled INT NOT NULL DEFAULT 0,
  fields_skipped JSONB,
  docs_attached JSONB,
  performed_by UUID
);

CREATE INDEX fill_sessions_case_idx ON public.fill_sessions (case_id);

ALTER TABLE public.fill_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY fill_sessions_select_org ON public.fill_sessions
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT user_org_ids()));

-- Append-only: INSERT policy only, no UPDATE or DELETE.
CREATE POLICY fill_sessions_insert_writer ON public.fill_sessions
  FOR INSERT TO authenticated
  WITH CHECK ((org_id IN (SELECT user_org_ids())) AND (user_role(org_id) = ANY (ARRAY['specialist'::text, 'admin'::text])));

GRANT SELECT, INSERT ON public.fill_sessions TO authenticated;
GRANT ALL ON public.fill_sessions TO service_role;

-- ============ TOUCHES CONSTRAINTS ============
-- Automated fills log touches with source 'extension' (covers both the
-- Chrome extension and the fill-pdf edge function) and outcome 'form_filled'
-- (fill and attach only — never submitted by automation).
ALTER TABLE public.touches DROP CONSTRAINT touches_source_check;
ALTER TABLE public.touches ADD CONSTRAINT touches_source_check
  CHECK (source = ANY (ARRAY['manual'::text, 'email_webhook'::text, 'extension'::text]));

ALTER TABLE public.touches DROP CONSTRAINT touches_outcome_check;
ALTER TABLE public.touches ADD CONSTRAINT touches_outcome_check
  CHECK (outcome = ANY (ARRAY['reached'::text, 'left_voicemail'::text, 'no_answer'::text, 'response_received'::text, 'submitted'::text, 'no_response'::text, 'form_filled'::text]));

-- ============ TOKEN VOCABULARY ACCESS ============
-- The resolve-fill edge function reads the token vocabulary under the
-- caller's JWT; re-grant execute to authenticated (revoked in 20260623044730).
GRANT EXECUTE ON FUNCTION public.get_sop_field_tokens() TO authenticated;

-- ============ STORAGE BUCKETS ============
INSERT INTO storage.buckets (id, name, public)
VALUES ('provider-documents', 'provider-documents', false),
       ('form-templates', 'form-templates', false)
ON CONFLICT (id) DO NOTHING;

-- provider-documents: object paths are {org_id}/... — org membership scopes access.
CREATE POLICY provider_documents_objects_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'provider-documents' AND (storage.foldername(name))[1] IN (SELECT user_org_ids()::text));

CREATE POLICY provider_documents_objects_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'provider-documents' AND (storage.foldername(name))[1] IN (SELECT user_org_ids()::text));

CREATE POLICY provider_documents_objects_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'provider-documents' AND (storage.foldername(name))[1] IN (SELECT user_org_ids()::text));

-- form-templates: blank payer forms, shared across orgs. Any member reads;
-- specialists/admins manage.
CREATE POLICY form_templates_objects_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'form-templates');

CREATE POLICY form_templates_objects_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'form-templates' AND EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid() AND m.role = ANY (ARRAY['specialist'::text, 'admin'::text])
  ));

CREATE POLICY form_templates_objects_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'form-templates' AND EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid() AND m.role = ANY (ARRAY['specialist'::text, 'admin'::text])
  ));
