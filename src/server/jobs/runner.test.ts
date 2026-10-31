import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createFakeJobDb, type FakeJobDb } from "@/__fixtures__/jobRunsFakeDb";
import { validateJobCounts } from "./counts";
import { JOB_STALE_AFTER_MINUTES, supabaseJobLedger } from "./ledger";
import { createJobRegistry, JOB_REGISTRY, utcDayKey } from "./registry";
import { jobLogger, runJob } from "./runner";
import type { JobContext, JobCounts, JobDefinition } from "./types";

// MINT-106 runner against a fake job_runs: claim, skip while running or after
// success, retry after failure, and stale-running recovery.
const SITE = { method: "GET", route: "/api/jobs/test-job" };
const COUNT_KEYS = ["orgs", "sent"] as const;
const MINUTE = 60_000;

let fake: FakeJobDb;
let consoleError: MockInstance<(...args: unknown[]) => void>;
beforeEach(() => {
  vi.stubEnv("DEV", false);
  fake = createFakeJobDb();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  consoleError.mockRestore();
});

function testJob(
  run: (ctx: JobContext) => Promise<JobCounts>,
  extra: Partial<Omit<JobDefinition, "run">> = {},
) {
  const spy = vi.fn(run);
  const job: JobDefinition = { name: "test-job", countKeys: COUNT_KEYS, ...extra, run: spy };
  return { job, spy };
}

function run(job: JobDefinition) {
  return runJob(job, {
    ledger: supabaseJobLedger(fake.db),
    db: fake.db,
    now: new Date(fake.clock.now),
    site: SITE,
  });
}

function slot(runKey = "2026-10-30") {
  return fake.rows.filter((row) => row.job === "test-job" && row.run_key === runKey);
}

describe("runJob: claim", () => {
  it("claims the slot, hands the job its context and records the counts", async () => {
    const { job, spy } = testJob(async () => ({ orgs: 3, sent: 2 }));
    const result = await run(job);
    expect(result).toEqual({
      job: "test-job",
      runKey: "2026-10-30",
      outcome: "succeeded",
      counts: { orgs: 3, sent: 2 },
    });
    const ctx = spy.mock.calls[0][0];
    expect(ctx.db).toBe(fake.db);
    expect(ctx.now.toISOString()).toBe("2026-10-30T13:00:00.000Z");
    expect(ctx.runKey).toBe("2026-10-30");
    expect(typeof ctx.log.error).toBe("function");
    expect(slot()).toEqual([
      expect.objectContaining({
        outcome: "succeeded",
        counts: { orgs: 3, sent: 2 },
        error_code: null,
        finished_at: fake.clock.now,
      }),
    ]);
    expect(fake.calls.map((call) => call.fn)).toEqual(["claim_job_run", "finish_job_run"]);
    expect(fake.calls[0].args).toEqual({ p_job: "test-job", p_run_key: "2026-10-30" });
  });

  it("keys a daily run on the UTC day, not the server's local day", () => {
    expect(utcDayKey(new Date("2026-10-30T23:30:00-07:00"))).toBe("2026-10-31");
    expect(utcDayKey(new Date("2026-10-31T00:00:00Z"))).toBe("2026-10-31");
  });

  it("uses the job's own runKey when it defines one", async () => {
    const { job } = testJob(async () => ({}), {
      runKey: (now) => `${utcDayKey(now)}T${String(now.getUTCHours()).padStart(2, "0")}`,
    });
    expect((await run(job)).runKey).toBe("2026-10-30T13");
    expect(fake.rows[0].run_key).toBe("2026-10-30T13");
  });

  it("refuses a run key the ledger would reject, before claiming", async () => {
    const { job, spy } = testJob(async () => ({}), { runKey: () => "2026 10 30" });
    await expect(run(job)).rejects.toThrow("RUN_KEY_RE");
    expect(spy).not.toHaveBeenCalled();
    expect(fake.calls).toEqual([]);
  });
});

