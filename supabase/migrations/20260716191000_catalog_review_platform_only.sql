-- E4.2 payer governance — catalog review is PLATFORM tooling, not an org-user
-- capability.
--
-- E1.6 gated payer_catalog_changes reads and the review_payer_catalog_change
-- RPC to "any authenticated member" (the inbound_leads shared-queue posture).
-- That was wrong for the catalog: the global payer catalog is Minted-managed
-- (E1.6 personas: "Catalog curation is platform-level work by the Minted team
-- via service-role tooling — not an org-user capability"), and a member of ANY
-- organization could accept an identity change that rewrites a global payer row
-- shared by every org. This migration removes org-user access entirely and
-- keeps the platform (service-role / direct-SQL) path.
--
-- ORDERING NOTE (operator): this file is timestamped AFTER
-- 20260716180000_payer_dead_column_drop.sql, whose reissue of
-- review_payer_catalog_change re-grants EXECUTE to authenticated. That drop
-- migration is operator-gated on hosted (pg_dump snapshot first). If it is
-- applied to hosted AFTER this migration, RE-APPLY this migration afterward —
-- it is idempotent, and skipping the re-apply would re-open authenticated
-- EXECUTE on the review RPC. A fresh repo rebuild applies files in timestamp
-- order and ends in the correct (revoked) state automatically.

-- 1. payer_catalog_changes: drop the org-user read path. The diff queue is a
--    platform review surface; org users no longer need it (the in-app review
--    panel is removed in the same PR). service_role retains full access via its
--    explicit grants + BYPASSRLS. The append-only posture (no authenticated
--    writes, ever) is unchanged.
--    REVOKE ALL, not just SELECT: the hosted project's default privileges had
--    left authenticated a dormant INSERT/UPDATE/DELETE grant floor from table
--    creation (RLS's zero write policies blocked it in practice, but E1.6's
--    stated grant floor was never real on hosted). This closes it for good.
drop policy if exists payer_catalog_changes_select on public.payer_catalog_changes;
revoke all on public.payer_catalog_changes from authenticated;
revoke all on public.payer_catalog_changes from anon;

-- 2. review_payer_catalog_change: reissue as platform-only.
--    The E1.6 body REQUIRED an authenticated member (auth.uid() + memberships
--    check), which meant service-role callers (no JWT sub → auth.uid() IS NULL)
--    could never call it — the grant revoke alone would have left the RPC with
--    no working caller at all. The reissued body inverts the posture: any
--    caller bearing an org-user JWT (role 'authenticated' or 'anon') is
--    rejected regardless of grants — defense in depth against a later replay of
--    the 20260716180000 reissue re-granting EXECUTE — while service-role
--    PostgREST calls and direct-SQL platform tooling (Supabase MCP / psql)
--    proceed. reviewed_by is stamped from auth.uid() and is NULL for platform
--    callers (the column is nullable; the diff row itself remains the trail).
--    The accept whitelist matches the 20260716180000 shape (identity fields
--    only, no cms_hios_id branch) so this body works before AND after the
--    operator applies the column drop.
CREATE OR REPLACE FUNCTION public.review_payer_catalog_change(p_change_id uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_change public.payer_catalog_changes%ROWTYPE;
BEGIN
  -- Platform-only: reject any org-user JWT outright. Service-role requests
  -- carry role 'service_role'; direct-SQL sessions carry no JWT claims.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'catalog_review_platform_only';
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
REVOKE ALL ON FUNCTION public.review_payer_catalog_change(uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.review_payer_catalog_change(uuid, boolean) TO service_role;
