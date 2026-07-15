-- E4.2 hardening (canonical payer selection & org assignment): make an org's
-- catalog subscription REVERSIBLE and HISTORY-SAFE. Adding a canonical payer is
-- now a first-class org-admin action, and removal must ARCHIVE (never DELETE)
-- so the deny-then-reapply cycle keeps its history, exactly like
-- payer_network_targets (E1.5 TE-5).
--
-- Additive + inert: `status` defaults to 'active' and there are ZERO rows today
-- (verified on hosted), so every future row and any pre-existing one stays
-- active. `archived_at` is nullable. No existing reader changes meaning — the
-- assignment "exists" test the payers/payer_network_targets RLS relies on is
-- unchanged (archive is a status flip, the row stays).

ALTER TABLE public.org_payer_assignments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- The hot read is "active subscriptions for this org" (the curated shortlist).
CREATE INDEX IF NOT EXISTS idx_org_payer_assignments_org_active
  ON public.org_payer_assignments (org_id)
  WHERE status = 'active';

-- Atomic archive (F: "archive the org payer AND its active payer_network_targets
-- in one transaction"). Two PostgREST UPDATEs are NOT atomic, so the cascade
-- lives in one function body = one transaction.
--
-- SECURITY INVOKER: the caller's RLS is the wall. Both org_payer_assignments and
-- payer_network_targets carry admin-only UPDATE policies, so a non-admin's inner
-- UPDATEs would match zero rows; the explicit user_role guard turns that silent
-- no-op into a clear error. The assignment ROW is preserved (status flip only),
-- so the payer_network_targets UPDATE WITH CHECK — which requires an
-- org_payer_assignments row to EXIST for (org, payer) — still passes, and a later
-- reactivation keeps the full target history for the existing restore/review flow.
CREATE OR REPLACE FUNCTION public.archive_org_payer_assignment(
  p_org_id uuid,
  p_payer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.org_payer_assignments;
  v_archived_targets integer;
BEGIN
  IF public.user_role(p_org_id) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'org_payer_assignment_admin_only';
  END IF;

  UPDATE public.org_payer_assignments
     SET status = 'archived', archived_at = now()
   WHERE org_id = p_org_id AND payer_id = p_payer_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_payer_assignment_not_found';
  END IF;

  WITH archived AS (
    UPDATE public.payer_network_targets
       SET status = 'archived'
     WHERE org_id = p_org_id
       AND payer_id = p_payer_id
       AND status = 'active'
    RETURNING 1
  )
  SELECT count(*) INTO v_archived_targets FROM archived;

  RETURN jsonb_build_object(
    'assignment', to_jsonb(v_row),
    'archived_target_count', v_archived_targets
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.archive_org_payer_assignment(uuid, uuid) TO authenticated;
