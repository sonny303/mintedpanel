// GET /api/jobs/<name>: the Vercel cron entry point (MINT-106).
//
// Vercel cron sends `Authorization: Bearer <CRON_SECRET>` when the project has
// CRON_SECRET set. There is no user, so api.ts dispatches here before the CORS
// preflight and every JWT guard, and the cron bearer never reaches Supabase
// Auth. Nothing here is browser-callable, so no CORS headers are set.
//
// Order of checks, each before any database work:
//   1. a method other than GET           -> 405 (says nothing about job names)
//   2. CRON_SECRET unset or too short    -> 503 (misconfiguration is a server
//      fault, never a 401; see CLAUDE.md locked decision 4)
//   3. a missing or wrong bearer         -> 401
//   4. a job name not in the registry    -> 404 (only now, so an unauthenticated
//      caller cannot enumerate job names)
// A run answers the standard envelope with `data: { job, runKey, outcome,
// counts }`: 200 for succeeded or skipped, 500 for failed (with the log
// line's `x-request-id`). Refusals are the usual `fail()` envelope.
import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { fail, ok } from "../envelope";
import { logServerError, requestSite, withRequestId, type ErrorLogSite } from "../safeLog";
import { getServiceClient } from "../serviceClient";
import { supabaseJobLedger } from "./ledger";
import { JOB_REGISTRY } from "./registry";
import { runJob } from "./runner";
import type { JobRegistry } from "./types";

/** Vercel's own guidance for CRON_SECRET: a random string of at least 16
 *  characters. A shorter one is treated as unset. */
export const MIN_CRON_SECRET_LENGTH = 16;

const JOB_PATH_RE = /^\/api\/jobs\/([^/]+)\/?$/;

export interface JobRouteDeps {
  registry: JobRegistry;
  getDb: () => SupabaseClient<Database>;
  now: () => Date;
  cronSecret: () => string | undefined;
}

const defaultDeps: JobRouteDeps = {
  registry: JOB_REGISTRY,
  getDb: getServiceClient,
  now: () => new Date(),
  cronSecret: () => process.env.CRON_SECRET,
};

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time check of the Authorization header against
 *  `Bearer <secret>`. Both sides are hashed first, so the comparison is always
 *  32 bytes against 32 bytes and leaks neither the secret nor its length. */
export function isCronAuthorized(header: string | null, secret: string): boolean {
  if (header === null) return false;
  const provided = sha256(header);
  const expected = sha256(`Bearer ${secret}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function noStore(response: Response): Response {
  response.headers.set("cache-control", "no-store");
  return response;
}

function refuse(status: number, message: string): Response {
  return noStore(fail(status, message));
}

export async function handleJobRequest(
  request: Request,
  overrides: Partial<JobRouteDeps> = {},
): Promise<Response> {
  const deps: JobRouteDeps = {
    registry: overrides.registry ?? defaultDeps.registry,
    getDb: overrides.getDb ?? defaultDeps.getDb,
    now: overrides.now ?? defaultDeps.now,
    cronSecret: overrides.cronSecret ?? defaultDeps.cronSecret,
  };
  let site: ErrorLogSite = requestSite(request);
  try {
    if (request.method.toUpperCase() !== "GET") {
      const response = refuse(405, "Method not allowed");
      response.headers.set("allow", "GET");
      return response;
    }

    const secret = deps.cronSecret();
    if (!secret || secret.length < MIN_CRON_SECRET_LENGTH) {
      return refuse(503, "Scheduled jobs are not configured");
    }
    if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
      return refuse(401, "Unauthorized");
    }

    const name = JOB_PATH_RE.exec(new URL(request.url).pathname)?.[1];
    const job = name === undefined ? undefined : deps.registry.get(name);
    if (!job) return refuse(404, "Not found");

    // A registered name is code, not caller input, so the log can carry it.
    site = { method: "GET", route: `/api/jobs/${job.name}` };
    const db = deps.getDb();
    const result = await runJob(job, { ledger: supabaseJobLedger(db), db, now: deps.now(), site });
    const data = {
      job: result.job,
      runKey: result.runKey,
      outcome: result.outcome,
      counts: result.counts,
    };
    const response = noStore(ok(data, null, result.outcome === "failed" ? 500 : 200));
    return result.requestId ? withRequestId(response, result.requestId) : response;
  } catch (error) {
    const requestId = logServerError("[jobs] internal error", error, site);
    return withRequestId(refuse(500, "Internal server error"), requestId);
  }
}
