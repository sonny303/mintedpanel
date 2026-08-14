-- Create-template "Save failed" — author_global_sop composite return + RLS.
--
-- Symptom: Save draft succeeds (sop_template_drafts, org-scoped table write);
-- Create template fails for both a newly created payer and an existing catalog
-- payer (Alignment Health). The wizard catch only shows "Save failed" when the
-- thrown value is not an Error — PostgREST's error object on this path.
--
-- Cause: author_global_sop RETURNS public.sop_templates. PostgREST treats that
-- as a table-typed result (generated SetofOptions.to = sop_templates) and
-- applies sop_templates_select to the returned row. The RPC is SECURITY
-- DEFINER so the INSERT itself succeeds; the invoker's SELECT then filters
-- the composite return. That is the Slice 6 / D6.5 write-then-vanish bug on
-- the create round-trip:
--   * hosted sop_templates_select still requiring org_payer_assignments, OR
--   * a catalog payer with no assignment row after OPA-RETIRE (create_payer
--     no longer upserts OPA; attach lives on payer_network_targets).
-- Save draft never calls this RPC, so it keeps working.
--
-- Fix:
--   1. Reassert the D6.5 SELECT policies (org_id IS NULL is readable). Idempotent
--      if Slice 6 already applied; the fix if hosted lagged.
--   2. Reissue author_global_sop as RETURNS jsonb (the publish_sop_template_version
--      precedent). A scalar jsonb result is not subjected to table RLS.
-- Return-type changes cannot CREATE OR REPLACE — DROP + CREATE, no leftover
-- overload (the E4.2 / E6.8 PostgREST schema-cache precedent).

-- ---------------------------------------------------------------------------
-- 1. Reassert D6.5 global SOP readability (Slice 6, 20260809120100).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS sop_templates_select ON public.sop_templates;
CREATE POLICY sop_templates_select ON public.sop_templates
  FOR SELECT USING (
    (org_id IN (SELECT user_org_ids()))
    OR (org_id IS NULL)
  );

DROP POLICY IF EXISTS sop_template_versions_select ON public.sop_template_versions;
CREATE POLICY sop_template_versions_select ON public.sop_template_versions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.sop_templates t
      WHERE t.id = sop_template_versions.template_id
        AND (
          (t.org_id IN (SELECT user_org_ids()))
          OR (t.org_id IS NULL)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. author_global_sop — same body as 20260812140000, RETURNS jsonb.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.author_global_sop(uuid, text, uuid, text[], uuid, jsonb, boolean, jsonb);

CREATE FUNCTION public.author_global_sop(
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
  v_clash text;
BEGIN
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

  -- No ACTIVE global row for the same (payer, group) may share a state.
  IF NOT v_archived THEN
    SELECT string_agg(DISTINCT s, ', ' ORDER BY s) INTO v_clash
      FROM public.sop_templates t
      CROSS JOIN LATERAL unnest(t.states) AS s
     WHERE t.org_id IS NULL
       AND t.archived = false
       AND t.id IS DISTINCT FROM p_id
       AND t.payer_id IS NOT DISTINCT FROM p_payer_id
       AND t.group_id IS NOT DISTINCT FROM p_group_id
       AND s = ANY (v_states);
    IF v_clash IS NOT NULL THEN
      RAISE EXCEPTION 'global_sop_duplicate_match: %', v_clash;
    END IF;
  END IF;

  IF p_id IS NULL THEN
    IF p_name IS NULL OR btrim(p_name) = '' THEN
      RAISE EXCEPTION 'Template name is required';
    END IF;
    INSERT INTO public.sop_templates
      (org_id, name, payer_id, state, states, group_id, task_definitions,
       archived, required_profile_attributes)
    VALUES
      (NULL, btrim(p_name), p_payer_id, v_mirror, v_states, p_group_id, v_defs,
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
END $$;

REVOKE ALL ON FUNCTION public.author_global_sop(uuid, text, uuid, text[], uuid, jsonb, boolean, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.author_global_sop(uuid, text, uuid, text[], uuid, jsonb, boolean, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.author_global_sop(uuid, text, uuid, text[], uuid, jsonb, boolean, jsonb) TO authenticated, service_role;
