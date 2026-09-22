// deleteCase service contract: admin-only gate + delete_case RPC args.
// The RPC owns the cascade + audit row; this pins the client boundary.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("translates the generation-ledger check via translateDbError (unpatched hosts)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "23514",
        message:
          'new row for relation "case_generation_run_rows" violates check constraint "case_generation_run_rows_created_case_check"',
      },
    });
    await expect(deleteCase("case-1")).rejects.toThrow(
      /cannot be deleted while linked to generation run records/,
    );
  });
});

describe("delete_case / generation-ledger migration contract", () => {
  // Do NOT edit the applied 20260903210000_delete_case_rpc.sql — the SET NULL
  // + CHECK conflict is fixed by a follow-up migration.
  it("drops the table CHECK and adds an INSERT-only created⇒case_id trigger", () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        "../../supabase/migrations/20260921220000_fix_case_generation_run_rows_created_case_check.sql",
      ),
      "utf-8",
    );
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS case_generation_run_rows_created_case_check");
    expect(sql).toContain("BEFORE INSERT ON public.case_generation_run_rows");
    expect(sql).toContain("trg_case_generation_run_rows_created_case_check");
    expect(sql).toContain("case_id is required when disposition is created");
  });
});
