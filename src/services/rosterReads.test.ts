// Provider roster source reads at the PostgREST boundary (MINT-14): the
// provider list, the org's group assignments and its license summary each
// page past the server's max-rows cap to every row, keep their filters and an
// id tiebreak on every page, and reject — never return a partial list — when
// a page fails.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/integrations/supabase/externalClient", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    supabase: createClient("http://127.0.0.1:1", "synthetic-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (...args) => transport.fetch(...args) },
    }),
  };
});

import { supabase } from "@/integrations/supabase/externalClient";
import { useAuthStore } from "@/lib/auth-store";
import { listOrgStateLicenses } from "./lookups";
import { getProviders, listProviderGroupAssignments, listProviders } from "./providers";

type Row = Record<string, unknown>;
const SERVER_MAX_ROWS = 1000;

interface RequestCapture {
  table: string;
  url: URL;
  prefer: string;
}

/** A PostgREST stand-in: applies top-level `eq.` filters, honors
 * offset/limit, caps every response at the server's max-rows (an unranged
 * read included), answers an exact count in content-range, and fails the
 * requests `failAt` picks with a non-retryable 500. */
function serve(
  rowsByTable: Record<string, Row[]>,
  failAt?: (table: string, offset: number) => boolean,
) {
  const requests: RequestCapture[] = [];
  transport.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").at(-1) ?? "";
    const headers = new Headers(init?.headers);
    requests.push({ table, url, prefer: headers.get("prefer") ?? "" });
    const offset = Number(url.searchParams.get("offset") ?? 0);
    if (failAt?.(table, offset)) {
      return new Response(JSON.stringify({ message: "statement timeout" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    const source = (rowsByTable[table] ?? []).filter((row) =>
      [...url.searchParams].every(
        ([key, value]) =>
          !(key in row) || !value.startsWith("eq.") || String(row[key]) === value.slice(3),
      ),
    );
    const limit = Math.min(
      Number(url.searchParams.get("limit") ?? SERVER_MAX_ROWS),
      SERVER_MAX_ROWS,
    );
    const page = source.slice(offset, offset + limit);
    const contentRange =
      page.length === 0
        ? `*/${source.length}`
        : `${offset}-${offset + page.length - 1}/${source.length}`;
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { "content-type": "application/json", "content-range": contentRange },
    });
  });
  return requests;
}

const pad = (i: number) => String(i).padStart(4, "0");

