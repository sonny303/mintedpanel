-- E6.7 F6.7.1 / F6.7.1a / F6.7.1b — Payer manual-setup enabler.
--
-- The PM is retiring the precanned payer-catalog browse (2026-07-26 decisions,
-- docs/redesign/payer-catalog-removal-impact.md): a user SETS UP a payer
-- manually and it lands in their org's network. `payers` has had no app write
-- path since 20260718120000_payers_org_write_lockdown — this migration adds
-- the ONE sanctioned write path back as guarded SECURITY DEFINER RPCs (the
-- author_global_sop precedent: interim all-authenticated posture, anon
-- rejected in-body, R7 hardens with real platform roles). Everything here is
-- additive — no rename, no drop, no policy widening; the table stays
-- member-SELECT-only and the org INSERT/UPDATE grants stay revoked (direct
-- table writes remain impossible; the RPCs are the only door).
--
-- Ships:
--   1. F6.7.1a additive columns on payers:
--        - the ID-expectation SPLIT: group_id_label/group_id_expected +
--          provider_id_label/provider_id_expected (a payer may issue a GROUP
--          ID, a PROVIDER ID, both, or neither — the legacy single
--          resolution_id_label/resolution_id_expected pair cannot say which).
--          The provider pair backfills from the legacy pair; the legacy pair
--          deprecates in place (stop-write; readers keep a fallback chain).
--        - provenance: created_by / source (seed|sync|manual; existing rows
--          backfill 'sync') / updated_at — stamped by the RPCs.
--        - domain CHECKs on payer_kind + status: ALREADY LIVE since E1.6
--          (payers_payer_kind_check / payers_status_check, 20260712180000) —
--          re-asserted guarded + VALIDATEd here so the F6.7.1a invariant is
--          explicit and a repo-only rebuild stays correct.
--        - the DB-level duplicate backstop: partial unique index on
--          lower(btrim(name)) WHERE org_id IS NULL AND status <> 'merged'
--          (aliases stay RPC-guard-only). Live data verified collision-free
--          2026-07-27 (zero rows from the pre-check in the E6.7 PR body).
--   2. F6.7.1 create_payer — inserts a GLOBAL row (org_id NULL, PM decision:
--      authored once, template inheritance intact) AND upserts the caller
--      org's org_payer_assignments row in the same transaction (creating =
--      adding; there is no other reason to create a payer).
--   3. F6.7.1b update_payer — same posture/validation; a typo is a 10-second
--      fix, not a platform ticket. status/merged_into_id/org_id/provenance
--      are NOT editable here (merges stay platform-side).
--   4. set_case_status reissue (same signature): Approved now requires
--      EXACTLY the expected payer-issued IDs — the provider ID when
--      provider_id_expected (legacy-pair fallback, default true = today's
--      behavior), the group ID when group_id_expected (default false =
--      today's behavior). New named error:
--      case_status_approved_needs_group_provider_id.
--
-- Named errors the frontend seam (src/services/payers.ts) maps:
--   payer_duplicate          — normalized name/alias collides with a
--                              non-retired global row (a merged match names
--                              its successor in the message)
--   payer_name_required, payer_kind_invalid,
--   payer_states_required, payer_state_invalid — validation
--   'Not authorized'         — anon / non-member / non-writer callers

-- ---------------------------------------------------------------------------
-- 1a. Additive columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payers
  ADD COLUMN IF NOT EXISTS group_id_label text,
  ADD COLUMN IF NOT EXISTS group_id_expected boolean,
  ADD COLUMN IF NOT EXISTS provider_id_label text,
  ADD COLUMN IF NOT EXISTS provider_id_expected boolean,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users (id),
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- Provider-side backfill from the legacy pair (the legacy pair meant the
-- INDIVIDUAL identifier; it deprecates in place, stop-write).
UPDATE public.payers
   SET provider_id_label = resolution_id_label,
       provider_id_expected = resolution_id_expected
 WHERE provider_id_label IS NULL
   AND provider_id_expected IS NULL
   AND (resolution_id_label IS NOT NULL OR resolution_id_expected IS NOT NULL);

-- Provenance backfill: every pre-E6.7 row came from the sync/seed pipeline.
UPDATE public.payers SET source = 'sync' WHERE source IS NULL;

-- Domain CHECKs (E0.10 precedent): source is new; kind/status re-asserted
-- (already live since E1.6) then VALIDATEd — a no-op on valid constraints.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payers_source_check') THEN
    ALTER TABLE public.payers
      ADD CONSTRAINT payers_source_check
      CHECK (source IS NULL OR source IN ('seed', 'sync', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payers_payer_kind_check') THEN
    ALTER TABLE public.payers
      ADD CONSTRAINT payers_payer_kind_check CHECK (
        payer_kind IN ('commercial', 'medicare', 'medicaid', 'medicaid_mco', 'medicare_advantage', 'tricare')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payers_status_check') THEN
    ALTER TABLE public.payers
      ADD CONSTRAINT payers_status_check CHECK (status IN ('active', 'merged', 'retired'));
  END IF;
END $$;

ALTER TABLE public.payers VALIDATE CONSTRAINT payers_source_check;
ALTER TABLE public.payers VALIDATE CONSTRAINT payers_payer_kind_check;
ALTER TABLE public.payers VALIDATE CONSTRAINT payers_status_check;

-- DB-level duplicate backstop: one global non-merged row per normalized name.
-- Merged rows keep their historical name (their successor usually carries a
-- near-identical one); retired names stay blocked at the DB even though the
-- RPC guard lets a retired name be re-registered — the RPCs catch the
-- unique_violation and surface it as payer_duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payers_global_normalized_name
  ON public.payers (lower(btrim(name)))
  WHERE org_id IS NULL AND status <> 'merged';

-- ---------------------------------------------------------------------------
-- Private helpers (no client EXECUTE — called from the definer RPCs only).
-- ---------------------------------------------------------------------------

-- Normalized-name key: lower / trim / collapse internal whitespace. Mirrored
-- app-side by src/lib/payerNearMatch.ts normalizePayerName — keep in lockstep.
CREATE OR REPLACE FUNCTION public._payer_norm_name(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(lower(btrim(coalesce(p_value, ''))), '\s+', ' ', 'g');
$$;

REVOKE ALL ON FUNCTION public._payer_norm_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._payer_norm_name(text) FROM anon;
REVOKE ALL ON FUNCTION public._payer_norm_name(text) FROM authenticated;

-- Trim/uppercase/dedupe the states array and enforce the F6.7.1 contract:
-- required, >= 1, each ^[A-Z]{2}$. states[] is load-bearing — groupPayerAttach
-- eligibility, payerExpansion generation candidacy, and the E6.2 attach-CSV
-- scan all intersect against it; an empty-states payer can never attach or
-- generate a case.
CREATE OR REPLACE FUNCTION public._payer_norm_states(p_states text[])
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_states text[];
  v_bad text;
BEGIN
  SELECT array_agg(DISTINCT s ORDER BY s) INTO v_states
    FROM (
      SELECT upper(btrim(x)) AS s
        FROM unnest(coalesce(p_states, '{}'::text[])) x
       WHERE btrim(coalesce(x, '')) <> ''
    ) u;
  IF v_states IS NULL OR cardinality(v_states) = 0 THEN
    RAISE EXCEPTION 'payer_states_required';
  END IF;
  SELECT s INTO v_bad FROM unnest(v_states) s WHERE s !~ '^[A-Z]{2}$' LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'payer_state_invalid: %', v_bad;
  END IF;
  RETURN v_states;
END;
$$;

REVOKE ALL ON FUNCTION public._payer_norm_states(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._payer_norm_states(text[]) FROM anon;
REVOKE ALL ON FUNCTION public._payer_norm_states(text[]) FROM authenticated;

-- Trim/dedupe aliases; blanks dropped; NULL when empty.
CREATE OR REPLACE FUNCTION public._payer_norm_aliases(p_aliases text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(
    coalesce((
      SELECT array_agg(DISTINCT a ORDER BY a)
        FROM (
          SELECT btrim(x) AS a
            FROM unnest(coalesce(p_aliases, '{}'::text[])) x
           WHERE btrim(coalesce(x, '')) <> ''
        ) u
    ), '{}'::text[]),
    '{}'::text[]
  );
$$;

REVOKE ALL ON FUNCTION public._payer_norm_aliases(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._payer_norm_aliases(text[]) FROM anon;
REVOKE ALL ON FUNCTION public._payer_norm_aliases(text[]) FROM authenticated;

-- The duplicate guard (F6.7.1 acceptance): every normalized candidate key
-- (name + aliases) must be free of any NON-RETIRED global row's name/alias.
-- A merged match names its successor so the caller can add THAT payer
-- instead. Retired names are re-registrable per the guard, but the partial
-- unique index above still blocks an exact normalized-name reuse — the RPCs
-- convert that unique_violation into payer_duplicate.
CREATE OR REPLACE FUNCTION public._payer_assert_name_available(p_keys text[], p_exclude_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_dup public.payers%ROWTYPE;
  v_successor text;
BEGIN
  SELECT px.* INTO v_dup
    FROM public.payers px
   WHERE px.org_id IS NULL
     AND px.status <> 'retired'
     AND px.id IS DISTINCT FROM p_exclude_id
     AND (
       public._payer_norm_name(px.name) = ANY (p_keys)
       OR EXISTS (
         SELECT 1 FROM unnest(coalesce(px.aliases, '{}'::text[])) al
          WHERE public._payer_norm_name(al) = ANY (p_keys)
       )
     )
   ORDER BY (px.status = 'active') DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_dup.status = 'merged' THEN
    SELECT name INTO v_successor FROM public.payers WHERE id = v_dup.merged_into_id;
    RAISE EXCEPTION 'payer_duplicate: "%" was merged into "%" — add that payer instead',
      v_dup.name, coalesce(v_successor, 'its successor');
  END IF;
  RAISE EXCEPTION 'payer_duplicate: a payer named "%" already exists in the catalog', v_dup.name;
END;
$$;

REVOKE ALL ON FUNCTION public._payer_assert_name_available(text[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._payer_assert_name_available(text[], uuid) FROM anon;
REVOKE ALL ON FUNCTION public._payer_assert_name_available(text[], uuid) FROM authenticated;

-- ---------------------------------------------------------------------------
-- F6.7.1 — create_payer. One transaction: the GLOBAL payer row + the caller
-- org's assignment upsert + the org-scoped audit row. Any RAISE rolls all of
-- it back.
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
  -- Writer-member of the org the payer lands in (billing is read-only; the
  -- PM's no-platform-role decision means any writer member may create).
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

  -- Creating = adding: the caller org's subscription rides the same
  -- transaction (reactivating an archived one — the addAssignment semantic).
  INSERT INTO public.org_payer_assignments (org_id, payer_id, status)
  VALUES (p_org_id, v_row.id, 'active')
  ON CONFLICT ON CONSTRAINT org_payer_assignments_org_payer_key
  DO UPDATE SET status = 'active', archived_at = NULL;

  SELECT coalesce(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id, after, description)
  VALUES
    (p_org_id, v_uid, v_user_name, 'CREATE', 'payer', v_row.id,
     jsonb_build_object(
       'name', v_row.name, 'payerKind', v_row.payer_kind,
       'states', v_row.states, 'aliases', v_row.aliases, 'source', v_row.source),
     'Created payer "' || v_row.name || '" (manual setup) and added it to the organization network');

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_payer(uuid, text, text, text[], text[], text, boolean, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_payer(uuid, text, text, text[], text[], text, boolean, text, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_payer(uuid, text, text, text[], text[], text, boolean, text, boolean, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- F6.7.1b — update_payer. Full-replace of the editable set (name, kind,
-- states, aliases, both ID-expectation pairs, delegation note) on an ACTIVE
-- global row. NOT editable here: status / merged_into_id (merges stay
-- platform-side), org_id, provenance (created_by/source), and the deprecated
-- legacy resolution pair (stop-write). Same validation + dup guard as create,
-- excluding the row itself; states[] can never be emptied.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_payer(
  p_org_id uuid,
  p_payer_id uuid,
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
  v_before public.payers%ROWTYPE;
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

  SELECT * INTO v_before FROM public.payers
   WHERE id = p_payer_id AND org_id IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payer not found';
  END IF;
  IF v_before.status <> 'active' THEN
    -- Retired/merged rows are curation history; repairs stay platform-side.
    RAISE EXCEPTION 'payer_not_editable';
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
  PERFORM public._payer_assert_name_available(v_keys, p_payer_id);

  BEGIN
    UPDATE public.payers
       SET name = v_name,
           payer_kind = p_payer_kind,
           states = v_states,
           aliases = v_aliases,
           group_id_label = nullif(btrim(coalesce(p_group_id_label, '')), ''),
           group_id_expected = p_group_id_expected,
           provider_id_label = nullif(btrim(coalesce(p_provider_id_label, '')), ''),
           provider_id_expected = p_provider_id_expected,
           delegation_note = nullif(btrim(coalesce(p_delegation_note, '')), ''),
           updated_at = now()
     WHERE id = p_payer_id AND org_id IS NULL
     RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'payer_duplicate: a payer named "%" already exists in the catalog', v_name;
  END;

  SELECT coalesce(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id, before, after, description)
  VALUES
    (p_org_id, v_uid, v_user_name, 'UPDATE', 'payer', v_row.id,
     jsonb_build_object(
       'name', v_before.name, 'payerKind', v_before.payer_kind,
       'states', v_before.states, 'aliases', v_before.aliases,
       'groupIdLabel', v_before.group_id_label, 'groupIdExpected', v_before.group_id_expected,
       'providerIdLabel', v_before.provider_id_label, 'providerIdExpected', v_before.provider_id_expected,
       'delegationNote', v_before.delegation_note),
     jsonb_build_object(
       'name', v_row.name, 'payerKind', v_row.payer_kind,
       'states', v_row.states, 'aliases', v_row.aliases,
       'groupIdLabel', v_row.group_id_label, 'groupIdExpected', v_row.group_id_expected,
       'providerIdLabel', v_row.provider_id_label, 'providerIdExpected', v_row.provider_id_expected,
       'delegationNote', v_row.delegation_note),
     'Updated payer "' || v_row.name || '"');

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_payer(uuid, uuid, text, text, text[], text[], text, boolean, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_payer(uuid, uuid, text, text, text[], text[], text, boolean, text, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_payer(uuid, uuid, text, text, text[], text[], text, boolean, text, boolean, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- F6.7.1a — set_case_status reissue (same 11-param signature; body change
-- ONLY in the Approved evidence block). The E6.0 rule required the individual
-- provider ID unconditionally; with the ID-expectation split, Approved now
-- requires EXACTLY what the payer is expected to issue:
--   * the INDIVIDUAL ID when provider_id_expected — falling back through the
--     deprecated legacy resolution_id_expected, then TRUE (today's behavior
--     for unconfigured payers; mirrors src/lib/payerResolutionIdentifier.ts);
--   * the GROUP ID when group_id_expected (NULL → false = today's behavior).
-- Everything else — edges, corrections, mirrors, history, audit — is copied
-- verbatim from 20260719120100. New named error:
--   case_status_approved_needs_group_provider_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_case_status(
  p_case_id uuid,
  p_to_status text,
  p_expected_status text DEFAULT NULL,
  p_reason_code_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_is_correction boolean DEFAULT false,
  p_effective_date date DEFAULT NULL,
  p_individual_provider_id text DEFAULT NULL,
  p_group_provider_id text DEFAULT NULL,
  p_contract_executed_date date DEFAULT NULL,
  p_evidence_touch_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_case public.credential_cases;
  v_org uuid;
  v_from text;
  v_role text;
  v_user uuid := auth.uid();
  v_user_name text;
  v_reason public.denial_reason_codes;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_individual_id text := NULLIF(btrim(COALESCE(p_individual_provider_id, '')), '');
  v_group_id text := NULLIF(btrim(COALESCE(p_group_provider_id, '')), '');
  v_provider_id_required boolean;
  v_group_id_required boolean;
  v_from_rank int;
  v_to_rank int;
  v_legal boolean;
  v_mirror_label text;
  v_mirror_status uuid;
  v_mirror_pipeline text;
BEGIN
  -- Lock the row; RLS (SECURITY INVOKER) scopes this to the caller's org, so
  -- a cross-org or missing id is simply NOT FOUND.
  SELECT * INTO v_case FROM public.credential_cases WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_status_case_not_found';
  END IF;
  v_org := v_case.org_id;
  v_from := v_case.case_status;
  v_role := user_role(v_org);

  IF v_role IS NULL OR v_role NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'case_status_not_authorized';
  END IF;

  -- Optimistic concurrency: the client acted on p_expected_status. A stale
  -- second writer is rejected, not silently overwritten. (The Add-touch bump
  -- passes NULL — an auto-trigger may have just advanced the case.)
  IF p_expected_status IS NOT NULL AND p_expected_status <> v_from THEN
    RAISE EXCEPTION 'case_status_conflict:%', v_from;
  END IF;

  IF p_to_status NOT IN (
    'not_started', 'in_progress', 'submitted', 'in_review',
    'action_required', 'approved', 'denied', 'not_pursuing'
  ) THEN
    RAISE EXCEPTION 'case_status_invalid';
  END IF;

  IF p_to_status = v_from THEN
    RAISE EXCEPTION 'case_status_invalid_transition';
  END IF;

  IF p_is_correction THEN
    -- Backward/off-edge moves: admin-only, note required (F6.0.4).
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'case_status_admin_only';
    END IF;
    IF v_note IS NULL THEN
      RAISE EXCEPTION 'case_status_correction_needs_note';
    END IF;
  ELSE
    v_from_rank := CASE v_from
      WHEN 'not_started' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'submitted' THEN 2
      WHEN 'in_review' THEN 3 WHEN 'action_required' THEN 4 ELSE NULL END;
    v_to_rank := CASE p_to_status
      WHEN 'not_started' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'submitted' THEN 2
      WHEN 'in_review' THEN 3 WHEN 'action_required' THEN 4 ELSE NULL END;
    v_legal :=
      (v_from = 'denied' AND p_to_status = 'in_progress')
      OR (v_from_rank IS NOT NULL
          AND p_to_status IN ('approved', 'denied', 'not_pursuing'))
      OR (v_from_rank IS NOT NULL AND v_to_rank IS NOT NULL AND v_to_rank > v_from_rank)
      OR (v_from = 'action_required' AND p_to_status = 'in_review');
    IF NOT v_legal THEN
      RAISE EXCEPTION 'case_status_invalid_transition';
    END IF;
  END IF;

  -- Reason-code enforcement. Validate any supplied code against the
  -- global + own-org active vocabulary (the E4.0 denial_reason_codes table —
  -- the fixed word-list the Denied dialog requires).
  IF p_reason_code_id IS NOT NULL THEN
    SELECT * INTO v_reason FROM public.denial_reason_codes
      WHERE id = p_reason_code_id
        AND (org_id IS NULL OR org_id = v_org)
        AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'case_status_reason_invalid';
    END IF;
  END IF;

  IF p_to_status = 'denied' THEN
    IF p_reason_code_id IS NULL THEN
      RAISE EXCEPTION 'case_status_denied_needs_reason';
    END IF;
    IF v_reason.code = 'other' AND v_note IS NULL THEN
      RAISE EXCEPTION 'case_status_other_needs_context';
    END IF;
  END IF;

  IF p_to_status = 'not_pursuing' AND NOT p_is_correction AND v_note IS NULL THEN
    RAISE EXCEPTION 'case_status_not_pursuing_needs_note';
  END IF;

  -- Approved captures the terminal facts at the moment the letter is in hand
  -- (F6.0.2): the effective date always; the payer-issued IDs per the payer's
  -- E6.7 ID-expectation flags (F6.7.1a — require exactly the expected ones).
  IF p_to_status = 'approved' AND NOT p_is_correction THEN
    IF p_effective_date IS NULL THEN
      RAISE EXCEPTION 'case_status_approved_needs_effective_date';
    END IF;
    SELECT COALESCE(py.provider_id_expected, py.resolution_id_expected, true),
           COALESCE(py.group_id_expected, false)
      INTO v_provider_id_required, v_group_id_required
      FROM public.payers py WHERE py.id = v_case.payer_id;
    IF NOT FOUND THEN
      v_provider_id_required := true;
      v_group_id_required := false;
    END IF;
    IF v_provider_id_required AND v_individual_id IS NULL THEN
      RAISE EXCEPTION 'case_status_approved_needs_provider_id';
    END IF;
    IF v_group_id_required AND v_group_id IS NULL THEN
      RAISE EXCEPTION 'case_status_approved_needs_group_provider_id';
    END IF;
  END IF;

  -- The evidencing touch (F6.0.3) must belong to this same case.
  IF p_evidence_touch_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.touches t
      WHERE t.id = p_evidence_touch_id AND t.case_id = p_case_id AND t.org_id = v_org
    ) THEN
      RAISE EXCEPTION 'case_status_evidence_invalid';
    END IF;
  END IF;

  -- Transition-shim mirrors (see 20260719120100). The credentialing mirror
  -- resolves this org's status_configs row by canonical label; a missing row
  -- (never the case for canonically-seeded orgs) leaves the legacy field
  -- unchanged.
  v_mirror_label := CASE p_to_status
    WHEN 'not_started' THEN 'Not Started'
    WHEN 'in_progress' THEN 'In Progress'
    WHEN 'submitted' THEN 'Submitted'
    WHEN 'in_review' THEN 'Submitted'
    WHEN 'action_required' THEN 'Waiting on Provider'
    WHEN 'approved' THEN 'Approved'
    WHEN 'denied' THEN 'Denied'
    WHEN 'not_pursuing' THEN 'Not Required'
  END;
  SELECT id INTO v_mirror_status FROM public.status_configs
    WHERE org_id = v_org AND track = 'credentialing' AND label = v_mirror_label
    ORDER BY sort_order ASC LIMIT 1;
  v_mirror_pipeline := CASE p_to_status
    WHEN 'not_started' THEN 'not_started'
    WHEN 'in_progress' THEN 'drafting'
    WHEN 'submitted' THEN 'submitted'
    WHEN 'in_review' THEN 'in_review'
    WHEN 'action_required' THEN 'action_required'
    WHEN 'approved' THEN 'approved'
    WHEN 'denied' THEN 'denied'
    WHEN 'not_pursuing' THEN 'oon'
  END;

  IF p_to_status = 'approved' AND NOT p_is_correction THEN
    UPDATE public.credential_cases
      SET case_status = p_to_status,
          credentialing_status_id = COALESCE(v_mirror_status, credentialing_status_id),
          payer_pipeline_state = v_mirror_pipeline,
          confirmed_effective_date = p_effective_date,
          payer_individual_provider_id = v_individual_id,
          payer_group_provider_id = COALESCE(v_group_id, payer_group_provider_id),
          contract_executed_date = COALESCE(p_contract_executed_date, contract_executed_date),
          approved_date = COALESCE(approved_date, CURRENT_DATE),
          updated_at = now()
      WHERE id = p_case_id
      RETURNING * INTO v_case;
  ELSIF p_is_correction AND v_from = 'approved' AND p_to_status <> 'approved' THEN
    -- Approval reversal: clear the erroneous enrollment facts (admin-only,
    -- the E4.0 reversal pattern).
    UPDATE public.credential_cases
      SET case_status = p_to_status,
          credentialing_status_id = COALESCE(v_mirror_status, credentialing_status_id),
          payer_pipeline_state = v_mirror_pipeline,
          confirmed_effective_date = NULL,
          payer_individual_provider_id = NULL,
          payer_group_provider_id = NULL,
          contract_executed_date = NULL,
          approved_date = NULL,
          updated_at = now()
      WHERE id = p_case_id
      RETURNING * INTO v_case;
  ELSIF p_to_status = 'submitted' THEN
    -- The human asserting the submission stamps the plain fact date once.
    UPDATE public.credential_cases
      SET case_status = p_to_status,
          credentialing_status_id = COALESCE(v_mirror_status, credentialing_status_id),
          payer_pipeline_state = v_mirror_pipeline,
          submitted_date = COALESCE(submitted_date, CURRENT_DATE),
          updated_at = now()
      WHERE id = p_case_id
      RETURNING * INTO v_case;
  ELSE
    UPDATE public.credential_cases
      SET case_status = p_to_status,
          credentialing_status_id = COALESCE(v_mirror_status, credentialing_status_id),
          payer_pipeline_state = v_mirror_pipeline,
          updated_at = now()
      WHERE id = p_case_id
      RETURNING * INTO v_case;
  END IF;

  -- Append-only unified history row (human transitions run through here;
  -- 'system' rows come from the 120200 triggers + create_case_with_tasks).
  INSERT INTO public.case_status_history (
    org_id, case_id, from_status, to_status, actor_kind, reason_code_id,
    evidence_touch_id, is_correction, note, changed_by
  ) VALUES (
    v_org, p_case_id, v_from, p_to_status, 'user', p_reason_code_id,
    p_evidence_touch_id, p_is_correction, v_note, v_user
  );

  -- In-RPC audit row, same transaction — rolls back with a failed transition.
  SELECT COALESCE(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_user;
  INSERT INTO public.audit_log (
    org_id, user_id, user_name, action_type, entity_type, entity_id,
    before, after, description
  ) VALUES (
    v_org, v_user, v_user_name, 'STATUS_CHANGE', 'credential_case', p_case_id,
    jsonb_build_object('caseStatus', v_from),
    jsonb_build_object(
      'caseStatus', p_to_status,
      'isCorrection', p_is_correction,
      'reasonCodeId', p_reason_code_id,
      'evidenceTouchId', p_evidence_touch_id
    ),
    CASE WHEN p_is_correction THEN 'Case status corrected' ELSE 'Case status changed' END
  );

  RETURN to_jsonb(v_case);
END;
$$;

REVOKE ALL ON FUNCTION public.set_case_status(
  uuid, text, text, uuid, text, boolean, date, text, text, date, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_case_status(
  uuid, text, text, uuid, text, boolean, date, text, text, date, uuid
) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_case_status(
  uuid, text, text, uuid, text, boolean, date, text, text, date, uuid
) TO authenticated;
