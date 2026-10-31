// MINT-110 — /api/npi-registry handlers: writer-only, validated before any
// upstream call, a per-user budget, a shared short cache, a plain 502 when the
// registry fails, and no typed name or NPI in the server log. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiEnvelope } from "./envelope";
import type { AuthContext } from "./guard";
import {
  NPI_REGISTRY_CACHE_TTL_MS,
  NPI_REGISTRY_RATE_LIMIT,
  handleNpiRegistryLookup,
  handleNpiRegistrySearch,
  resetNpiRegistryLimits,
} from "./npiRegistryRoutes";
import type { NpiRegistryLookupResult, NpiRegistrySearchResult } from "@/lib/npiRegistry";

function ctx(role: AuthContext["role"] = "specialist", userId = "u1"): AuthContext {
  return {
    userId,
    orgId: "org-1",
    role,
    userName: "Jordan Seed",
    email: "jordan@minted.example",
    userMetadata: null,
    db: {} as AuthContext["db"],
    writeAudit: vi.fn(),
  };
}

const RECORD = {
  number: "1234567893",
  enumeration_type: "NPI-1",
  basic: { first_name: "JANE", last_name: "DOE", credential: "PT", status: "A" },
  addresses: [{ address_purpose: "LOCATION", city: "DENVER", state: "CO" }],
  taxonomies: [{ code: "225100000X", desc: "Physical Therapist", primary: true }],
};

function registry(body: unknown = { result_count: 1, results: [RECORD] }) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
  );
}

async function envelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  return (await response.json()) as ApiEnvelope<T>;
}

