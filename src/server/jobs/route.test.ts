import { format } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// Wrap the real timingSafeEqual so the test can see the secret comparison
// goes through it; behavior is unchanged.
vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

import { timingSafeEqual } from "node:crypto";
import { createFakeJobDb, type FakeJobDb } from "@/__fixtures__/jobRunsFakeDb";
import { REQUEST_ID_HEADER } from "../safeLog";
import { validateJobCounts } from "./counts";
import { createJobRegistry } from "./registry";
import { handleJobRequest, isCronAuthorized, type JobRouteDeps } from "./route";
import type { JobContext, JobCounts } from "./types";

// MINT-106 GET /api/jobs/<name>: cron-secret auth, method and name handling,
// the response shape, and SEC-03 sentinels for a job that throws.
const SECRET = "cron-secret-0123456789abcdef";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LEVELS = ["error", "warn", "info", "log", "debug"] as const;

let fake: FakeJobDb;
let getDb: ReturnType<typeof vi.fn<() => FakeJobDb["db"]>>;
let digestRun: ReturnType<typeof vi.fn<(ctx: JobContext) => Promise<JobCounts>>>;
let spies: Array<MockInstance<(...args: unknown[]) => void>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEV", false);
  fake = createFakeJobDb();
  getDb = vi.fn(() => fake.db);
  digestRun = vi.fn(async () => ({ orgs: 2, sent: 2 }));
  spies = LEVELS.map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const spy of spies) spy.mockRestore();
});

function deps(overrides: Partial<JobRouteDeps> = {}): Partial<JobRouteDeps> {
  return {
    registry: createJobRegistry([
      { name: "daily-digest", countKeys: ["orgs", "sent"], run: digestRun },
    ]),
    getDb,
    now: () => new Date(fake.clock.now),
    cronSecret: () => SECRET,
    ...overrides,
  };
}

function call(
  path: string,
  init: { method?: string; authorization?: string | null; origin?: string } = {},
  overrides: Partial<JobRouteDeps> = {},
) {
  const headers = new Headers();
  const authorization = init.authorization === undefined ? `Bearer ${SECRET}` : init.authorization;
  if (authorization !== null) headers.set("authorization", authorization);
  if (init.origin) headers.set("origin", init.origin);
  return handleJobRequest(
    new Request(`https://x.test${path}`, { method: init.method ?? "GET", headers }),
    deps(overrides),
  );
}

function logged(): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => format(...args))
    .join("\n");
}

async function expectRefusal(res: Response, status: number, error: string) {
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ data: null, error, meta: null });
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(digestRun).not.toHaveBeenCalled();
  expect(getDb).not.toHaveBeenCalled();
  expect(fake.calls).toEqual([]);
}

describe("GET /api/jobs/<name>: the cron secret", () => {
  it("runs the job for the exact Vercel cron header", async () => {
    const res = await call("/api/jobs/daily-digest");
    expect(res.status).toBe(200);
    expect(digestRun).toHaveBeenCalledOnce();
    expect(timingSafeEqual).toHaveBeenCalled();
  });

  it("401s a missing Authorization header", async () => {
    await expectRefusal(
      await call("/api/jobs/daily-digest", { authorization: null }),
      401,
      "Unauthorized",
    );
  });

  it.each([
    ["a wrong secret", "Bearer not-the-cron-secret-000000"],
    ["a prefix of the secret", `Bearer ${SECRET.slice(0, -1)}`],
    ["the secret plus a suffix", `Bearer ${SECRET}x`],
    ["the bare secret", SECRET],
    ["a lowercase scheme", `bearer ${SECRET}`],
    ["a Basic scheme", `Basic ${SECRET}`],
    ["an empty bearer", "Bearer "],
    ["a user JWT", "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.sig"],
  ])("401s %s", async (_label, authorization) => {
    await expectRefusal(
      await call("/api/jobs/daily-digest", { authorization }),
      401,
      "Unauthorized",
    );
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["shorter than 16 characters", "short-secret"],
  ])("503s every call when CRON_SECRET is %s", async (_label, secret) => {
    for (const authorization of [null, "Bearer ", `Bearer ${secret ?? ""}`, `Bearer ${SECRET}`]) {
      const res = await call(
        "/api/jobs/daily-digest",
        { authorization },
        { cronSecret: () => secret },
      );
      await expectRefusal(res, 503, "Scheduled jobs are not configured");
    }
  });

  it("reads CRON_SECRET from the environment by default", async () => {
    const { cronSecret: _unused, ...withoutSecret } = deps();
    const request = () =>
      new Request("https://x.test/api/jobs/daily-digest", {
        headers: { authorization: `Bearer ${SECRET}` },
      });
    vi.stubEnv("CRON_SECRET", "");
    expect((await handleJobRequest(request(), withoutSecret)).status).toBe(503);
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await handleJobRequest(request(), withoutSecret)).status).toBe(200);
  });

  it("compares in constant time over equal-length digests", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isCronAuthorized(`Bearer ${SECRET}`, `${SECRET}0`)).toBe(false);
    expect(isCronAuthorized("Bearer x", SECRET)).toBe(false);
    expect(isCronAuthorized(null, SECRET)).toBe(false);
    for (const [a, b] of vi.mocked(timingSafeEqual).mock.calls) {
      expect((a as Buffer).length).toBe(32);
      expect((b as Buffer).length).toBe(32);
    }
  });
});

