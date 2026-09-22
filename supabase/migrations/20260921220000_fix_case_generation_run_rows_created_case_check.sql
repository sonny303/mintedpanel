-- Allow case_generation_run_rows.case_id to be SET NULL when a case is
-- deleted, while keeping INSERT-time validation that 'created' rows must
-- link a case.
--
-- Background: the table CHECK
--   (disposition <> 'created' OR case_id IS NOT NULL)
-- also fires on the internal UPDATE that ON DELETE SET NULL performs.
-- That aborts admin delete_case for any case that has a disposition =
-- 'created' ledger row — contradicting the FK comment and the delete_case
-- contract ("SET NULL keeps the ledger row if a case is ever removed").
--
-- Fix: drop the table CHECK; enforce the same rule with a BEFORE INSERT
-- trigger so generation cannot insert a headless 'created' row, while the
-- FK cascade UPDATE is free to clear case_id.

ALTER TABLE public.case_generation_run_rows
  DROP CONSTRAINT IF EXISTS case_generation_run_rows_created_case_check;

CREATE OR REPLACE FUNCTION public.trg_case_generation_run_rows_created_case_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.disposition = 'created' AND NEW.case_id IS NULL THEN
    RAISE EXCEPTION 'case_id is required when disposition is created'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_case_generation_run_rows_created_case_check
  ON public.case_generation_run_rows;

CREATE TRIGGER trg_case_generation_run_rows_created_case_check
  BEFORE INSERT ON public.case_generation_run_rows
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_case_generation_run_rows_created_case_check();
