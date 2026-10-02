-- MINT-60/MINT-52: validate a key-only SOP step against the same deterministic
-- owner-scope precedence used by Work configuration resolution. An org row
-- shadows the global row for that org; global templates only see global rows.
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
  v_task jsonb;
  v_step jsonb;
  v_selected public.portals%ROWTYPE;
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
        FROM jsonb_array_elements(coalesce(v_task->'steps', '[]'::jsonb)) AS step
       WHERE nullif(btrim(step->>'portalKey'), '') IS NOT NULL
    LOOP
      v_selected := NULL;

      -- Multiple visible rows at the selected owner scope are still
      -- ambiguous. A visible org row always shadows a same-key global row,
      -- even when its type or payer is incompatible.
      IF p_org_id IS NOT NULL THEN
        SELECT count(*) INTO v_match_count
          FROM public.portals AS portal
         WHERE lower(btrim(portal.portal_key)) = v_key
           AND portal.org_id = p_org_id
           AND left(portal.name, 9) <> '[hidden] ';

        IF v_match_count > 1 THEN
          RAISE EXCEPTION 'sop_portal_binding_ambiguous: portal key "%" has multiple visible organization configurations', v_key;
        ELSIF v_match_count = 1 THEN
          SELECT portal.* INTO v_selected
            FROM public.portals AS portal
           WHERE lower(btrim(portal.portal_key)) = v_key
             AND portal.org_id = p_org_id
             AND left(portal.name, 9) <> '[hidden] ';
        END IF;
      END IF;

      -- A global template, or an org template without a visible same-key org
      -- row, may select exactly one visible global configuration.
      IF v_selected.id IS NULL THEN
        SELECT count(*) INTO v_match_count
          FROM public.portals AS portal
         WHERE lower(btrim(portal.portal_key)) = v_key
           AND portal.org_id IS NULL
           AND left(portal.name, 9) <> '[hidden] ';

        IF v_match_count > 1 THEN
          RAISE EXCEPTION 'sop_portal_binding_ambiguous: portal key "%" has multiple visible global configurations', v_key;
        ELSIF v_match_count = 1 THEN
          SELECT portal.* INTO v_selected
            FROM public.portals AS portal
           WHERE lower(btrim(portal.portal_key)) = v_key
             AND portal.org_id IS NULL
             AND left(portal.name, 9) <> '[hidden] ';
        END IF;
      END IF;

      IF v_selected.id IS NULL
         OR v_selected.case_type IS DISTINCT FROM p_case_type
         OR v_selected.payer_id IS DISTINCT FROM p_payer_id
         OR (
           v_selected.org_id IS NULL
           AND (
             v_selected.payer_id IS NULL
             OR NOT EXISTS (
               SELECT 1
                 FROM public.payers AS payer
                WHERE payer.id = v_selected.payer_id
                  AND payer.status = 'active'
                  AND payer.archived_at IS NULL
                  AND payer.merged_into_id IS NULL
             )
           )
         ) THEN
        RAISE EXCEPTION 'sop_portal_binding_ineligible: portal key "%" has no compatible case type, payer, or owner scope', v_key;
      END IF;
    END LOOP;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_sop_template_portal_bindings(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