describe("runJob: one run per (job, runKey)", () => {
  it("skips while a run is running, without running the job or writing a row", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { job, spy } = testJob(async () => {
      await gate;
      return { sent: 1 };
    });
    const first = run(job);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
    const second = await run(job);
    expect(second).toEqual({
      job: "test-job",
      runKey: "2026-10-30",
      outcome: "skipped",
      counts: {},
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(slot()).toHaveLength(1);
    release();
    expect((await first).outcome).toBe("succeeded");
    expect(slot()).toEqual([expect.objectContaining({ outcome: "succeeded" })]);
  });

  it("skips after a run succeeded", async () => {
    const { job, spy } = testJob(async () => ({ sent: 2 }));
    await run(job);
    fake.clock.now += 3 * 60 * MINUTE;
    const again = await run(job);
    expect(again.outcome).toBe("skipped");
    expect(again.counts).toEqual({});
    expect(spy).toHaveBeenCalledOnce();
    expect(slot()).toHaveLength(1);
  });

  it("runs again on the next day's key", async () => {
    const { job, spy } = testJob(async () => ({ sent: 2 }));
    await run(job);
    fake.clock.now += 24 * 60 * MINUTE;
    expect((await run(job)).runKey).toBe("2026-10-31");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("retries after a failed run, as a new row, keeping the failure on record", async () => {
    let attempt = 0;
    const { job, spy } = testJob(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("transient");
      return { sent: 4 };
    });
    const first = await run(job);
    expect(first.outcome).toBe("failed");
    expect(first.counts).toEqual({});
    const second = await run(job);
    expect(second).toEqual({
      job: "test-job",
      runKey: "2026-10-30",
      outcome: "succeeded",
      counts: { sent: 4 },
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(slot().map((row) => [row.outcome, row.error_code])).toEqual([
      ["failed", "job_error"],
      ["succeeded", null],
    ]);
  });

  it("only one of two simultaneous calls runs the job", async () => {
    const { job, spy } = testJob(async () => ({ sent: 1 }));
    const outcomes = (await Promise.all([run(job), run(job)])).map((r) => r.outcome).sort();
    expect(outcomes).toEqual(["skipped", "succeeded"]);
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("runJob: stale running rows", () => {
  function seedRunning(ageMinutes: number, runKey = "2026-10-30", job = "test-job") {
    fake.rows.push({
      id: `00000000-0000-4000-a000-${String(fake.rows.length + 1).padStart(12, "a")}`,
      job,
      run_key: runKey,
      started_at: fake.clock.now - ageMinutes * MINUTE,
      finished_at: null,
      outcome: "running",
      counts: {},
      error_code: null,
    });
  }

  it("marks a running row older than the stale timeout timed_out and runs again", async () => {
    seedRunning(JOB_STALE_AFTER_MINUTES + 1);
    const { job, spy } = testJob(async () => ({ sent: 5 }));
    const result = await run(job);
    expect(result.outcome).toBe("succeeded");
    expect(spy).toHaveBeenCalledOnce();
    expect(slot().map((row) => [row.outcome, row.error_code])).toEqual([
      ["failed", "timed_out"],
      ["succeeded", null],
    ]);
    expect(slot()[0].finished_at).toBe(fake.clock.now);
  });

  it("times out a crashed run in an earlier day's slot, which no later claim would revisit", async () => {
    seedRunning(24 * 60 + JOB_STALE_AFTER_MINUTES, "2026-10-29");
    const { job, spy } = testJob(async () => ({ sent: 5 }));
    expect((await run(job)).runKey).toBe("2026-10-30");
    expect(spy).toHaveBeenCalledOnce();
    expect(slot("2026-10-29")).toEqual([
      expect.objectContaining({
        outcome: "failed",
        error_code: "timed_out",
        finished_at: fake.clock.now,
      }),
    ]);
    expect(slot()).toEqual([expect.objectContaining({ outcome: "succeeded" })]);
  });

  it("leaves another job's stale rows, and its own young rows in other slots, alone", async () => {
    seedRunning(JOB_STALE_AFTER_MINUTES + 1, "2026-10-29", "other-job");
    seedRunning(JOB_STALE_AFTER_MINUTES - 1, "2026-10-30T12");
    const { job } = testJob(async () => ({ sent: 5 }));
    expect((await run(job)).outcome).toBe("succeeded");
    expect(
      fake.rows
        .filter((row) => row.run_key !== "2026-10-30")
        .map((row) => [row.job, row.run_key, row.outcome]),
    ).toEqual([
      ["other-job", "2026-10-29", "running"],
      ["test-job", "2026-10-30T12", "running"],
    ]);
  });

  it("leaves a running row inside the stale timeout alone and skips", async () => {
    seedRunning(JOB_STALE_AFTER_MINUTES - 1);
    const { job, spy } = testJob(async () => ({ sent: 5 }));
    expect((await run(job)).outcome).toBe("skipped");
    expect(spy).not.toHaveBeenCalled();
    expect(slot()).toEqual([expect.objectContaining({ outcome: "running", error_code: null })]);
  });

  it("exceeds the longest a Vercel function may run (800 s)", () => {
    expect(JOB_STALE_AFTER_MINUTES * 60).toBeGreaterThan(800);
  });

  it("reports a run whose row was reclaimed meanwhile, and logs the lost finish", async () => {
    const { job } = testJob(async () => {
      // A later claim after the stale timeout takes the slot mid-run.
      fake.clock.now += (JOB_STALE_AFTER_MINUTES + 1) * MINUTE;
      await supabaseJobLedger(fake.db).claim("test-job", "2026-10-30");
      return { sent: 1 };
    });
    const result = await run(job);
    expect(result.outcome).toBe("succeeded");
    expect(slot().map((row) => row.outcome)).toEqual(["failed", "running"]);
    expect(consoleError).toHaveBeenCalledOnce();
    expect(String(consoleError.mock.calls[0][0])).toBe("[jobs:test-job] finish_lost");
  });
});

describe("runJob: failures", () => {
  it("records a throw as failed / job_error with empty counts and returns the log id", async () => {
    const { job } = testJob(async () => {
      throw new Error("boom");
    });
    const result = await run(job);
    expect(result.outcome).toBe("failed");
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(slot()).toEqual([
      expect.objectContaining({ outcome: "failed", error_code: "job_error", counts: {} }),
    ]);
    expect(String(consoleError.mock.calls[0][0])).toBe("[jobs:test-job] run_failed");
    expect(String(consoleError.mock.calls[0][1])).toContain(`"requestId":"${result.requestId}"`);
  });

  it("records counts that are not JobCounts as failed / invalid_counts", async () => {
    const { job } = testJob(async () => ({ sent: 1.5 }));
    const result = await run(job);
    expect(result).toMatchObject({ outcome: "failed", counts: {} });
    expect(slot()).toEqual([
      expect.objectContaining({ outcome: "failed", error_code: "invalid_counts", counts: {} }),
    ]);
    expect(String(consoleError.mock.calls[0][1])).toContain('"errorClass":"InvalidJobCountsError"');
  });

  it("refuses a well-formed key the job did not declare, such as a name", async () => {
    // jane_doe is a valid shape; only the declaration keeps it out.
    expect(validateJobCounts({ jane_doe: 19610412 }, ["jane_doe"])).not.toBeNull();
    const { job } = testJob(async () => ({ jane_doe: 19610412 }));
    const result = await run(job);
    expect(result).toMatchObject({ outcome: "failed", counts: {} });
    expect(slot()).toEqual([
      expect.objectContaining({ outcome: "failed", error_code: "invalid_counts", counts: {} }),
    ]);
    expect(JSON.stringify(fake.rows)).not.toContain("19610412");
    expect(JSON.stringify(fake.rows)).not.toContain("jane_doe");
  });

  it("accepts a subset of the declared keys", async () => {
    const { job } = testJob(async () => ({ sent: 0 }));
    expect(await run(job)).toMatchObject({ outcome: "succeeded", counts: { sent: 0 } });
  });

  it("propagates a ledger fault on claim without running the job", async () => {
    fake.failNext.claim_job_run = { code: "08006", message: "connection failure" };
    const { job, spy } = testJob(async () => ({}));
    await expect(run(job)).rejects.toMatchObject({ code: "08006" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("validateJobCounts", () => {
  it("accepts snake_case keys mapped to non-negative safe integers, as a copy", () => {
    const input = { orgs: 3, sent_ok: 0, failed: Number.MAX_SAFE_INTEGER };
    const counts = validateJobCounts(input, ["orgs", "sent_ok", "failed", "unused"]);
    expect(counts).toEqual(input);
    expect(counts).not.toBe(input);
    expect(validateJobCounts({}, [])).toEqual({});
    expect(
      validateJobCounts(Object.assign(Object.create(null) as object, { sent: 1 }), ["sent"]),
    ).toEqual({ sent: 1 });
  });

  it("refuses a key outside the declared set", () => {
    expect(validateJobCounts({ sent: 1, orgs: 2 }, ["sent"])).toBeNull();
    expect(validateJobCounts({ sent: 1 }, [])).toBeNull();
  });

  it.each([
    ["null", null],
    ["an array", [1, 2]],
    ["a number", 3],
    ["a string", "sent"],
    ["a Map", new Map([["sent", 1]])],
    ["a class instance", new (class Counts {})()],
    ["a negative count", { sent: -1 }],
    ["a fraction", { sent: 1.5 }],
    ["NaN", { sent: Number.NaN }],
    ["Infinity", { sent: Number.POSITIVE_INFINITY }],
    ["an unsafe integer", { sent: 2 ** 53 }],
    ["a numeric string", { sent: "2" }],
    ["a nested object", { sent: { org: 1 } }],
    ["an uppercase key", { Sent: 1 }],
    ["a hyphenated key", { "sent-ok": 1 }],
    ["a key with digits (a date)", { d1961_04_12: 1 }],
    ["a key that starts with _", { _sent: 1 }],
    ["__proto__ as a key", JSON.parse('{"__proto__": 1}') as unknown],
    ["a 41-character key", { ["a".repeat(41)]: 1 }],
    ["33 keys", Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${"a".repeat(i)}`, 1]))],
    ["a symbol key", { [Symbol("sent")]: 1 }],
    ["a getter", Object.defineProperty({}, "sent", { get: () => 1, enumerable: true })],
    ["a non-enumerable key", Object.defineProperty({}, "sent", { value: 1, enumerable: false })],
  ])("refuses %s, even with every key declared", (_label, value) => {
    // Declaring the value's own keys isolates the shape rule from the
    // declaration rule.
    const declared =
      typeof value === "object" && value !== null ? Object.getOwnPropertyNames(value) : [];
    expect(validateJobCounts(value, declared)).toBeNull();
  });
});

describe("registry", () => {
  it("ships the follow-up digest (MINT-108)", () => {
    expect([...JOB_REGISTRY.keys()]).toEqual(["followup-digest"]);
  });

  const noop = async () => ({});
  const job = (name: string, countKeys: readonly string[] = ["sent"]): JobDefinition => ({
    name,
    countKeys,
    run: noop,
  });

  it("refuses a name that is not a path-safe identifier, and duplicates", () => {
    expect(() => createJobRegistry([job("Daily Digest")])).toThrow();
    expect(() => createJobRegistry([job("daily/digest")])).toThrow();
    expect(() => createJobRegistry([job("a".repeat(49))])).toThrow();
    expect(() => createJobRegistry([job("daily-digest"), job("daily-digest")])).toThrow();
    expect([...createJobRegistry([job("daily-digest")]).keys()]).toEqual(["daily-digest"]);
  });

  it("refuses count keys that are malformed, repeated or too many", () => {
    expect(() => createJobRegistry([job("daily-digest", ["Sent"])])).toThrow();
    expect(() => createJobRegistry([job("daily-digest", ["d1961_04_12"])])).toThrow();
    expect(() => createJobRegistry([job("daily-digest", ["sent", "sent"])])).toThrow();
    const many = Array.from({ length: 33 }, (_, i) => `k${"a".repeat(i)}`);
    expect(() => createJobRegistry([job("daily-digest", many)])).toThrow();
    expect(() => createJobRegistry([job("daily-digest", many.slice(0, 32))])).not.toThrow();
    expect(() => createJobRegistry([job("daily-digest", [])])).not.toThrow();
  });
});

describe("jobLogger", () => {
  it("logs a snake_case event under the job's scope and replaces anything else", () => {
    const log = jobLogger("test-job", SITE);
    log.error("org_send_failed", new Error("x"));
    log.error("send failed for 742 Evergreen Terrace", new Error("x"));
    expect(consoleError.mock.calls.map((call) => call[0])).toEqual([
      "[jobs:test-job] org_send_failed",
      "[jobs:test-job] invalid_event",
    ]);
  });
});
