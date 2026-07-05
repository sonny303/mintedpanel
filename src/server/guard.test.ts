import { describe, it, expect } from "vitest";
import { getBearerToken, isWriter, GuardError, type AuthContext } from "./guard";

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
