-- Multi-state SOP templates — a template targets a SET of states, not one.
--
-- Before: `sop_templates.state` is a single text column, so an SOP that applies
-- in NC, SC and VA had to be authored three times (or widened to 'All', which
-- also drags in the other 47). Authors asked for the obvious middle ground.
--
-- Shape: additive `states text[]`, mirroring `payers.states` — the identical
-- concept already in this schema, which also lets the authoring UI reuse the
-- shipped states multi-select. The SCHEMA.md grain rule nominally points at a
-- child table, but that rule governs facts that VARY BY state (a per-state fee);
-- here the state set IS the match key, which is exactly what `payers.states`
-- models.
--
-- 'All' STAYS A SENTINEL, deliberately, and never mixes with specific codes.
-- pickTemplate ranks All-states BELOW an exact-state match (tiers 5-8 vs 1-4).
-- If "all states" were stored as a literal 50-entry list it would rank as an
-- exact-state match and silently start beating genuinely state-targeted
-- templates — a resolution regression with no error to notice.
--
-- `state` (scalar) is KEPT as a FROZEN MIRROR (additive rule, the
-- `providers.group_id` precedent): every write mirrors states[1] so any reader
-- not yet migrated keeps returning a sensible row instead of NULL. No new
-- readers — resolution reads `states`.
--
-- Uniqueness: `uq_sop_templates_active_org_match (org_id, payer_id, state,
-- group_id)` MUST GO. With the mirror, templates {NC,SC} and {NC,VA} both
-- mirror state='NC' and would collide though they are legitimately different.
-- The replacement invariant is OVERLAP: no two ACTIVE templates for the same
-- (org, payer, group) may share a state.
--
-- Why a trigger and not an exclusion constraint: `EXCLUDE USING gist (... states
-- WITH &&)` needs a gist opclass for text[], which btree_gist does not provide
-- (array overlap is GIN, and GIN cannot back an exclusion constraint). Verified
-- on Postgres 16, not assumed. The trigger takes a transaction-scoped advisory
-- lock on (org, payer, group) so two concurrent authors cannot both pass the
-- check — proven with two live sessions: the second blocked until the first
-- committed, then correctly failed, leaving exactly one row.
--
-- The trigger also covers GLOBAL rows (org_id NULL), which the dropped index
-- never did — they previously relied solely on author_global_sop's in-body
-- check. That is a strict improvement.

-- ---------------------------------------------------------------------------
-- 1. The column + its shape rules.
-- ---------------------------------------------------------------------------
ALTER TABLE public.sop_templates
  ADD COLUMN IF NOT EXISTS states text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sop_templates_states_shape_check'
  ) THEN
    ALTER TABLE public.sop_templates
      ADD CONSTRAINT sop_templates_states_shape_check CHECK (
        states IS NULL
        OR (
          -- Non-empty, no NULL members.
          array_length(states, 1) >= 1
          AND array_position(states, NULL::text) IS NULL
          AND (
            -- Either the lone 'All' sentinel...
            states = ARRAY['All']::text[]
            -- ...or two-letter codes only. A CHECK cannot contain a subquery,
            -- so the per-element test is expressed on the joined string. This
            -- also rejects a mix with 'All' for free: 'All' is three chars and
            -- lowercase, so it can never satisfy [A-Z]{2}.
            OR array_to_string(states, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'
          )
        )
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Backfill from the scalar. A NULL state (the seeded payerless generic
--    fallback) stays NULL — it matches every request by shape, not by state.
-- ---------------------------------------------------------------------------
UPDATE public.sop_templates
   SET states = ARRAY[state]
 WHERE states IS NULL
   AND state IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Swap the uniqueness mechanism.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.uq_sop_templates_active_org_match;

-- Membership lookups (`WHERE states && ARRAY['NC']`) for the guard + reads.
CREATE INDEX IF NOT EXISTS idx_sop_templates_states
  ON public.sop_templates USING gin (states);

CREATE OR REPLACE FUNCTION public.sop_template_assert_no_state_overlap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_clash text;
BEGIN
  -- Only ACTIVE, payer-keyed, state-carrying rows are constrained. The generic
  -- fallback (payerless) and legacy state-less rows sit outside the grain, as
  -- they did under the dropped index.
  IF NEW.archived OR NEW.payer_id IS NULL OR NEW.states IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent authors at this exact grain so two racing writes
  -- cannot both observe "no overlap" and both commit.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      coalesce(NEW.org_id::text, '-') || ':' ||
      NEW.payer_id::text || ':' ||
      coalesce(NEW.group_id::text, '-'),
      0
    )
  );

  SELECT string_agg(DISTINCT s, ', ' ORDER BY s) INTO v_clash
    FROM public.sop_templates o
    CROSS JOIN LATERAL unnest(o.states) AS s
   WHERE o.org_id IS NOT DISTINCT FROM NEW.org_id
     AND o.payer_id = NEW.payer_id
     AND o.group_id IS NOT DISTINCT FROM NEW.group_id
     AND o.archived = false
     AND o.id IS DISTINCT FROM NEW.id
     AND s = ANY (NEW.states);

  IF v_clash IS NOT NULL THEN
    -- Named error: the service maps this prefix to an author-facing message.
    RAISE EXCEPTION 'sop_template_state_overlap: %', v_clash;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sop_template_state_overlap ON public.sop_templates;
