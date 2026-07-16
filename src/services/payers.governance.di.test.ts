// E4.2 payer governance — the payers service boundary:
//   - updatePayer REJECTS a Minted-managed global row with the typed domain
//     error BEFORE any write reaches the client (never the silent zero-row
//     miss the own-org RLS would produce);
//   - getPayer reads own-org OR assigned-global rows (the RLS-safe read path);
//   - an own-org legacy row still updates through the guarded path;
//   - the service exposes NO create — canonical identities come from the
//     catalog, so a duplicate legacy payer can never be minted here.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, writeAuditMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  writeAuditMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: fromMock },
}));

vi.mock("@/lib/audit", () => ({
  requireActiveOrg: () => "org-1",
  currentUserId: () => "user-1",
  writeAudit: writeAuditMock,
}));

import * as payersService from "./payers";
import { getPayer, GlobalPayerUpdateError, updatePayer } from "./payers";

interface QueryLogEntry {
  method: string;
  args: unknown[];
}

// A minimal PostgREST-shaped chain fake: records calls, resolves maybeSingle/
// single from a queue of rows.
function chainFor(log: QueryLogEntry[], result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "update", "eq", "or", "order"]) {
    chain[method] = (...args: unknown[]) => {
      log.push({ method, args });
      return chain;
    };
  }
  chain.maybeSingle = () => {
    log.push({ method: "maybeSingle", args: [] });
    return Promise.resolve(result);
  };
  chain.single = () => {
    log.push({ method: "single", args: [] });
    return Promise.resolve(result);
  };
  return chain;
}

beforeEach(() => {
  fromMock.mockReset();
  writeAuditMock.mockReset();
});

describe("updatePayer — global-row governance", () => {
  it("rejects a global (org_id NULL) row with GlobalPayerUpdateError before any write", async () => {
    const log: QueryLogEntry[] = [];
    fromMock.mockReturnValue(
      chainFor(log, {
        data: { id: "gp-1", org_id: null, name: "Aetna (CVS Health)" },
        error: null,
      }),
    );

    await expect(updatePayer("gp-1", { isActive: false })).rejects.toBeInstanceOf(
      GlobalPayerUpdateError,
    );
    // The read ran; no update ever did.
    expect(log.some((e) => e.method === "update")).toBe(false);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("updates an own-org legacy row through the guarded, audited path", async () => {
    const legacyRow = { id: "lp-1", org_id: "org-1", name: "BCBS of Kansas", is_active: true };
    const readLog: QueryLogEntry[] = [];
    const writeLog: QueryLogEntry[] = [];
    fromMock
      .mockReturnValueOnce(chainFor(readLog, { data: legacyRow, error: null }))
      .mockReturnValueOnce(
        chainFor(writeLog, { data: { ...legacyRow, is_active: false }, error: null }),
      );

    const after = await updatePayer("lp-1", { isActive: false });
    expect(after.isActive).toBe(false);
    // The write is still org-scoped (the RLS-mirrored backstop filter).
    const eqArgs = writeLog.filter((e) => e.method === "eq").map((e) => e.args);
    expect(eqArgs).toContainEqual(["org_id", "org-1"]);
    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    expect(writeAuditMock.mock.calls[0][0]).toMatchObject({
      actionType: "UPDATE",
      entityType: "payer",
      entityId: "lp-1",
    });
  });

  it("a missing/cross-org id fails loudly without a write", async () => {
    const log: QueryLogEntry[] = [];
    fromMock.mockReturnValue(chainFor(log, { data: null, error: null }));
    await expect(updatePayer("nope", { isActive: true })).rejects.toThrow("Payer not found");
    expect(log.some((e) => e.method === "update")).toBe(false);
  });
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

describe("payer creation is gone from the service surface", () => {
  it("exports no createPayer — a duplicate legacy identity can't be minted", () => {
    expect("createPayer" in payersService).toBe(false);
  });
});