function providers(n: number, org = "org-1"): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${org}-p${pad(i)}`,
    org_id: org,
    first_name: "Ana",
    last_name: `Roster${pad(i)}`,
    status: "active",
    group_id: i % 10 === 0 ? "g2" : "g1",
  }));
}

const groupAssignments = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `ga${pad(i)}`,
    org_id: "org-1",
    provider_id: `org-1-p${pad(i)}`,
    group_id: "g1",
    is_primary: true,
  }));

const licenses = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `lic${pad(i)}`,
    org_id: "org-1",
    provider_id: `org-1-p${pad(i % 700)}`,
    state: i % 2 === 0 ? "TX" : "NC",
    expiration_date: "2027-01-01",
    verified_status: "verified",
  }));

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ activeOrgId: "org-1" });
});
afterEach(() => {
  useAuthStore.setState({ activeOrgId: null });
});

describe("getProviders (the roster's provider read)", () => {
  it("returns every provider past the 1,000-row cap, org-scoped, with an id tiebreak on every page", async () => {
    const requests = serve({ providers: [...providers(1234), ...providers(40, "org-2")] });
    const rows = await getProviders();
    expect(rows).toHaveLength(1234);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1234);
    expect(rows.every((r) => r.id.startsWith("org-1-"))).toBe(true);
    expect(rows[1233]).toMatchObject({ id: "org-1-p1233", lastName: "Roster1233" });
    expect(requests.map((r) => r.url.searchParams.get("offset"))).toEqual(["0", "500", "1000"]);
    for (const request of requests) {
      expect(request.url.searchParams.get("org_id")).toBe("eq.org-1");
      expect(request.url.searchParams.get("order")).toBe("last_name.asc,id.asc");
      expect(request.prefer).toContain("count=exact");
    }
  });

  it("keeps every filter on every page and reports the filtered total", async () => {
    const withLicenseEmbed = providers(1234).map((r) => ({
      ...r,
      state_licenses: [{ state: "TX", org_id: "org-1" }],
    }));
    const requests = serve({ providers: withLicenseEmbed });
    const page = await listProviders(
      { db: supabase, orgId: "org-1", writeAudit: vi.fn() },
      { groupId: "g1", state: "TX" },
    );
    // 1,234 rows, every tenth in g2: 1,110 match, still past the cap.
    expect(page.total).toBe(1110);
    expect(page.rows).toHaveLength(1110);
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.url.searchParams.get("group_id")).toBe("eq.g1");
      expect(request.url.searchParams.get("state_licenses.state")).toBe("eq.TX");
      expect(request.url.searchParams.get("select")).toContain("state_licenses!inner");
    }
    // The embed that carried the filter never reaches the roster row.
    expect(page.rows[0]).not.toHaveProperty("stateLicenses");
  });

  it("the API's single page is unchanged: one ranged request with its exact total", async () => {
    const requests = serve({ providers: providers(1234) });
    const page = await listProviders(
      { db: supabase, orgId: "org-1", writeAudit: vi.fn() },
      {},
      { page: 3, pageSize: 25 },
    );
    expect(page.total).toBe(1234);
    expect(page.rows).toHaveLength(25);
    expect(requests).toHaveLength(1);
    expect(requests[0].url.searchParams.get("offset")).toBe("50");
    expect(requests[0].url.searchParams.get("limit")).toBe("25");
  });
});

describe("listProviderGroupAssignments (the roster's Groups column)", () => {
  it("returns every assignment past the 1,000-row cap, org-scoped and id-ordered", async () => {
    const requests = serve({ provider_group_assignments: groupAssignments(1001) });
    const rows = await listProviderGroupAssignments();
    expect(rows).toHaveLength(1001);
    expect(rows[1000]).toMatchObject({ id: "ga1000", providerId: "org-1-p1000", isPrimary: true });
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.url.searchParams.get("org_id")).toBe("eq.org-1");
      expect(request.url.searchParams.get("order")).toBe("id.asc");
      expect(request.prefer).toContain("count=exact");
    }
  });
});

describe("listOrgStateLicenses (the roster's Licenses column)", () => {
  it("returns every license past the 1,000-row cap with the same narrow projection", async () => {
    const requests = serve({ state_licenses: licenses(2001) });
    const rows = await listOrgStateLicenses();
    expect(rows).toHaveLength(2001);
    expect(rows[2000]).toMatchObject({ id: "lic2000", state: "TX", verifiedStatus: "verified" });
    expect(requests).toHaveLength(5);
    for (const request of requests) {
      expect(request.url.searchParams.get("org_id")).toBe("eq.org-1");
      expect(request.url.searchParams.get("order")).toBe("id.asc");
      expect(request.url.searchParams.get("select")).toBe(
        "id,provider_id,state,license_number,issue_date,expiration_date,verified_status",
      );
      expect(request.prefer).toContain("count=exact");
    }
  });
});

describe("a failed middle page fails the whole read", () => {
  const readers = [
    { table: "providers", rows: () => providers(1234), read: () => getProviders() },
    {
      table: "provider_group_assignments",
      rows: () => groupAssignments(1234),
      read: () => listProviderGroupAssignments(),
    },
    { table: "state_licenses", rows: () => licenses(1234), read: () => listOrgStateLicenses() },
  ];
  for (const { table, rows, read } of readers) {
    it(`${table}: rejects instead of returning the first page as the whole list`, async () => {
      const requests = serve({ [table]: rows() }, (_, offset) => offset === 500);
      await expect(read()).rejects.toMatchObject({ message: "statement timeout" });
      // It stopped at the failed page: no later page was read past the gap.
      expect(requests.map((r) => r.url.searchParams.get("offset"))).toEqual(["0", "500"]);
    });
  }
});
