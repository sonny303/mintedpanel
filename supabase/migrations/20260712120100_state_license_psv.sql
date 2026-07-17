-- E1.3 F1.3.3 — primary-source verification (PSV) trail on state_licenses
-- (additive): the team verifies each license against the state board site;
-- this records that verification instead of losing it. verified_status is
-- service-managed (marking verified requires the lookup URL; verified_at/by
-- are set server-side; editing expiration_date resets to 'unverified' — the
-- R9 re-verify feed). state_licenses is NOT an append-only spine, so these
-- are ordinary audited UPDATEs under the existing org-scoped RLS.

ALTER TABLE public.state_licenses
  ADD COLUMN IF NOT EXISTS verified_status text DEFAULT 'unverified' NOT NULL,
  ADD COLUMN IF NOT EXISTS verified_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verification_source_url text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'state_licenses_verified_status_check') THEN
    ALTER TABLE public.state_licenses
      ADD CONSTRAINT state_licenses_verified_status_check
      CHECK (verified_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'failed'::text]));
  END IF;
END $$;
