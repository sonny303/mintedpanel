-- E0.10 F0.10.2 (TE-2) -- state-code format floor.
--
-- The jurisdiction/state columns are free text; TX / Tx / Texas / '' are all
-- storable and fragment equality joins. CHECK (state ~ '^[A-Z]{2}$') NOT VALID
-- per in-scope scalar column, per the pinned TE-2 list. The BD-2 audit
-- (2026-07-10) found only valid two-letter US codes (CO, KS, LA, NC) in live
-- data, so the allowed set is US-only ^[A-Z]{2}$ -- no territory/wildcard
-- alternation needed. VALIDATE ships separately (20260710180000).
--
-- Nullable columns use the NULL-allowing form -- the format floor is not a
-- presence requirement outside the F0.10.1 keys. Explicitly EXCLUDED per TE-2
-- (PM decision 2026-07-10): mso_routing_rules.state and sop_templates.state
-- (matching wildcards -- 'All' is valid there), launches.state (dead table),
-- and the provider_groups.states array (shape decision deferred to the
-- group-address normalization epic).

DO $$
BEGIN
  -- NOT NULL columns: plain two-uppercase-letter check ('' fails the regex).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credential_cases_state_format') THEN
    ALTER TABLE public.credential_cases
      ADD CONSTRAINT credential_cases_state_format CHECK (state ~ '^[A-Z]{2}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_state_format') THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_state_format CHECK (state ~ '^[A-Z]{2}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'state_licenses_state_format') THEN
    ALTER TABLE public.state_licenses
      ADD CONSTRAINT state_licenses_state_format CHECK (state ~ '^[A-Z]{2}$') NOT VALID;
  END IF;

  -- Nullable columns: NULL allowed, non-NULL must match.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facilities_state_format') THEN
    ALTER TABLE public.facilities
      ADD CONSTRAINT facilities_state_format
      CHECK (state IS NULL OR state ~ '^[A-Z]{2}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_home_state_format') THEN
    ALTER TABLE public.providers
      ADD CONSTRAINT providers_home_state_format
      CHECK (home_state IS NULL OR home_state ~ '^[A-Z]{2}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_license_state_format') THEN
    ALTER TABLE public.providers
      ADD CONSTRAINT providers_license_state_format
      CHECK (license_state IS NULL OR license_state ~ '^[A-Z]{2}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_groups_billing_state_format') THEN
    ALTER TABLE public.provider_groups
      ADD CONSTRAINT provider_groups_billing_state_format
      CHECK (billing_state IS NULL OR billing_state ~ '^[A-Z]{2}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_groups_correspondence_state_format') THEN
    ALTER TABLE public.provider_groups
      ADD CONSTRAINT provider_groups_correspondence_state_format
      CHECK (correspondence_state IS NULL OR correspondence_state ~ '^[A-Z]{2}$') NOT VALID;
  END IF;
END $$;
