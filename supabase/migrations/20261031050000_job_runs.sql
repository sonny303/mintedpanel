-- MINT-106 scheduled jobs: the job_runs ledger behind GET /api/jobs/<name>
-- (src/server/jobs/). Vercel cron calls the route with the CRON_SECRET bearer;
-- the route claims one run per (job, run_key), runs the job, and records the
-- outcome here.
--
-- Idempotency is the partial unique index job_runs_one_live_run: at most one
-- row per (job, run_key) is running or succeeded. A failed row is outside it,
-- so a retry inserts a new row and the failure stays on record.
--
-- claim_job_run first marks every running row of the job older than 15
-- minutes as failed (error_code timed_out), in any run_key: a daily job never
-- claims yesterday's slot again, so a crashed row there would otherwise stay
-- running forever. 15 minutes is longer than any Vercel function may run (800
-- seconds at most), so the invocation that held such a row is gone. Keep the
-- interval in step with JOB_STALE_AFTER_MINUTES in src/server/jobs/ledger.ts.
--
-- No PHI, ever. counts is a flat object of snake_case keys mapped to
-- non-negative integers (in code, only the keys the job declares); error_code
-- is one of job_error, invalid_counts or timed_out. Both are checked here and
-- in code (src/server/jobs/counts.ts, src/server/jobs/types.ts).
--
-- service_role only: RLS on with no policies, nothing granted to anon or
-- authenticated. service_role may read the table, and writes only through the
-- two SECURITY DEFINER RPCs below, so every row follows running -> succeeded
-- or running -> failed.
--
-- Additive and idempotent. Applying to hosted is an OPERATOR task.

