-- Pre-GA dead-column drop (superseding) — payers + credential_cases.
--
-- (a) SUPERSEDES supabase/migrations/20260716180000_payer_dead_column_drop.sql
--     (PR #169), which was NEVER applied to hosted project fkvuhfsqcmujywzgczmc
--     (absent from supabase_migrations.schema_migrations; verified 2026-07-17).
--     That file is retired in this same PR to
--     `20260716180000_payer_dead_column_drop.sql.superseded` so the CLI ignores it.
--
-- (b) #169's reissue of review_payer_catalog_change is DELIBERATELY OMITTED here.
--     After #169 was written, PR #170 (repo `20260716191000_catalog_review_platform_only.sql`,
--     applied to hosted as `20260716212728`) reissued that function to the
--     PLATFORM-ONLY body (rejects org-user JWTs, keeps service_role) and revoked
--     authenticated EXECUTE. Applying #169 verbatim would OVERWRITE #170's newer
--     body and silently remove the `catalog_review_platform_only` guard. This
--     migration therefore performs ONLY the column/constraint/index drops and
--     leaves the live function exactly as #170 left it (verified on hosted
--     2026-07-17: live body carries `catalog_review_platform_only`, references
--     no dropped column). Because #169 never runs, its E1.6-era reissue can never
--     re-grant authenticated EXECUTE — no re-apply of `20260716191000` is needed.
--
-- GOVERNANCE: authorized by AGENTS.md -> Database rules -> "Schema change policy
-- (pre-GA window)". We are pre-GA; no customer production database exists yet.
--   (1) PM approval: 2026-07-16 decisions D1/D2 (payer catalog identity is
--       payer_slug; no clearinghouse / curated-billing capacity ships pre-GA).
--   (2) Evidence: docs/data-model/payer-field-usage-audit.md — every column below
--       is audit class 2 (written/displayed, no downstream consumer), class 7
--       (unused/unverified), or class 8 (superseded).
--   (3) All code references removed in the same PR (the application layer already
--       carried none; the generated src/integrations/supabase/types.ts is
--       regenerated in a follow-up PR after the operator applies this drop).
-- Append-only ledgers (audit_log, *_history, touches) are untouched.
--
-- ============================================================================
-- Pre-drop data inventory — hosted project fkvuhfsqcmujywzgczmc, verified
-- 2026-07-17 (post full-data-wipe: 269 global payers `org_id IS NULL`,
-- 0 credential_cases rows). Every target column carries ZERO user data:
--   payers.portal_url                    0 non-null   (payers only; msos.portal_url is live)
--   payers.provider_type_path            0 non-null
--   payers.payer_billing_id              0 non-null
--   payers.prior_auth_vendor             0 non-null
--   payers.retro_billing_window_days     0 non-null
--   payers.caqh_pull_deadline_days       0 non-null
--   payers.retro_billing_allowed         269 non-null / 0 true  (column default false, not user data)
--   payers.provisional_billing_notes     0 non-null
--   payers.provisional_billing_allowed   269 non-null / 0 true  (column default false, not user data)
--   payers.cms_hios_id                   0 non-null
--   payers.prerequisite_payer_id         0 non-null
--   credential_cases.payer_provider_id   0 rows in table
-- No view or rule depends on any target column (pg_depend clean, verified
-- 2026-07-17), so the non-CASCADE drops below are safe.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop the constraint + index guarding two of the dropped columns, so the
--    destructive surface is explicit and auditable (DROP COLUMN would cascade
--    to them anyway). These are the ONLY dependent objects on the target
--    columns (verified against hosted 2026-07-17), matching #169.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payers DROP CONSTRAINT IF EXISTS payers_provider_type_path_check;
ALTER TABLE public.payers DROP CONSTRAINT IF EXISTS payers_prerequisite_payer_id_fkey;
DROP INDEX IF EXISTS public.idx_payers_prerequisite_payer_id;

-- ---------------------------------------------------------------------------
-- 2. Drop the 11 dead payers columns.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3. Drop the dormant credential_cases column. Superseded by the E4.0
--    Type1/Type2 split (20260715120500 -> payer_individual_provider_id /
--    payer_group_provider_id); never read or written.
-- ---------------------------------------------------------------------------
ALTER TABLE public.credential_cases
  DROP COLUMN IF EXISTS payer_provider_id;
