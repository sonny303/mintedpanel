// Runs one scheduled job against the job_runs ledger (MINT-106).
//
// claim -> run -> finish. A null claim means the slot is running or already
// succeeded, so the call is `skipped` and writes nothing: the existing row
// already describes the run. A throw or a malformed result is recorded as
// `failed` with a closed error code, and logged as allowlisted identifiers
// only (../safeLog.ts). The job's error text never reaches the ledger, the
// log or the response.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { logServerError, type ErrorLogSite } from "../safeLog";
import { validateJobCounts } from "./counts";
import type { JobLedger } from "./ledger";
import { RUN_KEY_RE, utcDayKey } from "./registry";
import type { JobCounts, JobDefinition, JobLogger, JobOutcome } from "./types";

const LOG_EVENT_RE = /^[a-z][a-z0-9_]{0,62}$/;

// Thrown values whose class name is the whole log line's explanation.
export class InvalidRunKeyError extends Error {
  override name = "InvalidRunKeyError";
}
export class InvalidJobCountsError extends Error {
  override name = "InvalidJobCountsError";
}
export class JobRunFinishLostError extends Error {
  override name = "JobRunFinishLostError";
}

export interface RunJobDeps {
  ledger: JobLedger;
  db: SupabaseClient<Database>;
  now: Date;
  /** The method and route the run's log lines name. */
  site: ErrorLogSite;
}

export interface JobRunResult {
  job: string;
  runKey: string;
  outcome: JobOutcome;
  counts: JobCounts;
  /** Set on `failed`: the correlation id of the run's log line. */
  requestId?: string;
}

/** The logger a job receives: `[jobs:<name>] <event>` lines through
 *  logServerError. An event that is not a snake_case literal is replaced, so
 *  a job cannot put data in the scope by mistake. */
export function jobLogger(jobName: string, site: ErrorLogSite): JobLogger {
  return {
    error(event, error) {
      const safeEvent = LOG_EVENT_RE.test(event) ? event : "invalid_event";
      return logServerError(`[jobs:${jobName}] ${safeEvent}`, error, site);
    },
  };
}

export async function runJob(job: JobDefinition, deps: RunJobDeps): Promise<JobRunResult> {
  const runKey = (job.runKey ?? utcDayKey)(new Date(deps.now.getTime()));
  if (!RUN_KEY_RE.test(runKey)) throw new InvalidRunKeyError("Run key must match RUN_KEY_RE");

  const runId = await deps.ledger.claim(job.name, runKey);
  if (runId === null) return { job: job.name, runKey, outcome: "skipped", counts: {} };

  const log = jobLogger(job.name, deps.site);
  const failed = async (
    errorCode: "job_error" | "invalid_counts",
    error: unknown,
  ): Promise<JobRunResult> => {
    const requestId = log.error(errorCode === "job_error" ? "run_failed" : errorCode, error);
    await deps.ledger.finish(runId, { outcome: "failed", counts: {}, errorCode });
    return { job: job.name, runKey, outcome: "failed", counts: {}, requestId };
  };

  let raw: unknown;
  try {
    raw = await job.run({ db: deps.db, now: new Date(deps.now.getTime()), runKey, log });
  } catch (error) {
    return failed("job_error", error);
  }

  const counts = validateJobCounts(raw, job.countKeys);
  if (!counts) return failed("invalid_counts", new InvalidJobCountsError());

  const recorded = await deps.ledger.finish(runId, {
    outcome: "succeeded",
    counts,
    errorCode: null,
  });
  // The work is done; only the ledger row was lost to a stale reclaim. Report
  // what happened and leave a line for the operator.
  if (!recorded) log.error("finish_lost", new JobRunFinishLostError());
  return { job: job.name, runKey, outcome: "succeeded", counts };
}
