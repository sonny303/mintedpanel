// MINT-110 — /api/npi-registry/* dispatch: behind the org guard, POST only,
// the body bounded before parsing, and the two paths to their handlers.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./guard", async () => {
  const actual = await vi.importActual<typeof import("./guard")>("./guard");
  return { ...actual, authenticate: vi.fn(), authenticateUser: vi.fn() };
});
vi.mock("./npiRegistryRoutes", () => ({
  handleNpiRegistrySearch: vi.fn(),
  handleNpiRegistryLookup: vi.fn(),
}));

import { authenticate, authenticateUser, GuardError, type AuthContext } from "./guard";
import { handleApiRequest } from "./api";
import { handleNpiRegistryLookup, handleNpiRegistrySearch } from "./npiRegistryRoutes";

const CTX = { userId: "u1", orgId: "org-1", role: "specialist" } as AuthContext;

function post(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://x.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t", ...headers },
    body,
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("api dispatch for /api/npi-registry", () => {
  it("puts both routes behind the full org guard", async () => {
    vi.mocked(authenticateUser).mockRejectedValue(new GuardError(401, "Missing bearer token"));
    vi.mocked(authenticate).mockRejectedValue(new GuardError(401, "Missing bearer token"));
    for (const path of ["/api/npi-registry/search", "/api/npi-registry/lookup"]) {
      const res = await handleApiRequest(post(path, "{}"));
      expect(res.status).toBe(401);
    }
    expect(authenticate).toHaveBeenCalledTimes(2);
    expect(handleNpiRegistrySearch).not.toHaveBeenCalled();
    expect(handleNpiRegistryLookup).not.toHaveBeenCalled();
  });

  it("routes search and lookup with the parsed body and the guard's context", async () => {
    vi.mocked(authenticateUser).mockRejectedValue(new GuardError(401, "skip context"));
    vi.mocked(authenticate).mockResolvedValue(CTX);
    vi.mocked(handleNpiRegistrySearch).mockResolvedValue(new Response("{}", { status: 200 }));
    vi.mocked(handleNpiRegistryLookup).mockResolvedValue(new Response("{}", { status: 200 }));

    const search = { firstName: "Jane", lastName: "Doe", state: "CO" };
    await handleApiRequest(post("/api/npi-registry/search", JSON.stringify(search)));
    expect(handleNpiRegistrySearch).toHaveBeenCalledWith(search, CTX);

    await handleApiRequest(post("/api/npi-registry/lookup/", JSON.stringify({ npi: "1" })));
    expect(handleNpiRegistryLookup).toHaveBeenCalledWith({ npi: "1" }, CTX);
  });

  it("hands an oversized body over as null instead of parsing it", async () => {
    vi.mocked(authenticateUser).mockRejectedValue(new GuardError(401, "skip context"));
    vi.mocked(authenticate).mockResolvedValue(CTX);
    vi.mocked(handleNpiRegistrySearch).mockResolvedValue(new Response("{}", { status: 422 }));
    const big = JSON.stringify({ firstName: "x".repeat(2000), lastName: "Doe" });
    await handleApiRequest(post("/api/npi-registry/search", big));
    expect(handleNpiRegistrySearch).toHaveBeenCalledWith(null, CTX);
  });

  it("is POST only and 404s an unknown sub-path", async () => {
    vi.mocked(authenticateUser).mockRejectedValue(new GuardError(401, "skip context"));
    vi.mocked(authenticate).mockResolvedValue(CTX);
    const get = await handleApiRequest(
      new Request("https://x.test/api/npi-registry/search?firstName=Jane&lastName=Doe", {
        headers: { authorization: "Bearer t" },
      }),
    );
    expect(get.status).toBe(405);
    const unknown = await handleApiRequest(post("/api/npi-registry/1234567893", "{}"));
    expect(unknown.status).toBe(404);
    expect(handleNpiRegistrySearch).not.toHaveBeenCalled();
    expect(handleNpiRegistryLookup).not.toHaveBeenCalled();
  });
});
