import { describe, it, expect, vi, beforeEach } from "vitest";
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

beforeEach(() => vi.clearAllMocks());

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
