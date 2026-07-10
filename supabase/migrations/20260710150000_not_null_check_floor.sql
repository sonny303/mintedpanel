-- E0.10 F0.10.1 (TE-1) -- NOT-NULL floor under the uniqueness invariants.
--
-- The live UNIQUE constraints contracts_group_id_payer_id_state_key,
-- provider_facility_assignments_provider_id_facility_id_key, and
-- uq_state_licenses_provider_state_number all include nullable FK columns, so
-- Postgres never collides two rows sharing a NULL -- the declared invariants
-- ("one contract per group x payer x state", etc.) are unenforced. One
-- per-column CHECK (col IS NOT NULL) NOT VALID closes the hole for all NEW
-- writes immediately; the matching VALIDATE statements ship separately
-- (20260710180000), gated on the BD-1 audit (TE-7).
--
-- Per-column (not one table-level check) so each can be validated
-- independently and the failure message names the offending column.
-- credential_cases' key columns (provider_id, payer_id, state) are already
-- NOT NULL in the baseline -- no change there.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_group_id_not_null') THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_group_id_not_null CHECK (group_id IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_payer_id_not_null') THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_payer_id_not_null CHECK (payer_id IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_facility_assignments_provider_id_not_null') THEN
    ALTER TABLE public.provider_facility_assignments
      ADD CONSTRAINT provider_facility_assignments_provider_id_not_null
      CHECK (provider_id IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_facility_assignments_facility_id_not_null') THEN
    ALTER TABLE public.provider_facility_assignments
      ADD CONSTRAINT provider_facility_assignments_facility_id_not_null
      CHECK (facility_id IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'state_licenses_provider_id_not_null') THEN
    ALTER TABLE public.state_licenses
      ADD CONSTRAINT state_licenses_provider_id_not_null
      CHECK (provider_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
