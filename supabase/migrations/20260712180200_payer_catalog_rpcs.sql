-- E1.6 — the two catalog RPCs.
--
-- list_global_payers (TE-4): the directory read. Global rows (org_id IS NULL)
-- are visible to an ORG only via org_payer_assignments under the P2 RLS
-- disjunction, which E1.6 must not touch (TE-1). The directory is a cross-org
-- browse surface for ANY authenticated member, so it reads through this
-- SECURITY DEFINER function instead of widening the table policy. Payer rows
-- carry no PHI; org-scoped payer rows are never returned.
--
-- review_payer_catalog_change (F1.6.3): accept/reject a sync diff. Accepting
-- applies the new value to the global payer row — identity fields ONLY
-- (name/aliases/states/cms_hios_id/status; never payer_slug — it is the
-- match key — and never Minted-curated credentialing fields, TE-5);
-- rejecting records the decision. Both stamp reviewed_by/reviewed_at. The diff facts
-- themselves are never mutated.

CREATE OR REPLACE FUNCTION public.list_global_payers()
RETURNS SETOF public.payers
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.*
  FROM public.payers p
  WHERE p.org_id IS NULL
    AND auth.uid() IS NOT NULL
  ORDER BY p.name;
$$;

REVOKE ALL ON FUNCTION public.list_global_payers() FROM public;
REVOKE ALL ON FUNCTION public.list_global_payers() FROM anon;
GRANT EXECUTE ON FUNCTION public.list_global_payers() TO authenticated;

CREATE OR REPLACE FUNCTION public.review_payer_catalog_change(p_change_id uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_change public.payer_catalog_changes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  -- Reviewer = any authenticated member (the shared-queue posture, like the
  -- inbound_leads triage; catalog curation UI itself is admin-gated client-side).
  IF NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_change
  FROM public.payer_catalog_changes
  WHERE id = p_change_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change not found';
  END IF;
  IF v_change.review_state <> 'unreviewed' THEN
    RAISE EXCEPTION 'Change already reviewed';
  END IF;

  IF p_accept THEN
    -- Identity-field whitelist. Array fields ride old/new_value as
    -- pipe-joined text (the dataset's own list encoding).
    IF v_change.field = 'name' THEN
      UPDATE public.payers SET name = v_change.new_value, last_synced_at = now()
      WHERE id = v_change.payer_id AND org_id IS NULL;
    ELSIF v_change.field = 'aliases' THEN
      UPDATE public.payers
      SET aliases = CASE WHEN v_change.new_value IS NULL OR v_change.new_value = ''
                         THEN NULL ELSE string_to_array(v_change.new_value, '|') END,
          last_synced_at = now()
      WHERE id = v_change.payer_id AND org_id IS NULL;
    ELSIF v_change.field = 'states' THEN
      UPDATE public.payers
      SET states = CASE WHEN v_change.new_value IS NULL OR v_change.new_value = ''
                        THEN NULL ELSE string_to_array(v_change.new_value, '|') END,
          last_synced_at = now()
      WHERE id = v_change.payer_id AND org_id IS NULL;
    ELSIF v_change.field = 'cms_hios_id' THEN
      UPDATE public.payers SET cms_hios_id = NULLIF(v_change.new_value, ''), last_synced_at = now()
      WHERE id = v_change.payer_id AND org_id IS NULL;
    ELSIF v_change.field = 'status' THEN
      UPDATE public.payers SET status = v_change.new_value, last_synced_at = now()
      WHERE id = v_change.payer_id AND org_id IS NULL;
    ELSE
      RAISE EXCEPTION 'Field % is not reviewable', v_change.field;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Catalog payer not found';
    END IF;
  END IF;

  UPDATE public.payer_catalog_changes
  SET review_state = CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = p_change_id;
END;
$$;

REVOKE ALL ON FUNCTION public.review_payer_catalog_change(uuid, boolean) FROM public;
REVOKE ALL ON FUNCTION public.review_payer_catalog_change(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.review_payer_catalog_change(uuid, boolean) TO authenticated;
