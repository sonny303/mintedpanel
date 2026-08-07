-- E6.9 F6.9.2 — shared-tier registry write parity.
--
-- The trained-form library is SHARED (`org_id IS NULL`, D10/D12) but shared
-- rows fail browser RLS for both INSERT and UPDATE (`org_id IN user_org_ids()`),
-- and `train_global_field_map` could only change decision state — it rejected
-- `source = 'hardcoded'` and could not write registry metadata at all. So a
-- shared form could never accumulate mappings from capture, and none of
-- F6.9.3–F6.9.6 could write to the tier that matters.
--
-- This ships the three missing shared mutations. All follow the E6.5
-- `20260719170000` idioms: SECURITY DEFINER, pinned search_path, anon rejected
-- IN-BODY via auth.role() (never the `auth.uid() IS NULL` proxy, which treats
-- anon like service_role), an explicit REVOKE/GRANT floor, and a
-- `WHERE org_id IS NULL` predicate on every write so a shared call can never
-- touch an org row.
--
-- Ungated for any signed-in user (D11) — there is no role model, and E6.7
-- rejected platform-role gating. No audit rows: `audit_log.org_id` is NOT NULL,
-- so shared writes have no org to book against; `updated_at` is the trail (D14).
--
-- Repo-only; hosted apply is an operator step in the PR body.

-- ---------------------------------------------------------------------------
-- 1. propose_shared_field_map — capture (F6.9.8) and manual "Add field"
--    (F6.9.6) both land shared rows through here.
--
--    Idempotent on the F6.9.1 partial unique index: ON CONFLICT DO NOTHING,
--    then re-read. A repeat capture of the same page returns the EXISTING row
--    with its decision intact rather than resetting it to proposed — the
--    whole point of re-capture as drift repair (D7).
-- ---------------------------------------------------------------------------
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
  -- selector is NOT NULL in the table; manual rows carry a deterministic
  -- `manual:` synthetic selector (F6.9.6) rather than relaxing the column.
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
    -- portal_field_maps_notes_required: source 'manual' ⇒ notes NOT NULL.
    coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'Captured for the shared form library'),
    NULL, p_sort_order
  )
  ON CONFLICT DO NOTHING;

  SELECT * INTO v_row
    FROM public.portal_field_maps
   WHERE org_id IS NULL AND portal_key = v_key AND selector = v_selector;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Could not resolve the shared field map after insert';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.propose_shared_field_map(text, text, text, text, text, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.propose_shared_field_map(text, text, text, text, text, text, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.propose_shared_field_map(text, text, text, text, text, text, integer, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. train_global_field_map — REISSUED (same name, widened signature).
--
--    Adds what F6.9.4 needs and the E6.5 body refused:
--      a. source 'hardcoded' + a non-empty literal → approved, token cleared.
--         Without this a shared fixed value is impossible, and the extension
--         only fills fixed values when source = 'hardcoded'.
--      b. Repropose clears hardcoded_value as well as token. The E6.5 body
--         left a stale literal behind on unmap — harmless under the old
--         classifier, but F6.9.4 keys "is this a fixed value" off the source,
--         and a stale value is a confusing thing to show a human either way.
--
--    The old 5-arg signature is DROPPED rather than overloaded (the E4.2
--    no-overload precedent: PostgREST cannot disambiguate two RPCs of the same
--    name by argument shape).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.train_global_field_map(uuid, text, text, text, text);

CREATE OR REPLACE FUNCTION public.train_global_field_map(
  p_id uuid,
  p_status text,
  p_source text,
  p_token text DEFAULT NULL,
  p_field_label text DEFAULT NULL,
  p_hardcoded_value text DEFAULT NULL
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
    -- A fixed value IS the decision; there is no token beside it.
    v_token := NULL;
  ELSE
    v_literal := NULL;
  END IF;
  IF p_source = 'manual' THEN
    v_token := NULL;
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
         -- Cleared on every non-hardcoded transition, so unmap leaves no
         -- stale literal behind.
         hardcoded_value = v_literal,
         -- portal_field_maps_notes_required: manual rows must carry notes.
         notes = CASE WHEN p_source IN ('manual', 'manual_partial')
                      THEN coalesce(notes, 'Marked manual in the form editor')
                      ELSE notes END,
         field_label = coalesce(nullif(btrim(coalesce(p_field_label, '')), ''), field_label)
   WHERE id = p_id AND org_id IS NULL
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.train_global_field_map(uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.train_global_field_map(uuid, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.train_global_field_map(uuid, text, text, text, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. update_shared_field_registry — display_label / section / sort_order.
--
--    Takes a BATCH because re-capture reorders a whole page at once (F6.9.5):
--    one statement, one transaction, no half-ordered intermediate state.
--
--    Each entry is `{id, display_label?, section?, sort_order?}`. A key that
--    is PRESENT and null CLEARS the column (the admin removing a rename);
--    a key that is ABSENT leaves it untouched. `?` on the jsonb tells the two
--    apart — `->>` alone cannot.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_shared_field_registry(p_entries jsonb)
RETURNS SETOF public.portal_field_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry jsonb;
  v_id uuid;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'entries must be a json array';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_id := nullif(v_entry->>'id', '')::uuid;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'each entry needs an id';
    END IF;

    UPDATE public.portal_field_maps
       SET display_label = CASE WHEN v_entry ? 'display_label'
                                THEN nullif(btrim(coalesce(v_entry->>'display_label', '')), '')
                                ELSE display_label END,
           section       = CASE WHEN v_entry ? 'section'
                                THEN nullif(btrim(coalesce(v_entry->>'section', '')), '')
                                ELSE section END,
           sort_order    = CASE WHEN v_entry ? 'sort_order'
                                THEN (v_entry->>'sort_order')::integer
                                ELSE sort_order END,
           updated_at    = now()
     WHERE id = v_id AND org_id IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Shared field map % not found', v_id;
    END IF;
  END LOOP;

  RETURN QUERY
    SELECT * FROM public.portal_field_maps
     WHERE org_id IS NULL
       AND id IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(p_entries) e);
END;
$$;

REVOKE ALL ON FUNCTION public.update_shared_field_registry(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_shared_field_registry(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_shared_field_registry(jsonb) TO authenticated, service_role;
