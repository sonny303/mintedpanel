-- Add the payer-form output formats supported by the shared web/PDF shaper.
-- The transform column already stores this choice; widen its existing closed
-- check and the global-training RPC allowlist without changing stored rows.

ALTER TABLE public.portal_field_maps
  DROP CONSTRAINT IF EXISTS portal_field_maps_transform_check;

ALTER TABLE public.portal_field_maps
  ADD CONSTRAINT portal_field_maps_transform_check
  CHECK (
    transform IS NULL OR transform = ANY (ARRAY[
      'date_mmddyyyy',
      'date_mmddyyyy_dash',
      'date_ddmmyyyy',
      'date_ddmmyyyy_dash',
      'date_yyyymmdd_slash',
      'date_yyyymmdd',
      'phone_digits',
      'phone_dashed',
      'phone_country_dashed',
      'phone_e164',
      'zip5',
      'state_abbrev',
      'uppercase'
    ]::text[])
  );

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
  IF app_authz.is_restricted_external() THEN
    RAISE EXCEPTION 'Restricted client cannot modify global training surfaces';
  END IF;
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
    IF v_transform IS NOT NULL AND v_transform NOT IN (
      'state_abbrev',
      'date_mmddyyyy',
      'date_mmddyyyy_dash',
      'date_ddmmyyyy',
      'date_ddmmyyyy_dash',
      'date_yyyymmdd_slash',
      'date_yyyymmdd',
      'zip5',
      'phone_digits',
      'phone_dashed',
      'phone_country_dashed',
      'phone_e164'
    ) THEN
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

REVOKE ALL ON FUNCTION public.train_global_field_map(uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.train_global_field_map(uuid, text, text, text, text, text, text) TO authenticated, service_role;
