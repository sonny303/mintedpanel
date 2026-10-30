import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, writeAuditMock, appendStatusHistoryMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  writeAuditMock: vi.fn(),
  appendStatusHistoryMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: fromMock },
}));

vi.mock("@/lib/audit", () => ({
  requireActiveOrg: () => "org-123",
  writeAudit: writeAuditMock,
}));

vi.mock("@/services/cases", () => ({
  appendStatusHistory: appendStatusHistoryMock,
}));

import {
  createContract,
  getContract,
  isMissingContractSpecialtyKeyError,
  listContracts,
  updateContract,
  updateContractStatus,
  upsertContract,
} from "./contracts";

describe("contracts service", () => {
  beforeEach(() => {
    fromMock.mockReset();
    writeAuditMock.mockReset();
    appendStatusHistoryMock.mockReset();
  });

  it("lists contracts with org scoping and applied filters", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      // The list reads to completion: one page, with the exact count.
      range: vi.fn().mockResolvedValue({
        count: 1,
        data: [
          {
            id: "c-1",
            org_id: "org-123",
            group_id: "g-1",
            payer_id: "p-1",
            state: "KS",
            contracting_status_id: "s-1",
            tentative_effective_date: "2026-10-01",
            specialty: "Physical Therapy",
            specialty_key: "pt",
            notes: "Humana note",
          },
        ],
        error: null,
      }),
    };
    fromMock.mockReturnValue(chain);

    const result = await listContracts({ groupId: "g-1" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c-1");
    expect(result[0].tentativeEffectiveDate).toBe("2026-10-01");
    expect(result[0].specialty).toBe("Physical Therapy");
    expect(result[0].specialtyKey).toBe("pt");
    expect(chain.select).toHaveBeenCalledWith(expect.stringContaining("specialty_key"), {
      count: "exact",
    });
    expect(chain.eq).toHaveBeenCalledWith("org_id", "org-123");
    expect(chain.eq).toHaveBeenCalledWith("group_id", "g-1");
    expect(chain.order).toHaveBeenCalledWith("id", { ascending: true });
    expect(chain.range).toHaveBeenCalledWith(0, 499);
  });

  it("creates a new contract and logs audit and status history", async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: "c-created",
        org_id: "org-123",
        group_id: "g-1",
        payer_id: "p-1",
        state: "KS",
        contracting_status_id: "stat-1",
        tentative_effective_date: "2026-11-01",
        specialty: "Multi-Specialty",
      },
      error: null,
    });
    const chain: Record<string, unknown> = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: singleMock,
    };
    fromMock.mockReturnValue(chain);

    const created = await createContract({
      groupId: "g-1",
      payerId: "p-1",
      state: "ks",
      contractingStatusId: "stat-1",
      tentativeEffectiveDate: "2026-11-01",
      specialty: "Multi-Specialty",
    });

    expect(created.id).toBe("c-created");
    expect(created.state).toBe("KS");
    expect(appendStatusHistoryMock).toHaveBeenCalledWith({
      track: "contracting",
      contractId: "c-created",
      fromStatusId: null,
      toStatusId: "stat-1",
    });
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CREATE",
        entityType: "contract",
        entityId: "c-created",
      }),
    );
  });

  it("updates an existing contract and records status changes", async () => {
    // 1st call for getContract before
    const getChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "c-existing",
          org_id: "org-123",
          group_id: "g-1",
          payer_id: "p-1",
          state: "OR",
          contracting_status_id: "stat-1",
        },
        error: null,
      }),
    };
    // 2nd call for update
    const updateChain: Record<string, unknown> = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: "c-existing",
          org_id: "org-123",
          group_id: "g-1",
          payer_id: "p-1",
          state: "OR",
          contracting_status_id: "stat-2",
          tentative_effective_date: "2026-12-01",
        },
        error: null,
      }),
    };

    fromMock.mockReturnValueOnce(getChain).mockReturnValueOnce(updateChain);

    const updated = await updateContract("c-existing", {
      contractingStatusId: "stat-2",
      tentativeEffectiveDate: "2026-12-01",
    });

    expect(updated.id).toBe("c-existing");
    expect(updated.contractingStatusId).toBe("stat-2");
    expect(appendStatusHistoryMock).toHaveBeenCalledWith({
      track: "contracting",
      contractId: "c-existing",
      fromStatusId: "stat-1",
      toStatusId: "stat-2",
    });
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        entityType: "contract",
        entityId: "c-existing",
      }),
    );
  });

  it("upsertContract updates when contract exists and inserts when new", async () => {
    // 1st lookup in upsertContract
    const lookupChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "c-found", contracting_status_id: "s-old" },
        error: null,
      }),
    };
    // getContract inside updateContract
    const getChain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "c-found", contracting_status_id: "s-old" },
        error: null,
      }),
    };
    // update inside updateContract
    const updateChain: Record<string, unknown> = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: "c-found",
          org_id: "org-123",
          group_id: "g-1",
          payer_id: "p-1",
          state: "WA",
          contracting_status_id: "s-new",
        },
        error: null,
      }),
    };

    fromMock
      .mockReturnValueOnce(lookupChain)
      .mockReturnValueOnce(getChain)
      .mockReturnValueOnce(updateChain);

    const res = await upsertContract({
      groupId: "g-1",
      payerId: "p-1",
      state: "WA",
      contractingStatusId: "s-new",
    });

    expect(res.id).toBe("c-found");
    expect(res.contractingStatusId).toBe("s-new");
  });
});

