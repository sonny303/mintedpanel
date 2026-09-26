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
  listContracts,
  updateContract,
  upsertContract,
} from "./contracts";

describe("contracts service", () => {
  beforeEach(() => {
    fromMock.mockReset();
    writeAuditMock.mockReset();
    appendStatusHistoryMock.mockReset();
  });

  it("lists contracts with org scoping and applied filters", async () => {
    const chain: Record<string, any> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
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
    expect(chain.eq).toHaveBeenCalledWith("org_id", "org-123");
    expect(chain.eq).toHaveBeenCalledWith("group_id", "g-1");
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
    const chain: Record<string, any> = {
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
    const getChain: Record<string, any> = {
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
    const updateChain: Record<string, any> = {
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
    const lookupChain: Record<string, any> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "c-found", contracting_status_id: "s-old" },
        error: null,
      }),
    };
    // getContract inside updateContract
    const getChain: Record<string, any> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "c-found", contracting_status_id: "s-old" },
        error: null,
      }),
    };
    // update inside updateContract
    const updateChain: Record<string, any> = {
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
