-- E6.5 — Payer Setup consolidation: global authoring enablers.
--
-- REPO-ONLY (E6-wave rule): hosted apply is an operator step listed in the PR
-- body; rollback-wrapped probes on hosted via MCP are the sanctioned dry-run.
--
-- What this ships (all additive):
--   1. portals gains a GLOBAL tier (org_id nullable + partial unique on the
--      key + global SELECT disjunct) and a `proven_at` dry-run pass stamp.
--   2. payers gains `delegation_note` — a Minted-curated platform fact
--      rendered in the catalog browser. NO app writer (payer governance
--      pins hold; catalog writes stay service-role).
--   3. Four SECURITY DEFINER RPCs that let AUTHENTICATED users author the
--      global (org_id NULL) tier of portals / SOP templates / portal field
--      maps — the F6.5.6 "authored once, inherited by every org" posture —
--      plus a reissue of publish_sop_template_version opening its global
--      branch to authenticated callers.
--
-- INTERIM GOVERNANCE POSTURE (F6.5.6, PM decision 2026-07-19): authoring is
-- open to ALL authenticated users (the product currently has two trusted
-- operators). R7 introduces real platform roles and hardens these grants.
-- Every RPC body rejects `anon` explicitly via auth.role() — NEVER the
-- `auth.uid() IS NULL` proxy, which treats anon like service-role (the grant
-- hole this migration also closes on the publish RPC).

-- ---------------------------------------------------------------------------
-- 1. portals — global tier + proven_at.
-- ---------------------------------------------------------------------------
ALTER TABLE public.portals ALTER COLUMN org_id DROP NOT NULL;

-- portals_org_key_unique (org_id, portal_key) is NULLs-distinct, so the global
-- tier needs its own key uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS uq_portals_global_key
  ON public.portals (portal_key) WHERE org_id IS NULL;

-- Dry-run pass stamp (F6.5.3): set when a mock dry run fills every mapped
-- field; cleared alongside verification when the form URL changes.
ALTER TABLE public.portals ADD COLUMN IF NOT EXISTS proven_at timestamptz;

-- Global rows readable by every org (the portal_field_maps shared-catalog
-- SELECT shape). Writer INSERT/UPDATE policies stay own-org-only — global
-- writes go through the RPCs below, never direct table access.
DROP POLICY IF EXISTS portals_select_org ON public.portals;
CREATE POLICY portals_select_org ON public.portals
  FOR SELECT TO authenticated
  USING ((org_id IS NULL) OR (org_id IN (SELECT user_org_ids() AS user_org_ids)));

