-- Group Contracts Matrix, organization view: a contract record is for ONE
-- specialty or for ALL of them (PM decision D11, Oct 29, 2026).
--
-- Clients hold two specialties under one TIN with the same payer and state
-- (say PT in-network, Nutrition still submitted). Until now the key was
-- (group_id, payer_id, state), so saving one specialty's status overwrote the
-- other's, and `specialty` was an optional free-text label on the one row.
--
-- 1. `contracts.specialty_key text NOT NULL DEFAULT 'all'`, CHECK-ed against
--    'all','pt','ot','slp','nutrition','chiro'. 'all' is one agreement that
--    covers every specialty of the group in that state; the matrix shows it in
--    each specialty's table, tagged "All", unless that specialty has its own
--    record. OT, SLP and chiropractic are allowed now so adding their tables
--    later needs no migration; v1 screens offer only PT and Nutrition (D15).
--    The app keeps the same set in `ContractSpecialtyKey` (src/types/index.ts)
--    and src/lib/contractSpecialty.ts.
--
-- 2. Backfill from the deprecated free-text `specialty` (D12). Only a label
--    that clearly names Physical therapy or Nutrition maps. EVERYTHING else --
--    NULL, blank, 'Multi-Specialty', OT/SLP/chiropractic labels, anything
--    unclear -- stays 'all'. Why OT/SLP/chiro labels stay 'all' too: v1 renders
--    only the PT and Nutrition tables, so an 'ot'-keyed record would be
--    invisible on every screen, and the spec says nothing is hidden and
--    nothing is guessed (D12, D15). As 'all' it stays visible in both tables;
--    when the OT table ships, a coordinator re-keys it deliberately.
--    `specialty` itself is deprecated in place: kept, no longer written by the
--    app (stop-write per the additive rule), never dropped.
--
-- 3. Uniqueness becomes (group_id, payer_id, state, specialty_key): the new
--    unique index is created FIRST, then `contracts_group_id_payer_id_state_key`
--    is dropped, so there is no moment with no uniqueness rule at all. The
--    index keeps the old constraint's default NULLS DISTINCT semantics. (NULL
--    group_id/payer_id rows are already refused by the validated CHECKs
--    contracts_group_id_not_null / contracts_payer_id_not_null.)
--
--    Dropping a constraint is not additive. This one replacement is the
--    PM-approved carve-out recorded in AGENTS.md "Database rules" (decision
--    D11, Oct 29, 2026). It LOOSENS a rule -- every row valid under the 3-part
--    key is valid under the 4-part key -- and it deletes no data and drops no
--    column.
--
-- Nothing else keys on the 3-part constraint: no FK references it and no
-- ON CONFLICT names it. Audit rows, status_history and contract_sop_assignments
-- point at contracts.id, so a specialty record carries its own history and
-- its own Contract SOP.
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS, a pg_constraint-guarded CHECK, a
-- backfill that touches only rows still at 'all' (and never one whose
-- group/payer/state already has a record for the target specialty, so a
-- re-run cannot collide with the new index), CREATE UNIQUE INDEX IF NOT
-- EXISTS, DROP CONSTRAINT IF EXISTS.
--
-- REPO-ONLY until the operator applies it -- staging first, then production.
-- The app change that reads/writes specialty_key ships with it, so apply
-- before (or with) that deploy: the service selects the column.
-- Verify the OBJECTS, not a ledger filename (supabase-migrations skill):
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'contracts'
--      AND column_name = 'specialty_key';
--     -> text, NO, 'all'::text
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.contracts'::regclass
--      AND conname IN ('contracts_specialty_key_check',
--                      'contracts_group_id_payer_id_state_key');
--     -> only contracts_specialty_key_check
--   SELECT indexdef FROM pg_indexes
--    WHERE schemaname = 'public'
--      AND indexname = 'contracts_group_payer_state_specialty_key';
--     -> CREATE UNIQUE INDEX ... (group_id, payer_id, state, specialty_key)
--   SELECT specialty, specialty_key, count(*) FROM public.contracts
--    GROUP BY 1, 2 ORDER BY 1, 2;   -- review what the backfill mapped

