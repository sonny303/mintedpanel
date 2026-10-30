import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import type { ApiEnvelope } from "./envelope";

// MINT-30 / SEC-03 at the /api boundary. Only auth and the access-context
// service are stubbed: the provider route, provider service and
// translateDbError run for real, so an untranslated CHECK failure travels the
// same path as in production, all the way to toErrorResponse.
vi.mock("./guard", async () => {
  const actual = await vi.importActual<typeof import("./guard")>("./guard");
  return { ...actual, authenticate: vi.fn(), authenticateUser: vi.fn() };
});
vi.mock("@/services/clientAccess", async () => {
  const actual =
    await vi.importActual<typeof import("@/services/clientAccess")>("@/services/clientAccess");
  return { ...actual, resolveEnrollmentContext: vi.fn() };
});

import { authenticate, authenticateUser } from "./guard";
import { resolveEnrollmentContext } from "@/services/clientAccess";
import { handleApiRequest } from "./api";
import { REQUEST_ID_HEADER } from "./safeLog";

const SENTINELS = ["1961-04-12", "742 Evergreen Terrace", "AB1234563"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// supabase-js hands back a PostgREST failure as a plain object. Every text
// field carries the sentinels; only `code` and the constraint name are safe.
const PG_CHECK_ERROR = {
  code: "23514",
  message:
    'new row for relation "providers" violates check constraint "providers_status_check" (DOB 1961-04-12, DEA AB1234563)',
  details:
    "Failing row contains (p1, org-1, Jane, Doe, 1961-04-12, 742 Evergreen Terrace, AB1234563, bogus).",
  hint: "Check 742 Evergreen Terrace / AB1234563 / 1961-04-12",
};

// A query-builder double: any chain (from().insert().select().single(), …)
// resolves to the PostgREST failure when awaited.
function failingDb(error: unknown): unknown {
  const chain: unknown = new Proxy(function () {}, {
    get: (_target, prop) =>
      prop === "then"
        ? (resolve: (value: unknown) => void) => resolve({ data: null, error })
        : chain,
    apply: () => chain,
  });
  return chain;
}

let consoleSpies: Array<MockInstance<(...args: unknown[]) => void>>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEV", false);
  consoleSpies = (["error", "warn", "info", "log", "debug"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
  vi.mocked(authenticate).mockResolvedValue({
    userId: "u1",
    orgId: "org-1",
    role: "admin",
    db: failingDb(PG_CHECK_ERROR),
    writeAudit: vi.fn(),
  } as never);
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const spy of consoleSpies) spy.mockRestore();
});

function consoleOutput(): string {
  return consoleSpies
    .flatMap((spy) => spy.mock.calls)
    .map((args) =>
      args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
    )
    .join("\n");
}

async function expectSafeFailure(res: Response, error: string): Promise<string> {
  expect(res.status).toBe(500);
  const raw = await res.text();
  expect(JSON.parse(raw) as ApiEnvelope<unknown>).toEqual({ data: null, error, meta: null });
  const requestId = res.headers.get(REQUEST_ID_HEADER) ?? "";
  expect(requestId).toMatch(UUID_RE);
  const output = consoleOutput();
  expect(output).toContain(`"requestId":"${requestId}"`);
  for (const sentinel of SENTINELS) {
    expect(raw).not.toContain(sentinel);
    expect(output).not.toContain(sentinel);
  }
  return output;
}

describe("SEC-03: a provider CHECK violation through /api", () => {
  it("POST /api/providers logs identifiers only and returns a stable 500", async () => {
    const res = await handleApiRequest(
      new Request("https://x.test/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: "Jane",
          lastName: "Doe",
          dateOfBirth: "1961-04-12",
          homeStreet: "742 Evergreen Terrace",
          deaNumber: "AB1234563",
          status: "bogus",
        }),
      }),
    );
    const output = await expectSafeFailure(res, "Internal server error");
    expect(output).toContain('"method":"POST","route":"/api/providers"');
    expect(output).toContain('"sqlstate":"23514","constraint":"providers_status_check"');
  });

  it("collapses a sentinel in the path to :param", async () => {
    const res = await handleApiRequest(
      new Request("https://x.test/api/providers/AB1234563?dob=1961-04-12"),
    );
    const output = await expectSafeFailure(res, "Internal server error");
    expect(output).toContain('"method":"GET","route":"/api/providers/:param"');
  });

  it("a client-access RPC failure is logged the same way", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({ userId: "u1" } as never);
    vi.mocked(resolveEnrollmentContext).mockRejectedValue(PG_CHECK_ERROR);
    const res = await handleApiRequest(new Request("https://x.test/api/me/access-context"));
    const output = await expectSafeFailure(res, "Access request failed");
    expect(output).toContain("[client-access] RPC failure");
    expect(output).toContain('"route":"/api/me/access-context"');
  });
});
