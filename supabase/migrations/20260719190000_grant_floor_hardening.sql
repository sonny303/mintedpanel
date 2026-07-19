-- Grant-floor hardening for append-only / no-delete tables.
--
-- Supabase's default privileges grant ALL on new tables to `authenticated`.
-- A `REVOKE ALL ... FROM PUBLIC` / `FROM anon` followed by a positive GRANT
-- does NOT remove that surviving default grant, so several ledgers carried
-- table-level UPDATE/DELETE/TRUNCATE privileges for `authenticated` even
-- though their RLS policy shape (no UPDATE/DELETE policy) already blocked the
-- writes. This floors each table explicitly: revoke everything from
-- `authenticated`, then grant exactly the intended privileges. No policy,
-- data, or behavior change — RLS remains the enforcing layer; this closes the
-- belt-and-suspenders gap.

-- Append-only ledgers: SELECT + INSERT only.
REVOKE ALL ON public.case_status_history FROM authenticated;
GRANT SELECT, INSERT ON public.case_status_history TO authenticated;

REVOKE ALL ON public.case_generation_runs FROM authenticated;
GRANT SELECT, INSERT ON public.case_generation_runs TO authenticated;

REVOKE ALL ON public.case_generation_run_rows FROM authenticated;
GRANT SELECT, INSERT ON public.case_generation_run_rows TO authenticated;

REVOKE ALL ON public.payer_pipeline_history FROM authenticated;
GRANT SELECT, INSERT ON public.payer_pipeline_history TO authenticated;

-- Enrollment facts: expiry is an UPDATE flip, never a DELETE.
REVOKE ALL ON public.enrollment_facts FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.enrollment_facts TO authenticated;
