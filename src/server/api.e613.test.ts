import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./guard", async () => {
  const actual = await vi.importActual<typeof import("./guard")>("./guard");
  return { ...actual, authenticateUser: vi.fn(), authenticate: vi.fn() };
});
vi.mock("@/services/clientAccess", () => ({ resolveEnrollmentContext: vi.fn() }));
vi.mock("./enrollmentExplorerRoutes", () => ({
  handleEnrollmentExplorerRequest: vi.fn(),
}));

import { authenticate, authenticateUser } from "./guard";
import type { UserContext } from "./guard";
import { resolveEnrollmentContext } from "@/services/clientAccess";
import { handleEnrollmentExplorerRequest } from "./enrollmentExplorerRoutes";
import { handleApiRequest } from "./api";

const authenticateMock = vi.mocked(authenticate);
const authenticateUserMock = vi.mocked(authenticateUser);
const resolveMock = vi.mocked(resolveEnrollmentContext);
const routeMock = vi.mocked(handleEnrollmentExplorerRequest);
const ACTOR = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const user = { userId: ACTOR, db: {} } as unknown as UserContext;

const context = (revision: string, audience: "staff" | "client" = "client") =>
  ({ audience, selectedOrgId: ORG, contextRevision: revision }) as never;

function getRequest(revision = "revision-a", audience = "client") {
  return new Request("https://x.test/api/enrollment-explorer/catalog", {
    method: "GET",
    headers: {
      authorization: "Bearer verified-token",
      "x-org-id": ORG,
      "x-enrollment-audience": audience,
      "x-minted-context-revision": revision,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticateUserMock.mockResolvedValue(user);
  authenticateMock.mockResolvedValue({ orgId: ORG, role: "admin" } as never);
  resolveMock.mockResolvedValue(context("revision-a"));
  routeMock.mockResolvedValue(new Response('{"data":{"products":[],"targets":[]},"error":null}'));
});

describe("E6.13 explicit audience and context boundary", () => {
  it("uses the caller-selected client audience even when the actor also has staff capability", async () => {
    const response = await handleApiRequest(getRequest());

    expect(response.status).toBe(200);
    expect(resolveMock).toHaveBeenCalledTimes(2);
    expect(resolveMock).toHaveBeenNthCalledWith(
      1,
      { db: user.db, actorUserId: ACTOR },
      { audience: "client", orgId: ORG },
    );
    expect(routeMock).toHaveBeenCalledWith(expect.any(Request), user, {
      orgId: ORG,
      audience: "client",
    });
    expect(authenticateMock).not.toHaveBeenCalled();
  });

  it("maps unavailable client organization context to a safe no-store denial", async () => {
    const contextError = Object.assign(new Error("Client organization is unavailable"), {
      code: "P0001",
    });
    resolveMock.mockRejectedValueOnce(contextError);

    const response = await handleApiRequest(getRequest());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({
      data: null,
      error: "Selected enrollment access is no longer available",
    });
    expect(routeMock).not.toHaveBeenCalled();
  });

  it("denies a client-selected audience when the resolved context is staff only", async () => {
    resolveMock.mockResolvedValue(context("revision-a", "staff"));

    const response = await handleApiRequest(getRequest());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(routeMock).not.toHaveBeenCalled();
  });

  it("maps a banned or unverified actor to 401 rather than an internal error", async () => {
    resolveMock.mockRejectedValueOnce(
      Object.assign(new Error("Verified actor is unavailable"), { code: "P0001" }),
    );

    const response = await handleApiRequest(getRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: "Your session is no longer active; sign in again",
    });
    expect(routeMock).not.toHaveBeenCalled();
  });

  it("rejects a stale selected-context revision before dispatch and returns the current revision", async () => {
    resolveMock.mockResolvedValue(context("revision-b"));

    const response = await handleApiRequest(getRequest("revision-a"));

    expect(response.status).toBe(409);
    expect(response.headers.get("x-minted-context-revision")).toBe("revision-b");
    expect(routeMock).not.toHaveBeenCalled();
  });

  it("invalidates the browser context when access disappears during a read", async () => {
    resolveMock
      .mockResolvedValueOnce(context("revision-a"))
      .mockRejectedValueOnce(
        Object.assign(new Error("Client context is unavailable"), { code: "P0001" }),
      );

    const response = await handleApiRequest(getRequest());

    expect(response.status).toBe(409);
    expect(response.headers.get("x-minted-context-revision")).toBe("unknown");
    expect(await response.json()).toMatchObject({ data: null });
  });

  it("retains a committed mutation while marking post-mutation context unknown", async () => {
    resolveMock
      .mockResolvedValueOnce(context("revision-a"))
      .mockRejectedValueOnce(new Error("context changed"));
    routeMock.mockResolvedValue(
      new Response('{"data":{"scopeId":"scope"},"error":null}', { status: 201 }),
    );
    const request = new Request("https://x.test/api/enrollment-explorer/scopes", {
      method: "POST",
      headers: {
        authorization: "Bearer verified-token",
        "content-type": "application/json",
        "x-org-id": ORG,
        "x-enrollment-audience": "client",
        "x-minted-context-revision": "revision-a",
      },
      body: "{}",
    });

    const response = await handleApiRequest(request);

    expect(response.status).toBe(201);
    expect(response.headers.get("x-minted-context-revision")).toBe("unknown");
  });
});
