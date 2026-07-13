-- E2.1 F2.1.1 / TE-1 — the 4-part case key: safety-net backfill of any
-- remaining NULL-group cases, then the uniqueness swap from
-- (provider_id, payer_id, state) to
-- UNIQUE NULLS NOT DISTINCT (provider_id, group_id, payer_id, state).
--
-- credential_cases.group_id has existed since the baseline (FK + cover index
-- already in place; every creation path writes it; 0 NULL rows on hosted at
-- authoring time, verified 2026-07-13) — THE migration is this constraint
-- swap, not a column add. One constraint yields BOTH required semantics:
-- 4-part uniqueness for grouped rows AND the legacy 3-part rule among
-- NULL-group rows (NULL = NULL under NULLS NOT DISTINCT; hosted is
-- PostgreSQL 17.6, NULLS NOT DISTINCT needs >= 15). The new constraint keeps
-- provider_id leading so the dropped constraint's FK index coverage for
-- provider_id is preserved.
--
-- The backfill rule order is deterministic (TE-1) and mirrored as the pure,
-- unit-tested resolveBackfillGroupId in src/lib/caseKeyBackfill.ts — keep the
-- two in sync:
--   (a) the case's facility_id -> facilities.group_id;
--   (b) the provider's SOLE provider_group_assignments row;
--   (c) the provider's is_primary assignment;
--   (d) otherwise leave NULL (the 3-part rule still binds those rows).
-- providers.group_id is a FROZEN legacy mirror (table register: "no new
-- readers") and is deliberately not consulted.

-- (a) Facility lineage: a case linked to a location inherits that location's
-- group.
UPDATE public.credential_cases c
SET group_id = f.group_id
FROM public.facilities f
WHERE c.group_id IS NULL
  AND c.facility_id = f.id
  AND f.group_id IS NOT NULL;

-- (b) Sole group membership: a provider with exactly one group assignment.
UPDATE public.credential_cases c
SET group_id = s.group_id
FROM (
  SELECT provider_id, min(group_id::text)::uuid AS group_id
  FROM public.provider_group_assignments
  GROUP BY provider_id
  HAVING count(*) = 1
) s
WHERE c.group_id IS NULL
  AND c.provider_id = s.provider_id;

-- (c) Primary assignment: the partial unique on provider_group_assignments
-- guarantees at most one is_primary row per provider.
UPDATE public.credential_cases c
SET group_id = a.group_id
FROM public.provider_group_assignments a
WHERE c.group_id IS NULL
  AND a.provider_id = c.provider_id
  AND a.is_primary;

-- (d) is the absence of an UPDATE: rows still NULL after (a)-(c) stay NULL
-- and remain governed by the 3-part rule via NULLS NOT DISTINCT below.

-- Constraint swap, guarded per docs/migration-baseline.md so a repo-only
-- rebuild (where the baseline already created the old constraint) and a
-- re-run against hosted both pass.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credential_cases_provider_id_payer_id_state_key'
      AND conrelid = 'public.credential_cases'::regclass
  ) THEN
    ALTER TABLE public.credential_cases
      DROP CONSTRAINT credential_cases_provider_id_payer_id_state_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credential_cases_provider_group_payer_state_key'
      AND conrelid = 'public.credential_cases'::regclass
  ) THEN
    ALTER TABLE public.credential_cases
      ADD CONSTRAINT credential_cases_provider_group_payer_state_key
      UNIQUE NULLS NOT DISTINCT (provider_id, group_id, payer_id, state);
  END IF;
END $$;
