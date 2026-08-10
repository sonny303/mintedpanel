-- BITE-CAP-02 — shared propose refreshes presentation on re-capture.
--
-- `propose_shared_field_map` was idempotent on (portal_key, selector) via
-- INSERT … ON CONFLICT DO NOTHING + re-read, which preserved decision fields
-- but never repaired sort_order / payer labels when the DOM drifted. Re-capture
-- now updates the presentation columns while leaving status, token, source,
-- hardcoded_value, and notes untouched. Admin renames (`display_label`,
-- `section`) are never clobbered.
--
-- Repo-only; hosted apply is an operator step in the PR body.

CREATE OR REPLACE FUNCTION public.propose_shared_field_map(
  p_portal_key text,
  p_selector text,
  p_field_label text DEFAULT NULL,
  p_form_section text DEFAULT NULL,
  p_page_step text DEFAULT NULL,
  p_field_type text DEFAULT 'text',
  p_sort_order integer DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.portal_field_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := lower(btrim(coalesce(p_portal_key, '')));
  v_selector text := btrim(coalesce(p_selector, ''));
  v_type text := coalesce(nullif(btrim(coalesce(p_field_type, '')), ''), 'text');
  v_row public.portal_field_maps%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_key = '' THEN
    RAISE EXCEPTION 'portal_key is required';
  END IF;
  IF v_selector = '' THEN
    RAISE EXCEPTION 'selector is required';
  END IF;
  IF v_type NOT IN ('text', 'select', 'radio', 'checkbox', 'date', 'file') THEN
    RAISE EXCEPTION 'Invalid field_type %', v_type;
  END IF;

  INSERT INTO public.portal_field_maps (
    org_id, portal_key, selector, field_label, form_section, page_step,
    field_type, map_type, status, source, notes, token, sort_order
  )
  VALUES (
    NULL, v_key, v_selector,
    nullif(btrim(coalesce(p_field_label, '')), ''),
    nullif(btrim(coalesce(p_form_section, '')), ''),
    nullif(btrim(coalesce(p_page_step, '')), ''),
    v_type, 'web', 'proposed', 'manual',
    coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'Captured for the shared form library'),
    NULL, p_sort_order
  )
  ON CONFLICT DO NOTHING;

  SELECT * INTO v_row
    FROM public.portal_field_maps
   WHERE org_id IS NULL AND portal_key = v_key AND selector = v_selector
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Could not resolve the shared field map after insert';
  END IF;

  UPDATE public.portal_field_maps
     SET field_label = coalesce(nullif(btrim(coalesce(p_field_label, '')), ''), field_label),
         form_section = coalesce(nullif(btrim(coalesce(p_form_section, '')), ''), form_section),
         page_step = coalesce(nullif(btrim(coalesce(p_page_step, '')), ''), page_step),
         sort_order = CASE
                        WHEN p_sort_order IS NOT NULL THEN p_sort_order
                        ELSE sort_order
                      END,
         updated_at = now()
   WHERE id = v_row.id AND org_id IS NULL
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.propose_shared_field_map(text, text, text, text, text, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.propose_shared_field_map(text, text, text, text, text, text, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.propose_shared_field_map(text, text, text, text, text, text, integer, text) TO authenticated, service_role;
