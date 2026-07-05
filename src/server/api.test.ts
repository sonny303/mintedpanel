import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ApiEnvelope } from "./envelope";

// Keep the real GuardError (used for instanceof in api.ts); mock authenticate.
vi.mock("./guard", async () => {
  const actual = await vi.importActual<typeof import("./guard")>("./guard");
  return { ...actual, authenticate: vi.fn() };
});
vi.mock("./providerRoutes", () => ({
  handleListProviders: vi.fn(),
  handleGetProvider: vi.fn(),
  handleCreateProvider: vi.fn(),
  handleUpdateProvider: vi.fn(),
}));

import { authenticate, GuardError } from "./guard";
import { handleListProviders, handleGetProvider } from "./providerRoutes";
import { handleApiRequest, isApiRequest } from "./api";

const authenticateMock = vi.mocked(authenticate);
const listMock = vi.mocked(handleListProviders);
const getMock = vi.mocked(handleGetProvider);

async function body(res: Response): Promise<ApiEnvelope<unknown>> {
  return (await res.json()) as ApiEnvelope<unknown>;
}
const GET = (path: string) => new Request(`https://x.test${path}`, { method: "GET" });

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  // toErrorResponse logs internal faults server-side; silence + capture them.
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe("isApiRequest", () => {
  it("owns /api/health and /api/providers*", () => {
    expect(isApiRequest("/api/health")).toBe(true);
    expect(isApiRequest("/api/providers")).toBe(true);
    expect(isApiRequest("/api/providers/abc")).toBe(true);
    expect(isApiRequest("/cases")).toBe(false);
  });
});

describe("handleApiRequest routing", () => {
  it("GET /api/health returns 200 { data: 'ok' } without auth", async () => {
    const res = await handleApiRequest(GET("/api/health"));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ data: "ok", error: null, meta: null });
    expect(authenticateMock).not.toHaveBeenCalled();
  });

  it("POST /api/health is 405", async () => {
    const res = await handleApiRequest(
      new Request("https://x.test/api/health", { method: "POST" }),
    );
    expect(res.status).toBe(405);
  });

  it("maps a GuardError from authenticate to its status", async () => {
    authenticateMock.mockRejectedValue(new GuardError(401, "Invalid or expired token"));
    const res = await handleApiRequest(GET("/api/providers"));
    expect(res.status).toBe(401);
    expect((await body(res)).error).toBe("Invalid or expired token");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("dispatches an authenticated list request", async () => {
    authenticateMock.mockResolvedValue({ orgId: "org-1", role: "specialist" } as never);
    listMock.mockResolvedValue(
      new Response('{"data":[],"error":null,"meta":null}', { status: 200 }),
    );
    const res = await handleApiRequest(GET("/api/providers?page=1"));
    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("dispatches an authenticated detail request", async () => {
    authenticateMock.mockResolvedValue({ orgId: "org-1", role: "billing" } as never);
    getMock.mockResolvedValue(
      new Response('{"data":{},"error":null,"meta":null}', { status: 200 }),
    );
    const res = await handleApiRequest(GET("/api/providers/p1"));
    expect(res.status).toBe(200);
    expect(getMock).toHaveBeenCalledWith("p1", expect.anything());
  });

  it("unknown method on a provider collection is 405", async () => {
    authenticateMock.mockResolvedValue({ orgId: "org-1", role: "admin" } as never);
    const res = await handleApiRequest(
      new Request("https://x.test/api/providers", { method: "DELETE" }),
    );
    expect(res.status).toBe(405);
  });
});

describe("handleApiRequest error handling — 500 for internal faults, no mask, no leak", () => {
  it("a non-GuardError from authenticate returns 500, not 401", async () => {
    // The real-world case: getServiceClient() throws on a missing
    // SUPABASE_SERVICE_ROLE_KEY. That must surface as a server fault, not a 401.
    authenticateMock.mockRejectedValue(new Error("supabaseKey is required."));
    const res = await handleApiRequest(GET("/api/providers"));
    expect(res.status).toBe(500);
    const b = await body(res);
    expect(b.error).toBe("Internal server error");
    expect(b.data).toBeNull();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("a GuardError from authenticate still maps to its own status/message", async () => {
    authenticateMock.mockRejectedValue(new GuardError(403, "No org membership"));
    const res = await handleApiRequest(GET("/api/providers"));
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("No org membership");
  });

  it("a handler that throws a plain Error returns 500, logs server-side, and does not leak", async () => {
    authenticateMock.mockResolvedValue({ orgId: "org-1", role: "admin" } as never);
    listMock.mockRejectedValue(new Error("kaboom: internal detail that must not leak"));
    const res = await handleApiRequest(GET("/api/providers"));
    expect(res.status).toBe(500);
    const b = await body(res);
    expect(b.error).toBe("Internal server error");
    expect(JSON.stringify(b)).not.toContain("kaboom");
    // the real error is logged server-side, not returned to the caller
    expect(errorSpy.mock.calls.flat().join(" ")).toContain("kaboom");
  });

  it("a handler that throws GuardError(403) returns 403", async () => {
    authenticateMock.mockResolvedValue({ orgId: "org-1", role: "billing" } as never);
    listMock.mockRejectedValue(new GuardError(403, "Your role cannot modify providers"));
    const res = await handleApiRequest(GET("/api/providers"));
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("Your role cannot modify providers");
  });
});
