import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, fromMock, writeAuditMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(() => {
    throw new Error("setDefaultRole must not issue direct table updates");
  }),
  writeAuditMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { rpc: rpcMock, from: fromMock },
}));

vi.mock("@/lib/audit", () => ({
  requireActiveOrg: () => "org-1",
  currentUserId: () => "user-1",
  writeAudit: writeAuditMock,
}));

import { setDefaultRole } from "./parties";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockClear();
  writeAuditMock.mockReset();
});

describe("setDefaultRole", () => {
  it("promotes through one transactional RPC and audits success", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await setDefaultRole("party-1", "billing_contact");

    expect(rpcMock).toHaveBeenCalledWith("set_default_party_role", {
      p_org_id: "org-1",
      p_party_id: "party-1",
      p_role_key: "billing_contact",
    });
    expect(fromMock).not.toHaveBeenCalled();
    expect(writeAuditMock).toHaveBeenCalledWith({
      actionType: "UPDATE",
      entityType: "party_role_assignment",
      entityId: "party-1",
      after: { roleKey: "billing_contact", isDefault: true },
    });
  });

  it("reports a missing target assignment clearly and does not audit", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "party_role_default_assignment_not_found" },
    });

    await expect(setDefaultRole("party-missing", "billing_contact")).rejects.toThrow(
      "This person no longer holds that role in this organization.",
    );
    expect(fromMock).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("leaves rollback to the single RPC transaction when promotion fails", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "promotion failed" },
    });

    await expect(setDefaultRole("party-1", "billing_contact")).rejects.toMatchObject({
      message: "promotion failed",
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(fromMock).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });
});
