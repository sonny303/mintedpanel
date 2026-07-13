-- E3.0 TE-2/TE-3 — import_runs + import_rows: the STAGING layer for bulk roster
-- import (Intake, File Gate & Async Processing). NOTHING here writes to the live
-- provider/group/facility tables — an upload lands as a staged run that E3.1's
-- preview/commit flow acts on ([r5] decision 10). These are WORKING tables
-- (create -> scan -> discard), not the append-only ledger: import_runs takes
-- UPDATE (the durable state/count progress that makes "leave and return to a run
-- in progress" work, F3.0.4), and import_rows are DELETEd when a run is
-- committed (E3.1) or cancelled (the TE-7 staged-PII purge). Register status =
-- support, not ledger.
--
-- Writes are ADMIN-only (INSERT/UPDATE/DELETE) — F3.0.1's admin-gated tool and
-- the [r5-review] decision 2 (the org rep is provisioned as an ADMIN of their
-- own org, so the admin-only staging RLS needs no policy change), mirroring the
-- case_generation_exclusions admin-write posture. Member SELECT own-org.
--
-- SSN safety (TE-6): a full SSN never reaches import_rows.raw/mapped — the
-- client scan (src/lib/rosterImport.ts) rejects any 9-digit / NNN-NN-NNNN value
-- outside the TIN column as a blocked row and strips it before the row is
-- written; only a validated 4-digit ssn_last4 is ever persisted. raw/mapped are
-- opaque jsonb, so this is enforced at the scan boundary, not by a DB constraint.

CREATE TABLE IF NOT EXISTS public.import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.profiles (id),
  source text NOT NULL
    CONSTRAINT import_runs_source_check CHECK (source IN ('internal', 'onboarding')),
  file_name text NULL,
  state text NOT NULL DEFAULT 'uploading'
    CONSTRAINT import_runs_state_check
    CHECK (state IN ('uploading', 'scanning', 'ready_for_review', 'committed', 'failed', 'cancelled')),
  total_rows int NULL,
  staged_rows int NULL,
  error_rows int NULL,
  error_report jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- FK cover indexes per the E0.10 20260710065904 convention.
CREATE INDEX IF NOT EXISTS idx_import_runs_org_id ON public.import_runs (org_id);
CREATE INDEX IF NOT EXISTS idx_import_runs_created_by ON public.import_runs (created_by);

CREATE TABLE IF NOT EXISTS public.import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalized on purpose (derivable via run_id) so RLS filters on it
  -- directly — the case_generation_run_rows / E1.5 precedent.
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.import_runs (id) ON DELETE CASCADE,
  line int NOT NULL,
  raw jsonb NOT NULL,
  mapped jsonb NULL,
  row_state text NULL
    CONSTRAINT import_rows_row_state_check CHECK (row_state IN ('staged', 'error')),
  error_column text NULL,
  error_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One staged/error row per source line — the idempotent-resume key (a
  -- re-sent chunk conflicts instead of duplicating; F3.0.4 resume).
  CONSTRAINT uq_import_rows_run_line UNIQUE (run_id, line)
);

-- run_id leads uq_import_rows_run_line (FK cover); org_id needs its own index.
CREATE INDEX IF NOT EXISTS idx_import_rows_org_id ON public.import_rows (org_id);

ALTER TABLE public.import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;

-- Working-table grants (the 20260710004810 grant-hardening posture): no anon;
-- import_runs is UPDATEd (progress) but never DELETEd (it is the durable
-- record); import_rows are INSERTed at scan and DELETEd on commit/cancel.
REVOKE ALL ON public.import_runs FROM PUBLIC;
REVOKE ALL ON public.import_runs FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.import_runs TO authenticated;

REVOKE ALL ON public.import_rows FROM PUBLIC;
REVOKE ALL ON public.import_rows FROM anon;
GRANT SELECT, INSERT, DELETE ON public.import_rows TO authenticated;

-- Member SELECT own-org; ADMIN-only INSERT/UPDATE (import_runs) and
-- INSERT/DELETE (import_rows), with the exclusions-style stricter WITH CHECKs
-- (import_rows.run_id must belong to the same org, so a multi-org admin cannot
-- stage rows under another tenant's run).
DROP POLICY IF EXISTS import_runs_select ON public.import_runs;
CREATE POLICY import_runs_select ON public.import_runs
  FOR SELECT USING (org_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS import_runs_insert ON public.import_runs;
CREATE POLICY import_runs_insert ON public.import_runs
  FOR INSERT WITH CHECK (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) = 'admin'
  );

DROP POLICY IF EXISTS import_runs_update ON public.import_runs;
CREATE POLICY import_runs_update ON public.import_runs
  FOR UPDATE USING (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) = 'admin'
  )
  WITH CHECK (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) = 'admin'
  );

DROP POLICY IF EXISTS import_rows_select ON public.import_rows;
CREATE POLICY import_rows_select ON public.import_rows
  FOR SELECT USING (org_id IN (SELECT user_org_ids()));

DROP POLICY IF EXISTS import_rows_insert ON public.import_rows;
CREATE POLICY import_rows_insert ON public.import_rows
  FOR INSERT WITH CHECK (
    org_id IN (SELECT user_org_ids())
    AND user_role(org_id) = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.import_runs r
      WHERE r.id = run_id AND r.org_id = import_rows.org_id
    )
  );

DROP POLICY IF EXISTS import_rows_delete ON public.import_rows;
CREATE POLICY import_rows_delete ON public.import_rows
  FOR DELETE USING (
    org_id IN (SELECT user_org_ids()) AND user_role(org_id) = 'admin'
  );

-- TE-3 — batched staging RPC. The async scan runs in the browser (chunked
-- parse off the main thread); each ~500-row chunk of scanned rows is inserted
-- through this ONE round trip, which also recomputes the run's staged/error
-- counts from the ledger (idempotent under uq_import_rows_run_line, so a
-- re-sent chunk on resume neither duplicates nor double-counts). SECURITY
-- DEFINER with a pinned search_path; the function re-checks membership + admin
-- role itself (definer bypasses RLS). EXECUTE granted to authenticated only.
CREATE OR REPLACE FUNCTION public.stage_import_rows(
  p_run_id uuid,
  p_rows jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM import_runs WHERE id = p_run_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Import run not found';
  END IF;
  IF NOT (v_org IN (SELECT user_org_ids())) OR NOT (user_role(v_org) = 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO import_rows (org_id, run_id, line, raw, mapped, row_state, error_column, error_reason)
  SELECT
    v_org,
    p_run_id,
    (e ->> 'line')::int,
    COALESCE(e -> 'raw', '{}'::jsonb),
    NULLIF(e -> 'mapped', 'null'::jsonb),
    e ->> 'row_state',
    e ->> 'error_column',
    e ->> 'error_reason'
  FROM jsonb_array_elements(p_rows) AS e
  ON CONFLICT (run_id, line) DO NOTHING;

  UPDATE import_runs
    SET staged_rows = (SELECT count(*) FROM import_rows WHERE run_id = p_run_id AND row_state = 'staged'),
        error_rows  = (SELECT count(*) FROM import_rows WHERE run_id = p_run_id AND row_state = 'error'),
        updated_at  = now()
    WHERE id = p_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.stage_import_rows(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stage_import_rows(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.stage_import_rows(uuid, jsonb) TO authenticated;
