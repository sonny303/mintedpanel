-- 3M payer-setup cleanup, Slice 2 — delete the dead precanned payer catalog.
--
-- WHY
-- The E1.6 catalog sync seeded 270 canonical payer identities from
-- docs/redesign/data/payer-catalog/payers.csv. E6.7 PR 2 retired that pipeline
-- outright (the script is deleted, the dataset frozen) and payers are manual-
-- only now. What the retirement did not do is remove the rows: 270 payers are
-- live, 8 are referenced by anything at all, and 1 was actually created by a
-- human. The other 262 are inventory — they never became a case, a target, a
-- template or a portal, and nothing will ever write to them again.
--
-- They are not inert. Every payer picker in the app reads the global catalog,
-- so attaching a payer to a group means scrolling 262 rows nobody set up. That
-- is the Muda this deletes.
--
-- WHAT SURVIVES
-- A payer is kept when ANY of these is true:
--   * it is org-scoped (org_id is not null) — never a catalog row;
--   * it was created by a human (source = 'manual');
--   * it is referenced by ANY of the fifteen FK columns that point at payers;
--   * it is merged, or it is the survivor another payer merged into.
--
-- THE CASCADE TRAP (the reason this guard is exhaustive, not just "no cases")
-- Seven of the fifteen references are ON DELETE CASCADE:
--   case_generation_exclusions · case_generation_run_rows · enrollment_facts ·
--   org_payer_assignments · org_payer_settings · payer_contacts ·
--   payer_network_targets
-- so a delete that only checked the BLOCKING references (cases, contracts,
-- sop_templates, …) would not error — it would silently take immutable
-- generation-ledger rows and live enrollment facts with it. Every referencing
-- column is checked here, cascading ones included, precisely so this migration
-- can never destroy history it did not intend to touch.
--
-- SAFETY
-- Re-runnable (a second run finds nothing left to delete) and a no-op on a
-- fresh rebuild, where payers is empty. Reversible: the frozen source CSV is
-- still in the repo at docs/redesign/data/payer-catalog/payers.csv.
--
-- Slice 2 of docs/ops/ — 3M audit, 2026-08-10. Prototype-stage, synthetic data
-- (PM-confirmed).

DO $$
DECLARE
  v_before integer;
  v_deleted integer;
  v_after integer;
BEGIN
  SELECT count(*) INTO v_before FROM public.payers;

  WITH referenced AS (
    SELECT payer_id AS id FROM public.case_generation_exclusions
    UNION SELECT payer_id FROM public.case_generation_run_rows
    UNION SELECT payer_id FROM public.communication_event
    UNION SELECT payer_id FROM public.contracts
    UNION SELECT payer_id FROM public.credential_cases
    UNION SELECT payer_id FROM public.enrollment_facts
    UNION SELECT payer_id FROM public.mso_routing_rules
    UNION SELECT payer_id FROM public.org_payer_assignments
    UNION SELECT payer_id FROM public.org_payer_settings
    UNION SELECT payer_id FROM public.payer_catalog_changes
    UNION SELECT payer_id FROM public.payer_contacts
    UNION SELECT payer_id FROM public.payer_network_targets
    UNION SELECT payer_id FROM public.portals
    UNION SELECT payer_id FROM public.sop_templates
    -- The self-reference: never delete a payer some other row was merged into.
    UNION SELECT merged_into_id FROM public.payers
  )
  DELETE FROM public.payers p
  WHERE p.org_id IS NULL
    AND coalesce(p.source, '') <> 'manual'
    AND coalesce(p.status, '') <> 'merged'
    AND p.id NOT IN (SELECT id FROM referenced WHERE id IS NOT NULL);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  SELECT count(*) INTO v_after FROM public.payers;

  RAISE NOTICE 'purge_unreferenced_catalog_payers: % payers before, % deleted, % remaining',
    v_before, v_deleted, v_after;
END $$;
