-- E2.1 TE-2 — case_generation_runs: one row per confirmed generation batch
-- (who/when/counts), plus credential_cases.generation_run_id so every case a
-- batch creates carries its run — the E2.4 traceability spine.
--
-- Write order (locked by the FK): the run row is inserted FIRST, at confirm
-- time, carrying the confirmed plan's counts; the per-row create loop then
-- threads its id through create_case_with_tasks. Runs are IMMUTABLE BY
-- OMISSION — no UPDATE or DELETE policy, no UPDATE/DELETE grant — so the
-- stored counts are the confirm-time record (actual outcomes are reported
-- client-side and in the run's audit row; E2.4's disposition child rows
-- supersede the stored counts at read time, per its TE-1).
--
-- The per-row disposition payload shape is deliberately NOT built here —
-- that is E2.4's §5 decision.

CREATE TABLE IF NOT EXISTS public.case_generation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  proposed_count int NOT NULL,
  created_count int NOT NULL,
  skipped_existing_count int NOT NULL,
  excluded_count int NOT NULL,
  failed_count int NOT NULL
);

-- FK cover indexes per the E0.10 convention.
CREATE INDEX IF NOT EXISTS idx_case_generation_runs_org_id
  ON public.case_generation_runs (org_id);
CREATE INDEX IF NOT EXISTS idx_case_generation_runs_created_by
  ON public.case_generation_runs (created_by);

ALTER TABLE public.case_generation_runs ENABLE ROW LEVEL SECURITY;

-- Immutability at the grant layer too: SELECT + INSERT only.
REVOKE ALL ON public.case_generation_runs FROM PUBLIC;
REVOKE ALL ON public.case_generation_runs FROM anon;
GRANT SELECT, INSERT ON public.case_generation_runs TO authenticated;

-- Member SELECT own-org; WRITER (admin|specialist) INSERT — generation
-- confirm is a writer flow, mirroring the credential_cases write policies.
-- Deliberately NO UPDATE/DELETE policies (TE-2: runs are immutable).
DROP POLICY IF EXISTS case_generation_runs_select ON public.case_generation_runs;
CREATE POLICY case_generation_runs_select ON public.case_generation_runs
  FOR SELECT USING (org_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS case_generation_runs_insert ON public.case_generation_runs;
CREATE POLICY case_generation_runs_insert ON public.case_generation_runs
  FOR INSERT WITH CHECK (
    org_id IN (SELECT user_org_ids())
    AND user_role(org_id) IN ('admin', 'specialist')
  );

-- The traceability column: NULL = not created by a generation run (manual
-- one-offs, every pre-E2.1 case). Partial cover index — the overwhelming
-- majority of rows stay NULL (the tasks_sop_template_version_idx precedent).
ALTER TABLE public.credential_cases
  ADD COLUMN IF NOT EXISTS generation_run_id uuid REFERENCES public.case_generation_runs (id);

CREATE INDEX IF NOT EXISTS idx_credential_cases_generation_run_id
  ON public.credential_cases (generation_run_id)
  WHERE generation_run_id IS NOT NULL;