describe("GET /api/jobs/<name>: methods and names", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])(
    "405s %s with Allow: GET, before anything else",
    async (method) => {
      const res = await call("/api/jobs/daily-digest", { method });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET");
      expect(digestRun).not.toHaveBeenCalled();
      expect(getDb).not.toHaveBeenCalled();
    },
  );

  it("answers an unknown job and a known job the same way until the caller is authenticated", async () => {
    for (const path of ["/api/jobs/daily-digest", "/api/jobs/no-such-job", "/api/jobs"]) {
      const res = await call(path, { authorization: "Bearer wrong" });
      expect(res.status).toBe(401);
      expect(await res.text()).toBe('{"data":null,"error":"Unauthorized","meta":null}');
    }
  });

  it.each(["/api/jobs/no-such-job", "/api/jobs", "/api/jobs/", "/api/jobs/daily-digest/extra"])(
    "404s %s once authenticated",
    async (path) => {
      await expectRefusal(await call(path), 404, "Not found");
    },
  );

  it("accepts a trailing slash on a known job", async () => {
    expect((await call("/api/jobs/daily-digest/")).status).toBe(200);
  });
});

describe("GET /api/jobs/<name>: the response", () => {
  it("returns { job, runKey, outcome, counts } in the envelope, with no-store and no CORS", async () => {
    vi.stubEnv("API_CORS_ORIGINS", "chrome-extension://abc");
    const res = await call("/api/jobs/daily-digest", { origin: "chrome-extension://abc" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        job: "daily-digest",
        runKey: "2026-10-30",
        outcome: "succeeded",
        counts: { orgs: 2, sent: 2 },
      },
      error: null,
      meta: null,
    });
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect([...res.headers.keys()].filter((key) => key.startsWith("access-control-"))).toEqual([]);
    expect(res.headers.get(REQUEST_ID_HEADER)).toBeNull();
  });

  it("returns 200 skipped with empty counts on a second call the same day", async () => {
    await call("/api/jobs/daily-digest");
    const res = await call("/api/jobs/daily-digest");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { job: "daily-digest", runKey: "2026-10-30", outcome: "skipped", counts: {} },
      error: null,
      meta: null,
    });
    expect(digestRun).toHaveBeenCalledOnce();
    expect(fake.rows).toHaveLength(1);
  });

  it("returns 500 failed with the log line's request id when the job throws", async () => {
    digestRun.mockRejectedValue(new Error("boom"));
    const res = await call("/api/jobs/daily-digest");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      data: { job: "daily-digest", runKey: "2026-10-30", outcome: "failed", counts: {} },
      error: null,
      meta: null,
    });
    const requestId = res.headers.get(REQUEST_ID_HEADER) ?? "";
    expect(requestId).toMatch(UUID_RE);
    expect(logged()).toContain(`"requestId":"${requestId}"`);
    expect(logged()).toContain('"method":"GET","route":"/api/jobs/daily-digest"');
  });

  it("returns a generic 500 when the ledger itself fails", async () => {
    fake.failNext.claim_job_run = { code: "08006", message: "connection failure" };
    const res = await call("/api/jobs/daily-digest");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ data: null, error: "Internal server error", meta: null });
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID_RE);
    expect(logged()).toContain("[jobs] internal error");
    expect(logged()).toContain('"sqlstate":"08006"');
    expect(digestRun).not.toHaveBeenCalled();
  });

  it("returns a generic 500 when the service client cannot be built", async () => {
    const res = await call(
      "/api/jobs/daily-digest",
      {},
      {
        getDb: () => {
          throw new Error("Server Supabase not configured");
        },
      },
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ data: null, error: "Internal server error", meta: null });
  });
});

