-- 3M Slice 6 / D6.1 — platform authoring vs org adoption.
-- Spike: docs/ops/slice-6-platform-org-spike.md (LOCKED D6.1).
--
-- E6.7 locked "creating = adding": create_payer ALWAYS upserts the caller
-- org's org_payer_assignments row. That conflates two intents — an ops user
-- setting a payer up FOR THEIR NETWORK, and a platform user authoring the
-- canonical identity (payer -> SOP -> shared portal -> train -> map) that
-- orgs adopt later. This softens the coupling WITHOUT reversing the default:
-- creating still adds unless the caller explicitly says otherwise.
--
--   p_assign_to_org = true (DEFAULT)  today's behaviour, byte for byte:
--                                     assignment upsert + the same audit row.
--   p_assign_to_org = false           GLOBAL payer row only. No assignment,
--                                     no scope, no candidates. Adoption stays
--                                     the existing addAssignment / Payer
--                                     Detail "Add to my network" path.
--
-- p_org_id is STILL REQUIRED either way: it is what authorizes the call
-- (writer-member of that org) and what the audit row is written under.
-- Platform authoring does not invent a platform role — the E6.7 / D11 posture
-- stands, and R7 owns any real platform tier.
--
-- Shape: DROP + CREATE rather than a plain CREATE OR REPLACE with a defaulted
-- arg. Adding a DEFAULT parameter would leave the 10-arg signature resolvable
-- alongside the new 11-arg one, and PostgREST cannot disambiguate two
-- overloads whose named-argument sets nest — the same trap E4.2 hit on
-- publish_sop_template_version and E6.8 hit on set_case_status, both of which
-- dropped the old signature for exactly this reason. Every caller (the
-- payers.ts service seam) moves to the new signature in this PR.
--
-- Nothing else changes: the duplicate guard, the states/kind validation, the
-- provenance stamp, the GLOBAL org_id NULL insert, and the 20260718120000
-- payers table write lockdown are all untouched.

DROP FUNCTION IF EXISTS public.create_payer(
  uuid, text, text, text[], text[], text, boolean, text, boolean, text
);

CREATE FUNCTION public.create_payer(
  p_org_id uuid,
  p_name text,
  p_payer_kind text,
  p_states text[],
  p_aliases text[] DEFAULT NULL,
  p_group_id_label text DEFAULT NULL,
  p_group_id_expected boolean DEFAULT NULL,
  p_provider_id_label text DEFAULT NULL,
  p_provider_id_expected boolean DEFAULT NULL,
  p_delegation_note text DEFAULT NULL,
  p_assign_to_org boolean DEFAULT true
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
  v_assign boolean := coalesce(p_assign_to_org, true);
  v_row public.payers%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  -- Writer-member of the org the call is made under. Required for BOTH
  -- intents: with p_assign_to_org = false the org still authorizes the write
  -- and owns the audit row — it just does not adopt the payer.
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
    -- The partial unique index won a race (or a retired name was reused).
    RAISE EXCEPTION 'payer_duplicate: a payer named "%" already exists in the catalog', v_name;
  END;

  -- D6.1: adoption is now the caller's choice. When it is taken, it rides the
  -- SAME transaction as the identity insert (reactivating an archived
  -- subscription — the addAssignment semantic), so "creating = adding" is
  -- still all-or-nothing for everyone who does not opt out.
  IF v_assign THEN
    INSERT INTO public.org_payer_assignments (org_id, payer_id, status)
    VALUES (p_org_id, v_row.id, 'active')
    ON CONFLICT ON CONSTRAINT org_payer_assignments_org_payer_key
    DO UPDATE SET status = 'active', archived_at = NULL;
  END IF;

  SELECT coalesce(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id, after, description)
  VALUES
    (p_org_id, v_uid, v_user_name, 'CREATE', 'payer', v_row.id,
     jsonb_build_object(
       'name', v_row.name, 'payerKind', v_row.payer_kind,
       'states', v_row.states, 'aliases', v_row.aliases, 'source', v_row.source,
       -- The audit row is the only record of which intent was used: an
       -- unassigned create leaves no org_payer_assignments trace at all.
       'assignedToOrg', v_assign),
     CASE WHEN v_assign
       THEN 'Created payer "' || v_row.name || '" (manual setup) and added it to the organization network'
       ELSE 'Created global payer "' || v_row.name || '" (manual setup) without adding it to the organization network'
     END);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_payer(
  uuid, text, text, text[], text[], text, boolean, text, boolean, text, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_payer(
  uuid, text, text, text[], text[], text, boolean, text, boolean, text, boolean
) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_payer(
  uuid, text, text, text[], text[], text, boolean, text, boolean, text, boolean
) TO authenticated, service_role;
