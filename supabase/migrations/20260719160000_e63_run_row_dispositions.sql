-- E6.3 F6.3.4 — the run ledger records EVERY candidate's disposition,
-- including the two buckets the decoupled grid adds: 'skipped' (skip-for-now —
-- deliberately left out of this batch, no reason demanded of the user, the
-- candidate stays in the buffer) and 'enrolled' (covered by a live enrollment
-- fact — never attempted, never casework). Widening a CHECK is additive:
-- every existing row and writer stays valid; the ledger stays INSERT-only
-- (no policy/grant change here). Both new dispositions carry a snapshot
-- reason like excluded/failed do, so run detail always explains the row.
--
-- Repo-file ONLY per the E6 build rule — hosted apply is an OPERATOR step.

ALTER TABLE public.case_generation_run_rows
  DROP CONSTRAINT IF EXISTS case_generation_run_rows_disposition_check;
ALTER TABLE public.case_generation_run_rows
  ADD CONSTRAINT case_generation_run_rows_disposition_check
  CHECK (disposition IN ('created', 'skipped_existing', 'excluded', 'failed', 'skipped', 'enrolled'));

ALTER TABLE public.case_generation_run_rows
  DROP CONSTRAINT IF EXISTS case_generation_run_rows_reason_required_check;
ALTER TABLE public.case_generation_run_rows
  ADD CONSTRAINT case_generation_run_rows_reason_required_check
  CHECK (disposition NOT IN ('excluded', 'failed', 'skipped', 'enrolled') OR reason IS NOT NULL);