// SEC-03 sentinels: a DOB, a full SSN and a home address. None may reach the
// log, the response or the ledger, whatever shape the job's failure takes.
describe("GET /api/jobs/<name>: a failing job leaks nothing", () => {
  const SENTINELS = ["1961-04-12", "078-05-1120", "078051120", "742 Evergreen Terrace"];
  const PG_ERROR = {
    code: "23514",
    message:
      'new row for relation "providers" violates check constraint "providers_status_check" (DOB 1961-04-12, SSN 078-05-1120)',
    details: "Failing row contains (p1, Jane, Doe, 1961-04-12, 078051120, 742 Evergreen Terrace).",
    hint: "742 Evergreen Terrace",
  };

  async function expectNoLeak(res: Response) {
    const raw = await res.text();
    const headers = JSON.stringify([...res.headers.entries()]);
    const output = logged();
    const ledger = JSON.stringify(fake.rows);
    for (const sentinel of [...SENTINELS, SECRET]) {
      expect(raw).not.toContain(sentinel);
      expect(headers).not.toContain(sentinel);
      expect(output).not.toContain(sentinel);
      expect(ledger).not.toContain(sentinel);
    }
    return { raw, output };
  }

  it("an Error whose message carries the sentinels", async () => {
    digestRun.mockRejectedValue(
      new Error("digest for Jane Doe DOB 1961-04-12 SSN 078-05-1120 at 742 Evergreen Terrace"),
    );
    const res = await call("/api/jobs/daily-digest");
    expect(res.status).toBe(500);
    const { output } = await expectNoLeak(res);
    expect(output).toContain('"errorClass":"Error"');
    expect(fake.rows).toEqual([
      expect.objectContaining({ outcome: "failed", error_code: "job_error", counts: {} }),
    ]);
  });

  it("a PostgREST error object with the row in details", async () => {
    digestRun.mockRejectedValue(PG_ERROR);
    const { output } = await expectNoLeak(await call("/api/jobs/daily-digest"));
    expect(output).toContain('"sqlstate":"23514","constraint":"providers_status_check"');
  });

  it("a thrown string", async () => {
    digestRun.mockRejectedValue("SSN 078-05-1120 DOB 1961-04-12");
    const { output } = await expectNoLeak(await call("/api/jobs/daily-digest"));
    expect(output).toContain('"errorClass":"string"');
  });

  it("a job that logs data through ctx.log, then throws", async () => {
    digestRun.mockImplementation(async (ctx) => {
      ctx.log.error("send failed for 742 Evergreen Terrace 1961-04-12", PG_ERROR);
      throw PG_ERROR;
    });
    const { output } = await expectNoLeak(await call("/api/jobs/daily-digest"));
    expect(output).toContain("[jobs:daily-digest] invalid_event");
  });

  // A well-formed key: it passes the shape rule, so only the job's declared
  // countKeys can refuse it. This is the case the declaration exists for.
  it("a job that reports a name and a DOB as a well-formed, undeclared count", async () => {
    const counts = { jane_doe: 19610412 };
    expect(validateJobCounts(counts, ["jane_doe"])).toEqual(counts);
    expect(validateJobCounts(counts, ["orgs", "sent"])).toBeNull();
    digestRun.mockResolvedValue(counts);
    const res = await call("/api/jobs/daily-digest");
    expect(res.status).toBe(500);
    const { raw, output } = await expectNoLeak(res);
    for (const text of [raw, output, JSON.stringify(fake.rows)]) {
      expect(text).not.toContain("19610412");
      expect(text).not.toContain("jane_doe");
    }
    expect(fake.rows[0]).toMatchObject({ error_code: "invalid_counts", counts: {} });
  });

  it("a job that returns free text as a count key", async () => {
    digestRun.mockResolvedValue({ ["742 Evergreen Terrace"]: 1 } as JobCounts);
    const res = await call("/api/jobs/daily-digest");
    expect(res.status).toBe(500);
    await expectNoLeak(res);
    expect(fake.rows[0]).toMatchObject({ error_code: "invalid_counts", counts: {} });
  });
});