CREATE TRIGGER trg_sop_template_state_overlap
  BEFORE INSERT OR UPDATE ON public.sop_templates
  FOR EACH ROW EXECUTE FUNCTION public.sop_template_assert_no_state_overlap();

-- ---------------------------------------------------------------------------
-- 4. author_global_sop — p_state text becomes p_states text[].
--    DROP + CREATE, not a defaulted arg: PostgREST cannot disambiguate
--    overloads whose named-argument sets nest (the E4.2 publish-RPC / E6.8
--    set_case_status precedent). The in-body duplicate check becomes an OVERLAP
--    check so the caller still gets the friendly named error; the trigger above
--    is the race-proof backstop underneath it.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.author_global_sop(uuid, text, uuid, text, uuid, jsonb, boolean, jsonb);

CREATE FUNCTION public.author_global_sop(
  p_id uuid,
  p_name text,
  p_payer_id uuid,
  p_states text[],
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
  v_states text[] := p_states;
  v_mirror text := p_states[1];
  v_clash text;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_id = '00000000-0000-4000-a000-00000000e17b'::uuid THEN
    RAISE EXCEPTION 'fallback_sop_locked';
  END IF;

  -- Active global SOPs require a complete payer + at-least-one-state match key
  -- (group stays optional = the "any group" tier). Archived rows are exempt,
  -- mirroring assertActiveOrgMatchKeyComplete.
  IF NOT v_archived
     AND (p_payer_id IS NULL OR v_states IS NULL OR array_length(v_states, 1) IS NULL) THEN
    RAISE EXCEPTION 'global_sop_match_key_incomplete';
  END IF;

  -- No ACTIVE global row for the same (payer, group) may share a state.
  IF NOT v_archived THEN
    SELECT string_agg(DISTINCT s, ', ' ORDER BY s) INTO v_clash
      FROM public.sop_templates t
      CROSS JOIN LATERAL unnest(t.states) AS s
     WHERE t.org_id IS NULL
       AND t.archived = false
       AND t.id IS DISTINCT FROM p_id
       AND t.payer_id IS NOT DISTINCT FROM p_payer_id
       AND t.group_id IS NOT DISTINCT FROM p_group_id
       AND s = ANY (v_states);
    IF v_clash IS NOT NULL THEN
      RAISE EXCEPTION 'global_sop_duplicate_match: %', v_clash;
    END IF;
  END IF;

  IF p_id IS NULL THEN
    IF p_name IS NULL OR btrim(p_name) = '' THEN
      RAISE EXCEPTION 'Template name is required';
    END IF;
    INSERT INTO public.sop_templates
      (org_id, name, payer_id, state, states, group_id, task_definitions,
       archived, required_profile_attributes)
    VALUES
      (NULL, btrim(p_name), p_payer_id, v_mirror, v_states, p_group_id, v_defs,
       v_archived, v_attrs)
    RETURNING * INTO v_row;
  ELSE
    -- UPDATE changes match key + archived ONLY; content/name/attributes go
    -- through publish_sop_template_version (the TE-5 save split), never here.
    UPDATE public.sop_templates
       SET payer_id = p_payer_id,
           state = v_mirror,
           states = v_states,
           group_id = p_group_id,
           archived = v_archived
     WHERE id = p_id AND org_id IS NULL
     RETURNING * INTO v_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Template not found';
    END IF;
  END IF;

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.author_global_sop(uuid, text, uuid, text[], uuid, jsonb, boolean, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.author_global_sop(uuid, text, uuid, text[], uuid, jsonb, boolean, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.author_global_sop(uuid, text, uuid, text[], uuid, jsonb, boolean, jsonb) TO authenticated, service_role;
