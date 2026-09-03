// deleteCase service contract: admin-only gate + delete_case RPC args.
// The RPC owns the cascade + audit row; this pins the client boundary.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, fromMock, writeAuditMock, currentUserRoleMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
  writeAuditMock: vi.fn(),
  currentUserRoleMock: vi.fn((): "admin" | "specialist" | "billing" | null => "admin"),
}));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { rpc: rpcMock, from: fromMock },
}));

vi.mock("@/lib/audit", () => ({
  requireActiveOrg: () => "org-1",
  currentUserId: () => "user-1",
  currentUserRole: () => currentUserRoleMock(),
  writeAudit: writeAuditMock,
}));

import { deleteCase } from "./cases";

describe("deleteCase", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    writeAuditMock.mockReset();
    currentUserRoleMock.mockReset();
    currentUserRoleMock.mockReturnValue("admin");
  });

  it("calls delete_case with org + case id and does not writeAudit", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await deleteCase("case-1");
    expect(rpcMock).toHaveBeenCalledWith("delete_case", {
      p_org_id: "org-1",
      p_case_id: "case-1",
    });
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("rejects non-admin callers before the RPC", async () => {
    currentUserRoleMock.mockReturnValue("specialist");
    await expect(deleteCase("case-1")).rejects.toThrow(/Only an admin/);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("maps Not authorized from the RPC", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "Not authorized" } });
    await expect(deleteCase("case-1")).rejects.toThrow(/Only an admin/);
  });

  it("maps Case not found from the RPC", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "Case not found" } });
    await expect(deleteCase("case-1")).rejects.toThrow(/Case not found/);
  });
});
