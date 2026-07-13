-- E3.1 TE-1 — providers.verification_state: the R5 staging fence. Bulk-imported
-- providers land 'pending_verification' and are excluded from E1.8 readiness and
-- E2.0 generation candidacy by ONE additive filter on the shared
-- listProviderReadinessFacts read (TE-2) until a user explicitly verifies them
-- ([r5] decision 10). The 'verified' DEFAULT preserves every existing row as
-- verified, so nothing already on the roster falls out of readiness/generation.
--
-- Deliberately NOT a widening of providers.status: providers_status_check
-- (onboarding|active|terminated) drives the action engine — a verification
-- value there would collide with that CHECK and its semantics. Also deliberately
-- NOT reference_only, which keeps its existing action-engine meaning — the
-- import pipeline sets verification_state ONLY (the reviewer's single-fence
-- recommendation, E3.1 §5 open question).

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS verification_state text NOT NULL DEFAULT 'verified';

DO $$
BEGIN
  ALTER TABLE public.providers
    ADD CONSTRAINT providers_verification_state_check
    CHECK (verification_state IN ('verified', 'pending_verification'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- The verify surfaces list an org's pending rows; verified rows (the steady
-- state) stay out of the index.
CREATE INDEX IF NOT EXISTS idx_providers_pending_verification
  ON public.providers (org_id)
  WHERE verification_state = 'pending_verification';
