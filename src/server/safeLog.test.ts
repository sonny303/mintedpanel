import { format } from "node:util";
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

// src/server.ts lazy-imports this router for /api; mock it so the entry's own
// catch can be driven with a sentinel-bearing throw.
vi.mock("./api", () => ({ handleApiRequest: vi.fn() }));

import { handleApiRequest } from "./api";
import serverEntry from "../server";
import { describeError } from "@/lib/errorIdentifiers";
import { logServerError, REQUEST_ID_HEADER, requestSite, routeTemplate } from "./safeLog";

// SEC-03 sentinels: none of these may ever reach a production log line.
const SENTINELS = ["1961-04-12", "742 Evergreen Terrace", "AB1234563"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LEVELS = ["error", "warn", "info", "log", "debug"] as const;

// A PostgREST CHECK failure as supabase-js returns it: a plain object, not an
// Error, with the rejected row in `details`. The message and hint carry the
// sentinels too, so the test does not rely on Postgres keeping them out.
const PG_CHECK_ERROR = {
  code: "23514",
  message:
    'new row for relation "providers" violates check constraint "providers_status_check" (1961-04-12, AB1234563)',
  details:
    "Failing row contains (p1, org-1, Jane, Doe, 1961-04-12, 742 Evergreen Terrace, AB1234563).",
  hint: "742 Evergreen Terrace",
};

let spies: Record<(typeof LEVELS)[number], MockInstance<(...args: unknown[]) => void>>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEV", false);
  spies = {} as typeof spies;
  for (const level of LEVELS) {
    spies[level] = vi.spyOn(console, level).mockImplementation(() => {});
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const spy of Object.values(spies)) spy.mockRestore();
});

// Every console level, rendered the way Node prints it: util.format expands
// an Error's stack and an object's fields, so a raw leak cannot hide behind
// "[object Object]" or JSON.stringify(new Error()) === "{}".
function logged(): string {
  return Object.values(spies)
    .flatMap((spy) => spy.mock.calls)
    .map((args) => format(...args))
    .join("\n");
}

describe("describeError", () => {
  it("keeps the SQLSTATE and constraint of a PostgREST error, never its text", () => {
    expect(describeError(PG_CHECK_ERROR)).toEqual({
      errorClass: "Object",
      sqlstate: "23514",
      constraint: "providers_status_check",
    });
  });

  it("drops a code that is not a SQLSTATE or PGRST code", () => {
    expect(describeError({ code: "AB1234563", message: "x" })).toEqual({ errorClass: "Object" });
    expect(describeError({ code: "PGRST116" }).sqlstate).toBe("PGRST116");
  });

  it("reads a constraint only from a class-23 message, never from details", () => {
    const named = 'violates check constraint "providers_status_check"';
    expect(describeError({ code: "22007", message: named }).constraint).toBeUndefined();
    expect(describeError({ code: "23514", message: "x", details: named }).constraint).toBe(
      undefined,
    );
    expect(
      describeError({ code: "23514", message: 'violates check constraint "AB1234563"' }).constraint,
    ).toBeUndefined();
  });

  it("names the class of an Error and the type of a non-object", () => {
    expect(describeError(new TypeError("1961-04-12"))).toEqual({ errorClass: "TypeError" });
    expect(describeError("742 Evergreen Terrace")).toEqual({ errorClass: "string" });
    expect(describeError(null)).toEqual({ errorClass: "null" });
  });
});

describe("routeTemplate / requestSite", () => {
  it("keeps known route words and collapses ids and caller text", () => {
    expect(routeTemplate("/api/providers/5b2c0e4e-0000-4000-a000-000000000001/profile")).toBe(
      "/api/providers/:param/profile",
    );
    expect(routeTemplate("/api/providers/742%20Evergreen%20Terrace")).toBe("/api/providers/:param");
    expect(routeTemplate("/api/rosters/mappings/m1/preview")).toBe(
      "/api/rosters/mappings/:param/preview",
    );
  });

  it("collapses a lowercase slug in an id slot, not only ids with digits", () => {
    expect(routeTemplate("/api/providers/jane-doe")).toBe("/api/providers/:param");
    expect(routeTemplate("/api/intake/evergreen")).toBe("/api/intake/:param");
  });

  it("never carries the query string", () => {
    const site = requestSite(
      new Request("https://x.test/api/providers?search=AB1234563", { method: "post" }),
    );
    expect(site).toEqual({ method: "POST", route: "/api/providers" });
  });
});

describe("logServerError", () => {
  it("emits one allowlisted JSON line in production and returns its id", () => {
    const requestId = logServerError("[api] internal error", PG_CHECK_ERROR, {
      method: "POST",
      route: "/api/providers",
    });
    expect(requestId).toMatch(UUID_RE);
    expect(spies.error).toHaveBeenCalledTimes(1);
    const [scope, line, ...rest] = spies.error.mock.calls[0];
    expect(scope).toBe("[api] internal error");
    expect(rest).toEqual([]);
    expect(JSON.parse(line as string)).toEqual({
      requestId,
      method: "POST",
      route: "/api/providers",
      errorClass: "Object",
      sqlstate: "23514",
      constraint: "providers_status_check",
    });
    for (const sentinel of SENTINELS) expect(logged()).not.toContain(sentinel);
  });

  it("passes the raw error through on a dev server only", () => {
    vi.stubEnv("DEV", true);
    const error = new Error("dev-only detail");
    logServerError("[api] internal error", error, { method: "GET", route: "/api/providers" });
    expect(spies.error.mock.calls[0][2]).toBe(error);
  });
});

describe("src/server.ts entry", () => {
  it("logs an escaped /api throw safely and returns the id on the error page", async () => {
    vi.mocked(handleApiRequest).mockRejectedValue(PG_CHECK_ERROR);
    const res = await serverEntry.fetch(
      new Request("https://x.test/api/providers/AB1234563"),
      undefined,
      undefined,
    );
    expect(res.status).toBe(500);
    const requestId = res.headers.get(REQUEST_ID_HEADER);
    expect(requestId).toMatch(UUID_RE);
    expect(logged()).toContain(requestId);
    expect(logged()).toContain('"route":"/api/providers/:param"');
    const page = await res.text();
    for (const sentinel of SENTINELS) {
      expect(logged()).not.toContain(sentinel);
      expect(page).not.toContain(sentinel);
    }
  });
});
