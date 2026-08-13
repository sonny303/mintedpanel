-- E6.10 — structured control autofill: persist captured option vocabulary
-- and make `transform` authorable from the shared trainer.
--
-- Additive: `portal_field_maps.control_options jsonb` (NULL = pre-E6.10 row).
-- `propose_shared_field_map` is DROP + CREATE (9th arg) so PostgREST does not
-- see nested defaulted overloads. Re-capture refreshes a NON-EMPTY option
-- list as presentation; an empty list leaves the stored vocabulary (dynamic
-- select that had not loaded). Decision columns stay untouched.
--
-- `train_global_field_map` is DROP + CREATE (7th arg `p_transform`). Only the
-- two transforms the extension's `applyTransform` implements are accepted
-- (`state_abbrev`, `date_mmddyyyy`); a non-token transition clears it the
-- way it already clears the hardcoded literal.
--
-- Repo-only; hosted apply is an operator step in the PR body.

ALTER TABLE public.portal_field_maps
  ADD COLUMN IF NOT EXISTS control_options jsonb;

COMMENT ON COLUMN public.portal_field_maps.control_options IS
  'E6.10: captured {value,label}[] for select/radio (and valued checkboxes). NULL = never captured. Empty array is not written on re-capture.';

-- ---------------------------------------------------------------------------
-- propose_shared_field_map — add p_control_options; refresh non-empty lists.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.propose_shared_field_map(text, text, text, text, text, text, integer, text);

CREATE OR REPLACE FUNCTION public.propose_shared_field_map(
  p_portal_key text,
  p_selector text,
  p_field_label text DEFAULT NULL,
  p_form_section text DEFAULT NULL,
  p_page_step text DEFAULT NULL,
  p_field_type text DEFAULT 'text',
  p_sort_order integer DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_control_options jsonb DEFAULT NULL
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

  IF p_control_options IS NOT NULL THEN
    IF jsonb_typeof(p_control_options) <> 'array' THEN
      RAISE EXCEPTION 'control_options must be a json array';
    END IF;
    -- Empty array is a valid inbound shape (AJAX select not yet loaded) but
    -- is never stored on re-capture; first insert still writes NULL rather
    -- than [] so "never captured" stays distinguishable from "captured empty".
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
    v_type, 'web', 'proposed', 'manual',
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

  UPDATE public.portal_field_maps
     SET field_label = coalesce(nullif(btrim(coalesce(p_field_label, '')), ''), field_label),
         form_section = coalesce(nullif(btrim(coalesce(p_form_section, '')), ''), form_section),
         page_step = coalesce(nullif(btrim(coalesce(p_page_step, '')), ''), page_step),
         sort_order = CASE
                        WHEN p_sort_order IS NOT NULL THEN p_sort_order
                        ELSE sort_order
                      END,
         -- Non-empty vocabulary refreshes; empty/null leaves the stored list.
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

REVOKE ALL ON FUNCTION public.propose_shared_field_map(text, text, text, text, text, text, integer, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.propose_shared_field_map(text, text, text, text, text, text, integer, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.propose_shared_field_map(text, text, text, text, text, text, integer, text, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- train_global_field_map — add p_transform; clear on non-token transitions.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.train_global_field_map(uuid, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.train_global_field_map(
  p_id uuid,
  p_status text,
  p_source text,
  p_token text DEFAULT NULL,
  p_field_label text DEFAULT NULL,
  p_hardcoded_value text DEFAULT NULL,
  p_transform text DEFAULT NULL
)
RETURNS public.portal_field_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.portal_field_maps%ROWTYPE;
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
  v_literal text := nullif(btrim(coalesce(p_hardcoded_value, '')), '');
  v_transform text := nullif(btrim(coalesce(p_transform, '')), '');
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('proposed', 'approved') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('token', 'manual', 'manual_partial', 'hardcoded') THEN
    RAISE EXCEPTION 'Invalid source';
  END IF;
  IF p_source IN ('token', 'manual_partial') AND v_token IS NULL THEN
    RAISE EXCEPTION 'Token is required for source %', p_source;
  END IF;
  IF p_source = 'hardcoded' THEN
    IF v_literal IS NULL THEN
      RAISE EXCEPTION 'A fixed value cannot be empty';
    END IF;
    v_token := NULL;
  ELSE
    v_literal := NULL;
  END IF;
  IF p_source = 'manual' THEN
    v_token := NULL;
  END IF;
  -- Shaping only applies to a token fill. A fixed value is already the
  -- literal that will be sent.
  IF p_source IN ('token', 'manual_partial') THEN
    IF v_transform IS NOT NULL AND v_transform NOT IN ('state_abbrev', 'date_mmddyyyy') THEN
      RAISE EXCEPTION 'Invalid transform %', v_transform;
    END IF;
  ELSE
    v_transform := NULL;
  END IF;

  SELECT * INTO v_row FROM public.portal_field_maps
   WHERE id = p_id AND org_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Field map not found';
  END IF;

  UPDATE public.portal_field_maps
     SET status = p_status,
         source = p_source,
         token = v_token,
         hardcoded_value = v_literal,
         transform = v_transform,
         notes = CASE WHEN p_source IN ('manual', 'manual_partial')
                      THEN coalesce(notes, 'Marked manual in the form editor')
                      ELSE notes END,
         field_label = coalesce(nullif(btrim(coalesce(p_field_label, '')), ''), field_label)
   WHERE id = p_id AND org_id IS NULL
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.train_global_field_map(uuid, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.train_global_field_map(uuid, text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.train_global_field_map(uuid, text, text, text, text, text, text) TO authenticated, service_role;
