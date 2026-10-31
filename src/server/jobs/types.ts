// Scheduled jobs (MINT-106): the contract a job implements.
//
// Vercel cron calls GET /api/jobs/<name> (./route.ts). The runner (./runner.ts)
// claims one public.job_runs row per (job, runKey), runs the job and records
// its outcome and integer counts (./ledger.ts). A second call for the same
// slot while the first is running, or after it succeeded, runs nothing.
//
// A run is at-least-once, not exactly-once: a run that fails, or crashes and
// times out, is run again by the next call. A job whose work has side effects
// (one email per org, say) keys each one on (job, runKey, item) and skips the
// items an earlier attempt already finished.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Integer tallies a run reports, e.g. `{ orgs: 3, sent: 2, failed: 1 }`.
 *  Keys are snake_case (`JOB_COUNT_KEY_RE`), values non-negative safe
 *  integers (./counts.ts). Never row data. */
export type JobCounts = Readonly<Record<string, number>>;

/** What one call to /api/jobs/<name> did. */
export type JobOutcome = "succeeded" | "failed" | "skipped";

/** The codes a failed job_runs row can carry. */
export type JobErrorCode =
  | "job_error" // the job threw
  | "invalid_counts" // the job returned something other than JobCounts
  | "timed_out"; // a running row outlived the stale timeout (set in SQL)

export interface JobLogger {
  /** Logs one allowlisted line through safeLog's `logServerError` and returns
   *  its correlation id. `event` is a snake_case code literal such as
   *  `"org_send_failed"`; anything else is logged as `invalid_event`. The
   *  error is reduced to its SQLSTATE, constraint and class, never its text. */
  error(event: string, error: unknown): string;
}

export interface JobContext {
  /** The service-role client. It bypasses RLS, so a job that reads tenant
   *  rows scopes every query by org itself. */
  db: SupabaseClient<Database>;
  /** The request time, and the job's only clock. */
  now: Date;
  /** The slot this run holds, from `JobDefinition.runKey`. */
  runKey: string;
  log: JobLogger;
}

export interface JobDefinition {
  /** The /api/jobs/<name> path segment, matching `JOB_NAME_RE`. */
  name: string;
  /** The run slot for a request time. Defaults to `utcDayKey` (one run per UTC
   *  day). Must match `RUN_KEY_RE`. */
  runKey?: (now: Date) => string;
  run: (ctx: JobContext) => Promise<JobCounts>;
}

/** Every job the cron route can run, by name. */
export type JobRegistry = ReadonlyMap<string, JobDefinition>;
