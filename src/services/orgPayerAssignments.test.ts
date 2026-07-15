import { beforeEach, describe, expect, it, vi } from "vitest";

// Browser-path service: it imports the anon client + audit helpers directly.
// Mock both so this suite drives the query builder / RPC and observes audit
// writes without a real env or auth store. camelizeRow and isActiveAssignment
// (pure libs) run for real.
const holder = vi.hoisted(() => ({
  from: (_table: string): unknown => {
    throw new Error("no fake db installed");
  },
}));
const rpcMock = vi.hoisted(() => vi.fn());
const writeAuditMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: (table: string) => holder.from(table), rpc: rpcMock },
}));

vi.mock("@/lib/audit", () => ({
  writeAudit: writeAuditMock,
  requireActiveOrg: () => "org-1",
}));

import { addAssignment, archiveAssignment, reactivateAssignment } from "./orgPayerAssignments";

interface Captured {
  table: string;
  op?: "insert" | "update";
  selectCols?: string;
  payload?: unknown;
  filters: Array<[string, unknown]>;
}

function makeFakeDb(results: Array<{ data: unknown; error?: unknown }>) {
  const captures: Captured[] = [];
  let cursor = 0;
  const take = () => results[Math.min(cursor++, results.length - 1)] ?? { data: null };
  const from = (table: string) => {
    const cap: Captured = { table, filters: [] };
    captures.push(cap);
    const builder: Record<string, unknown> = {
      select(cols: string) {
        cap.selectCols = cols;
        return builder;
      },
      insert(payload: unknown) {
        cap.op = "insert";
        cap.payload = payload;
        return builder;
      },
      update(payload: unknown) {
        cap.op = "update";
        cap.payload = payload;
        return builder;
      },
      eq(col: string, val: unknown) {
        cap.filters.push([col, val]);
        return builder;
      },
      maybeSingle: () => Promise.resolve(take()),
      single: () => Promise.resolve(take()),
    };
    return builder;
  };
  return { from, captures };
}

function installDb(results: Array<{ data: unknown; error?: unknown }>) {
  const fake = makeFakeDb(results);
  holder.from = fake.from;
  return fake.captures;
}

const activeRow = {
  id: "opa-1",
  org_id: "org-1",
  payer_id: "pay-1",
  starter: false,
  status: "active",
  archived_at: null,
  created_at: "2026-07-15T00:00:00Z",
};
const archivedRow = { ...activeRow, status: "archived", archived_at: "2026-07-15T00:00:00Z" };

beforeEach(() => {
  writeAuditMock.mockReset();
  rpcMock.mockReset();
});

describe("addAssignment (idempotent)", () => {
  it("inserts a fresh active subscription + a CREATE audit when none exists", async () => {
    const captures = installDb([{ data: null }, { data: activeRow }]);
    const result = await addAssignment("pay-1");

    expect(result.status).toBe("active");
    expect(captures[1].op).toBe("insert");
    expect(captures[1].payload).toEqual({ org_id: "org-1", payer_id: "pay-1", status: "active" });
    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "CREATE",
        entityType: "org_payer_assignment",
        entityId: "opa-1",
      }),
    );
  });

  it("is a no-op (no insert, no audit) when the subscription is already active", async () => {
    const captures = installDb([{ data: activeRow }]);
    const result = await addAssignment("pay-1");

    expect(result.id).toBe("opa-1");
    expect(captures).toHaveLength(1); // only the existence read
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("reactivates an archived subscription (deny-then-reapply) with an UPDATE audit", async () => {
    const captures = installDb([{ data: archivedRow }, { data: activeRow }]);
    const result = await addAssignment("pay-1");

    expect(result.status).toBe("active");
    expect(captures[1].op).toBe("update");
    expect(captures[1].payload).toEqual({ status: "active", archived_at: null });
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "UPDATE", entityType: "org_payer_assignment" }),
    );
  });
});

describe("reactivateAssignment", () => {
  it("flips status to active and NEVER touches payer_network_targets (no scope recreation)", async () => {
    const captures = installDb([{ data: activeRow }]);
    await reactivateAssignment("pay-1");

    expect(captures).toHaveLength(1);
    expect(captures[0].table).toBe("org_payer_assignments");
    expect(captures[0].op).toBe("update");
    expect(captures[0].payload).toEqual({ status: "active", archived_at: null });
    // Reactivation must not recreate scope — no target write anywhere.
    expect(captures.some((c) => c.table === "payer_network_targets")).toBe(false);
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "UPDATE", entityType: "org_payer_assignment" }),
    );
  });
});

describe("archiveAssignment", () => {
  it("archives via the transactional RPC, audits once, and reports the target cascade count", async () => {
    installDb([]); // the service must not touch tables directly
    rpcMock.mockResolvedValue({
      data: { assignment: archivedRow, archived_target_count: 2 },
      error: null,
    });

    const result = await archiveAssignment("pay-1");

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("archive_org_payer_assignment", {
      p_org_id: "org-1",
      p_payer_id: "pay-1",
    });
    expect(result.archivedTargetCount).toBe(2);
    expect(result.assignment.status).toBe("archived");
    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "UPDATE",
        entityType: "org_payer_assignment",
        entityId: "opa-1",
        description: expect.stringContaining("2 network targets"),
      }),
    );
  });

  it("maps the admin-only RPC RAISE to a friendly error and writes no audit", async () => {
    installDb([]);
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "error: org_payer_assignment_admin_only" },
    });

    await expect(archiveAssignment("pay-1")).rejects.toThrow(/administrator/i);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });
});
