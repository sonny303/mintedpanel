// The job_runs ledger (MINT-106), reached only through its two service-role
// RPCs (supabase/migrations/20261031120000_job_runs.sql). The claim is atomic
// in SQL: a partial unique index allows one running or succeeded row per
// (job, run_key), and the stale sweep runs in the same call.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { JobCounts, JobErrorCode } from "./types";

/** A running row older than this is treated as a crashed run: the next claim
 *  marks it failed (timed_out) and runs again. It must exceed the longest a
 *  Vercel function may run (800 s); claim_job_run hard-codes the same
 *  interval. */
export const JOB_STALE_AFTER_MINUTES = 15;

export interface JobRunFinish {
  outcome: "succeeded" | "failed";
  counts: JobCounts;
  errorCode: JobErrorCode | null;
}

export interface JobLedger {
  /** Takes the (job, runKey) slot. Returns the new run id, or null when a run
   *  for the slot is running or succeeded. */
  claim(job: string, runKey: string): Promise<string | null>;
  /** Records a running row's outcome. False when the row is no longer running
   *  (a later claim marked it timed_out). */
  finish(runId: string, result: JobRunFinish): Promise<boolean>;
}

export function supabaseJobLedger(db: SupabaseClient<Database>): JobLedger {
  return {
    async claim(job, runKey) {
      const { data, error } = await db.rpc("claim_job_run", { p_job: job, p_run_key: runKey });
      if (error) throw error;
      return typeof data === "string" && data.length > 0 ? data : null;
    },
    async finish(runId, result) {
      const { data, error } = await db.rpc("finish_job_run", {
        p_id: runId,
        p_outcome: result.outcome,
        p_counts: result.counts,
        ...(result.errorCode ? { p_error_code: result.errorCode } : {}),
      });
      if (error) throw error;
      return data === true;
    },
  };
}
