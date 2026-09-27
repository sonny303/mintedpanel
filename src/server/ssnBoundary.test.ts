import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiEnvelope } from "./envelope";
import type { AppRole } from "./guard";

// Keep the guard, handler, release service, and audit writer real. Only the
// Supabase client boundary is replaced; no network or vault key is involved.
vi.mock("./serviceClient", () => ({ getAuthClient: vi.fn(), getServiceClient: vi.fn() }));
vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));

import { getAuthClient, getServiceClient } from "./serviceClient";
import { authenticate, GuardError } from "./guard";
import { handleSsnRelease } from "./extensionRoutes";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ORG_ID = "44444444-4444-4444-8444-444444444444";
const PROVIDER_ID = "55555555-5555-4555-8555-555555555555";
const CASE_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_ID = "77777777-7777-4777-8777-777777777777";

interface Membership {
  user_id: string;
  org_id: string;
  role: AppRole;
}

interface CaseRow {
  id: string;
  org_id: string;
  provider_id: string;
}

interface FixtureOptions {
  role?: AppRole;
  memberships?: Membership[];
  caseRow?: Partial<CaseRow>;
  invalidClaims?: boolean;
  auditFailure?: boolean;
  rpcFailure?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  // Synthetic, never issued. Build internally so failed source excerpts and
  // assertion diffs cannot print a full SSN or bearer token.
  const ssn = [900, 12, 3456].join("");
  const bearer = ["p01", "synthetic", "bearer"].join(".");
  const auditError = new Error("Synthetic audit write failure");
  const audits: Record<string, unknown>[] = [];
  const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const tables: Record<string, Record<string, unknown>[]> = {
    memberships: (
      options.memberships ?? [
        { user_id: USER_ID, org_id: ORG_ID, role: options.role ?? "admin" },
        // Another user's membership must never authorize the caller.
        { user_id: OTHER_USER_ID, org_id: OTHER_ORG_ID, role: "admin" },
      ]
    ).map((row) => ({ ...row })),
    profiles: [{ id: USER_ID, full_name: "Synthetic Operator" }],
    credential_cases: [
      { id: CASE_ID, org_id: ORG_ID, provider_id: PROVIDER_ID, ...options.caseRow },
    ],
  };

  const db = {
    from(table: string) {
      const query = { table, filters: [] as Array<[string, unknown]> };
      queries.push(query);
      const rows = () =>
        (tables[table] ?? []).filter((row) =>
          query.filters.every(([column, value]) => row[column] === value),
        );
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq(column: string, value: unknown) {
          query.filters.push([column, value]);
          return builder;
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
          Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
        insert: async (row: Record<string, unknown>) => {
          if (table !== "audit_log") throw new Error("Unexpected boundary-test write");
          audits.push(row);
          return { data: null, error: options.auditFailure ? auditError : null };
        },
      };
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return options.rpcFailure
        ? { data: null, error: { message: "Synthetic release rejection" } }
        : { data: { ssn, ssn_last4: ssn.slice(-4) }, error: null };
    },
  };

  vi.mocked(getAuthClient).mockReturnValue({
    auth: {
      getClaims: async () =>
        options.invalidClaims
          ? { data: null, error: new Error("Synthetic invalid claims") }
          : { data: { claims: { sub: USER_ID } }, error: null },
    },
  } as never);
  vi.mocked(getServiceClient).mockReturnValue(db as never);

  async function run(requestedOrgId: string | null = ORG_ID, anonymous = false) {
    const url = new URL(`https://example.test/api/providers/${PROVIDER_ID}/ssn-release`);
    url.searchParams.set("caseId", CASE_ID);
    const headers: Record<string, string> = anonymous ? {} : { authorization: `Bearer ${bearer}` };
    if (requestedOrgId) headers["x-org-id"] = requestedOrgId;
    const request = new Request(url, { headers });
    const ctx = await authenticate(request, request.headers.get("x-org-id"));
    return handleSsnRelease(PROVIDER_ID, url, ctx);
  }

  return {
    run,
    queries,
    rpcCalls,
    audits,
    auditError,
    hasSecret: (value: unknown) => {
      const serialized = JSON.stringify(value) ?? "";
      return serialized.includes(ssn) || serialized.includes(bearer);
    },
    isExpectedRelease: (value: unknown) => {
      const data = value as Record<string, unknown> | null;
      return data?.ssn === ssn && data?.ssnLast4 === ssn.slice(-4);
    },
  };
}

