// E6.7 payer governance — the payers service boundary after the manual-setup
// enabler (supersedes the E4.2 read-only posture, PM decisions 2026-07-26):
//   - getPayer reads own-org OR assigned-global rows (unchanged);
//   - createPayer/updatePayer exist but are RPC-ONLY (create_payer /
//     update_payer) — the service still issues NO direct payers
//     INSERT/UPDATE (the 20260718120000 write lockdown stands at the DB);
//   - the RPCs own validation + audit; the service maps payer_duplicate to
//     the typed PayerDuplicateError the future dialog branches on.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: fromMock, rpc: rpcMock },
}));

vi.mock("@/lib/audit", () => ({
  requireActiveOrg: () => "org-1",
  currentUserId: () => "user-1",
  writeAudit: vi.fn(),
}));

import { createPayer, getPayer, PayerDuplicateError, updatePayer } from "./payers";

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
  rpcMock.mockReset();
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

const WRITE_INPUT = {
  name: "Probe Health Plan",
  payerKind: "commercial" as const,
  states: ["NC", "SC"],
  aliases: ["PHP"],
  groupIdLabel: "Group Number",
  groupIdExpected: true,
  providerIdLabel: "Provider PIN",
  providerIdExpected: true,
  delegationNote: null,
};

describe("createPayer — RPC-only write, never a table INSERT", () => {
  it("threads the input to create_payer with the active org (snake params)", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "new-1", org_id: null, name: "Probe Health Plan", source: "manual" },
      error: null,
    });
    const created = await createPayer(WRITE_INPUT);
    expect(created.source).toBe("manual");
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("create_payer", {
      p_org_id: "org-1",
      p_name: "Probe Health Plan",
      p_payer_kind: "commercial",
      p_states: ["NC", "SC"],
      p_aliases: ["PHP"],
      p_group_id_label: "Group Number",
      p_group_id_expected: true,
      p_provider_id_label: "Provider PIN",
      p_provider_id_expected: true,
      p_delegation_note: undefined,
    });
  });

  // 3M payer-setup cleanup (Slice 1) — the create call must carry EXACTLY the
  // argument set the live create_payer declares. PostgREST resolves an RPC by
  // its named-argument set, so one extra key is not a no-op: it makes the
  // function unresolvable (PGRST202) and payer creation fails outright, which
  // is precisely how p_assign_to_org broke production. A JS fake cannot prove
  // PostgREST's resolution, so what this pins is the argument set itself.
  it("sends no argument outside the live create_payer signature", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "new-2", org_id: null, name: "Probe Health Plan", source: "manual" },
      error: null,
    });
    await createPayer(WRITE_INPUT);
    const body = (rpcMock.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      [
        "p_aliases",
        "p_delegation_note",
        "p_group_id_expected",
        "p_group_id_label",
        "p_name",
        "p_org_id",
        "p_payer_kind",
        "p_provider_id_expected",
        "p_provider_id_label",
        "p_states",
      ].sort(),
    );
    expect(body).not.toHaveProperty("p_assign_to_org");
    // Adoption rides the RPC's own transaction — never a second client write.
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("maps payer_duplicate to the typed PayerDuplicateError, keeping the detail", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message:
          'payer_duplicate: a payer named "Aetna (CVS Health)" already exists in the catalog',
      },
    });
    const failed = createPayer(WRITE_INPUT);
    await expect(failed).rejects.toBeInstanceOf(PayerDuplicateError);
    await expect(failed).rejects.toThrow(/Aetna \(CVS Health\)/);
  });

  it("maps the merged-successor duplicate the same way (one error type to branch on)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message:
          'payer_duplicate: "Optum" was merged into "UnitedHealthcare" — add that payer instead',
      },
    });
    await expect(createPayer(WRITE_INPUT)).rejects.toBeInstanceOf(PayerDuplicateError);
  });

  it("maps the named validation errors to friendly messages", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "payer_states_required" } });
    await expect(createPayer({ ...WRITE_INPUT, states: [] })).rejects.toThrow(
      "At least one operating state is required.",
    );
  });
});

describe("updatePayer — same posture, excluding the row itself", () => {
  it("threads id + input to update_payer", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "gp-1", org_id: null, name: "Renamed Plan" },
      error: null,
    });
    const updated = await updatePayer("gp-1", { ...WRITE_INPUT, name: "Renamed Plan" });
    expect(updated.name).toBe("Renamed Plan");
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith(
      "update_payer",
      expect.objectContaining({ p_org_id: "org-1", p_payer_id: "gp-1", p_name: "Renamed Plan" }),
    );
  });

  it("never sends p_assign_to_org — editing identity must not touch adoption", async () => {
    rpcMock.mockResolvedValue({ data: { id: "gp-1", org_id: null, name: "X" }, error: null });
    await updatePayer("gp-1", WRITE_INPUT);
    const body = (rpcMock.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(body).not.toHaveProperty("p_assign_to_org");
  });

  it("a rename onto an existing name raises the typed duplicate", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'payer_duplicate: a payer named "BCBS of Kansas" already exists in the catalog',
      },
    });
    await expect(updatePayer("gp-1", WRITE_INPUT)).rejects.toBeInstanceOf(PayerDuplicateError);
  });

  it("a retired/merged target maps to the not-editable message", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "payer_not_editable" } });
    await expect(updatePayer("gp-1", WRITE_INPUT)).rejects.toThrow(
      "This payer is retired or merged and can no longer be edited.",
    );
  });
});
