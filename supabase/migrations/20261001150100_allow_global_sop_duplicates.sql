-- Permit several active global SOPs for one payer, group, and state.
-- The preceding migration removes the table overlap trigger; the global authoring
-- RPC must stop applying the same retired rule inside its own body.
DROP TRIGGER IF EXISTS trg_sop_template_state_overlap ON public.sop_templates;

CREATE OR REPLACE FUNCTION public.author_global_sop(
  p_id uuid,
  p_name text,
  p_payer_id uuid,
  p_states text[],
  p_group_id uuid,
  p_task_definitions jsonb DEFAULT NULL,
  p_archived boolean DEFAULT NULL,
  p_required_profile_attributes jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Active global SOPs require a complete payer + at-least-one-state match key
  -- (group stays optional = the "any group" tier). Archived rows are exempt,
  -- mirroring assertActiveOrgMatchKeyComplete.
  IF NOT v_archived
     AND (p_payer_id IS NULL OR v_states IS NULL OR array_length(v_states, 1) IS NULL) THEN
    RAISE EXCEPTION 'global_sop_match_key_incomplete';
  END IF;

  IF p_id IS NULL THEN
    IF p_name IS NULL OR btrim(p_name) = '' THEN
      RAISE EXCEPTION 'Template name is required';
    END IF;
    IF jsonb_typeof(v_defs) <> 'array' THEN
      RAISE EXCEPTION 'task_definitions must be a json array';
    END IF;
    IF jsonb_typeof(v_attrs) <> 'array' THEN
      RAISE EXCEPTION 'required_profile_attributes must be a json array';
    END IF;
    INSERT INTO public.sop_templates
      (org_id, name, payer_id, state, states, group_id, task_definitions,
       archived, required_profile_attributes)
    VALUES (NULL, btrim(p_name), p_payer_id, v_mirror, v_states, p_group_id, v_defs,
            v_archived, v_attrs)
    RETURNING * INTO v_row;
  ELSE
    -- UPDATE changes match key + archived ONLY; content/name/attributes go
    -- through publish_sop_template_version (the TE-5 save split), never here.
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
$$;

REVOKE ALL ON FUNCTION public.author_global_sop(uuid, text, uuid, text[], uuid, jsonb, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.author_global_sop(uuid, text, uuid, text[], uuid, jsonb, boolean, jsonb) TO authenticated, service_role;