async function expectGuardDenial(operation: Promise<Response>, status: number) {
  const outcome: unknown = await operation.then(
    () => null,
    (error: unknown) => error,
  );
  expect(outcome instanceof GuardError && outcome.status === status).toBe(true);
}

beforeEach(() => vi.clearAllMocks());

describe("SSN fill release through the real application boundary", () => {
  it.each([
    { label: "anonymous", anonymous: true, invalidClaims: false },
    { label: "invalid credentials", anonymous: false, invalidClaims: true },
  ])("rejects $label before database access", async ({ anonymous, invalidClaims }) => {
    const f = fixture({ invalidClaims });
    await expectGuardDenial(f.run(ORG_ID, anonymous), 401);
    expect(f.queries.length).toBe(0);
    expect(f.rpcCalls.length).toBe(0);
    expect(f.audits.length).toBe(0);
  });

  it("rejects an authenticated caller with no membership", async () => {
    const f = fixture({ memberships: [] });
    await expectGuardDenial(f.run(), 403);
    expect(f.rpcCalls.length).toBe(0);
    expect(f.audits.length).toBe(0);
  });

  it("rejects a requested foreign org even when another user is its admin", async () => {
    const f = fixture();
    await expectGuardDenial(f.run(OTHER_ORG_ID), 403);
    expect(f.rpcCalls.length).toBe(0);
    expect(f.audits.length).toBe(0);
  });

  it("rejects billing before case lookup or release", async () => {
    const f = fixture({ role: "billing" });
    const response = await f.run();
    const payload = (await response.json()) as ApiEnvelope<unknown>;
    expect(response.status).toBe(403);
    expect(payload.data === null && !f.hasSecret(payload)).toBe(true);
    expect(f.queries.some((query) => query.table === "credential_cases")).toBe(false);
    expect(f.rpcCalls.length).toBe(0);
    expect(f.audits.length).toBe(0);
  });

  it.each([
    { label: "another org", caseRow: { org_id: OTHER_ORG_ID } },
    { label: "another provider", caseRow: { provider_id: OTHER_ID } },
    { label: "a different case", caseRow: { id: OTHER_ID } },
  ])("rejects a case belonging to $label without calling the RPC", async ({ caseRow }) => {
    const f = fixture({ caseRow });
    const response = await f.run();
    const payload = (await response.json()) as ApiEnvelope<unknown>;
    expect(response.status).toBe(404);
    expect(payload.data === null && !f.hasSecret(payload)).toBe(true);
    expect(f.rpcCalls.length).toBe(0);
    expect(f.audits.length).toBe(0);
  });

  it.each(["admin", "specialist"] as const)(
    "releases for a matching %s with one scoped audit and no-store",
    async (role) => {
      const f = fixture({ role });
      const response = await f.run(null);
      const payload = (await response.json()) as ApiEnvelope<unknown>;
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(f.isExpectedRelease(payload.data)).toBe(true);
      expect(
        JSON.stringify(f.rpcCalls) ===
          JSON.stringify([
            {
              name: "release_ssn_for_fill",
              args: { p_provider_id: PROVIDER_ID, p_org_id: ORG_ID, p_case_id: CASE_ID },
            },
          ]),
      ).toBe(true);
      expect(f.audits.length).toBe(1);
      const audit = f.audits[0];
      expect(audit.org_id === ORG_ID && audit.user_id === USER_ID).toBe(true);
      expect(audit.entity_id === PROVIDER_ID && audit.entity_type === "provider_ssn_vault").toBe(
        true,
      );
      expect(audit.action_type === "READ").toBe(true);
      const context = audit.after as Record<string, unknown>;
      expect(context.caseId === CASE_ID && context.route === "/api/providers/:id/ssn-release").toBe(
        true,
      );
      expect(f.hasSecret(f.audits)).toBe(false);
    },
  );

  it("returns no value and writes no audit when the release RPC rejects", async () => {
    const f = fixture({ rpcFailure: true });
    const response = await f.run();
    const payload = (await response.json()) as ApiEnvelope<unknown>;
    expect(response.status).toBe(404);
    expect(payload.data === null && !f.hasSecret(payload)).toBe(true);
    expect(f.rpcCalls.length).toBe(1);
    expect(f.audits.length).toBe(0);
  });

  it("does not return a response when the real audit writer fails", async () => {
    const f = fixture({ auditFailure: true });
    const outcome: unknown = await f.run().then(
      () => null,
      (error: unknown) => error,
    );
    expect(outcome === f.auditError).toBe(true);
    expect(f.rpcCalls.length).toBe(1);
    expect(f.audits.length).toBe(1);
    expect(f.hasSecret(f.audits)).toBe(false);
  });
});
