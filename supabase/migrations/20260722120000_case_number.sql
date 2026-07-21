-- Case# — a globally-sequential, immutable case number across ALL orgs
-- (2026-07-22 Cases page redesign). ONE sequence (not per-org), backfilled in
-- global created_at order, displayed as C-<n>. Additive; applied to hosted via
-- MCP the same day (repo + hosted in sync). Guarded so a repo-only rebuild
-- (fresh stack / CI) still passes.

-- 1. The global sequence — one across all orgs.
CREATE SEQUENCE IF NOT EXISTS public.credential_cases_case_number_seq AS bigint;

-- 2. The column, additive + nullable for the backfill window.
ALTER TABLE public.credential_cases
  ADD COLUMN IF NOT EXISTS case_number bigint;

-- 3. Backfill existing rows in GLOBAL created_at order (stable id tiebreak),
--    starting at 1001 so numbers read as C-1001+.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.credential_cases
  WHERE case_number IS NULL
)
UPDATE public.credential_cases c
SET case_number = 1000 + o.rn
FROM ordered o
WHERE c.id = o.id;

-- 4. Advance the sequence past the highest backfilled number.
SELECT setval(
  'public.credential_cases_case_number_seq',
  GREATEST(COALESCE((SELECT max(case_number) FROM public.credential_cases), 1000), 1000)
);

-- 5. New rows draw the next global number by default. The create_case_with_tasks
--    RPC inserts an explicit column list WITHOUT case_number, so the DEFAULT
--    flows through every creation path unchanged (no RPC change needed).
ALTER TABLE public.credential_cases
  ALTER COLUMN case_number SET DEFAULT nextval('public.credential_cases_case_number_seq');

-- 6. Now-populated: presence + GLOBAL uniqueness (no org_id in the key).
ALTER TABLE public.credential_cases
  ALTER COLUMN case_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_credential_cases_case_number
  ON public.credential_cases (case_number);

-- 7. Immutable — reject any UPDATE that changes case_number (a permanent
--    identity, like an invoice number). Every other column stays freely
--    updatable, so set_case_status and the auto-transition triggers are
--    unaffected (they never touch case_number).
CREATE OR REPLACE FUNCTION public.credential_cases_case_number_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.case_number IS DISTINCT FROM OLD.case_number THEN
    RAISE EXCEPTION 'case_number is immutable (case %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credential_cases_case_number_immutable ON public.credential_cases;
CREATE TRIGGER trg_credential_cases_case_number_immutable
  BEFORE UPDATE ON public.credential_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.credential_cases_case_number_immutable();

-- 8. Grants — create_case_with_tasks is SECURITY INVOKER, so the inserting role
--    needs USAGE on the sequence to draw the default value.
GRANT USAGE, SELECT ON SEQUENCE public.credential_cases_case_number_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.credential_cases_case_number_seq TO service_role;
