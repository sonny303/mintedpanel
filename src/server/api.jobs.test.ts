import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { JobContext, JobCounts } from "./jobs/types";

// MINT-106 dispatch: /api/jobs/* is served from the cron-secret route before
// the CORS preflight and every user-JWT guard, and no other route accepts the
// cron secret in place of a JWT.
const hoisted = vi.hoisted(() => ({
  run: undefined as unknown as ReturnType<typeof vi.fn<(ctx: JobContext) => Promise<JobCounts>>>,
  db: undefined as unknown,
}));

vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));
vi.mock("./guard", async () => {
  const actual = await vi.importActual<typeof import("./guard")>("./guard");
  return { ...actual, authenticate: vi.fn(), authenticateUser: vi.fn() };
});
vi.mock("@/services/clientAccess", async () => {
  const actual =
    await vi.importActual<typeof import("@/services/clientAccess")>("@/services/clientAccess");
  return { ...actual, resolveEnrollmentContext: vi.fn() };
});
vi.mock("./serviceClient", async () => {
  const actual = await vi.importActual<typeof import("./serviceClient")>("./serviceClient");
  return { ...actual, getServiceClient: vi.fn(() => hoisted.db) };
});
vi.mock("./jobs/registry", async () => {
  const actual = await vi.importActual<typeof import("./jobs/registry")>("./jobs/registry");
  return {
    ...actual,
    JOB_REGISTRY: actual.createJobRegistry([
      { name: "test-job", run: (ctx: JobContext) => hoisted.run(ctx) },
    ]),
  };
});

import { createFakeJobDb, type FakeJobDb } from "@/__fixtures__/jobRunsFakeDb";
import { resolveEnrollmentContext } from "@/services/clientAccess";
import { handleApiRequest } from "./api";
import { authenticate, authenticateUser, GuardError } from "./guard";

const SECRET = "cron-secret-0123456789abcdef";
const ORIGIN = "chrome-extension://dppfnbikpojpgdiobckgcknmkjlfoinh";

let fake: FakeJobDb;
let consoleError: MockInstance<(...args: unknown[]) => void>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEV", false);
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("API_CORS_ORIGINS", ORIGIN);
  fake = createFakeJobDb(Date.now());
  hoisted.db = fake.db;
  hoisted.run = vi.fn(async () => ({ sent: 3 }));
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(authenticateUser).mockRejectedValue(new GuardError(401, "Invalid or expired token"));
  vi.mocked(authenticate).mockRejectedValue(new GuardError(401, "Invalid or expired token"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  consoleError.mockRestore();
});

function request(path: string, init: { method?: string; authorization?: string } = {}) {
  const headers = new Headers({ origin: ORIGIN });
  if (init.authorization !== undefined) headers.set("authorization", init.authorization);
  return new Request(`https://x.test${path}`, { method: init.method ?? "GET", headers });
}

function corsHeaders(res: Response): string[] {
  return [...res.headers.keys()].filter((key) => key.startsWith("access-control-"));
}

function expectNoUserGuard() {
  expect(authenticateUser).not.toHaveBeenCalled();
  expect(authenticate).not.toHaveBeenCalled();
  expect(resolveEnrollmentContext).not.toHaveBeenCalled();
}

describe("/api/jobs dispatch", () => {
  it("runs a job on the cron secret without invoking the user-JWT guard", async () => {
    const res = await handleApiRequest(
      request("/api/jobs/test-job", { authorization: `Bearer ${SECRET}` }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      job: "test-job",
      outcome: "succeeded",
      counts: { sent: 3 },
    });
    expect(hoisted.run).toHaveBeenCalledOnce();
    expectNoUserGuard();
    expect(corsHeaders(res)).toEqual([]);
  });

  it("401s a wrong bearer without sending it to the user guard", async () => {
    const res = await handleApiRequest(
      request("/api/jobs/test-job", { authorization: "Bearer a-user-jwt" }),
    );
    expect(res.status).toBe(401);
    expect(hoisted.run).not.toHaveBeenCalled();
    expectNoUserGuard();
    expect(corsHeaders(res)).toEqual([]);
  });

  it("404s an unknown job only once authenticated, still without the user guard", async () => {
    const unauthenticated = await handleApiRequest(request("/api/jobs/no-such-job"));
    expect(unauthenticated.status).toBe(401);
    const authenticated = await handleApiRequest(
      request("/api/jobs/no-such-job", { authorization: `Bearer ${SECRET}` }),
    );
    expect(authenticated.status).toBe(404);
    expectNoUserGuard();
  });

  it("503s when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    const res = await handleApiRequest(request("/api/jobs/test-job", { authorization: "Bearer " }));
    expect(res.status).toBe(503);
    expect(hoisted.run).not.toHaveBeenCalled();
    expectNoUserGuard();
  });

  it("405s a non-GET, including a CORS preflight, with no CORS headers", async () => {
    for (const method of ["OPTIONS", "POST"]) {
      const res = await handleApiRequest(
        request("/api/jobs/test-job", { method, authorization: `Bearer ${SECRET}` }),
      );
      expect(res.status).toBe(405);
      expect(corsHeaders(res)).toEqual([]);
    }
    expect(hoisted.run).not.toHaveBeenCalled();
    expectNoUserGuard();
  });
});

describe("other routes keep their guards", () => {
  it("still answers the preflight for an allowlisted origin elsewhere", async () => {
    const res = await handleApiRequest(request("/api/providers", { method: "OPTIONS" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("does not accept the cron secret as a user token", async () => {
    const res = await handleApiRequest(
      request("/api/providers", { authorization: `Bearer ${SECRET}` }),
    );
    expect(res.status).toBe(401);
    expect(authenticate).toHaveBeenCalled();
    expect(hoisted.run).not.toHaveBeenCalled();
  });

  it("treats /api/jobsx as an ordinary path, not the jobs route", async () => {
    const res = await handleApiRequest(
      request("/api/jobsx/test-job", { authorization: `Bearer ${SECRET}` }),
    );
    expect(res.status).toBe(404);
    expect(authenticateUser).toHaveBeenCalled();
    expect(hoisted.run).not.toHaveBeenCalled();
  });

  it("keeps /api/health public", async () => {
    const res = await handleApiRequest(request("/api/health"));
    expect(res.status).toBe(200);
    expectNoUserGuard();
  });
});
