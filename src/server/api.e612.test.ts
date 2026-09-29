import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./guard", async () => {
  const actual = await vi.importActual<typeof import("./guard")>("./guard");
  return { ...actual, authenticate: vi.fn(), authenticateUser: vi.fn() };
});
vi.mock("@/services/clientAccess", () => ({
  resolveEnrollmentContext: vi.fn(),
}));
vi.mock("./providerRoutes", () => ({
  handleListProviders: vi.fn(),
  handleCreateProvider: vi.fn(),
}));

import { authenticate, authenticateUser } from "./guard";
import { handleListProviders, handleCreateProvider } from "./providerRoutes";
import { handleApiRequest } from "./api";
import { resolveEnrollmentContext } from "@/services/clientAccess";

const authenticateMock = vi.mocked(authenticate);
const authenticateUserMock = vi.mocked(authenticateUser);
const resolveContextMock = vi.mocked(resolveEnrollmentContext);
const listProvidersMock = vi.mocked(handleListProviders);
const createProviderMock = vi.mocked(handleCreateProvider);

const user = { userId: "11111111-1111-4111-8111-111111111111", db: {} } as never;
const context = (contextRevision: string) =>
  ({ contextRevision, restrictedExternal: false }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  authenticateUserMock.mockResolvedValue(user);
  authenticateMock.mockResolvedValue({ orgId: "org-1", role: "admin" } as never);
});

describe("E6.12 operation revision binding", () => {
  it("discards a protected read when authority changes during dispatch", async () => {
    resolveContextMock
      .mockResolvedValueOnce(context("revision-a"))
      .mockResolvedValueOnce(context("revision-b"));
    listProvidersMock.mockResolvedValue(
      new Response('{"data":[{"id":"p1"}],"error":null,"meta":null}', { status: 200 }),
    );

    const response = await handleApiRequest(
      new Request("https://x.test/api/providers", { method: "GET" }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      data: null,
      error: "Access context changed; retry the request",
    });
  });

  it("preserves a committed mutation and marks revision unknown when revalidation fails", async () => {
    resolveContextMock
      .mockResolvedValueOnce(context("revision-a"))
      .mockRejectedValueOnce(new Error("context lookup unavailable"));
    createProviderMock.mockResolvedValue(
      new Response('{"data":{"id":"p1"},"error":null,"meta":null}', { status: 201 }),
    );

    const response = await handleApiRequest(
      new Request("https://x.test/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Provider" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("X-Minted-Context-Revision")).toBe("unknown");
    expect(await response.json()).toMatchObject({ data: { id: "p1" }, error: null });
  });
});
