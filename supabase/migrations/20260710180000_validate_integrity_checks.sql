-- E0.10 TE-7 -- validate the E0.10 NOT VALID checks.
--
-- Gated on the BD-1 / BD-2 audits (run via MCP execute_sql 2026-07-10, results
-- recorded in the PR): every probe returned ZERO offending rows --
--   BD-1: no NULL group_id/payer_id on contracts, no NULL provider_id/
--         facility_id on provider_facility_assignments, no NULL provider_id on
--         state_licenses, no ownerless tasks;
--   BD-2: every non-NULL state value across the TE-2 columns is already a
--         valid ^[A-Z]{2}$ code (CO, KS, LA, NC).
-- So all fourteen CHECK constraints validate cleanly. VALIDATE CONSTRAINT is
-- a no-op on an already-validated constraint, keeping this re-runnable.

-- F0.10.1 NOT-NULL floor
ALTER TABLE public.contracts VALIDATE CONSTRAINT contracts_group_id_not_null;
ALTER TABLE public.contracts VALIDATE CONSTRAINT contracts_payer_id_not_null;
ALTER TABLE public.provider_facility_assignments
  VALIDATE CONSTRAINT provider_facility_assignments_provider_id_not_null;
ALTER TABLE public.provider_facility_assignments
  VALIDATE CONSTRAINT provider_facility_assignments_facility_id_not_null;
ALTER TABLE public.state_licenses VALIDATE CONSTRAINT state_licenses_provider_id_not_null;

-- F0.10.2 state-format floor
ALTER TABLE public.credential_cases VALIDATE CONSTRAINT credential_cases_state_format;
ALTER TABLE public.contracts VALIDATE CONSTRAINT contracts_state_format;
ALTER TABLE public.state_licenses VALIDATE CONSTRAINT state_licenses_state_format;
ALTER TABLE public.facilities VALIDATE CONSTRAINT facilities_state_format;
ALTER TABLE public.providers VALIDATE CONSTRAINT providers_home_state_format;
ALTER TABLE public.providers VALIDATE CONSTRAINT providers_license_state_format;
ALTER TABLE public.provider_groups VALIDATE CONSTRAINT provider_groups_billing_state_format;
ALTER TABLE public.provider_groups
  VALIDATE CONSTRAINT provider_groups_correspondence_state_format;

-- F0.10.3 structural validity
ALTER TABLE public.tasks VALIDATE CONSTRAINT tasks_owner_check;