// The 4-part key (group, payer, state, specialty_key) — migration
// 20261029120000, PM decision D11.
describe("contracts service — specialty key", () => {
  beforeEach(() => {
    fromMock.mockReset();
    writeAuditMock.mockReset();
    appendStatusHistoryMock.mockReset();
  });

  function lookupChain(found: { id: string; contracting_status_id: string | null } | null) {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: found, error: null }),
    };
  }

  function insertChain(row: Record<string, unknown>) {
    return {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
  }

  function updateChain(row: Record<string, unknown>) {
    return {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
  }

  const ROW = {
    id: "c-new",
    org_id: "org-123",
    group_id: "g-1",
    payer_id: "p-1",
    state: "KS",
    contracting_status_id: "s-1",
  };

  it("matches on org, group, payer, normalized state and specialty_key", async () => {
    const lookup = lookupChain(null);
    const insert = insertChain({ ...ROW, specialty_key: "nutrition" });
    fromMock.mockReturnValueOnce(lookup).mockReturnValueOnce(insert);

    await upsertContract({
      groupId: "g-1",
      payerId: "p-1",
      state: " ks ",
      specialtyKey: "nutrition",
      contractingStatusId: "s-1",
    });

    expect(lookup.eq.mock.calls).toEqual([
      ["org_id", "org-123"],
      ["group_id", "g-1"],
      ["payer_id", "p-1"],
      ["state", "KS"],
      ["specialty_key", "nutrition"],
    ]);
  });

  it("creates a specialty's own record with that key when only the shared one exists", async () => {
    // The lookup is keyed on 'pt', so the group's 'all' record at the same
    // group/payer/state is not found and is never updated.
    const lookup = lookupChain(null);
    const insert = insertChain({ ...ROW, specialty_key: "pt" });
    fromMock.mockReturnValueOnce(lookup).mockReturnValueOnce(insert);

    const created = await upsertContract({
      groupId: "g-1",
      payerId: "p-1",
      state: "KS",
      specialtyKey: "pt",
      contractingStatusId: "s-1",
    });

    expect(lookup.eq).toHaveBeenCalledWith("specialty_key", "pt");
    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ specialty_key: "pt", state: "KS", org_id: "org-123" }),
    );
    expect(created.specialtyKey).toBe("pt");
    expect(fromMock).toHaveBeenCalledTimes(2);
  });

  it("treats a missing specialtyKey as 'all' for the match and the new record", async () => {
    const lookup = lookupChain(null);
    const insert = insertChain({ ...ROW, specialty_key: "all" });
    fromMock.mockReturnValueOnce(lookup).mockReturnValueOnce(insert);

    await upsertContract({ groupId: "g-1", payerId: "p-1", state: "KS" });

    expect(lookup.eq).toHaveBeenCalledWith("specialty_key", "all");
    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({ specialty_key: "all" }));
  });

  it("never writes the deprecated free-text specialty", async () => {
    const insert = insertChain({ ...ROW, specialty_key: "all" });
    fromMock.mockReturnValueOnce(insert);

    await createContract({
      groupId: "g-1",
      payerId: "p-1",
      state: "KS",
      specialty: "Physical Therapy",
    });

    const payload = insert.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("specialty");
    expect(payload.specialty_key).toBe("all");
  });

  it("updates the matched record without changing its specialty_key", async () => {
    const lookup = lookupChain({ id: "c-pt", contracting_status_id: "s-old" });
    const get = lookupChain({ id: "c-pt", contracting_status_id: "s-old" });
    const update = updateChain({
      ...ROW,
      id: "c-pt",
      specialty_key: "pt",
      contracting_status_id: "s-new",
    });
    fromMock.mockReturnValueOnce(lookup).mockReturnValueOnce(get).mockReturnValueOnce(update);

    const saved = await upsertContract({
      groupId: "g-1",
      payerId: "p-1",
      state: "KS",
      specialtyKey: "pt",
      specialty: "Nutrition",
      contractingStatusId: "s-new",
    });

    expect(lookup.eq).toHaveBeenCalledWith("specialty_key", "pt");
    const patch = update.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch).not.toHaveProperty("specialty_key");
    expect(patch).not.toHaveProperty("specialty");
    expect(patch.contracting_status_id).toBe("s-new");
    expect(update.eq).toHaveBeenCalledWith("id", "c-pt");
    expect(saved.specialtyKey).toBe("pt");
  });

  it("drops specialty_key and specialty from a direct update or status change", async () => {
    const get = lookupChain({ id: "c-1", contracting_status_id: "s-1" });
    const update = updateChain({ ...ROW, id: "c-1", specialty_key: "all" });
    fromMock.mockReturnValueOnce(get).mockReturnValueOnce(update);

    // A caller bypassing the ContractPatch type still cannot re-key a record.
    await updateContract("c-1", {
      notes: "n",
      specialty: "PT",
      ...({ specialtyKey: "pt" } as Record<string, unknown>),
    });
    const patch = update.update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch).not.toHaveProperty("specialty_key");
    expect(patch).not.toHaveProperty("specialty");
    expect(patch.notes).toBe("n");

    const statusGet = lookupChain({ id: "c-1", contracting_status_id: "s-1" });
    const statusUpdate = updateChain({ ...ROW, id: "c-1", contracting_status_id: "s-2" });
    fromMock.mockReturnValueOnce(statusGet).mockReturnValueOnce(statusUpdate);
    await updateContractStatus("c-1", "s-2", { specialtyKey: "nutrition", specialty: "x" });
    const statusPatch = statusUpdate.update.mock.calls[0][0] as Record<string, unknown>;
    expect(statusPatch).toEqual({ contracting_status_id: "s-2" });
  });
});

