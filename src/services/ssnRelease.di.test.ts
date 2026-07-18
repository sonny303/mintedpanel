import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import { releaseSsnForFill, type SsnReleaseServiceCtx } from "./ssnRelease";

// Minimal fake of the two calls releaseSsnForFill makes: the org+provider-scoped
// credential_cases maybeSingle (wall 1), then the release_ssn_for_fill rpc
// (wall 2). Records the case filters and the rpc args so the test can assert the
// active-fill-context checks are actually applied.
interface Captured {
  caseFilters: Array<[string, unknown]>;
  rpcName?: string;
  rpcArgs?: Record<string, unknown>;
}

function makeFakeDb(opts: {
  caseData: unknown;
  caseError?: unknown;
  rpcData?: unknown;
  rpcError?: unknown;
}) {
  const cap: Captured = { caseFilters: [] };
  const db = {
    from(_table: string) {
      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          cap.caseFilters.push([col, val]);
          return builder;
        },
        maybeSingle: () => Promise.resolve({ data: opts.caseData, error: opts.caseError ?? null }),
      };
      return builder;
    },
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      cap.rpcName = name;
      cap.rpcArgs = args;
      return Promise.resolve({ data: opts.rpcData ?? null, error: opts.rpcError ?? null });
    }),
  };
  return { db: db as unknown as SupabaseClient<Database>, cap };
}

function ctx(db: SupabaseClient<Database>): SsnReleaseServiceCtx {
  return { db, orgId: "org-1" };
}

const PROVIDER_ID = "11111111-2222-4333-8444-555566667777";
const CASE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("releaseSsnForFill", () => {
  it("rejects with 404 when the case is not this org's / this provider's (never calls the RPC)", async () => {
    const { db, cap } = makeFakeDb({ caseData: null });
    const result = await releaseSsnForFill(ctx(db), PROVIDER_ID, CASE_ID);
    expect(result).toEqual({
      kind: "rejected",
      status: 404,
      message: "Case not found for this provider",
    });
    // Wall 1 scopes by case id AND org AND provider — the active-fill context.
    expect(cap.caseFilters).toEqual([
      ["id", CASE_ID],
      ["org_id", "org-1"],
      ["provider_id", PROVIDER_ID],
    ]);
    // The decrypt RPC is never reached on a wall-1 miss.
    expect(cap.rpcName).toBeUndefined();
  });

  it("releases the value when the case belongs to the org and provider", async () => {
    const { db, cap } = makeFakeDb({
      caseData: { id: CASE_ID },
      rpcData: { ssn: "900000000", ssn_last4: "0000" },
    });
    const result = await releaseSsnForFill(ctx(db), PROVIDER_ID, CASE_ID);
    expect(result).toEqual({ kind: "released", ssn: "900000000", ssnLast4: "0000" });
    // Wall 2 re-checks the same fact server-side (org + provider + case).
    expect(cap.rpcName).toBe("release_ssn_for_fill");
    expect(cap.rpcArgs).toEqual({
      p_provider_id: PROVIDER_ID,
      p_org_id: "org-1",
      p_case_id: CASE_ID,
    });
  });

  it("rejects with 404 (no value echoed) when the RPC raises", async () => {
    const { db } = makeFakeDb({
      caseData: { id: CASE_ID },
      rpcError: { message: "SSN release requires an active fill context" },
    });
    const result = await releaseSsnForFill(ctx(db), PROVIDER_ID, CASE_ID);
    expect(result).toEqual({
      kind: "rejected",
      status: 404,
      message: "SSN is not available for this fill",
    });
  });

  it("rejects with 404 when the RPC returns an empty value", async () => {
    const { db } = makeFakeDb({ caseData: { id: CASE_ID }, rpcData: { ssn: "" } });
    const result = await releaseSsnForFill(ctx(db), PROVIDER_ID, CASE_ID);
    expect(result.kind).toBe("rejected");
  });
});
