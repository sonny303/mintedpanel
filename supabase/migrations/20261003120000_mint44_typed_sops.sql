-- MINT-44: persist the case purpose independently from operational execution
-- type. Existing rows deliberately remain NULL; new writes are typed by the
-- authoring / case creation contracts added in this migration.

ALTER TABLE public.sop_templates
  ADD COLUMN IF NOT EXISTS case_type text;

ALTER TABLE public.sop_template_versions
  ADD COLUMN IF NOT EXISTS case_type text;

ALTER TABLE public.sop_template_drafts
  ADD COLUMN IF NOT EXISTS case_type text;

ALTER TABLE public.credential_cases
  ADD COLUMN IF NOT EXISTS case_type text;

-- Add the default only after adding the column so historical cases stay NULL.
ALTER TABLE public.credential_cases
  ALTER COLUMN case_type SET DEFAULT 'enrollment';

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.sop_templates'::regclass
       AND conname = 'sop_templates_case_type_check'
  ) THEN
    ALTER TABLE public.sop_templates
      ADD CONSTRAINT sop_templates_case_type_check
      CHECK (case_type IS NULL OR case_type IN ('contract', 'enrollment', 'recredentialing'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.sop_template_versions'::regclass
       AND conname = 'sop_template_versions_case_type_check'
  ) THEN
    ALTER TABLE public.sop_template_versions
      ADD CONSTRAINT sop_template_versions_case_type_check
      CHECK (case_type IS NULL OR case_type IN ('contract', 'enrollment', 'recredentialing'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.sop_template_drafts'::regclass
       AND conname = 'sop_template_drafts_case_type_check'
  ) THEN
    ALTER TABLE public.sop_template_drafts
      ADD CONSTRAINT sop_template_drafts_case_type_check
      CHECK (case_type IS NULL OR case_type IN ('contract', 'enrollment', 'recredentialing'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.credential_cases'::regclass
       AND conname = 'credential_cases_case_type_check'
  ) THEN
    ALTER TABLE public.credential_cases
      ADD CONSTRAINT credential_cases_case_type_check
      CHECK (case_type IS NULL OR case_type = 'enrollment');
  END IF;
END;
$migration$;

COMMENT ON COLUMN public.sop_templates.case_type IS
  'Nullable MINT-44 business-purpose classification; NULL is retained for legacy SOPs.';
COMMENT ON COLUMN public.sop_template_versions.case_type IS
  'Immutable nullable business-purpose snapshot; legacy versions remain NULL.';
COMMENT ON COLUMN public.sop_template_drafts.case_type IS
  'Nullable typed draft classification; drafts never resolve at runtime.';
COMMENT ON COLUMN public.credential_cases.case_type IS
  'Nullable historical classification; new provider credential cases default to enrollment.';

-- Defaults do not apply to an explicit JSON/SQL NULL. Stamp only new rows so
-- historical NULL remains untouched, and keep this table Enrollment-only.
CREATE OR REPLACE FUNCTION public.stamp_provider_case_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.case_type := coalesce(NEW.case_type, 'enrollment');
  IF NEW.case_type <> 'enrollment' THEN
    RAISE EXCEPTION 'credential_case_type_unsupported';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS credential_cases_stamp_case_type ON public.credential_cases;
CREATE TRIGGER credential_cases_stamp_case_type
  BEFORE INSERT ON public.credential_cases
  FOR EACH ROW EXECUTE FUNCTION public.stamp_provider_case_type();

-- Newly seeded version 1 rows snapshot the head type. Existing immutable
-- versions are deliberately not backfilled from their mutable heads.
CREATE OR REPLACE FUNCTION public.sop_template_seed_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.sop_template_versions
    (template_id, version, name, task_definitions, published_by,
     required_profile_attributes, case_type)
  VALUES (NEW.id, NEW.current_version, NEW.name, NEW.task_definitions, auth.uid(),
          coalesce(NEW.required_profile_attributes, '[]'::jsonb), NEW.case_type)
  ON CONFLICT (template_id, version) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- Typed global SOP authoring. Drop the prior arity before adding the optional
-- case type argument so PostgREST never sees ambiguous overloads.
DROP FUNCTION IF EXISTS public.author_global_sop(uuid, text, uuid, text[], uuid, jsonb, boolean, jsonb);
CREATE FUNCTION public.author_global_sop(
  p_id uuid,
  p_name text,
  p_payer_id uuid,
  p_states text[],
  p_group_id uuid,
  p_task_definitions jsonb DEFAULT NULL,
  p_archived boolean DEFAULT NULL,
  p_required_profile_attributes jsonb DEFAULT '[]'::jsonb,
  p_case_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row public.sop_templates%ROWTYPE;
  v_archived boolean := coalesce(p_archived, false);
  v_defs jsonb := coalesce(p_task_definitions, '[]'::jsonb);
  v_attrs jsonb := coalesce(p_required_profile_attributes, '[]'::jsonb);
  v_states text[] := p_states;
  v_mirror text := p_states[1];
BEGIN
  IF app_authz.is_restricted_external() THEN
    RAISE EXCEPTION 'Restricted client cannot modify global training surfaces';
  END IF;
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_id = '00000000-0000-4000-a000-00000000e17b'::uuid THEN
    RAISE EXCEPTION 'fallback_sop_locked';
  END IF;
  IF p_case_type IS NOT NULL AND p_case_type NOT IN ('contract', 'enrollment', 'recredentialing') THEN
    RAISE EXCEPTION 'sop_case_type_invalid';
  END IF;
  IF NOT v_archived
     AND (p_payer_id IS NULL OR v_states IS NULL OR array_length(v_states, 1) IS NULL) THEN
    RAISE EXCEPTION 'global_sop_match_key_incomplete';
  END IF;

  IF p_id IS NULL THEN
    IF p_name IS NULL OR btrim(p_name) = '' THEN
      RAISE EXCEPTION 'Template name is required';
    END IF;
    IF p_case_type IS NULL THEN
      RAISE EXCEPTION 'sop_case_type_required';
    END IF;
    IF jsonb_typeof(v_defs) <> 'array' THEN
      RAISE EXCEPTION 'task_definitions must be a json array';
    END IF;
    IF jsonb_typeof(v_attrs) <> 'array' THEN
      RAISE EXCEPTION 'required_profile_attributes must be a json array';
    END IF;
    INSERT INTO public.sop_templates
      (org_id, name, payer_id, state, states, group_id, task_definitions,
       archived, required_profile_attributes, case_type)
    VALUES (NULL, btrim(p_name), p_payer_id, v_mirror, v_states, p_group_id,
            v_defs, v_archived, v_attrs, p_case_type)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.sop_templates
       SET payer_id = p_payer_id,
           state = v_mirror,
           states = v_states,
           group_id = p_group_id,
           archived = v_archived
     WHERE id = p_id AND org_id IS NULL
     RETURNING * INTO v_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Template not found';
    END IF;
  END IF;
  RETURN to_jsonb(v_row);
END;
$function$;
REVOKE ALL ON FUNCTION public.author_global_sop(uuid, text, uuid, text[], uuid, jsonb, boolean, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.author_global_sop(uuid, text, uuid, text[], uuid, jsonb, boolean, jsonb, text) TO authenticated, service_role;

-- Typed, atomic version publish. A NULL optional argument preserves the
-- current head classification for legacy callers; a supplied classification
-- is snapshotted on the immutable version and updated on the head atomically.
DROP FUNCTION IF EXISTS public.publish_sop_template_version(uuid, integer, text, jsonb, text, jsonb);
CREATE FUNCTION public.publish_sop_template_version(
  p_template_id uuid,
  p_expected_version integer,
  p_name text,
  p_task_definitions jsonb,
  p_change_note text DEFAULT NULL::text,
  p_required_profile_attributes jsonb DEFAULT '[]'::jsonb,
  p_case_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_org uuid;
  v_current integer;
  v_existing_case_type text;
  v_case_type text;
  v_uid uuid := auth.uid();
  v_next integer;
  v_attrs jsonb := coalesce(p_required_profile_attributes, '[]'::jsonb);
BEGIN
  IF app_authz.is_restricted_external() THEN
    RAISE EXCEPTION 'Restricted client cannot modify global training surfaces';
  END IF;
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Template name is required';
  END IF;
  IF p_task_definitions IS NULL OR jsonb_typeof(p_task_definitions) <> 'array' THEN
    RAISE EXCEPTION 'task_definitions must be a json array';
  END IF;
  IF jsonb_typeof(v_attrs) <> 'array' THEN
    RAISE EXCEPTION 'required_profile_attributes must be a json array';
  END IF;
  IF p_case_type IS NOT NULL AND p_case_type NOT IN ('contract', 'enrollment', 'recredentialing') THEN
    RAISE EXCEPTION 'sop_case_type_invalid';
  END IF;

  SELECT org_id, current_version, case_type
    INTO v_org, v_current, v_existing_case_type
    FROM public.sop_templates WHERE id = p_template_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template not found'; END IF;
  v_case_type := coalesce(p_case_type, v_existing_case_type);

  IF v_org IS NOT NULL
     AND (NOT (v_org IN (SELECT user_org_ids()))
          OR user_role(v_org) IS DISTINCT FROM 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_current IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'sop_version_conflict: expected version %, head is %',
      p_expected_version, v_current;
  END IF;
  v_next := v_current + 1;

  INSERT INTO public.sop_template_versions
    (template_id, version, name, task_definitions, change_note, published_by,
     required_profile_attributes, case_type)
  VALUES (p_template_id, v_next, btrim(p_name), p_task_definitions,
          nullif(btrim(coalesce(p_change_note, '')), ''), v_uid, v_attrs, v_case_type);

  UPDATE public.sop_templates
    SET name = btrim(p_name),
        task_definitions = p_task_definitions,
        required_profile_attributes = v_attrs,
        case_type = v_case_type,
        current_version = v_next,
        updated_at = now()
    WHERE id = p_template_id AND current_version = v_current;
  IF NOT FOUND THEN RAISE EXCEPTION 'sop_version_conflict: concurrent publish detected'; END IF;

  IF v_org IS NOT NULL THEN
    INSERT INTO public.audit_log
      (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org, v_uid, 'UPDATE', 'sop_template', p_template_id,
            'Published SOP template ' || btrim(p_name) || ' version ' || v_next);
  END IF;
  RETURN jsonb_build_object('template_id', p_template_id, 'version', v_next);
END;
$function$;
REVOKE ALL ON FUNCTION public.publish_sop_template_version(uuid, integer, text, jsonb, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_sop_template_version(uuid, integer, text, jsonb, text, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_sop_template_portal_bindings(
  p_org_id uuid,
  p_payer_id uuid,
  p_case_type text,
  p_task_definitions jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_key text;
  v_match_count integer;
  v_key_count integer;
  v_task jsonb;
  v_step jsonb;
BEGIN
  IF p_case_type IS NULL THEN
    RETURN; -- Preserve legacy unclassified heads and historical references.
  END IF;
  IF jsonb_typeof(p_task_definitions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'task_definitions must be a json array';
  END IF;

  FOR v_task IN SELECT value FROM jsonb_array_elements(p_task_definitions)
  LOOP
    IF v_task ? 'steps' AND jsonb_typeof(v_task->'steps') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'sop_task_steps_invalid';
    END IF;
    FOR v_step IN SELECT value FROM jsonb_array_elements(coalesce(v_task->'steps', '[]'::jsonb))
    LOOP
      IF nullif(btrim(v_step->>'stepType'), '') IS NOT NULL
         AND v_step->>'stepType' NOT IN ('draft_email', 'online_form', 'pdf', 'fax', 'phone', 'mail', 'custom') THEN
        RAISE EXCEPTION 'sop_step_type_invalid';
      END IF;
      IF coalesce(nullif(v_step->>'stepType', ''), 'online_form') = 'online_form'
         AND nullif(btrim(v_step->>'portalKey'), '') IS NULL THEN
        RAISE EXCEPTION 'sop_portal_binding_required: every online-form step must select a portal configuration';
      END IF;
    END LOOP;
    FOR v_key IN
      SELECT DISTINCT lower(btrim(step->>'portalKey'))
      FROM jsonb_array_elements(coalesce(v_task->'steps', '[]'::jsonb)) step
      WHERE nullif(btrim(step->>'portalKey'), '') IS NOT NULL
    LOOP
      -- A key-only step cannot identify which owner-scope row downstream
      -- consumers should use. Reject duplicate visible keys even if only one
      -- happens to match the current type or payer.
      SELECT count(*) INTO v_key_count
      FROM public.portals p
      WHERE lower(btrim(p.portal_key)) = v_key
        AND left(p.name, 9) <> '[hidden] '
        AND (
          (p_org_id IS NULL AND p.org_id IS NULL)
          OR (p_org_id IS NOT NULL AND (p.org_id IS NULL OR p.org_id = p_org_id))
        )
        AND (
          p.org_id IS NOT NULL
          OR (p.payer_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.payers payer
            WHERE payer.id = p.payer_id AND payer.status = 'active'
              AND payer.archived_at IS NULL AND payer.merged_into_id IS NULL
          ))
        );
      IF v_key_count > 1 THEN
        RAISE EXCEPTION 'sop_portal_binding_ambiguous: portal key "%" is shared by multiple visible configurations; use a unique portal key', v_key;
      END IF;

      SELECT count(*) INTO v_match_count
      FROM public.portals p
      WHERE lower(btrim(p.portal_key)) = v_key
        AND left(p.name, 9) <> '[hidden] '
        AND p.case_type = p_case_type
        AND p.payer_id IS NOT DISTINCT FROM p_payer_id
        AND (
          (p_org_id IS NULL AND p.org_id IS NULL)
          OR (p_org_id IS NOT NULL AND (p.org_id IS NULL OR p.org_id = p_org_id))
        )
        AND (
          p.org_id IS NOT NULL
          OR (p.payer_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.payers payer
            WHERE payer.id = p.payer_id AND payer.status = 'active'
              AND payer.archived_at IS NULL AND payer.merged_into_id IS NULL
          ))
        );
      IF v_match_count = 0 THEN
        RAISE EXCEPTION 'sop_portal_binding_ineligible: portal key "%" has no compatible case type, payer, or owner scope', v_key;
      ELSIF v_match_count > 1 THEN
        RAISE EXCEPTION 'sop_portal_binding_ambiguous: portal key "%" matches multiple compatible configurations; use a unique portal key', v_key;
      END IF;
    END LOOP;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_typed_sop_template()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.case_type IS NULL THEN
      RAISE EXCEPTION 'sop_case_type_required';
    END IF;
  ELSIF NEW.case_type IS DISTINCT FROM OLD.case_type THEN
    IF NEW.current_version IS DISTINCT FROM OLD.current_version + 1
       OR NOT EXISTS (
         SELECT 1 FROM public.sop_template_versions v
         WHERE v.template_id = NEW.id
           AND v.version = NEW.current_version
           AND v.case_type IS NOT DISTINCT FROM NEW.case_type
       ) THEN
      RAISE EXCEPTION 'sop_case_type_requires_publish';
    END IF;
  END IF;

  IF NEW.id = '00000000-0000-4000-a000-00000000e17b'::uuid
     AND NEW.case_type IS NOT NULL AND NEW.case_type <> 'enrollment' THEN
    RAISE EXCEPTION 'fallback_sop_case_type_invalid';
  END IF;

  IF NEW.case_type IS NOT NULL THEN
    PERFORM public.validate_sop_template_portal_bindings(
      NEW.org_id, NEW.payer_id, NEW.case_type, NEW.task_definitions
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sop_templates_guard_typed_insert ON public.sop_templates;
CREATE TRIGGER sop_templates_guard_typed_insert
  BEFORE INSERT ON public.sop_templates
  FOR EACH ROW EXECUTE FUNCTION public.guard_typed_sop_template();
DROP TRIGGER IF EXISTS sop_templates_guard_typed_update ON public.sop_templates;
CREATE TRIGGER sop_templates_guard_typed_update
  BEFORE UPDATE OF case_type, task_definitions, payer_id, org_id ON public.sop_templates
  FOR EACH ROW EXECUTE FUNCTION public.guard_typed_sop_template();

-- Case/task writers share the immutable version check, including direct task
-- insert paths used by manual creation and reapplication.
CREATE OR REPLACE FUNCTION public.guard_task_sop_case_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_case public.credential_cases%ROWTYPE;
  v_template public.sop_templates%ROWTYPE;
  v_version_case_type text;
  v_is_generic_fallback boolean;
BEGIN
  IF NEW.case_id IS NULL OR NEW.sop_template_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_case
  FROM public.credential_cases WHERE id = NEW.case_id AND org_id = NEW.org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_sop_type_mismatch'; END IF;
  SELECT case_type INTO v_version_case_type
  FROM public.sop_template_versions
  WHERE template_id = NEW.sop_template_id AND version = NEW.sop_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_sop_type_mismatch'; END IF;
  SELECT * INTO v_template FROM public.sop_templates
  WHERE id = NEW.sop_template_id;
  v_is_generic_fallback := v_template.id = '00000000-0000-4000-a000-00000000e17b'::uuid
    AND v_template.org_id IS NULL AND v_template.payer_id IS NULL
    AND v_template.group_id IS NULL AND v_template.state IS NULL
    AND v_template.states IS NULL;
  IF NOT FOUND
     OR v_version_case_type IS DISTINCT FROM v_case.case_type
     OR v_template.case_type IS DISTINCT FROM v_case.case_type
     OR v_template.current_version IS DISTINCT FROM NEW.sop_version
     OR v_template.archived
     OR (v_template.group_id IS NOT NULL AND v_template.group_id IS DISTINCT FROM v_case.group_id)
     OR (NOT v_is_generic_fallback AND (
          v_template.payer_id IS DISTINCT FROM v_case.payer_id
          OR NOT (v_case.state = ANY(coalesce(v_template.states, ARRAY[v_template.state]))
                  OR coalesce(v_template.states, ARRAY[v_template.state]) = ARRAY['All']::text[])
        ))
     OR (v_template.org_id IS NOT NULL AND v_template.org_id IS DISTINCT FROM v_case.org_id) THEN
    RAISE EXCEPTION 'case_sop_type_mismatch';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tasks_guard_sop_case_type ON public.tasks;
CREATE TRIGGER tasks_guard_sop_case_type
  BEFORE INSERT OR UPDATE OF case_id, sop_template_id, sop_version ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_task_sop_case_type();

-- Keep the current case creation RPC semantics while stamping Enrollment and
-- checking every SOP stamp against its immutable version before any writes.
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
  v_case_type text := coalesce(nullif(p_input->>'case_type', ''), 'enrollment');
  v_task_template_id uuid;
  v_task_version integer;
  v_stamp_template_id uuid;
  v_stamp_version integer;
  v_has_unstamped_task boolean := false;
  v_template public.sop_templates%ROWTYPE;
  v_version_case_type text;
  v_is_generic_fallback boolean;
  v_user uuid := auth.uid();
  v_user_name text;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'org_id is required'; END IF;
  IF v_case_type <> 'enrollment' THEN RAISE EXCEPTION 'provider_case_type_unsupported'; END IF;
  IF jsonb_typeof(coalesce(p_tasks, '[]'::jsonb)) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'case_tasks_invalid';
  END IF;

  FOR v_task IN SELECT value FROM jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb))
  LOOP
    v_task_template_id := nullif(v_task->>'sop_template_id', '')::uuid;
    v_task_version := nullif(v_task->>'sop_version', '')::integer;
    IF v_task_template_id IS NOT NULL THEN
      IF v_stamp_template_id IS NOT NULL
         AND (v_stamp_template_id IS DISTINCT FROM v_task_template_id
              OR v_stamp_version IS DISTINCT FROM v_task_version) THEN
        RAISE EXCEPTION 'case_sop_stamp_mixed';
      END IF;
      v_stamp_template_id := v_task_template_id;
      v_stamp_version := v_task_version;
      SELECT case_type INTO v_version_case_type
      FROM public.sop_template_versions
      WHERE template_id = v_task_template_id AND version = v_task_version;
      IF NOT FOUND THEN RAISE EXCEPTION 'case_sop_type_mismatch'; END IF;
      SELECT * INTO v_template FROM public.sop_templates WHERE id = v_task_template_id;
      v_is_generic_fallback := v_template.id = '00000000-0000-4000-a000-00000000e17b'::uuid
        AND v_template.org_id IS NULL AND v_template.payer_id IS NULL
        AND v_template.group_id IS NULL AND v_template.state IS NULL
        AND v_template.states IS NULL;
      IF NOT FOUND
         OR v_version_case_type IS DISTINCT FROM v_case_type
         OR v_template.case_type IS DISTINCT FROM v_case_type
         OR v_template.current_version IS DISTINCT FROM v_task_version
         OR v_template.archived
         OR (v_template.group_id IS NOT NULL
             AND v_template.group_id IS DISTINCT FROM nullif(p_input->>'group_id', '')::uuid)
         OR (NOT v_is_generic_fallback AND (
              v_template.payer_id IS DISTINCT FROM nullif(p_input->>'payer_id', '')::uuid
              OR NOT ((p_input->>'state') = ANY(coalesce(v_template.states, ARRAY[v_template.state]))
                      OR coalesce(v_template.states, ARRAY[v_template.state]) = ARRAY['All']::text[])
            ))
         OR (v_template.org_id IS NOT NULL AND v_template.org_id IS DISTINCT FROM v_org) THEN
        RAISE EXCEPTION 'case_sop_type_mismatch';
      END IF;
    ELSE
      v_has_unstamped_task := true;
    END IF;
  END LOOP;
  IF v_stamp_template_id IS NOT NULL AND v_has_unstamped_task THEN
    RAISE EXCEPTION 'case_sop_stamp_incomplete';
  END IF;

  IF v_status IS NULL THEN
    SELECT id INTO v_status
    FROM public.status_configs
    WHERE org_id = v_org AND track = 'credentialing'
    ORDER BY sort_order ASC LIMIT 1;
    IF v_status IS NULL THEN
      RAISE EXCEPTION 'No credentialing status configured for this organization. Add at least one credentialing status before creating cases.';
    END IF;
  END IF;
  SELECT COALESCE(full_name, email) INTO v_user_name
  FROM public.profiles WHERE id = v_user;

  INSERT INTO public.credential_cases (
    org_id, provider_id, payer_id, state, group_id, facility_id, specialty,
    credentialing_status_id, mso_id, assigned_to, submitted_date,
    expected_effective_date, generation_run_id, created_by, case_type
  ) VALUES (
    v_org, NULLIF(p_input->>'provider_id','')::uuid,
    NULLIF(p_input->>'payer_id','')::uuid, p_input->>'state',
    NULLIF(p_input->>'group_id','')::uuid,
    NULLIF(p_input->>'facility_id','')::uuid,
    NULLIF(p_input->>'specialty',''), v_status,
    NULLIF(p_input->>'mso_id','')::uuid,
    NULLIF(p_input->>'assigned_to','')::uuid,
    NULLIF(p_input->>'submitted_date','')::date,
    NULLIF(p_input->>'expected_effective_date','')::date,
    NULLIF(p_input->>'generation_run_id','')::uuid, v_user, v_case_type
  ) RETURNING * INTO v_case;

  INSERT INTO public.status_history
    (org_id, case_id, track, from_status_id, to_status_id, metadata, changed_by)
  VALUES (v_org, v_case.id, 'credentialing', NULL, v_status, '{}'::jsonb, v_user);
  INSERT INTO public.case_status_history
    (org_id, case_id, from_status, to_status, actor_kind, changed_by)
  VALUES (v_org, v_case.id, NULL, v_case.case_status, 'system', v_user);

  FOR v_task IN SELECT value FROM jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb))
  LOOP
    INSERT INTO public.tasks (
      org_id, case_id, provider_id, title, description, sop_content,
      status, sort_order, due_date, is_auto_generated, sop_template_id,
      sop_version, execution_type, sop_resolution_tier
    ) VALUES (
      v_org, v_case.id, v_case.provider_id,
      COALESCE(NULLIF(v_task->>'title',''), 'Task'), v_task->>'description',
      COALESCE(v_task->'sop_content', '[]'::jsonb), 'not_started',
      COALESCE((v_task->>'sort_order')::int, 0),
      NULLIF(v_task->>'due_date','')::date, true,
      NULLIF(v_task->>'sop_template_id','')::uuid,
      NULLIF(v_task->>'sop_version','')::int,
      NULLIF(v_task->>'execution_type',''),
      NULLIF(v_task->>'sop_resolution_tier','')
    ) RETURNING id INTO v_task_id;
    v_task_ids := v_task_ids || v_task_id;
  END LOOP;

  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id,
     before, after, description)
  VALUES (v_org, v_user, v_user_name, 'CREATE', 'credential_case', v_case.id,
          NULL, to_jsonb(v_case), 'Created credentialing case');
  IF coalesce(array_length(v_task_ids, 1), 0) > 0 THEN
    INSERT INTO public.audit_log
      (org_id, user_id, user_name, action_type, entity_type, entity_id,
       before, after, description)
    VALUES (
      v_org, v_user, v_user_name, 'CREATE', 'task', v_case.id, NULL,
      jsonb_build_object('caseId', v_case.id,
                         'count', array_length(v_task_ids, 1),
                         'taskIds', to_jsonb(v_task_ids)),
      'Auto-generated ' || array_length(v_task_ids, 1) || ' SOP task'
        || CASE WHEN array_length(v_task_ids, 1) = 1 THEN '' ELSE 's' END
        || ' for case'
    );
  END IF;
  RETURN to_jsonb(v_case);
END;
$function$;

-- Reapplication/change path keeps the PR #461 atomic replacement contract and
-- additionally requires the selected head and immutable version to match the
-- case's exact business purpose (NULL only matches historical NULL cases).
CREATE OR REPLACE FUNCTION public.replace_unstarted_case_sop(
  p_org_id uuid,
  p_case_id uuid,
  p_template_id uuid,
  p_expected_version integer,
  p_tasks jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_case public.credential_cases%ROWTYPE;
  v_template public.sop_templates%ROWTYPE;
  v_version_case_type text;
  v_is_generic_fallback boolean;
  v_old_count integer;
  v_old_template_id uuid;
  v_old_version integer;
  v_row jsonb;
  v_user_name text;
BEGIN
  IF auth.uid() IS NULL OR p_org_id IS NULL
     OR p_org_id NOT IN (SELECT user_org_ids())
     OR coalesce(user_role(p_org_id), '') NOT IN ('specialist', 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_case FROM public.credential_cases
  WHERE id = p_case_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Case not found'; END IF;
  IF v_case.case_status NOT IN ('not_started', 'in_progress') THEN
    RAISE EXCEPTION 'case_sop_change_unavailable';
  END IF;

  SELECT * INTO v_template FROM public.sop_templates
  WHERE id = p_template_id AND (org_id = p_org_id OR org_id IS NULL) FOR SHARE;
  v_is_generic_fallback := v_template.id = '00000000-0000-4000-a000-00000000e17b'::uuid
    AND v_template.org_id IS NULL AND v_template.payer_id IS NULL
    AND v_template.group_id IS NULL AND v_template.state IS NULL
    AND v_template.states IS NULL;
  IF NOT FOUND OR v_template.archived
     OR (v_template.group_id IS NOT NULL AND v_template.group_id IS DISTINCT FROM v_case.group_id)
     OR (NOT v_is_generic_fallback AND (
          v_template.payer_id IS DISTINCT FROM v_case.payer_id
          OR NOT (v_case.state = ANY(coalesce(v_template.states, ARRAY[v_template.state]))
                  OR coalesce(v_template.states, ARRAY[v_template.state]) = ARRAY['All']::text[])
        ))
     OR v_template.current_version IS DISTINCT FROM p_expected_version
     OR v_template.case_type IS DISTINCT FROM v_case.case_type THEN
    RAISE EXCEPTION 'case_sop_template_ineligible';
  END IF;

  SELECT case_type INTO v_version_case_type FROM public.sop_template_versions
  WHERE template_id = v_template.id AND version = v_template.current_version;
  IF NOT FOUND OR v_version_case_type IS DISTINCT FROM v_case.case_type THEN
    RAISE EXCEPTION 'case_sop_template_ineligible';
  END IF;

  IF jsonb_typeof(p_tasks) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'case_sop_tasks_invalid';
  END IF;
  IF jsonb_array_length(p_tasks) <> jsonb_array_length(coalesce(v_template.task_definitions, '[]'::jsonb)) THEN
    RAISE EXCEPTION 'case_sop_tasks_invalid';
  END IF;

  PERFORM 1 FROM public.tasks WHERE case_id = p_case_id AND org_id = p_org_id FOR UPDATE;
  SELECT count(*) INTO v_old_count FROM public.tasks
  WHERE case_id = p_case_id AND org_id = p_org_id;
  SELECT sop_template_id, sop_version INTO v_old_template_id, v_old_version
  FROM public.tasks WHERE case_id = p_case_id AND org_id = p_org_id
  ORDER BY created_at, id LIMIT 1;
  IF EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.case_id = p_case_id AND t.org_id = p_org_id
      AND (NOT coalesce(t.is_auto_generated, false)
        OR t.status <> 'not_started'
        OR t.completed_date IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(t.sop_content, '[]'::jsonb)) step
          WHERE coalesce((step->>'isCompleted')::boolean, false)
             OR coalesce(jsonb_array_length(coalesce(step->'attachments', '[]'::jsonb)), 0) > 0
        )
        OR EXISTS (SELECT 1 FROM public.touches touch
                   WHERE touch.org_id = p_org_id AND touch.task_id = t.id))
  ) THEN RAISE EXCEPTION 'case_sop_tasks_started'; END IF;

  DELETE FROM public.tasks WHERE case_id = p_case_id AND org_id = p_org_id;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_tasks)
  LOOP
    IF nullif(btrim(v_row->>'title'), '') IS NULL
       OR jsonb_typeof(v_row->'sop_content') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'case_sop_tasks_invalid';
    END IF;
    INSERT INTO public.tasks (
      org_id, case_id, provider_id, title, description, sop_content,
      status, sort_order, due_date, is_auto_generated, sop_template_id,
      sop_version, execution_type, sop_resolution_tier
    ) VALUES (
      p_org_id, p_case_id, v_case.provider_id, v_row->>'title',
      v_row->>'description', v_row->'sop_content', 'not_started',
      (v_row->>'sort_order')::integer, (v_row->>'due_date')::date, true,
      v_template.id, v_template.current_version,
      nullif(v_row->>'execution_type', ''),
      CASE WHEN v_template.org_id IS NOT NULL THEN 'organization'
           ELSE 'global_payer' END
    );
  END LOOP;

  SELECT coalesce(full_name, email) INTO v_user_name
  FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id,
     description, before, after)
  VALUES
    (p_org_id, auth.uid(), v_user_name, 'UPDATE', 'credential_case', p_case_id,
     'Changed case SOP template',
     jsonb_build_object('sop_template_id', v_old_template_id,
                        'sop_version', v_old_version,
                        'replaced_task_count', v_old_count),
     jsonb_build_object('sop_template_id', v_template.id,
                        'sop_version', v_template.current_version,
                        'task_count', jsonb_array_length(p_tasks)));
  RETURN jsonb_array_length(p_tasks);
END;
$function$;

REVOKE ALL ON FUNCTION public.replace_unstarted_case_sop(uuid, uuid, uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_unstarted_case_sop(uuid, uuid, uuid, integer, jsonb) TO authenticated, service_role;

-- Global portal registration carries the selected case purpose at creation.
-- Existing configuration type cannot be silently changed in place because
-- maps and SOP references are tied to the exact key and owner scope.
DROP FUNCTION IF EXISTS public.upsert_global_portal(uuid, text, text, uuid, text);
CREATE FUNCTION public.upsert_global_portal(
  p_id uuid,
  p_name text,
  p_portal_key text,
  p_payer_id uuid DEFAULT NULL,
  p_form_url text DEFAULT NULL,
  p_case_type text DEFAULT NULL
)
RETURNS public.portals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_key text := lower(btrim(coalesce(p_portal_key, '')));
  v_row public.portals%ROWTYPE;
BEGIN
  IF app_authz.is_restricted_external() THEN
    RAISE EXCEPTION 'Restricted client cannot modify global training surfaces';
  END IF;
  IF coalesce(auth.role(), '') = 'anon' THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'Portal name is required'; END IF;
  IF p_case_type IS NOT NULL AND p_case_type NOT IN ('contract', 'enrollment', 'recredentialing') THEN
    RAISE EXCEPTION 'portal_case_type_invalid';
  END IF;

  IF p_id IS NULL THEN
    IF v_key = '' THEN RAISE EXCEPTION 'Portal key is required'; END IF;
    BEGIN
      INSERT INTO public.portals (org_id, portal_key, name, payer_id, case_type, form_url)
      VALUES (NULL, v_key, btrim(p_name), p_payer_id, p_case_type,
              nullif(btrim(coalesce(p_form_url, '')), ''))
      RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'global_portal_key_exists: %', v_key;
    END;
    RETURN v_row;
  END IF;

  SELECT * INTO v_row FROM public.portals WHERE id = p_id AND org_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Portal not found'; END IF;
  IF p_case_type IS NOT NULL AND p_case_type IS DISTINCT FROM v_row.case_type THEN
    RAISE EXCEPTION 'global_portal_case_type_immutable';
  END IF;

  UPDATE public.portals
     SET name = btrim(p_name),
         payer_id = p_payer_id,
         form_url = nullif(btrim(coalesce(p_form_url, '')), ''),
         is_verified = CASE WHEN nullif(btrim(coalesce(p_form_url, '')), '') IS DISTINCT FROM form_url
                            THEN false ELSE is_verified END,
         last_verified_at = CASE WHEN nullif(btrim(coalesce(p_form_url, '')), '') IS DISTINCT FROM form_url
                                 THEN NULL ELSE last_verified_at END,
         proven_at = CASE WHEN nullif(btrim(coalesce(p_form_url, '')), '') IS DISTINCT FROM form_url
                          THEN NULL ELSE proven_at END,
         url_changed_at = CASE WHEN nullif(btrim(coalesce(p_form_url, '')), '') IS DISTINCT FROM form_url
                               THEN now() ELSE url_changed_at END
   WHERE id = p_id AND org_id IS NULL
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;
REVOKE ALL ON FUNCTION public.upsert_global_portal(uuid, text, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_global_portal(uuid, text, text, uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.validate_sop_template_portal_bindings(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_typed_sop_template() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_task_sop_case_type() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.stamp_provider_case_type() FROM PUBLIC, anon, authenticated, service_role;