CREATE TABLE IF NOT EXISTS public.job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job text NOT NULL,
  run_key text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome text NOT NULL DEFAULT 'running',
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  CONSTRAINT job_runs_job_check CHECK (job ~ '^[a-z][a-z0-9-]{0,47}$'),
  CONSTRAINT job_runs_run_key_check CHECK (run_key ~ '^[0-9A-Za-z:_-]{1,64}$'),
  CONSTRAINT job_runs_outcome_check CHECK (outcome IN ('running', 'succeeded', 'failed')),
  CONSTRAINT job_runs_counts_check CHECK (jsonb_typeof(counts) = 'object'),
  CONSTRAINT job_runs_error_code_check CHECK (
    error_code IS NULL OR error_code IN ('job_error', 'invalid_counts', 'timed_out')
  ),
  -- A run is finished exactly when it is no longer running, and carries an
  -- error code exactly when it failed.
  CONSTRAINT job_runs_finished_check CHECK ((outcome = 'running') = (finished_at IS NULL)),
  CONSTRAINT job_runs_failed_code_check CHECK ((outcome = 'failed') = (error_code IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS job_runs_one_live_run
  ON public.job_runs (job, run_key) WHERE outcome IN ('running', 'succeeded');
CREATE INDEX IF NOT EXISTS job_runs_job_started_idx
  ON public.job_runs (job, started_at DESC);

ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.job_runs FROM public, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.job_runs TO service_role;

COMMENT ON TABLE public.job_runs IS
  'Scheduled job ledger (MINT-106): one row per run attempt of a /api/jobs job. At most one running or succeeded row per (job, run_key). Counts and safe codes only, never PHI. service_role only; written by claim_job_run and finish_job_run.';
COMMENT ON COLUMN public.job_runs.job IS
  'Registered job name, the /api/jobs/<name> path segment.';
COMMENT ON COLUMN public.job_runs.run_key IS
  'The run slot the job computed from the request time, by default the UTC day (YYYY-MM-DD).';
COMMENT ON COLUMN public.job_runs.outcome IS
  'running, then succeeded or failed. A skipped call writes no row.';
COMMENT ON COLUMN public.job_runs.counts IS
  'Flat object of snake_case keys mapped to non-negative integers, e.g. {"sent": 2}. Never row data.';
COMMENT ON COLUMN public.job_runs.error_code IS
  'Set exactly when outcome is failed, and only to job_error (the job threw), invalid_counts (it returned something other than its declared integer counts) or timed_out (it was still running after 15 minutes). Never an error message.';

-- ---------------------------------------------------------------------------
-- claim_job_run: take the (job, run_key) slot. Returns the new running row's
-- id, or NULL when a run for the slot is already running or succeeded. Every
-- running row of the job older than 15 minutes, in any slot, is marked failed
-- (timed_out) first, in the same call.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_job_run(p_job text, p_run_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  -- One claim per job at a time. The sweep reaches every slot of the job, so
  -- serializing per job keeps two claims from locking the same stale rows in
  -- different orders. job_runs_one_live_run remains the guarantee.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job_runs:' || p_job, 0));

  -- Every slot, not only this one: a daily job never claims an earlier day's
  -- slot again, so a row that crashed there is retired here.
  UPDATE public.job_runs
     SET outcome = 'failed', error_code = 'timed_out', finished_at = now()
   WHERE job = p_job
     AND outcome = 'running'
     AND started_at < now() - interval '15 minutes';

  -- A live run for the slot makes this insert a no-op, which leaves v_id NULL.
  -- The target names the partial index, so any other conflict still raises.
  INSERT INTO public.job_runs (job, run_key)
  VALUES (p_job, p_run_key)
  ON CONFLICT (job, run_key) WHERE outcome IN ('running', 'succeeded') DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- finish_job_run: record the outcome of a running row. Returns false when the
-- row is no longer running (a later claim marked it timed_out). Counts and
-- the error code are validated here as well as in code: snake_case keys, at
-- most 32, mapped to non-negative integers; a code from the closed set.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finish_job_run(
  p_id uuid,
  p_outcome text,
  p_counts jsonb,
  p_error_code text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_key text;
  v_value jsonb;
  v_number numeric;
  v_keys integer := 0;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'finish_job_run: outcome must be succeeded or failed'
      USING ERRCODE = '22023';
  END IF;
  IF p_error_code IS NOT NULL
     AND p_error_code NOT IN ('job_error', 'invalid_counts', 'timed_out') THEN
    RAISE EXCEPTION 'finish_job_run: error code must be job_error, invalid_counts or timed_out'
      USING ERRCODE = '22023';
  END IF;
  IF p_counts IS NULL OR jsonb_typeof(p_counts) <> 'object' THEN
    RAISE EXCEPTION 'finish_job_run: counts must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  FOR v_key, v_value IN SELECT e.key, e.value FROM jsonb_each(p_counts) AS e LOOP
    v_keys := v_keys + 1;
    IF v_keys > 32 OR v_key !~ '^[a-z][a-z_]{0,39}$' OR jsonb_typeof(v_value) <> 'number' THEN
      RAISE EXCEPTION 'finish_job_run: counts must map snake_case keys to integers'
        USING ERRCODE = '22023';
    END IF;
    -- Cast only once the value is known to be a number.
    v_number := (v_value #>> '{}')::numeric;
    IF v_number < 0 OR v_number <> trunc(v_number) OR v_number > 9007199254740991 THEN
      RAISE EXCEPTION 'finish_job_run: counts must be non-negative integers'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  UPDATE public.job_runs
     SET outcome = p_outcome,
         counts = p_counts,
         error_code = p_error_code,
         finished_at = now()
   WHERE id = p_id
     AND outcome = 'running';

  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_job_run(text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_job_run(uuid, text, jsonb, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_job_run(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_job_run(uuid, text, jsonb, text) TO service_role;

COMMENT ON FUNCTION public.claim_job_run(text, text) IS
  'MINT-106: claim the (job, run_key) slot. Returns the new run id, or NULL when a run is already running or succeeded. First marks every running row of the job older than 15 minutes, in any run_key, failed (timed_out). service_role only.';
COMMENT ON FUNCTION public.finish_job_run(uuid, text, jsonb, text) IS
  'MINT-106: record succeeded or failed, integer counts and an error code (job_error, invalid_counts or timed_out; required for failed) on a running row. Returns false when the row is no longer running. service_role only.';

NOTIFY pgrst, 'reload schema';