-- 1. The column and its closed set.
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS specialty_key text NOT NULL DEFAULT 'all';

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.contracts'::regclass
      AND conname = 'contracts_specialty_key_check'
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_specialty_key_check
      CHECK (specialty_key = ANY (ARRAY['all'::text, 'pt'::text, 'ot'::text, 'slp'::text, 'nutrition'::text, 'chiro'::text]));
  END IF;
END;
$migration$;

COMMENT ON COLUMN public.contracts.specialty_key IS
  'The specialty this contract record covers: all (one agreement for every specialty of the group in that state) or one of pt, ot, slp, nutrition, chiro. Part of the unique key (group_id, payer_id, state, specialty_key). Set on create, never changed by an update.';

-- 2. Backfill from the deprecated free-text label. Normalized: whitespace runs
-- collapsed, spaces around '/' removed, trimmed, lower-cased. Guarded on the
-- column so a database without 20260926160000 still applies cleanly.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contracts'
      AND column_name = 'specialty'
  ) THEN
    RAISE NOTICE 'contracts.specialty is absent; nothing to backfill';
    RETURN;
  END IF;

  WITH labelled AS (
    SELECT
      c.id,
      c.group_id,
      c.payer_id,
      c.state,
      CASE lower(btrim(regexp_replace(regexp_replace(c.specialty, '\s+', ' ', 'g'), '\s*/\s*', '/', 'g')))
        WHEN 'pt' THEN 'pt'
        WHEN 'physical therapy' THEN 'pt'
        WHEN 'physical therapist' THEN 'pt'
        WHEN 'nutrition' THEN 'nutrition'
        WHEN 'nutritionist' THEN 'nutrition'
        WHEN 'dietitian' THEN 'nutrition'
        WHEN 'dietician' THEN 'nutrition'
        WHEN 'registered dietitian' THEN 'nutrition'
        WHEN 'registered dietician' THEN 'nutrition'
        WHEN 'dietetics' THEN 'nutrition'
        WHEN 'nutrition/dietetics' THEN 'nutrition'
        WHEN 'medical nutrition therapy' THEN 'nutrition'
        ELSE NULL
      END AS target_key
    FROM public.contracts c
    WHERE c.specialty_key = 'all'
      AND c.specialty IS NOT NULL
  )
  UPDATE public.contracts c
  SET specialty_key = labelled.target_key
  FROM labelled
  WHERE c.id = labelled.id
    AND labelled.target_key IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.contracts sibling
      WHERE sibling.id <> c.id
        AND sibling.group_id = c.group_id
        AND sibling.payer_id = c.payer_id
        AND sibling.state = c.state
        AND sibling.specialty_key = labelled.target_key
    );

  COMMENT ON COLUMN public.contracts.specialty IS
    'DEPRECATED in place (Oct 29, 2026): free-text specialty label, no longer written by the app. specialty_key is the grain; this text was its one-time backfill source (20261029120000).';
END;
$migration$;

-- 3. Swap the uniqueness rule: the 4-part index first, then drop the 3-part
-- constraint (PM-approved carve-out D11 -- loosens a rule, deletes no data).
CREATE UNIQUE INDEX IF NOT EXISTS contracts_group_payer_state_specialty_key
  ON public.contracts (group_id, payer_id, state, specialty_key) NULLS DISTINCT;

COMMENT ON INDEX public.contracts_group_payer_state_specialty_key IS
  'One contract record per group, payer, state and specialty (all = every specialty). Replaced contracts_group_id_payer_id_state_key (PM decision D11, Oct 29, 2026). NULLS DISTINCT, as the old constraint was.';

ALTER TABLE public.contracts
  DROP CONSTRAINT IF EXISTS contracts_group_id_payer_id_state_key;

NOTIFY pgrst, 'reload schema';
