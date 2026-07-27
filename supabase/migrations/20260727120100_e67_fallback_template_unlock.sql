-- E6.7 F6.7.2 — fallback-template unlock.
--
-- PM decision 2026-07-26 (no platform-role gating anywhere, two trusted
-- users): the seeded generic fallback SOP (00000000-0000-4000-a000-
-- 00000000e17b) becomes editable like any global SOP — the blanket
-- `fallback_sop_locked` rejection for authenticated callers is removed from
-- both authoring RPCs. Its STRUCTURAL guards stay, narrower but intact:
--   * it remains the only payerless global row — every OTHER active global
--     SOP still requires payer + state (global_sop_match_key_incomplete),
--     and the fallback itself can never be GIVEN a payer/state/group;
--   * it cannot be archived.
-- Both structural violations keep raising the same `fallback_sop_locked`
-- name, so the existing src/services/templates.ts mapping stays truthful.
--
-- Reissues (bodies only; signatures, grants, and every other rule unchanged
-- from 20260719170000_e65_global_authoring.sql):
--   1. author_global_sop      — fallback passes through for no-op-identity
--                               updates; archive / match-key changes on it
--                               still fail.
--   2. publish_sop_template_version — the fallback's authenticated-caller
--                               rejection branch is removed; content
--                               publishes like any global SOP.

-- ---------------------------------------------------------------------------
-- 1. author_global_sop — reissue.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.author_global_sop(
  p_id uuid,
  p_name text,
  p_payer_id uuid,
  p_state text,
  p_group_id uuid,
  p_task_definitions jsonb DEFAULT NULL,
  p_archived boolean DEFAULT NULL,
  p_required_profile_attributes jsonb DEFAULT '[]'::jsonb
)
RETURNS public.sop_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fallback_id constant uuid := '00000000-0000-4000-a000-00000000e17b';
  v_row public.sop_templates%ROWTYPE;
  v_archived boolean := coalesce(p_archived, false);
  v_defs jsonb := coalesce(p_task_definitions, '[]'::jsonb);
  v_attrs jsonb := coalesce(p_required_profile_attributes, '[]'::jsonb);
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- F6.7.2 structural guards: the fallback's IDENTITY is immutable — it
  -- stays the one payerless, stateless, groupless, unarchived global row.
  -- (Content edits go through publish_sop_template_version, now open.)
  IF p_id = v_fallback_id THEN
    IF v_archived THEN
      RAISE EXCEPTION 'fallback_sop_locked';
    END IF;
    IF p_payer_id IS NOT NULL OR p_state IS NOT NULL OR p_group_id IS NOT NULL THEN
      RAISE EXCEPTION 'fallback_sop_locked';
    END IF;
  END IF;

  -- Active global SOPs require a complete payer+state match key (group stays
  -- optional = the "any group" tier). Archived rows are exempt, mirroring
  -- assertActiveOrgMatchKeyComplete; the fallback is exempt BY IDENTITY —
  -- it is payerless by design, and the guard above pins it there, so no
  -- second payerless global row can ever be created or edited into being.
  IF NOT v_archived
     AND p_id IS DISTINCT FROM v_fallback_id
     AND (p_payer_id IS NULL OR p_state IS NULL OR btrim(p_state) = '') THEN
    RAISE EXCEPTION 'global_sop_match_key_incomplete';
  END IF;

  -- One ACTIVE global row per (payer, state, group), NULLS NOT DISTINCT.
  IF NOT v_archived AND EXISTS (
    SELECT 1 FROM public.sop_templates t
     WHERE t.org_id IS NULL
       AND t.archived = false
       AND t.id IS DISTINCT FROM p_id
       AND t.payer_id IS NOT DISTINCT FROM p_payer_id
       AND t.state IS NOT DISTINCT FROM p_state
       AND t.group_id IS NOT DISTINCT FROM p_group_id
  ) THEN
    RAISE EXCEPTION 'global_sop_duplicate_match';
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
      (org_id, name, payer_id, state, group_id, task_definitions, archived, required_profile_attributes)
    VALUES (NULL, btrim(p_name), p_payer_id, p_state, p_group_id, v_defs, v_archived, v_attrs)
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  SELECT * INTO v_row FROM public.sop_templates WHERE id = p_id AND org_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found';
  END IF;

  UPDATE public.sop_templates
     SET payer_id = p_payer_id,
         state = p_state,
         group_id = p_group_id,
         archived = v_archived,
         updated_at = now()
   WHERE id = p_id AND org_id IS NULL
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.author_global_sop(uuid, text, uuid, text, uuid, jsonb, boolean, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.author_global_sop(uuid, text, uuid, text, uuid, jsonb, boolean, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.author_global_sop(uuid, text, uuid, text, uuid, jsonb, boolean, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. publish_sop_template_version — reissue. The only change from the E6.5
--    body: the fallback's authenticated-caller rejection is GONE — a global
--    row is a global row (interim F6.5.6 posture, R7 hardens). Org-row rule,
--    optimistic concurrency, version insert, audit, grants all unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_sop_template_version(
  p_template_id uuid,
  p_expected_version integer,
  p_name text,
  p_task_definitions jsonb,
  p_change_note text DEFAULT NULL::text,
  p_required_profile_attributes jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_current integer;
  v_uid uuid := auth.uid();
  v_next integer;
  v_attrs jsonb := coalesce(p_required_profile_attributes, '[]'::jsonb);
BEGIN
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

  SELECT org_id, current_version INTO v_org, v_current
    FROM public.sop_templates WHERE id = p_template_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found';
  END IF;

  -- Global tier (v_org NULL): authenticated authoring is the interim F6.5.6
  -- posture (R7 replaces this with real platform roles). Since E6.7 F6.7.2
  -- that includes the generic fallback — its identity guards live in
  -- author_global_sop; content versions publish like any global SOP.
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
    (template_id, version, name, task_definitions, change_note, published_by, required_profile_attributes)
  VALUES (p_template_id, v_next, btrim(p_name), p_task_definitions,
          nullif(btrim(coalesce(p_change_note, '')), ''), v_uid, v_attrs);

  UPDATE public.sop_templates
    SET name = btrim(p_name),
        task_definitions = p_task_definitions,
        required_profile_attributes = v_attrs,
        current_version = v_next,
        updated_at = now()
    WHERE id = p_template_id AND current_version = v_current;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sop_version_conflict: concurrent publish detected';
  END IF;

  IF v_org IS NOT NULL THEN
    INSERT INTO public.audit_log
      (org_id, user_id, action_type, entity_type, entity_id, description)
    VALUES (v_org, v_uid, 'UPDATE', 'sop_template', p_template_id,
            'Published SOP template ' || btrim(p_name) || ' version ' || v_next);
  END IF;

  RETURN jsonb_build_object('template_id', p_template_id, 'version', v_next);
END;
$function$;

REVOKE ALL ON FUNCTION public.publish_sop_template_version(uuid, integer, text, jsonb, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_sop_template_version(uuid, integer, text, jsonb, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.publish_sop_template_version(uuid, integer, text, jsonb, text, jsonb) TO authenticated, service_role;
