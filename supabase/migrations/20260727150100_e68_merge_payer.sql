-- E6.8 F6.8.2 — merge_payer: repair a duplicate payer in-app.
--
-- Duplicates are the known failure mode of manual payer creation (the E6.7
-- name/alias guards reduce but cannot eliminate them). The design puts Merge
-- on Payer Detail → Manage: pick the survivor; templates, network targets,
-- enrollment facts, open cases, and org subscriptions follow; the loser's
-- name becomes an alias on the survivor; the loser reads status 'merged' with
-- merged_into_id set (the existing E1.6/E6.7 merged-successor seam — the
-- near-match helpers and the duplicate guard already name a merged row's
-- successor). ONE transaction — any RAISE rolls all of it back.
--
-- What moves (exactly the epic's table trace — payer_contacts, contracts, and
-- case_generation_exclusions deliberately stay on the loser as history):
--   * sop_templates.payer_id            — all rows (a collision under the
--     active-org-match partial unique raises payer_merge_template_conflict)
--   * payer_network_targets.payer_id    — non-colliding rows move; where the
--     survivor already covers a (group, state) the survivor row wins (it is
--     restored to active if the loser's was active, and inherits the loser's
--     group PIN where it has none) and the loser's duplicate is ARCHIVED in
--     place (the (group, payer, state) unique covers archived rows, so the
--     duplicate cannot move; archiving keeps the no-DELETE targets rule)
--   * enrollment_facts.payer_id         — everything moves; where BOTH sides
--     hold a LIVE fact at the same (provider, group, state) the loser's is
--     first EXPIRED (the standard flip, never a delete) and the survivor's
--     inherits the loser's provider PIN where it has none
--   * credential_cases.payer_id         — OPEN (non-terminal) cases only;
--     closed cases stay on the loser as history (its name still resolves —
--     the merged row is retained). A collision on the 4-part case key raises
--     payer_merge_case_conflict listing the conflicting case numbers and
--     commits NOTHING.
--   * org_payer_assignments             — re-pointed; where an org holds
--     both, the two subscriptions FOLD into the survivor's row (active wins)
--     and the loser's row is deleted (dedupe — an operational join row, not
--     a ledger; targets moved above keep their RLS WITH CHECK because the
--     survivor assignment exists).
--
-- Payers are global, so the merge is a global consequence: the definer
-- re-points EVERY org's rows (an open case in another org would otherwise be
-- orphaned on a merged payer). The audit row lands in the CALLER's org
-- (audit_log.org_id is NOT NULL; the PM's two-trusted-users posture).
--
-- Named errors the frontend seam maps:
--   payer_merge_self                — loser = survivor
--   payer_merge_loser_merged        — the loser was already merged
--   payer_merge_survivor_not_active — survivor is merged/retired
--   payer_merge_survivor_archived   — survivor is archived (reactivate first)
--   payer_merge_case_conflict: …    — colliding open cases, listed as C-<n>
--   payer_merge_template_conflict   — active-SOP grain collision
--   'Payer not found' / 'Not authorized'

CREATE OR REPLACE FUNCTION public.merge_payer(
  p_org_id uuid,
  p_loser_id uuid,
  p_survivor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_name text;
  v_loser public.payers%ROWTYPE;
  v_survivor public.payers%ROWTYPE;
  v_survivor_after public.payers%ROWTYPE;
  v_conflicts text;
  v_conflict_count int;
  v_templates int := 0;
  v_targets int := 0;
  v_dup_targets int := 0;
  v_facts int := 0;
  v_dup_facts int := 0;
  v_cases int := 0;
  v_assignments int := 0;
  v_dup_assignments int := 0;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_org_id IS NULL
     OR NOT (p_org_id IN (SELECT user_org_ids()))
     OR user_role(p_org_id) NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_loser_id = p_survivor_id THEN
    RAISE EXCEPTION 'payer_merge_self';
  END IF;

  -- Lock both rows in a deterministic order (by id) so two concurrent merges
  -- can never deadlock; then validate each side.
  PERFORM 1 FROM public.payers
   WHERE id IN (p_loser_id, p_survivor_id)
   ORDER BY id
   FOR UPDATE;

  SELECT * INTO v_loser FROM public.payers
   WHERE id = p_loser_id AND (org_id IS NULL OR org_id = p_org_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payer not found';
  END IF;
  SELECT * INTO v_survivor FROM public.payers
   WHERE id = p_survivor_id AND (org_id IS NULL OR org_id = p_org_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payer not found';
  END IF;

  IF v_loser.status = 'merged' THEN
    RAISE EXCEPTION 'payer_merge_loser_merged';
  END IF;
  IF coalesce(v_survivor.status, 'active') <> 'active' THEN
    RAISE EXCEPTION 'payer_merge_survivor_not_active';
  END IF;
  IF v_survivor.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'payer_merge_survivor_archived';
  END IF;

  -- The 4-part case-key collision pre-check (F6.8.2 acceptance): an OPEN
  -- loser case whose (provider, group, survivor, state) key is already taken
  -- (by ANY survivor case, open or closed — the unique spans all rows,
  -- NULLS NOT DISTINCT) makes the merge impossible; name the cases so the
  -- future dialog can send the user to resolve them first. First 20 listed.
  SELECT count(*),
         string_agg('C-' || sub.case_number, ', ' ORDER BY sub.case_number)
         FILTER (WHERE sub.rn <= 20)
    INTO v_conflict_count, v_conflicts
    FROM (
      SELECT c.case_number, row_number() OVER (ORDER BY c.case_number) AS rn
        FROM public.credential_cases c
       WHERE c.payer_id = p_loser_id
         AND c.case_status NOT IN ('approved', 'denied', 'not_pursuing')
         AND EXISTS (
           SELECT 1 FROM public.credential_cases s
            WHERE s.payer_id = p_survivor_id
              AND s.provider_id = c.provider_id
              AND s.group_id IS NOT DISTINCT FROM c.group_id
              AND s.state = c.state
         )
    ) sub;
  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'payer_merge_case_conflict: % open case(s) collide with the survivor — %',
      v_conflict_count, v_conflicts;
  END IF;

  -- Templates follow. Collisions are surfaced honestly on BOTH tiers,
  -- nothing partial commits:
  --   * org tier — the E4.2 partial unique (one ACTIVE org SOP per
  --     (org, payer, state, group) grain) raises 23505 on the UPDATE;
  --   * GLOBAL tier — that grain (one ACTIVE global SOP per (payer, state,
  --     group), NULLS NOT DISTINCT) has NO DB index: author_global_sop
  --     enforces it in-body (`global_sop_duplicate_match`), which a direct
  --     UPDATE bypasses. Pre-check it here with the same match, or the merge
  --     would silently mint two active global SOPs at one grain (pickTemplate
  --     tiebreaks one dead with no signal; later match-key edits jam on the
  --     occupied grain).
  IF EXISTS (
    SELECT 1
      FROM public.sop_templates l
      JOIN public.sop_templates s
        ON s.org_id IS NULL
       AND s.archived = false
       AND s.payer_id = p_survivor_id
       AND s.state IS NOT DISTINCT FROM l.state
       AND s.group_id IS NOT DISTINCT FROM l.group_id
     WHERE l.org_id IS NULL
       AND l.archived = false
       AND l.payer_id = p_loser_id
  ) THEN
    RAISE EXCEPTION 'payer_merge_template_conflict';
  END IF;
  BEGIN
    UPDATE public.sop_templates
       SET payer_id = p_survivor_id
     WHERE payer_id = p_loser_id;
    GET DIAGNOSTICS v_templates = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'payer_merge_template_conflict';
  END;

  -- Network targets. Survivor-side fold first (restore + inherit the group
  -- PIN), then archive the loser's duplicates in place, then move the rest.
  UPDATE public.payer_network_targets s
     SET status = CASE WHEN l.status = 'active' THEN 'active' ELSE s.status END,
         payer_issued_id = coalesce(s.payer_issued_id, l.payer_issued_id)
    FROM public.payer_network_targets l
   WHERE l.payer_id = p_loser_id
     AND s.payer_id = p_survivor_id
     AND s.group_id = l.group_id
     AND s.state = l.state;

  UPDATE public.payer_network_targets l
     SET status = 'archived'
   WHERE l.payer_id = p_loser_id
     AND l.status = 'active'
     AND EXISTS (
       SELECT 1 FROM public.payer_network_targets s
        WHERE s.payer_id = p_survivor_id
          AND s.group_id = l.group_id
          AND s.state = l.state
     );
  GET DIAGNOSTICS v_dup_targets = ROW_COUNT;

  UPDATE public.payer_network_targets l
     SET payer_id = p_survivor_id
   WHERE l.payer_id = p_loser_id
     AND NOT EXISTS (
       SELECT 1 FROM public.payer_network_targets s
        WHERE s.payer_id = p_survivor_id
          AND s.group_id = l.group_id
          AND s.state = l.state
     );
  GET DIAGNOSTICS v_targets = ROW_COUNT;

  -- Enrollment facts. Where both sides hold a LIVE fact at the same key the
  -- survivor's wins (inheriting the loser's provider PIN where it has none)
  -- and the loser's is expired — the standard flip, never a delete. Then
  -- everything (live non-colliding + all history) moves.
  UPDATE public.enrollment_facts s
     SET payer_issued_id = coalesce(s.payer_issued_id, l.payer_issued_id)
    FROM public.enrollment_facts l
   WHERE l.payer_id = p_loser_id AND l.expired_at IS NULL
     AND s.payer_id = p_survivor_id AND s.expired_at IS NULL
     AND s.provider_id = l.provider_id
     AND s.group_id = l.group_id
     AND s.state = l.state;

  UPDATE public.enrollment_facts l
     SET expired_at = now(), expired_by = v_uid
   WHERE l.payer_id = p_loser_id AND l.expired_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.enrollment_facts s
        WHERE s.payer_id = p_survivor_id AND s.expired_at IS NULL
          AND s.provider_id = l.provider_id
          AND s.group_id = l.group_id
          AND s.state = l.state
     );
  GET DIAGNOSTICS v_dup_facts = ROW_COUNT;

  UPDATE public.enrollment_facts
     SET payer_id = p_survivor_id
   WHERE payer_id = p_loser_id;
  GET DIAGNOSTICS v_facts = ROW_COUNT;

  -- Open cases re-point (pre-checked above; the DB unique stays the backstop
  -- against a concurrent insert — a race aborts the whole merge).
  BEGIN
    UPDATE public.credential_cases
       SET payer_id = p_survivor_id,
           updated_at = now()
     WHERE payer_id = p_loser_id
       AND case_status NOT IN ('approved', 'denied', 'not_pursuing');
    GET DIAGNOSTICS v_cases = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'payer_merge_case_conflict: a conflicting case was created concurrently — retry';
  END;

  -- Org subscriptions: fold where an org holds both (active wins), delete the
  -- loser's now-redundant row (dedupe), move the rest.
  UPDATE public.org_payer_assignments s
     SET status = CASE WHEN l.status = 'active' THEN 'active' ELSE s.status END,
         archived_at = CASE WHEN l.status = 'active' THEN NULL ELSE s.archived_at END
    FROM public.org_payer_assignments l
   WHERE l.payer_id = p_loser_id
     AND s.payer_id = p_survivor_id
     AND s.org_id = l.org_id;

  DELETE FROM public.org_payer_assignments l
   WHERE l.payer_id = p_loser_id
     AND EXISTS (
       SELECT 1 FROM public.org_payer_assignments s
        WHERE s.org_id = l.org_id AND s.payer_id = p_survivor_id
     );
  GET DIAGNOSTICS v_dup_assignments = ROW_COUNT;

  UPDATE public.org_payer_assignments
     SET payer_id = p_survivor_id
   WHERE payer_id = p_loser_id;
  GET DIAGNOSTICS v_assignments = ROW_COUNT;

  -- The loser's name becomes an alias on the survivor (skipped when the
  -- survivor already carries it as its name or an alias, by normalized key).
  UPDATE public.payers
     SET aliases = CASE
           WHEN public._payer_norm_name(name) = public._payer_norm_name(v_loser.name)
             OR EXISTS (
               SELECT 1 FROM unnest(coalesce(aliases, '{}'::text[])) a
                WHERE public._payer_norm_name(a) = public._payer_norm_name(v_loser.name)
             )
           THEN aliases
           ELSE coalesce(aliases, '{}'::text[]) || v_loser.name
         END,
         updated_at = now()
   WHERE id = p_survivor_id
   RETURNING * INTO v_survivor_after;

  -- Mark the loser merged. Flipping status also drops it out of the
  -- normalized-name partial unique (WHERE status <> 'merged'), so the
  -- survivor's new alias never collides at the index.
  UPDATE public.payers
     SET status = 'merged',
         merged_into_id = p_survivor_id,
         updated_at = now()
   WHERE id = p_loser_id;

  SELECT coalesce(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id, before, after, description)
  VALUES
    (p_org_id, v_uid, v_user_name, 'UPDATE', 'payer', p_loser_id,
     jsonb_build_object(
       'loser', jsonb_build_object('id', v_loser.id, 'name', v_loser.name, 'status', v_loser.status),
       'survivor', jsonb_build_object('id', v_survivor.id, 'name', v_survivor.name, 'aliases', v_survivor.aliases)),
     jsonb_build_object(
       'loser', jsonb_build_object('id', v_loser.id, 'status', 'merged', 'mergedIntoId', p_survivor_id),
       'survivor', jsonb_build_object('id', v_survivor_after.id, 'aliases', v_survivor_after.aliases),
       'movedTemplates', v_templates,
       'movedTargets', v_targets,
       'archivedDuplicateTargets', v_dup_targets,
       'movedFacts', v_facts,
       'expiredDuplicateFacts', v_dup_facts,
       'movedOpenCases', v_cases,
       'movedAssignments', v_assignments,
       'dedupedAssignments', v_dup_assignments),
     'Merged payer "' || v_loser.name || '" into "' || v_survivor.name || '"');

  RETURN jsonb_build_object(
    'survivor', to_jsonb(v_survivor_after),
    'movedTemplates', v_templates,
    'movedTargets', v_targets,
    'archivedDuplicateTargets', v_dup_targets,
    'movedFacts', v_facts,
    'expiredDuplicateFacts', v_dup_facts,
    'movedOpenCases', v_cases,
    'movedAssignments', v_assignments,
    'dedupedAssignments', v_dup_assignments);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_payer(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_payer(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.merge_payer(uuid, uuid, uuid) TO authenticated, service_role;
