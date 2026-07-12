-- E1.4 TE-2 — start_date floor on provider_facility_assignments (additive).
-- The column has existed since the baseline but both legacy writers dropped
-- it; the E1.4 assignment editor requires it. NOT VALID so pre-existing null
-- rows survive; new/updated rows must comply. Legacy nulls are remediated
-- through the E1.4 UI, then a later migration runs VALIDATE CONSTRAINT
-- (the E0.10 two-step pattern).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_facility_assignments_start_date_check'
  ) THEN
    ALTER TABLE public.provider_facility_assignments
      ADD CONSTRAINT provider_facility_assignments_start_date_check
      CHECK (start_date IS NOT NULL) NOT VALID;
  END IF;
END $$;
