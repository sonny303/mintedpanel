-- E6.11 (B2) — let a PDF field map exist.
--
-- `portal_field_maps.map_type` has allowed `'pdf'` since the baseline
-- (`portal_field_maps_map_type_check`), but the only writer of a shared
-- (`org_id IS NULL`) row inserts a literal `'web'`, so a PDF row has never
-- been creatable. This adds `p_map_type` to `propose_shared_field_map` and
-- nothing else: same idempotency contract, same presentation-refresh rule,
-- same grant floor.
--
-- DROP + CREATE, not an in-place added arg: PostgREST resolves an RPC by its
-- named-argument SET, so a defaulted 10th arg on a live 9-arg signature is an
-- unresolvable overload and every call 400s with PGRST202 (the E6.10
-- precedent in 20260813120000, same function).
--
-- Callers that send no `p_map_type` still get `'web'`, so the extension's
-- capture path is unchanged. The panel sends the argument ONLY for a PDF
-- import, which keeps web capture working on a hosted signature that has not
-- had this migration applied yet.
--
-- Repo-only; hosted apply is an operator step named in the PR body.

DROP FUNCTION IF EXISTS public.propose_shared_field_map(text, text, text, text, text, text, integer, text, jsonb);

CREATE OR REPLACE FUNCTION public.propose_shared_field_map(
  p_portal_key text,
  p_selector text,
  p_field_label text DEFAULT NULL,
  p_form_section text DEFAULT NULL,
  p_page_step text DEFAULT NULL,
  p_field_type text DEFAULT 'text',
  p_sort_order integer DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_control_options jsonb DEFAULT NULL,
  p_map_type text DEFAULT 'web'
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
  v_map_type text := coalesce(nullif(btrim(lower(coalesce(p_map_type, ''))), ''), 'web');
  v_row public.portal_field_maps%ROWTYPE;
  v_options jsonb := NULL;
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
  IF v_map_type NOT IN ('web', 'pdf') THEN
    RAISE EXCEPTION 'Invalid map_type %', v_map_type;
  END IF;

  IF p_control_options IS NOT NULL THEN
    IF jsonb_typeof(p_control_options) <> 'array' THEN
      RAISE EXCEPTION 'control_options must be a json array';
    END IF;
    -- Empty array is a valid inbound shape (AJAX select not yet loaded, or a
    -- PDF checkbox with no export values) but is never stored on re-capture;
    -- first insert still writes NULL rather than [] so "never captured" stays
    -- distinguishable from "captured empty".
    IF jsonb_array_length(p_control_options) > 0 THEN
      v_options := p_control_options;
    END IF;
  END IF;

  INSERT INTO public.portal_field_maps (
    org_id, portal_key, selector, field_label, form_section, page_step,
    field_type, map_type, status, source, notes, token, sort_order,
    control_options
  )
  VALUES (
    NULL, v_key, v_selector,
    nullif(btrim(coalesce(p_field_label, '')), ''),
    nullif(btrim(coalesce(p_form_section, '')), ''),
    nullif(btrim(coalesce(p_page_step, '')), ''),
    v_type, v_map_type, 'proposed', 'manual',
    coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'Captured for the shared form library'),
    NULL, p_sort_order,
    v_options
  )
  ON CONFLICT DO NOTHING;

  SELECT * INTO v_row
    FROM public.portal_field_maps
   WHERE org_id IS NULL AND portal_key = v_key AND selector = v_selector
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Could not resolve the shared field map after insert';
  END IF;

  -- Presentation refresh only. `map_type` is identity, not presentation: a row
  -- that already exists keeps the type it was created with, so a stray caller
  -- can never flip a trained web row into a PDF row (or the reverse) and
  -- silently take it out of the fill it belongs to.
  UPDATE public.portal_field_maps
     SET field_label = coalesce(nullif(btrim(coalesce(p_field_label, '')), ''), field_label),
         form_section = coalesce(nullif(btrim(coalesce(p_form_section, '')), ''), form_section),
         page_step = coalesce(nullif(btrim(coalesce(p_page_step, '')), ''), page_step),
         sort_order = CASE
                        WHEN p_sort_order IS NOT NULL THEN p_sort_order
                        ELSE sort_order
                      END,
         control_options = CASE
                             WHEN v_options IS NOT NULL THEN v_options
                             ELSE control_options
                           END,
         updated_at = now()
   WHERE id = v_row.id AND org_id IS NULL
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.propose_shared_field_map(text, text, text, text, text, text, integer, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.propose_shared_field_map(text, text, text, text, text, text, integer, text, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.propose_shared_field_map(text, text, text, text, text, text, integer, text, jsonb, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.propose_shared_field_map(text, text, text, text, text, text, integer, text, jsonb, text) IS
  'E6.11: propose a shared registry row. p_map_type (web|pdf) is set on INSERT only — an existing row never changes tier.';