-- ---------------------------------------------------------------------------
-- 2. payers — delegation note (F6.5.5).
--    MSO routing retires app-side in this epic; delegation ("this payer
--    delegates credentialing to X — submit via Y") becomes a curated catalog
--    fact + SOP content. Platform-written only (payers has no org write path
--    since 20260718120000).
-- ---------------------------------------------------------------------------
ALTER TABLE public.payers ADD COLUMN IF NOT EXISTS delegation_note text;

-- ---------------------------------------------------------------------------
-- 3. upsert_global_portal — create or update a GLOBAL portal registry row.
--    portal_key is immutable after create (a rename would orphan every SOP
--    step link, the locked no-key-edit posture); a form URL change clears
--    verification AND the dry-run proof, stamping url_changed_at (the
--    updatePortalUrl semantic).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_global_portal(
  p_id uuid,
  p_name text,
  p_portal_key text,
  p_payer_id uuid DEFAULT NULL,
  p_form_url text DEFAULT NULL
)
RETURNS public.portals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := lower(btrim(coalesce(p_portal_key, '')));
  v_row public.portals%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Portal name is required';
  END IF;

  IF p_id IS NULL THEN
    IF v_key = '' THEN
      RAISE EXCEPTION 'Portal key is required';
    END IF;
    BEGIN
      INSERT INTO public.portals (org_id, portal_key, name, payer_id, form_url)
      VALUES (NULL, v_key, btrim(p_name), p_payer_id, nullif(btrim(coalesce(p_form_url, '')), ''))
      RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'global_portal_key_exists: %', v_key;
    END;
    RETURN v_row;
  END IF;

  SELECT * INTO v_row FROM public.portals WHERE id = p_id AND org_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Portal not found';
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
$$;

REVOKE ALL ON FUNCTION public.upsert_global_portal(uuid, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_global_portal(uuid, text, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_global_portal(uuid, text, text, uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. set_global_portal_flags — verification + dry-run proof flips on a GLOBAL
--    row. NULL leaves a flag unchanged; verified=true stamps last_verified_at;
--    proven=true stamps proven_at (the F6.5.3 pass), proven=false clears it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_global_portal_flags(
  p_id uuid,
  p_verified boolean DEFAULT NULL,
  p_proven boolean DEFAULT NULL
)
RETURNS public.portals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.portals%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_row FROM public.portals WHERE id = p_id AND org_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Portal not found';
  END IF;

  UPDATE public.portals
     SET is_verified = coalesce(p_verified, is_verified),
         last_verified_at = CASE WHEN p_verified IS TRUE THEN now()
                                 WHEN p_verified IS FALSE THEN NULL
                                 ELSE last_verified_at END,
         proven_at = CASE WHEN p_proven IS TRUE THEN now()
                          WHEN p_proven IS FALSE THEN NULL
                          ELSE proven_at END
   WHERE id = p_id AND org_id IS NULL
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_global_portal_flags(uuid, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_global_portal_flags(uuid, boolean, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_global_portal_flags(uuid, boolean, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. author_global_sop — create a GLOBAL SOP head, or edit a global head's
--    match keys / archived flag.
--
--    Contract (mirrors the org-path TE-5 save split): INSERT takes name +
--    task_definitions + required_profile_attributes (the AFTER INSERT trigger
--    seeds version 1); UPDATE changes payer_id/state/group_id/archived ONLY —
--    content, name, and attributes go through publish_sop_template_version,
--    never here.
--
--    Grain guard: global rows sit OUTSIDE uq_sop_templates_active_org_match
--    (its predicate requires org_id IS NOT NULL), so this RPC enforces the
--    equivalent invariant in-body: at most one ACTIVE global row per
--    (payer_id, state, group_id), NULLS NOT DISTINCT. Active non-fallback
--    global rows require payer + state (the E4.2 authoring rule); the seeded
--    generic fallback is the only payerless global row and is LOCKED here —
--    org-user edits to it are rejected (sop-versioning TS-47 posture).
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
  v_row public.sop_templates%ROWTYPE;
  v_archived boolean := coalesce(p_archived, false);
  v_defs jsonb := coalesce(p_task_definitions, '[]'::jsonb);
  v_attrs jsonb := coalesce(p_required_profile_attributes, '[]'::jsonb);
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_id = '00000000-0000-4000-a000-00000000e17b'::uuid THEN
    RAISE EXCEPTION 'fallback_sop_locked';
  END IF;

  -- Active global SOPs require a complete payer+state match key (group stays
  -- optional = the "any group" tier). Archived rows are exempt, mirroring
  -- assertActiveOrgMatchKeyComplete.
  IF NOT v_archived AND (p_payer_id IS NULL OR p_state IS NULL OR btrim(p_state) = '') THEN
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
-- 6. train_global_field_map — the three training shapes (approve / manual /
--    repropose) applied to a GLOBAL portal_field_maps row. Org rows keep the
--    existing browser-RLS UPDATE path; this RPC touches org_id NULL rows ONLY
--    (previously platform/MCP-only by locked rule — E6.5 opens the in-editor
--    trainer to the global tier).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.train_global_field_map(
  p_id uuid,
  p_status text,
  p_source text,
  p_token text DEFAULT NULL,
  p_field_label text DEFAULT NULL
)
RETURNS public.portal_field_maps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.portal_field_maps%ROWTYPE;
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('proposed', 'approved') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('token', 'manual', 'manual_partial') THEN
    RAISE EXCEPTION 'Invalid source';
  END IF;
  IF p_source IN ('token', 'manual_partial') AND v_token IS NULL THEN
    RAISE EXCEPTION 'Token is required for source %', p_source;
  END IF;
  IF p_source = 'manual' THEN
    v_token := NULL;
  END IF;

  SELECT * INTO v_row FROM public.portal_field_maps WHERE id = p_id AND org_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Field map not found';
  END IF;

  UPDATE public.portal_field_maps
     SET status = p_status,
         source = p_source,
         token = v_token,
         -- portal_field_maps_notes_required: manual rows must carry notes.
         notes = CASE WHEN p_source = 'manual' THEN coalesce(notes, 'Marked manual in SOP editor')
                      ELSE notes END,
         field_label = coalesce(nullif(btrim(coalesce(p_field_label, '')), ''), field_label)
   WHERE id = p_id AND org_id IS NULL
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.train_global_field_map(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.train_global_field_map(uuid, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.train_global_field_map(uuid, text, text, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. publish_sop_template_version — reissue (same 6-param signature, body +
--    grant changes only):
--      a. The GLOBAL branch now accepts AUTHENTICATED callers (the interim
--         F6.5.6 posture; R7 hardens). The fallback template stays locked for
--         org-user JWTs; platform callers (service-role / direct SQL) keep
--         full access.
--      b. anon is rejected IN-BODY via auth.role() — the previous body's
--         `auth.uid() IS NULL` global gate treated anon like service-role,
--         and the 20260715140300 reissue carried NO explicit grants (default
--         EXECUTE to anon). Both closed here: body check + explicit floor.
--      c. Org-row rule unchanged: member + admin only, in-RPC audit row.
--         Global publishes write NO audit row (audit_log.org_id is NOT NULL);
--         the immutable version row + published_by is the trail.
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

  IF v_org IS NULL THEN
    -- Global tier: authenticated authoring is the interim F6.5.6 posture
    -- (R7 replaces this with real platform roles). The generic fallback
    -- stays platform-only for org-user JWTs.
    IF p_template_id = '00000000-0000-4000-a000-00000000e17b'::uuid
       AND coalesce(auth.role(), '') = 'authenticated' THEN
      RAISE EXCEPTION 'fallback_sop_locked';
    END IF;
  ELSIF NOT (v_org IN (SELECT user_org_ids()))
     OR user_role(v_org) IS DISTINCT FROM 'admin' THEN
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
