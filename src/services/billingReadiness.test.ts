import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

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

import { getBillingReadinessSnapshot, type BillingReadinessServiceCtx } from "./billingReadiness";

type Row = Record<string, unknown>;
const TABLES = [
  "providers",
  "provider_groups",
  "facilities",
  "payers",
  "provider_group_assignments",
  "provider_facility_assignments",
  "state_licenses",
  "credential_cases",
  "case_facilities",
  "case_status_history",
  "status_history",
  "status_configs",
];

interface RequestCapture {
  table: string;
  url: URL;
  range: string | null;
  prefer: string;
}

function createFixtureDb(fixtures: Record<string, Row[]> = {}) {
  const requests: RequestCapture[] = [];
  let failingTable: string | null = null;
  const rows: Record<string, Row[]> = Object.fromEntries(
    TABLES.map((table) => [table, fixtures[table] ?? []]),
  );

  transport.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").at(-1) ?? "";
    const headers = new Headers(init?.headers);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 1000);
    const range = `${offset}-${offset + limit - 1}`;
    requests.push({ table, url, range, prefer: headers.get("prefer") ?? "" });
    if (table === failingTable) {
      return new Response(JSON.stringify({ code: "42501", message: "synthetic read denied" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    const sourceRows = rows[table] ?? [];
    const page = sourceRows.slice(offset, offset + limit);
    const contentRange =
      sourceRows.length === 0
        ? "*/0"
        : `${offset}-${offset + page.length - 1}/${sourceRows.length}`;
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { "content-type": "application/json", "content-range": contentRange },
    });
  });

  const db = awaitableSupabaseClient();
  const ctx: BillingReadinessServiceCtx = { db, orgId: "org-1" };
  return {
    ctx,
    requests,
    rows,
    failOn(table: string) {
      failingTable = table;
    },
  };
}

function awaitableSupabaseClient(): SupabaseClient<Database> {
  // The real browser client is created by the module mock; this helper imports
  // no alternate client and only gives the service an injectable context.
  return supabaseForTest;
}

// The mocked singleton is imported through the same module as production.
import { supabase as supabaseForTest } from "@/integrations/supabase/externalClient";

function emptyProvider(id: string): Row {
  return {
    id,
    org_id: "org-1",
    first_name: "Synthetic",
    last_name: "Clinician",
    npi: null,
    taxonomy_code: "225100000X",
    status: "active",
    verification_state: "verified",
    is_test_provider: false,
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("billing readiness service query boundary", () => {
  it("org-scopes each tenant table, narrows projections, and reads global/own-org payers correctly", async () => {
    const fixture = createFixtureDb({ providers: [emptyProvider("p1")] });
    const snapshot = await getBillingReadinessSnapshot(fixture.ctx, "2026-09-25");

    expect(snapshot.providers).toHaveLength(1);
    expect(snapshot.providers[0]).toMatchObject({
      id: "p1",
      firstName: "Synthetic",
      status: "active",
    });
    expect(fixture.requests.map((request) => request.table).sort()).toEqual([...TABLES].sort());
    for (const request of fixture.requests.filter((item) => item.table !== "payers")) {
      expect(request.url.searchParams.getAll("org_id")).toContain("eq.org-1");
      expect(request.prefer).toContain("count=exact");
      expect(request.range).toBe("0-499");
    }
    const payerRequest = fixture.requests.find((request) => request.table === "payers");
    expect(payerRequest?.url.searchParams.get("or")).toContain("org_id.eq.org-1");
    expect(payerRequest?.url.searchParams.get("or")).toContain("org_id.is.null");
    expect(payerRequest?.url.searchParams.getAll("org_id")).toEqual([]);
    const providerProjection =
      fixture.requests
        .find((request) => request.table === "providers")
        ?.url.searchParams.get("select") ?? "";
    expect(providerProjection).toContain("first_name");
    for (const privateColumn of [
      "date_of_birth",
      "ssn_last4",
      "home_street",
      "home_city",
      "home_zip",
    ]) {
      expect(providerProjection).not.toContain(privateColumn);
    }
    expect(
      fixture.requests
        .find((request) => request.table === "case_status_history")
        ?.url.searchParams.get("changed_at"),
    ).toContain("gte.2026-06-27");
    expect(
      fixture.requests
        .find((request) => request.table === "status_history")
        ?.url.searchParams.get("changed_at"),
    ).toContain("gte.2026-06-27");
    expect(
      fixture.requests
        .find((request) => request.table === "case_status_history")
        ?.url.searchParams.get("select"),
    ).toContain("from_status");
    expect(
      fixture.requests
        .find((request) => request.table === "case_status_history")
        ?.url.searchParams.get("select"),
    ).toContain("actor_kind");
    expect(
      fixture.requests
        .find((request) => request.table === "case_facilities")
        ?.url.searchParams.get("select"),
    ).toContain("created_by");
  });

  it("continues through a full first page and validates the exact total before returning", async () => {
    const fixture = createFixtureDb({
      providers: Array.from({ length: 501 }, (_, index) => emptyProvider(`p${index}`)),
    });
    const snapshot = await getBillingReadinessSnapshot(fixture.ctx, "2026-09-25");
    expect(snapshot.providers).toHaveLength(501);
    expect(
      fixture.requests
        .filter((request) => request.table === "providers")
        .map((request) => request.range),
    ).toEqual(["0-499", "500-999"]);
  });

  it("rejects failed or incomplete source reads instead of returning a partial snapshot", async () => {
    const fixture = createFixtureDb();
    fixture.failOn("state_licenses");
    await expect(getBillingReadinessSnapshot(fixture.ctx, "2026-09-25")).rejects.toThrow(
      "synthetic read denied",
    );

    const incomplete = createFixtureDb();
    // The server claims two rows exist but returns an empty first page.
    transport.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      const table = url.pathname.split("/").at(-1) ?? "";
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 1000);
      incomplete.requests.push({
        table,
        url,
        range: `${offset}-${offset + limit - 1}`,
        prefer: headers.get("prefer") ?? "",
      });
      return new Response("[]", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-range": table === "providers" ? "*/2" : "*/0",
        },
      });
    });
    await expect(getBillingReadinessSnapshot(incomplete.ctx, "2026-09-25")).rejects.toThrow(
      "incomplete page set",
    );
  });
});
