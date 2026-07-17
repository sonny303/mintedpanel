-- E2.4 TE-1/TE-2 — case_generation_run_rows: the immutable per-candidate
-- disposition record of a confirmed generation run — one row per candidate
-- 4-part key per run, written ONCE when its outcome is known
-- (skipped_existing/excluded at confirm, created/failed as each
-- create_case_with_tasks call resolves). A child rows table, not columns or
-- a jsonb blob on the run (the register's grain rule: per-row facts are
-- child rows), so F2.4.1's links (row → case, row → exclusion) are real FKs.
--
-- Immutability is enforced by POLICY SHAPE, not convention (TE-2): member
-- SELECT + writer INSERT only — no UPDATE/DELETE policy AND no UPDATE/DELETE
-- grant (the audit_log / case_generation_runs posture). A mid-batch crash
-- leaves a run whose rows < its proposed count — honest and queryable; no
-- UPDATE exists to "fix" it.
--
-- reason is a snapshot at confirm time (derivation reason for created/
-- skipped rows, the exclusion reason label for excluded, the error message
-- for failed) so run detail degrades to reason-without-link rather than
-- breaking (TE-5 belt-and-braces: exclusion_id is ON DELETE SET NULL even
-- though exclusions carry no DELETE grant). Nothing beyond ids, the
-- disposition enum, and reason text ever lands here — no PHI, never an
-- exclusion note (TE-8).

CREATE TABLE IF NOT EXISTS public.case_generation_run_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalized on purpose (derivable via run_id) so RLS filters directly —
  -- the E1.5/E2.0 precedent: keep it and set it on insert.
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.case_generation_runs (id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers (id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.provider_groups (id) ON DELETE CASCADE,
  payer_id uuid NOT NULL REFERENCES public.payers (id) ON DELETE CASCADE,
  state text NOT NULL
    CONSTRAINT case_generation_run_rows_state_format_check CHECK (state ~ '^[A-Z]{2}$'),
  disposition text NOT NULL
    CONSTRAINT case_generation_run_rows_disposition_check
    CHECK (disposition IN ('created', 'skipped_existing', 'excluded', 'failed')),
  reason text NULL,
  -- created rows MUST link their case; skipped_existing rows also set it to
  -- the BLOCKING case ("why doesn't this exist → it already does" is a link,
  -- not a hunt). SET NULL keeps the ledger row if a case is ever removed.
  case_id uuid NULL REFERENCES public.credential_cases (id) ON DELETE SET NULL,
  exclusion_id uuid NULL REFERENCES public.case_generation_exclusions (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_generation_run_rows_created_case_check
    CHECK (disposition <> 'created' OR case_id IS NOT NULL),
  CONSTRAINT case_generation_run_rows_reason_required_check
    CHECK (disposition NOT IN ('excluded', 'failed') OR reason IS NOT NULL),
  -- One disposition per candidate key per run; leading run_id covers that FK.
  CONSTRAINT uq_case_generation_run_rows_run_key
    UNIQUE (run_id, provider_id, group_id, payer_id, state)
);

-- FK cover indexes per the E0.10 convention (run_id leads the unique above).
CREATE INDEX IF NOT EXISTS idx_case_generation_run_rows_org_id
  ON public.case_generation_run_rows (org_id);
CREATE INDEX IF NOT EXISTS idx_case_generation_run_rows_provider_id
  ON public.case_generation_run_rows (provider_id);
CREATE INDEX IF NOT EXISTS idx_case_generation_run_rows_group_id
  ON public.case_generation_run_rows (group_id);
CREATE INDEX IF NOT EXISTS idx_case_generation_run_rows_payer_id
  ON public.case_generation_run_rows (payer_id);
CREATE INDEX IF NOT EXISTS idx_case_generation_run_rows_case_id
  ON public.case_generation_run_rows (case_id)
  WHERE case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_generation_run_rows_exclusion_id
  ON public.case_generation_run_rows (exclusion_id)
  WHERE exclusion_id IS NOT NULL;

ALTER TABLE public.case_generation_run_rows ENABLE ROW LEVEL SECURITY;

-- Immutability at the grant layer too: SELECT + INSERT only (the
-- 20260710120000 grant-hardening posture).
REVOKE ALL ON public.case_generation_run_rows FROM PUBLIC;
REVOKE ALL ON public.case_generation_run_rows FROM anon;
GRANT SELECT, INSERT ON public.case_generation_run_rows TO authenticated;

-- Member SELECT own-org; WRITER (admin|specialist) INSERT — generation
-- confirm is a writer flow, mirroring case_generation_runs — with the
-- exclusions-style stricter WITH CHECKs: the run, provider, and group must
-- each belong to the same org, so a multi-org writer cannot cross tenant
-- references. payer_id needs no org check (shared catalog, not a tenant
-- secret). Deliberately NO UPDATE/DELETE policies (TE-2).
DROP POLICY IF EXISTS case_generation_run_rows_select ON public.case_generation_run_rows;
CREATE POLICY case_generation_run_rows_select ON public.case_generation_run_rows
  FOR SELECT USING (org_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS case_generation_run_rows_insert ON public.case_generation_run_rows;
CREATE POLICY case_generation_run_rows_insert ON public.case_generation_run_rows
  FOR INSERT WITH CHECK (
    org_id IN (SELECT user_org_ids())
    AND user_role(org_id) IN ('admin', 'specialist')
    AND EXISTS (
      SELECT 1 FROM public.case_generation_runs r
      WHERE r.id = run_id AND r.org_id = case_generation_run_rows.org_id
    )
    AND EXISTS (
      SELECT 1 FROM public.providers p
      WHERE p.id = provider_id AND p.org_id = case_generation_run_rows.org_id
    )
    AND EXISTS (
      SELECT 1 FROM public.provider_groups g
      WHERE g.id = group_id AND g.org_id = case_generation_run_rows.org_id
    )
  );
