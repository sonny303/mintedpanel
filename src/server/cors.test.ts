import { describe, it, expect, vi, afterEach } from "vitest";
import { handlePreflight, withCors } from "./cors";

const EXT_ORIGIN = "chrome-extension://abcdefghijklmnop";

function request(origin?: string, method = "OPTIONS"): Request {
  return new Request("https://x.test/api/fill-events", {
    method,
    headers: origin ? { origin } : {},
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("handlePreflight", () => {
  it("with no allowlist configured: 204, vary: Origin, and no access-control headers", () => {
    const res = handlePreflight(request(EXT_ORIGIN));
    expect(res.status).toBe(204);
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-methods")).toBeNull();
    expect(res.headers.get("access-control-allow-headers")).toBeNull();
  });

  it("an allowlisted origin gets the full preflight grant", () => {
    vi.stubEnv("API_CORS_ORIGINS", ` https://ops.example , ${EXT_ORIGIN}`);
    const res = handlePreflight(request(EXT_ORIGIN));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(EXT_ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, PATCH, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe(
      "authorization, content-type, x-org-id",
    );
    expect(res.headers.get("access-control-max-age")).toBe("86400");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("a non-allowlisted origin still gets 204 but no grant", () => {
    vi.stubEnv("API_CORS_ORIGINS", EXT_ORIGIN);
    const res = handlePreflight(request("https://evil.example"));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-methods")).toBeNull();
  });

  it("a request without an Origin header (curl, the gate) gets 204 and no grant", () => {
    vi.stubEnv("API_CORS_ORIGINS", EXT_ORIGIN);
    const res = handlePreflight(request());
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("withCors", () => {
  it("with an empty allowlist: leaves the response untouched", () => {
    vi.stubEnv("API_CORS_ORIGINS", "");
    const original = new Response("{}", { status: 200 });
    const res = withCors(original, request(EXT_ORIGIN, "GET"));
    expect(res).toBe(original);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBeNull();
  });

  it("attaches allow-origin + vary for an allowlisted origin", () => {
    vi.stubEnv("API_CORS_ORIGINS", EXT_ORIGIN);
    const res = withCors(new Response("{}", { status: 200 }), request(EXT_ORIGIN, "GET"));
    expect(res.headers.get("access-control-allow-origin")).toBe(EXT_ORIGIN);
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("adds nothing for a non-allowlisted origin", () => {
    vi.stubEnv("API_CORS_ORIGINS", EXT_ORIGIN);
    const res = withCors(
      new Response("{}", { status: 200 }),
      request("https://evil.example", "GET"),
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBeNull();
  });
});
