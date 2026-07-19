// E4.2 payer governance — the payers service boundary (read-only since the
// 2026-07-18 close-out):
//   - getPayer reads own-org OR assigned-global rows (the RLS-safe read path;
//     the own-org disjunct is vestigial on live data post-wipe but keeps local
//     seed fixtures readable);
//   - the service exposes NO create and NO update — canonical identities are
//     Minted-curated, org-varying config lives in org_payer_settings, and the
//     DB write grants/policies were revoked (`20260718120000`).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: fromMock },
}));

vi.mock("@/lib/audit", () => ({
  requireActiveOrg: () => "org-1",
  currentUserId: () => "user-1",
  writeAudit: vi.fn(),
}));

import * as payersService from "./payers";
import { getPayer } from "./payers";

interface QueryLogEntry {
  method: string;
  args: unknown[];
}

// A minimal PostgREST-shaped chain fake: records calls, resolves maybeSingle
// from the provided result.
function chainFor(log: QueryLogEntry[], result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "or", "order"]) {
    chain[method] = (...args: unknown[]) => {
      log.push({ method, args });
      return chain;
    };
  }
  chain.maybeSingle = () => {
    log.push({ method: "maybeSingle", args: [] });
    return Promise.resolve(result);
  };
  return chain;
}

beforeEach(() => {
  fromMock.mockReset();
});

describe("getPayer — the RLS-safe global read path", () => {
  it("reads own-org OR global rows (RLS narrows the global disjunct to assigned)", async () => {
    const log: QueryLogEntry[] = [];
    fromMock.mockReturnValue(
      chainFor(log, {
        data: { id: "gp-1", org_id: null, name: "Aetna (CVS Health)" },
        error: null,
      }),
    );
    const p = await getPayer("gp-1");
    expect(p?.orgId).toBeNull();
    const orArgs = log.filter((e) => e.method === "or").map((e) => e.args[0]);
    expect(orArgs).toEqual(["org_id.eq.org-1,org_id.is.null"]);
  });
});

describe("payer writes are gone from the service surface", () => {
  it("exports no createPayer and no updatePayer — payers rows are Minted-managed", () => {
    expect("createPayer" in payersService).toBe(false);
    expect("updatePayer" in payersService).toBe(false);
  });
});
