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
vi.mock("./extensionRoutes", () => ({
  handleProviderProfile: vi.fn(),
  handleListPortalFieldMaps: vi.fn(),
  handleCreateFillEvent: vi.fn(),
}));

import { authenticate, GuardError } from "./guard";
import { handleListProviders, handleGetProvider } from "./providerRoutes";
import {
  handleProviderProfile,
  handleListPortalFieldMaps,
  handleCreateFillEvent,
} from "./extensionRoutes";
import { handleApiRequest, isApiRequest } from "./api";

const authenticateMock = vi.mocked(authenticate);
const listMock = vi.mocked(handleListProviders);
const getMock = vi.mocked(handleGetProvider);
const profileMock = vi.mocked(handleProviderProfile);
const fieldMapsMock = vi.mocked(handleListPortalFieldMaps);
const fillEventsMock = vi.mocked(handleCreateFillEvent);

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

describe("isApiRequest — owns the whole /api/* prefix", () => {
  it("matches any /api path, known route or not", () => {
    expect(isApiRequest("/api")).toBe(true);
    expect(isApiRequest("/api/portal-field-maps")).toBe(true);
    expect(isApiRequest("/api/fill-events")).toBe(true);
    expect(isApiRequest("/api/providers/p1/profile")).toBe(true);
    expect(isApiRequest("/api/anything/else")).toBe(true);
    expect(isApiRequest("/apiary")).toBe(false);
    expect(isApiRequest("/")).toBe(false);
  });
});

describe("handleApiRequest — extension routes and CORS preflight", () => {
  it("OPTIONS anywhere under /api is a 204 preflight without auth", async () => {
    const res = await handleApiRequest(
      new Request("https://x.test/api/anything", { method: "OPTIONS" }),
    );
    expect(res.status).toBe(204);
    expect(authenticateMock).not.toHaveBeenCalled();
  });

  it("GET /api/providers/p1/profile dispatches to the profile handler, not handleGetProvider", async () => {
    authenticateMock.mockResolvedValue({ orgId: "org-1", role: "specialist" } as never);
    profileMock.mockResolvedValue(
      new Response('{"data":{},"error":null,"meta":null}', { status: 200 }),
    );
    const res = await handleApiRequest(GET("/api/providers/p1/profile?state=KS"));
    expect(res.status).toBe(200);
    expect(profileMock).toHaveBeenCalledWith("p1", expect.any(URL), expect.anything());
    expect(getMock).not.toHaveBeenCalled();
  });

  it("GET /api/portal-field-maps dispatches with auth", async () => {
    authenticateMock.mockResolvedValue({ orgId: "org-1", role: "billing" } as never);
    fieldMapsMock.mockResolvedValue(
      new Response('{"data":[],"error":null,"meta":{"total":0}}', { status: 200 }),
    );
    const res = await handleApiRequest(GET("/api/portal-field-maps?portal_key=availity"));
    expect(res.status).toBe(200);
    expect(authenticateMock).toHaveBeenCalledTimes(1);
    expect(fieldMapsMock).toHaveBeenCalledWith(expect.any(URL), expect.anything());
  });

  it("POST /api/fill-events dispatches the parsed JSON body with auth", async () => {
    authenticateMock.mockResolvedValue({ orgId: "org-1", role: "specialist" } as never);
    fillEventsMock.mockResolvedValue(
      new Response('{"data":{},"error":null,"meta":null}', { status: 201 }),
    );
    const res = await handleApiRequest(
      new Request("https://x.test/api/fill-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "abc", portalKey: "availity" }),
      }),
    );
    expect(res.status).toBe(201);
    expect(fillEventsMock).toHaveBeenCalledWith(
      { id: "abc", portalKey: "availity" },
      expect.anything(),
    );
  });

  it("wrong methods on the extension routes are 405", async () => {
    authenticateMock.mockResolvedValue({ orgId: "org-1", role: "admin" } as never);
    const postMaps = await handleApiRequest(
      new Request("https://x.test/api/portal-field-maps", { method: "POST" }),
    );
    expect(postMaps.status).toBe(405);
    const getFills = await handleApiRequest(GET("/api/fill-events"));
    expect(getFills.status).toBe(405);
    const patchProfile = await handleApiRequest(
      new Request("https://x.test/api/providers/p1/profile", { method: "PATCH" }),
    );
    expect(patchProfile.status).toBe(405);
    expect(profileMock).not.toHaveBeenCalled();
    expect(fieldMapsMock).not.toHaveBeenCalled();
    expect(fillEventsMock).not.toHaveBeenCalled();
  });

  it("an unknown /api path is a JSON 404 envelope without auth", async () => {
    const res = await handleApiRequest(GET("/api/nope"));
    expect(res.status).toBe(404);
    expect(await body(res)).toEqual({ data: null, error: "Not found", meta: null });
    expect(authenticateMock).not.toHaveBeenCalled();
  });
});
