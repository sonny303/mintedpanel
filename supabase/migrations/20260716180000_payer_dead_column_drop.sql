-- Pre-GA dead-column drop — payers + credential_cases.
--
-- Governance: authorized by the pre-GA destructive-DDL window added to
-- AGENTS.md in THIS SAME PR (Database rules → "Schema change policy (pre-GA
-- window)"). We are pre-GA; no customer production database exists yet.
--   (1) PM approval: 2026-07-16 decisions D1/D2 (payer catalog identity is
--       payer_slug; no clearinghouse/curated-billing capacity ships pre-GA).
--   (2) Evidence: docs/data-model/payer-field-usage-audit.md — every column
--       below is audit class 2 (written/displayed, no downstream consumer),
--       class 7 (unused/unverified), or class 8 (superseded).
--   (3) All code references are removed in the same PR.
-- Append-only ledgers (audit_log, *_history, touches) are untouched.
--
-- OPERATOR: DO NOT run this migration until you have taken a pg_dump snapshot
-- of hosted project fkvuhfsqcmujywzgczmc, AND run the inventory queries below
-- against that project and pasted their output into the PR's "inventory
-- results" section. If any column shows non-null data BEYOND the near-zero
-- counts the audit recorded, STOP and flag it in the PR — do not drop.
--
-- ============================================================================
-- Pre-drop data inventory (run each against hosted; paste results into the PR).
-- Expected non-null counts are the audit's demo/dev figures (illustrative of
-- shape, not customer reality) — re-verify against the live project.
-- ============================================================================
--
-- public.payers (287 rows at audit time: 269 global, 18 org-scoped)
--   select count(*) total, count(provisional_billing_allowed)   non_null, count(distinct provisional_billing_allowed)   distinct_vals from public.payers;  -- audit: 0 non-null
--   select count(*) total, count(provisional_billing_notes)     non_null, count(distinct provisional_billing_notes)     distinct_vals from public.payers;  -- audit: 0 non-null
--   select count(*) total, count(retro_billing_allowed)         non_null, count(distinct retro_billing_allowed)         distinct_vals from public.payers;  -- audit: 1 non-null
--   select count(*) total, count(retro_billing_window_days)     non_null, count(distinct retro_billing_window_days)     distinct_vals from public.payers;  -- audit: 1 non-null
--   select count(*) total, count(caqh_pull_deadline_days)       non_null, count(distinct caqh_pull_deadline_days)       distinct_vals from public.payers;  -- audit: 1 non-null
--   select count(*) total, count(provider_type_path)            non_null, count(distinct provider_type_path)            distinct_vals from public.payers;  -- audit: 8 non-null
--   select count(*) total, count(prior_auth_vendor)             non_null, count(distinct prior_auth_vendor)             distinct_vals from public.payers;  -- audit: 1 non-null
--   select count(*) total, count(payer_billing_id)              non_null, count(distinct payer_billing_id)              distinct_vals from public.payers;  -- audit: 2 non-null
--   select count(*) total, count(portal_url)                    non_null, count(distinct portal_url)                    distinct_vals from public.payers;  -- audit: 9 non-null (PAYERS ONLY; msos.portal_url is live)
--   select count(*) total, count(cms_hios_id)                   non_null, count(distinct cms_hios_id)                   distinct_vals from public.payers;  -- audit: 0 non-null
--   select count(*) total, count(prerequisite_payer_id)         non_null, count(distinct prerequisite_payer_id)         distinct_vals from public.payers;  -- audit: 0 non-null
--
-- public.credential_cases (65 rows at audit time)
--   select count(*) total, count(payer_provider_id)             non_null, count(distinct payer_provider_id)             distinct_vals from public.credential_cases;  -- audit: 0 non-null (superseded by the Type1/Type2 split, 20260715120500)
--
-- ============================================================================
-- Dependency handling (grep of every migration for each column name).
-- ============================================================================
--
-- review_payer_catalog_change (20260712180200): its accept-whitelist has a
-- `cms_hios_id` branch. Reissued below without it — cms_hios_id ceases to be a
-- reviewable field and falls through to the "not reviewable" error.
--
-- advance_payer_pipeline: NO CHANGE NEEDED. The 20260715120400 version wrote
-- credential_cases.payer_provider_id, but 20260715120500 (the Type1/Type2
-- split) already DROP FUNCTION'd that signature and reissued the RPC writing
-- payer_individual_provider_id / payer_group_provider_id instead. The current
-- function does not reference payer_provider_id, so the column drop is clean
-- and the RPC is left exactly as the split left it.
--
-- get_sop_field_tokens (baseline): builds the SOP token catalog dynamically
-- from information_schema.columns, so dropping these payers columns removes
-- their payer.* tokens automatically — no function change needed.
--
-- list_global_payers (20260712180200): RETURNS SETOF public.payers via
-- `SELECT p.*`, which tracks the table's live column set — no change needed.
--
-- No trigger, CHECK (other than payers_provider_type_path_check, dropped
-- below), RLS policy, or column-level GRANT references any dropped column.

-- ---------------------------------------------------------------------------
-- 1. Reissue review_payer_catalog_change without the cms_hios_id branch.
-- ---------------------------------------------------------------------------
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
    -- pipe-joined text (the dataset's own list encoding). The cms_hios_id
    -- branch was removed in the pre-GA cleanup (column dropped).
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
GRANT EXECUTE ON FUNCTION public.review_payer_catalog_change(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Drop the constraint/index that guard the dropped columns, then the
--    columns. DROP COLUMN would cascade to these, but we name them so the
--    destructive surface is explicit and auditable.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payers DROP CONSTRAINT IF EXISTS payers_provider_type_path_check;
ALTER TABLE public.payers DROP CONSTRAINT IF EXISTS payers_prerequisite_payer_id_fkey;
DROP INDEX IF EXISTS public.idx_payers_prerequisite_payer_id;

ALTER TABLE public.payers
  DROP COLUMN IF EXISTS provisional_billing_allowed,
  DROP COLUMN IF EXISTS provisional_billing_notes,
  DROP COLUMN IF EXISTS retro_billing_allowed,
  DROP COLUMN IF EXISTS retro_billing_window_days,
  DROP COLUMN IF EXISTS caqh_pull_deadline_days,
  DROP COLUMN IF EXISTS provider_type_path,
  DROP COLUMN IF EXISTS prior_auth_vendor,
  DROP COLUMN IF EXISTS payer_billing_id,
  DROP COLUMN IF EXISTS portal_url,
  DROP COLUMN IF EXISTS cms_hios_id,
  DROP COLUMN IF EXISTS prerequisite_payer_id;

-- credential_cases.payer_provider_id: dormant since the Type1/Type2 split
-- (20260715120500); 0 non-null in the audit. Verify 0 non-null (inventory
-- above) before applying.
ALTER TABLE public.credential_cases
  DROP COLUMN IF EXISTS payer_provider_id;
