import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiEnvelope } from "./envelope";
import type { AuthContext } from "./guard";

vi.mock("@/services/providers", () => ({
  listProviders: vi.fn(),
  getProvider: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
}));

import { listProviders, getProvider, createProvider, updateProvider } from "@/services/providers";
import {
  handleListProviders,
  handleGetProvider,
  handleCreateProvider,
  handleUpdateProvider,
} from "./providerRoutes";

const listProvidersMock = vi.mocked(listProviders);
const getProviderMock = vi.mocked(getProvider);
const createProviderMock = vi.mocked(createProvider);
const updateProviderMock = vi.mocked(updateProvider);

function ctx(role: AuthContext["role"] = "specialist"): AuthContext {
  return {
    userId: "u1",
    orgId: "org-1",
    role,
    userName: "Tester",
    email: "tester@minted.com",
    userMetadata: null,
    db: {} as AuthContext["db"],
    writeAudit: vi.fn().mockResolvedValue(undefined),
  };
}

async function body(res: Response): Promise<ApiEnvelope<unknown>> {
  return (await res.json()) as ApiEnvelope<unknown>;
}

beforeEach(() => vi.clearAllMocks());

describe("provider route handlers", () => {
  it("list returns the envelope with pagination meta", async () => {
    listProvidersMock.mockResolvedValue({ rows: [{ id: "p1" }] as never, total: 30 });
    const res = await handleListProviders(
      new URL("https://x.test/api/providers?page=2&pageSize=10"),
      ctx(),
    );
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b.data).toEqual([{ id: "p1" }]);
    expect(b.meta).toEqual({ total: 30, page: 2, pageSize: 10 });
    // page/pageSize forwarded to the service
    expect(listProvidersMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ page: 2, pageSize: 10 }),
    );
  });

  it("list clamps pageSize to 100", async () => {
    listProvidersMock.mockResolvedValue({ rows: [], total: 0 });
    await handleListProviders(new URL("https://x.test/api/providers?pageSize=9999"), ctx());
    expect(listProvidersMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ pageSize: 100 }),
    );
  });

  it("get returns 404 when the provider is missing", async () => {
    getProviderMock.mockResolvedValue(null);
    const res = await handleGetProvider("nope", ctx());
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("Provider not found");
  });

  it("get returns 200 with the provider", async () => {
    getProviderMock.mockResolvedValue({ id: "p1" } as never);
    const res = await handleGetProvider("p1", ctx());
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({ id: "p1" });
  });

  it("create rejects a billing (read-only) role with 403", async () => {
    const res = await handleCreateProvider({ firstName: "A", lastName: "B" }, ctx("billing"));
    expect(res.status).toBe(403);
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  it("create 422s when firstName/lastName are missing", async () => {
    const res = await handleCreateProvider({ firstName: "A" }, ctx());
    expect(res.status).toBe(422);
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  it("create returns 201 and forwards the injected ctx", async () => {
    createProviderMock.mockResolvedValue({ id: "new" } as never);
    const c = ctx();
    const res = await handleCreateProvider({ firstName: "A", lastName: "B" }, c);
    expect(res.status).toBe(201);
    expect((await body(res)).data).toEqual({ id: "new" });
    expect(createProviderMock).toHaveBeenCalledWith(
      { firstName: "A", lastName: "B" },
      expect.objectContaining({ orgId: "org-1" }),
    );
  });

  it("update requires a writer and returns 200", async () => {
    getProviderMock.mockResolvedValue({ id: "p1" } as never);
    updateProviderMock.mockResolvedValue({ id: "p1", firstName: "New" } as never);
    const blocked = await handleUpdateProvider("p1", { firstName: "New" }, ctx("billing"));
    expect(blocked.status).toBe(403);

    const ok = await handleUpdateProvider("p1", { firstName: "New" }, ctx("admin"));
    expect(ok.status).toBe(200);
    expect((await body(ok)).data).toEqual({ id: "p1", firstName: "New" });
  });

  it("update returns 404 for a cross-org / nonexistent id (never a 500)", async () => {
    // getProvider is org-scoped, so a cross-org or unknown id resolves to null —
    // the same not-found signal the GET handler uses.
    getProviderMock.mockResolvedValue(null);
    const res = await handleUpdateProvider("nope", { firstName: "New" }, ctx("admin"));
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe("Provider not found");
    // The update never runs once the row is absent (no cross-org write attempt).
    expect(updateProviderMock).not.toHaveBeenCalled();
  });
});
