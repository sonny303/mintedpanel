import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./serviceClient", () => ({ getAuthClient: vi.fn(), getServiceClient: vi.fn() }));

import { getAuthClient, getServiceClient } from "./serviceClient";
import {
  authenticate,
  authenticateUser,
  getBearerToken,
  isWriter,
  GuardError,
  type AuthContext,
} from "./guard";

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/providers", { headers });
}

function ctx(role: AuthContext["role"]): AuthContext {
  return {
    userId: "u1",
    orgId: "org-1",
    role,
    userName: "Tester",
    email: "tester@minted.com",
    userMetadata: null,
    asUser: () => ({}) as AuthContext["db"],
    // not exercised in these unit tests
    db: {} as AuthContext["db"],
    writeAudit: async () => {},
  };
}

describe("guard.getBearerToken", () => {
  it("extracts a bearer token", () => {
    expect(getBearerToken(req({ authorization: "Bearer abc.def" }))).toBe("abc.def");
  });

  it("rejects a missing header with 401", () => {
    try {
      getBearerToken(req());
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GuardError);
      expect((e as GuardError).status).toBe(401);
    }
  });

  it("rejects a non-bearer scheme with 401", () => {
    expect(() => getBearerToken(req({ authorization: "Basic xyz" }))).toThrow(GuardError);
  });
});

describe("guard.isWriter", () => {
  it("is true for admin and specialist", () => {
    expect(isWriter(ctx("admin"))).toBe(true);
    expect(isWriter(ctx("specialist"))).toBe(true);
  });

  it("is false for billing (read-only)", () => {
    expect(isWriter(ctx("billing"))).toBe(false);
  });
});

// Fakes for the authenticate() flow: an auth client whose getClaims accepts
// the token, and a service db serving memberships (honoring the org_id filter,
// like PostgREST would) plus a profiles row.
function fakeAuthClient() {
  return {
    auth: {
      getClaims: async () => ({
        data: { claims: { sub: "u1", email: "tester@minted.com", user_metadata: {} } },
        error: null,
      }),
    },
  };
}

function fakeServiceDb(memberships: Array<{ org_id: string; role: string }>) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const membershipRows = () => {
        const orgFilter = filters.find(([col]) => col === "org_id");
        return orgFilter ? memberships.filter((m) => m.org_id === orgFilter[1]) : memberships;
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return builder;
        },
        maybeSingle: () =>
          Promise.resolve({
            data: table === "profiles" ? { full_name: "Tess Tester" } : null,
            error: null,
          }),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve({
            data: table === "memberships" ? membershipRows() : [],
            error: null,
          }).then(res, rej),
      };
      return builder;
    },
  };
}

describe("guard.authenticateUser — user-only auth step (no org resolution)", () => {
  const request = () => req({ authorization: "Bearer tok" });

  it("verifies the JWT and returns the user without ever querying the db", async () => {
    vi.mocked(getAuthClient).mockReturnValue(fakeAuthClient() as never);
    // The whole point of this step: a multi-org caller must be able to list
    // their orgs BEFORE sending x-org-id, so no membership query may run.
    vi.mocked(getServiceClient).mockReturnValue({
      from: () => {
        throw new Error("authenticateUser must not query the db");
      },
    } as never);

    const user = await authenticateUser(request());

    expect(user.userId).toBe("u1");
    expect(user.email).toBe("tester@minted.com");
    expect(user.userMetadata).toEqual({});
    expect(user.db).toBeDefined();
  });

  it("rejects an invalid or expired token with 401", async () => {
    vi.mocked(getAuthClient).mockReturnValue({
      auth: { getClaims: async () => ({ data: null, error: new Error("bad token") }) },
    } as never);

    await expect(authenticateUser(request())).rejects.toMatchObject({
      name: "GuardError",
      status: 401,
    });
  });

  it("rejects a missing Authorization header with 401", async () => {
    await expect(authenticateUser(req())).rejects.toMatchObject({
      name: "GuardError",
      status: 401,
    });
  });
});

describe("guard.authenticate — org resolution", () => {
  const TWO_ORGS = [
    { org_id: "org-1", role: "admin" },
    { org_id: "org-2", role: "billing" },
  ];
  const request = () => req({ authorization: "Bearer tok" });

  beforeEach(() => {
    vi.mocked(getAuthClient).mockReturnValue(fakeAuthClient() as never);
  });

  it("resolves the sole org for a single-org caller without x-org-id", async () => {
    vi.mocked(getServiceClient).mockReturnValue(
      fakeServiceDb([{ org_id: "org-1", role: "specialist" }]) as never,
    );
    const c = await authenticate(request(), null);
    expect(c.orgId).toBe("org-1");
    expect(c.role).toBe("specialist");
  });

  it("rejects a multi-org caller without x-org-id loudly (400), never guessing an org", async () => {
    vi.mocked(getServiceClient).mockReturnValue(fakeServiceDb(TWO_ORGS) as never);
    await expect(authenticate(request(), null)).rejects.toMatchObject({
      name: "GuardError",
      status: 400,
      message: expect.stringContaining("x-org-id"),
    });
  });

  it("resolves the requested org for a multi-org caller sending x-org-id", async () => {
    vi.mocked(getServiceClient).mockReturnValue(fakeServiceDb(TWO_ORGS) as never);
    const c = await authenticate(request(), "org-2");
    expect(c.orgId).toBe("org-2");
    expect(c.role).toBe("billing");
  });

  it("rejects an x-org-id the caller is not a member of with 403", async () => {
    vi.mocked(getServiceClient).mockReturnValue(fakeServiceDb(TWO_ORGS) as never);
    await expect(authenticate(request(), "org-9")).rejects.toMatchObject({
      name: "GuardError",
      status: 403,
    });
  });
});
