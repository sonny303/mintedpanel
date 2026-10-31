// An in-memory stand-in for public.job_runs and its two RPCs
// (supabase/migrations/20261031120000_job_runs.sql), for the MINT-106 runner
// and route tests. It follows the SQL: the stale sweep, then an insert that is
// a no-op while a running or succeeded row holds the slot, and a finish that
// only touches a running row. Its clock is the test's, standing in for now().
// The SQL itself is exercised by supabase/tests/mint106-job-runs.sql.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { JOB_STALE_AFTER_MINUTES } from "@/server/jobs/ledger";
import { JOB_NAME_RE, RUN_KEY_RE } from "@/server/jobs/registry";

export interface FakeJobRun {
  id: string;
  job: string;
  run_key: string;
  started_at: number;
  finished_at: number | null;
  outcome: "running" | "succeeded" | "failed";
  counts: unknown;
  error_code: string | null;
}

export interface FakeRpcError {
  code: string;
  message: string;
  details?: string;
}

export interface FakeJobDb {
  db: SupabaseClient<Database>;
  rows: FakeJobRun[];
  calls: Array<{ fn: string; args: Record<string, unknown> }>;
  /** Milliseconds since the epoch; the fake's now(). */
  clock: { now: number };
  /** When set, the named RPC answers with this error instead. */
  failNext: Partial<Record<"claim_job_run" | "finish_job_run", FakeRpcError>>;
}

type RpcResult = { data: unknown; error: FakeRpcError | null };

const CHECK_VIOLATION = (constraint: string): FakeRpcError => ({
  code: "23514",
  message: `new row for relation "job_runs" violates check constraint "${constraint}"`,
});

export function createFakeJobDb(start = Date.parse("2026-10-30T13:00:00Z")): FakeJobDb {
  const state: FakeJobDb = {
    db: undefined as unknown as SupabaseClient<Database>,
    rows: [],
    calls: [],
    clock: { now: start },
    failNext: {},
  };
  let sequence = 0;

  const claim = (args: Record<string, unknown>): RpcResult => {
    const job = String(args.p_job);
    const runKey = String(args.p_run_key);
    if (!JOB_NAME_RE.test(job)) return { data: null, error: CHECK_VIOLATION("job_runs_job_check") };
    if (!RUN_KEY_RE.test(runKey)) {
      return { data: null, error: CHECK_VIOLATION("job_runs_run_key_check") };
    }
    const staleBefore = state.clock.now - JOB_STALE_AFTER_MINUTES * 60_000;
    const slot = state.rows.filter((row) => row.job === job && row.run_key === runKey);
    for (const row of slot) {
      if (row.outcome === "running" && row.started_at < staleBefore) {
        row.outcome = "failed";
        row.error_code = "timed_out";
        row.finished_at = state.clock.now;
      }
    }
    if (slot.some((row) => row.outcome === "running" || row.outcome === "succeeded")) {
      return { data: null, error: null };
    }
    sequence += 1;
    const id = `00000000-0000-4000-a000-${String(sequence).padStart(12, "0")}`;
    state.rows.push({
      id,
      job,
      run_key: runKey,
      started_at: state.clock.now,
      finished_at: null,
      outcome: "running",
      counts: {},
      error_code: null,
    });
    return { data: id, error: null };
  };

  const finish = (args: Record<string, unknown>): RpcResult => {
    const outcome = args.p_outcome;
    if (outcome !== "succeeded" && outcome !== "failed") {
      return { data: null, error: { code: "22023", message: "finish_job_run: outcome" } };
    }
    const errorCode = typeof args.p_error_code === "string" ? args.p_error_code : null;
    if ((outcome === "failed") !== (errorCode !== null)) {
      return { data: null, error: CHECK_VIOLATION("job_runs_failed_code_check") };
    }
    const row = state.rows.find((r) => r.id === args.p_id && r.outcome === "running");
    if (!row) return { data: false, error: null };
    row.outcome = outcome;
    row.counts = args.p_counts;
    row.error_code = errorCode;
    row.finished_at = state.clock.now;
    return { data: true, error: null };
  };

  const rpc = async (fn: string, args: Record<string, unknown>): Promise<RpcResult> => {
    state.calls.push({ fn, args });
    if (fn === "claim_job_run" || fn === "finish_job_run") {
      const injected = state.failNext[fn];
      if (injected) {
        delete state.failNext[fn];
        return { data: null, error: injected };
      }
      return fn === "claim_job_run" ? claim(args) : finish(args);
    }
    return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
  };

  state.db = { rpc } as unknown as SupabaseClient<Database>;
  return state;
}
