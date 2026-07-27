-- E6.8 F6.8.1 — archive_payer / reactivate_payer: the payer list's honest,
-- reversible lifecycle.
--
-- With the precanned catalog browse retired (E6.7) the payer list IS the
-- org's network, so the design's "remove from network" collapsed into
-- Archive: the payer leaves the working list, nothing is deleted, no new
-- cases can be generated for it, and Reactivate brings it back with all its
-- history intact (payer-cases-ui-build-handoff.md §2.2; Show-archived toggle
-- = UI slice A).
--
-- Archive is deliberately NOT `status = 'retired'`: the E6.7 status domain
-- (`active|merged|retired`) is platform curation and stays untouched; archive
-- is a reversible org-workflow flag on an ACTIVE payer. The new column is a
-- plain additive nullable timestamptz — no CHECK interplay, and the E6.7
-- duplicate backstop (`uq_payers_global_normalized_name` WHERE status <>
-- 'merged') still covers archived rows, so an archived payer's name cannot be
-- re-registered while it can come back.
--
-- Posture (the create_payer/update_payer precedent, PM decisions carried
-- forward from E6.7 — no platform-role gating): SECURITY DEFINER, EXECUTE for
-- `authenticated` only, anon rejected in-body, writer-member of the caller
-- org, org-scoped audit append. Direct payers DML stays revoked (the
-- 20260718120000 lockdown stands) — these RPCs are the only archive door.
--
-- Named errors the frontend seam (src/services/payers.ts) maps:
--   payer_archive_open_cases: <n> — the payer still has open (non-terminal)
--                                   cases; nothing is written. The count is
--                                   parseable so the future dialog can say
--                                   how many.
--   payer_already_archived / payer_not_archived — state guards
--   payer_not_editable  — merged/retired rows are curation history
--   'Payer not found'   — invisible or nonexistent id
--   'Not authorized'    — anon / non-member / non-writer callers
--
-- Exclusion from attach eligibility, generation candidates, and the default
-- payer-list read is CLIENT-SIDE filtering on `archived_at IS NULL` (F6.8.1:
-- no RLS change — archived rows stay readable so closed cases keep resolving
-- their payer name and the Show-archived toggle can list them).

-- ---------------------------------------------------------------------------
-- 1. The additive flag.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payers
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. archive_payer — flag the row, blocked while open cases exist.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_payer(p_org_id uuid, p_payer_id uuid)
RETURNS public.payers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_name text;
  v_before public.payers%ROWTYPE;
  v_row public.payers%ROWTYPE;
  v_open_cases int;
BEGIN
  IF coalesce(auth.role(), '') = 'anon' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_org_id IS NULL
     OR NOT (p_org_id IN (SELECT user_org_ids()))
     OR user_role(p_org_id) NOT IN ('admin', 'specialist') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Same visibility rule as listPayers: a global-catalog row or (local seed
  -- fixtures only — hosted has zero org rows) an own-org row.
  SELECT * INTO v_before FROM public.payers
   WHERE id = p_payer_id AND (org_id IS NULL OR org_id = p_org_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payer not found';
  END IF;
  IF coalesce(v_before.status, 'active') <> 'active' THEN
    RAISE EXCEPTION 'payer_not_editable';
  END IF;
  IF v_before.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'payer_already_archived';
  END IF;

  -- The orphaning guard (F6.8.1 acceptance): a payer with open (non-terminal)
  -- cases cannot be archived — archiving would hide in-flight work. Payers
  -- are global, so the count spans EVERY org's cases (definer read): an open
  -- case anywhere would be orphaned. Open mirrors src/lib/caseStatus.ts
  -- OPEN_CASE_STATUSES (everything but the three terminals).
  SELECT count(*) INTO v_open_cases
    FROM public.credential_cases c
   WHERE c.payer_id = p_payer_id
     AND c.case_status NOT IN ('approved', 'denied', 'not_pursuing');
  IF v_open_cases > 0 THEN
    RAISE EXCEPTION 'payer_archive_open_cases: %', v_open_cases;
  END IF;

  UPDATE public.payers
     SET archived_at = now(),
         updated_at = now()
   WHERE id = p_payer_id
   RETURNING * INTO v_row;

  SELECT coalesce(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id, before, after, description)
  VALUES
    (p_org_id, v_uid, v_user_name, 'UPDATE', 'payer', v_row.id,
     jsonb_build_object('archivedAt', NULL),
     jsonb_build_object('archivedAt', v_row.archived_at),
     'Archived payer "' || v_row.name || '"');

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_payer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_payer(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.archive_payer(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. reactivate_payer — clear the flag; everything the archive hid returns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reactivate_payer(p_org_id uuid, p_payer_id uuid)
RETURNS public.payers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_name text;
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
   WHERE id = p_payer_id AND (org_id IS NULL OR org_id = p_org_id)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payer not found';
  END IF;
  IF coalesce(v_before.status, 'active') <> 'active' THEN
    RAISE EXCEPTION 'payer_not_editable';
  END IF;
  IF v_before.archived_at IS NULL THEN
    RAISE EXCEPTION 'payer_not_archived';
  END IF;

  UPDATE public.payers
     SET archived_at = NULL,
         updated_at = now()
   WHERE id = p_payer_id
   RETURNING * INTO v_row;

  SELECT coalesce(full_name, email) INTO v_user_name FROM public.profiles WHERE id = v_uid;
  INSERT INTO public.audit_log
    (org_id, user_id, user_name, action_type, entity_type, entity_id, before, after, description)
  VALUES
    (p_org_id, v_uid, v_user_name, 'UPDATE', 'payer', v_row.id,
     jsonb_build_object('archivedAt', v_before.archived_at),
     jsonb_build_object('archivedAt', NULL),
     'Reactivated payer "' || v_row.name || '"');

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.reactivate_payer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reactivate_payer(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reactivate_payer(uuid, uuid) TO authenticated, service_role;
