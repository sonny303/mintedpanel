// The scheduled-job registry (MINT-106). A job ships by adding its definition
// to JOB_REGISTRY below and a `crons` entry for /api/jobs/<name> to
// vercel.json. The route takes the registry as a dependency, so tests run
// their own.
import { JOB_COUNT_KEY_RE, MAX_JOB_COUNT_KEYS } from "./counts";
import { followupDigestJob } from "./followupDigest";
import type { JobDefinition, JobRegistry } from "./types";

// Mirrored by job_runs_job_check and job_runs_run_key_check in
// supabase/migrations/20261031050000_job_runs.sql.
export const JOB_NAME_RE = /^[a-z][a-z0-9-]{0,47}$/;
export const RUN_KEY_RE = /^[0-9A-Za-z:_-]{1,64}$/;

export function createJobRegistry(jobs: readonly JobDefinition[]): JobRegistry {
  const registry = new Map<string, JobDefinition>();
  for (const job of jobs) {
    if (!JOB_NAME_RE.test(job.name)) throw new Error("Job name must match JOB_NAME_RE");
    if (registry.has(job.name)) throw new Error("Job names must be unique");
    const keys = job.countKeys;
    if (
      keys.length > MAX_JOB_COUNT_KEYS ||
      new Set(keys).size !== keys.length ||
      !keys.every((key) => JOB_COUNT_KEY_RE.test(key))
    ) {
      throw new Error("Job count keys must be unique, at most 32, and match JOB_COUNT_KEY_RE");
    }
    registry.set(job.name, job);
  }
  return registry;
}

/** The UTC calendar day of `now`, `YYYY-MM-DD`: the default run key, so a
 *  daily job runs once per UTC day however often cron calls it. */
export function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The jobs /api/jobs/<name> serves. Each has a vercel.json cron
 *  (src/server/jobs/crons.test.ts pins both directions). */
export const JOB_REGISTRY: JobRegistry = createJobRegistry([followupDigestJob]);
