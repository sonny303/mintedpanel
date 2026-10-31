// What a job may report (MINT-106): integer tallies under snake_case keys,
// nothing else. The counts land in public.job_runs and in the cron response,
// so this check is what keeps row data out of both. finish_job_run repeats it
// in SQL.
import type { JobCounts } from "./types";

// Mirrored in finish_job_run (supabase/migrations/20261031120000_job_runs.sql).
// A key starts with a letter, which also rules out `__proto__`.
export const JOB_COUNT_KEY_RE = /^[a-z][a-z_]{0,39}$/;
export const MAX_JOB_COUNT_KEYS = 32;

/** A fresh copy of `value` when it is a plain object of at most 32 snake_case
 *  keys mapped to non-negative safe integers; otherwise null. Getters,
 *  symbols, arrays, class instances and non-enumerable keys are refused. */
export function validateJobCounts(value: unknown): JobCounts | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const keys = Object.getOwnPropertyNames(value);
  if (keys.length > MAX_JOB_COUNT_KEYS) return null;
  const counts: Record<string, number> = {};
  for (const key of keys) {
    if (!JOB_COUNT_KEY_RE.test(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
    const count: unknown = descriptor.value;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return null;
    counts[key] = count;
  }
  return counts;
}