let now = 0;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  now = 1_000_000;
  resetNpiRegistryLimits(() => now);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe("POST /api/npi-registry/search", () => {
  it("returns public registry fields for a writer, never cached by the browser", async () => {
    const fetchFn = registry();
    const res = await handleNpiRegistrySearch(
      { firstName: "Jane", lastName: "Doe", state: "CO" },
      ctx(),
      { fetch: fetchFn },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await envelope<NpiRegistrySearchResult>(res);
    expect(body.data).toMatchObject({
      truncated: false,
      results: [{ npi: "1234567893", lastName: "DOE", practiceCity: "DENVER" }],
    });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("is writer-only: billing gets 403 and the registry is never called", async () => {
    const fetchFn = registry();
    const res = await handleNpiRegistrySearch(
      { firstName: "Jane", lastName: "Doe" },
      ctx("billing"),
      { fetch: fetchFn },
    );
    expect(res.status).toBe(403);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("422s a missing last name or a wildcard before any upstream call", async () => {
    const fetchFn = registry();
    for (const body of [null, { firstName: "Jane" }, { firstName: "Jane", lastName: "Do*" }]) {
      const res = await handleNpiRegistrySearch(body, ctx(), { fetch: fetchFn });
      expect(res.status).toBe(422);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("serves a repeat search from the cache, across users, until it expires", async () => {
    const fetchFn = registry();
    const input = { firstName: "Jane", lastName: "Doe" };
    await handleNpiRegistrySearch(input, ctx("admin", "u1"), { fetch: fetchFn });
    const again = await handleNpiRegistrySearch(
      { firstName: "JANE", lastName: "doe" },
      ctx("specialist", "u2"),
      { fetch: fetchFn },
    );
    expect(again.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledOnce();
    now += NPI_REGISTRY_CACHE_TTL_MS;
    await handleNpiRegistrySearch(input, ctx(), { fetch: fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/npi-registry/lookup", () => {
  it("returns the record, or record: null when the registry has none", async () => {
    const found = await handleNpiRegistryLookup({ npi: "123-456-7893" }, ctx(), {
      fetch: registry(),
    });
    expect((await envelope<NpiRegistryLookupResult>(found)).data?.record?.npi).toBe("1234567893");
    const missing = await handleNpiRegistryLookup({ npi: "1902833742" }, ctx(), {
      fetch: registry({ result_count: 0, results: [] }),
    });
    expect(missing.status).toBe(200);
    expect((await envelope<NpiRegistryLookupResult>(missing)).data).toEqual({ record: null });
  });

  it("422s an NPI that fails the check digit without calling the registry", async () => {
    const fetchFn = registry();
    const res = await handleNpiRegistryLookup({ npi: "1234567890" }, ctx(), { fetch: fetchFn });
    expect(res.status).toBe(422);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("turns an upstream failure into a plain 502 and logs no query", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("bad gateway", { status: 503 }));
    const res = await handleNpiRegistryLookup({ npi: "1234567893" }, ctx(), { fetch: fetchFn });
    expect(res.status).toBe(502);
    expect((await envelope(res)).error).toBe("NPI Registry is unavailable");
    expect(warn).toHaveBeenCalledWith("[npi-registry] upstream unavailable: http 503");
    const search = await handleNpiRegistrySearch({ firstName: "Jane", lastName: "Doe" }, ctx(), {
      fetch: vi.fn<typeof fetch>(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    expect(search.status).toBe(502);
    const logged = JSON.stringify(warn.mock.calls);
    for (const secret of ["1234567893", "Jane", "Doe", "JANE", "DOE"]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("422s a query the registry refuses and does not call it an outage", async () => {
    const fetchFn = registry({
      Errors: [{ description: "special character(s)", field: "last_name", number: "10" }],
    });
    const res = await handleNpiRegistrySearch({ firstName: "Ana", lastName: "Doe" }, ctx(), {
      fetch: fetchFn,
    });
    expect(res.status).toBe(422);
    expect((await envelope(res)).error).toMatch(/would not run that search/);
    expect(warn).not.toHaveBeenCalled();
  });

  it("422s a non-Latin name before any registry call", async () => {
    const fetchFn = registry();
    const res = await handleNpiRegistrySearch({ firstName: "Wei", lastName: "\u674e" }, ctx(), {
      fetch: fetchFn,
    });
    expect(res.status).toBe(422);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not cache a failure", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("down", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result_count: 1, results: [RECORD] })));
    expect(
      (await handleNpiRegistryLookup({ npi: "1234567893" }, ctx(), { fetch: fetchFn })).status,
    ).toBe(502);
    expect(
      (await handleNpiRegistryLookup({ npi: "1234567893" }, ctx(), { fetch: fetchFn })).status,
    ).toBe(200);
  });
});

describe("per-user rate limit", () => {
  it("429s past the limit with Retry-After, per user, and resets after the window", async () => {
    const fetchFn = registry();
    for (let i = 0; i < NPI_REGISTRY_RATE_LIMIT; i += 1) {
      const res = await handleNpiRegistryLookup({ npi: "1234567893" }, ctx(), { fetch: fetchFn });
      expect(res.status).toBe(200);
    }
    now += 20_000;
    const limited = await handleNpiRegistryLookup({ npi: "1234567893" }, ctx(), {
      fetch: fetchFn,
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("40");
    expect((await envelope(limited)).error).toMatch(/Too many NPI Registry lookups/);

    const otherUser = await handleNpiRegistrySearch(
      { firstName: "Jane", lastName: "Doe" },
      ctx("admin", "u2"),
      { fetch: fetchFn },
    );
    expect(otherUser.status).toBe(200);

    now += 40_000;
    const reset = await handleNpiRegistryLookup({ npi: "1234567893" }, ctx(), { fetch: fetchFn });
    expect(reset.status).toBe(200);
  });

  it("spends no budget on a forbidden or invalid request", async () => {
    const fetchFn = registry();
    for (let i = 0; i < NPI_REGISTRY_RATE_LIMIT + 5; i += 1) {
      await handleNpiRegistryLookup({ npi: "bad" }, ctx(), { fetch: fetchFn });
    }
    const res = await handleNpiRegistryLookup({ npi: "1234567893" }, ctx(), { fetch: fetchFn });
    expect(res.status).toBe(200);
  });
});