// Deploy-order safety: the app can reach a database before the operator
// applies 20261029120000. Reads fall back; writes do not.
describe("contracts service — before specialty_key exists", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  const MISSING_42703 = {
    code: "42703",
    message: "column contracts.specialty_key does not exist",
    details: null,
    hint: null,
  };

  it("recognises PostgREST's two spellings of the missing column, and nothing else", () => {
    expect(isMissingContractSpecialtyKeyError(MISSING_42703)).toBe(true);
    expect(
      isMissingContractSpecialtyKeyError({
        code: "PGRST204",
        message: "Could not find the 'specialty_key' column of 'contracts' in the schema cache",
      }),
    ).toBe(true);
    expect(
      isMissingContractSpecialtyKeyError({
        code: "42703",
        message: "column contracts.tentative_effective_date does not exist",
      }),
    ).toBe(false);
    expect(
      isMissingContractSpecialtyKeyError({ code: "42501", message: "specialty_key: denied" }),
    ).toBe(false);
    expect(isMissingContractSpecialtyKeyError(new Error("fetch failed"))).toBe(false);
    expect(isMissingContractSpecialtyKeyError(null)).toBe(false);
    expect(isMissingContractSpecialtyKeyError("specialty_key")).toBe(false);
  });

  it("lists without specialty_key when the column is missing; rows carry no key", async () => {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi
        .fn()
        .mockResolvedValueOnce({ data: null, count: null, error: MISSING_42703 })
        .mockResolvedValueOnce({
          count: 1,
          data: [{ id: "c-1", group_id: "g-1", payer_id: "p-1", state: "KS" }],
          error: null,
        }),
    };
    fromMock.mockReturnValue(chain);

    const rows = await listContracts({ groupId: "g-1" });

    const selects = (chain.select as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(selects).toHaveLength(2);
    expect(selects[0]).toContain("specialty_key");
    expect(selects[1]).not.toContain("specialty_key");
    expect(chain.eq).toHaveBeenCalledWith("group_id", "g-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("specialtyKey");
  });

  it("does not retry on any other error", async () => {
    const failure = { code: "500", message: "upstream timeout" };
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: null, count: null, error: failure }),
    };
    fromMock.mockReturnValue(chain);

    await expect(listContracts()).rejects.toBe(failure);
    expect(chain.select).toHaveBeenCalledTimes(1);
  });
});
