-- OPA-RETIRE (R1 B, 2026-08-10) — retire org_payer_assignments as a GATE.
--
-- Lock: stop reading org_payer_assignments to gate catalog visibility
-- (payers_select), attach eligibility (payer_network_targets WITH CHECK), and
-- create_payer's auto-upsert side-effect. The table and its rows stay in
-- place, DORMANT — never DROP (additive rule). Case generation candidacy is
-- unchanged (buildGenerationPreview never took assignments as an input).
--
-- Do NOT call this "Slice 3" — #280 owns that label (SOP All-states + D3.3-G).
--
-- Hosted apply is an operator step (3M lane). Repo dry-run must pass.

-- ---------------------------------------------------------------------------
-- 1. payers_select — every global row readable (portals / sop_templates shape).
--    Own-org disjunct kept for local seed fixtures. No write policies touched.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS payers_select ON public.payers;
CREATE POLICY payers_select ON public.payers
  FOR SELECT USING (
    (org_id IN (SELECT user_org_ids()))
    OR (org_id IS NULL)
  );

-- ---------------------------------------------------------------------------
-- 2. payer_network_targets write WITH CHECKs — drop the assignment EXISTS.
--    Group must still belong to the org; admin-only write posture unchanged.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS payer_network_targets_insert ON public.payer_network_targets;
CREATE POLICY payer_network_targets_insert ON public.payer_network_targets
  FOR INSERT WITH CHECK (
    org_id IN (SELECT user_org_ids())
    AND user_role(org_id) = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.provider_groups g
      WHERE g.id = group_id AND g.org_id = payer_network_targets.org_id
    )
  );

DROP POLICY IF EXISTS payer_network_targets_update ON public.payer_network_targets;
CREATE POLICY payer_network_targets_update ON public.payer_network_targets
  FOR UPDATE USING (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) = 'admin'
  )
  WITH CHECK (
    org_id IN (SELECT user_org_ids())
    AND user_role(org_id) = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.provider_groups g
      WHERE g.id = group_id AND g.org_id = payer_network_targets.org_id
    )
  );

-- ---------------------------------------------------------------------------
-- 3. create_payer — same 10-arg signature (CREATE OR REPLACE; no overload
--    games). Stops upserting org_payer_assignments. p_org_id still authorizes
--    the call and owns the audit row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_payer(
  p_org_id uuid,
  p_name text,
  p_payer_kind text,
  p_states text[],
  p_aliases text[] DEFAULT NULL,
  p_group_id_label text DEFAULT NULL,
  p_group_id_expected boolean DEFAULT NULL,
  p_provider_id_label text DEFAULT NULL,
  p_provider_id_expected boolean DEFAULT NULL,
  p_delegation_note text DEFAULT NULL
)
RETURNS public.payers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_name text;
  v_name text := btrim(coalesce(p_name, ''));
  v_states text[];
  v_aliases text[];
  v_keys text[];
  v_row public.payers%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_org_id IS NULL
     OR NOT (p_org_id IN (SELECT user_org_ids()))
     OR user_role(p_org_id) NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'payer_name_required';
  END IF;
  IF p_payer_kind IS NULL OR p_payer_kind NOT IN
     ('commercial', 'medicare', 'medicaid', 'medicaid_mco', 'medicare_advantage', 'tricare') THEN
    RAISE EXCEPTION 'payer_kind_invalid';
  END IF;
  v_states := public._payer_norm_states(p_states);
  v_aliases := public._payer_norm_aliases(p_aliases);

  v_keys := ARRAY[public._payer_norm_name(v_name)]
            || coalesce(
                 (SELECT array_agg(public._payer_norm_name(a)) FROM unnest(coalesce(v_aliases, '{}'::text[])) a),
                 '{}'::text[]
               );
  PERFORM public._payer_assert_name_available(v_keys, NULL);

  BEGIN
    INSERT INTO public.payers
      (org_id, name, payer_kind, states, aliases, status,
       group_id_label, group_id_expected, provider_id_label, provider_id_expected,
       delegation_note, payer_slug, last_synced_at,
       created_by, source, updated_at)
    VALUES
      (NULL, v_name, p_payer_kind, v_states, v_aliases, 'active',
       nullif(btrim(coalesce(p_group_id_label, '')), ''), p_group_id_expected,
       nullif(btrim(coalesce(p_provider_id_label, '')), ''), p_provider_id_expected,
       nullif(btrim(coalesce(p_delegation_note, '')), ''), NULL, NULL,
       v_uid, 'manual', now())
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'payer_duplicate: a payer named "%" already exists in the catalog', v_name;
  END;

  -- OPA-RETIRE: no org_payer_assignments upsert. Adoption = group attach
  -- (payer_network_targets). Table stays dormant.

  SELECT coalesce(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id, after, description)
  VALUES
    (p_org_id, v_uid, v_user_name, 'CREATE', 'payer', v_row.id,
     jsonb_build_object(
       'name', v_row.name, 'payerKind', v_row.payer_kind,
       'states', v_row.states, 'aliases', v_row.aliases, 'source', v_row.source,
       'assignedToOrg', false),
     'Created payer "' || v_row.name || '" in the payer catalog (manual setup)');

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_payer(uuid, text, text, text[], text[], text, boolean, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_payer(uuid, text, text, text[], text[], text, boolean, text, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_payer(uuid, text, text, text[], text[], text, boolean, text, boolean, text) TO authenticated, service_role;
