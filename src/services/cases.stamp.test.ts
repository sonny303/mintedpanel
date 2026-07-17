// E2.2 TE-9 — the stamping round-trip at the service layer: a stamped
// CaseTaskPayload reaches the create_case_with_tasks RPC as the snake_case
// jsonb keys the E2.1 TE-1 transport reads (sop_template_id / sop_version),
// and the reapply append (appendCaseTasks) writes the same pair on its task
// rows. Unstamped payloads round-trip as explicit NULL/NULL — the
// legacy-shaped write the both-or-neither CHECK accepts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, fromMock, writeAuditMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
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

import { appendCaseTasks, createCase, type CaseTaskPayload } from "./cases";

const stampedTask: CaseTaskPayload = {
  title: "Submit application",
  description: null,
  sopContent: [{ label: "Submit the online form" }],
  sortOrder: 0,
  dueDate: "2026-07-20",
  sopTemplateId: "tpl-humana-ks",
  sopVersion: 2,
};

const legacyTask: CaseTaskPayload = {
  title: "Follow up",
  description: null,
  sopContent: [],
  sortOrder: 1,
  dueDate: null,
};

describe("createCase stamp round-trip", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    writeAuditMock.mockReset();
  });

  it("threads sopTemplateId/sopVersion into the RPC p_tasks as sop_template_id/sop_version", async () => {
    rpcMock.mockResolvedValue({ data: { id: "case-1" }, error: null });
    await createCase({ providerId: "prov-1", payerId: "pay-1", state: "KS" }, [
      stampedTask,
      legacyTask,
    ]);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fn, args] = rpcMock.mock.calls[0] as [string, { p_tasks: Record<string, unknown>[] }];
    expect(fn).toBe("create_case_with_tasks");
    expect(args.p_tasks[0]).toMatchObject({
      title: "Submit application",
      sop_template_id: "tpl-humana-ks",
      sop_version: 2,
    });
    // Unstamped payloads write explicit NULL/NULL (legacy-shaped, CHECK-valid).
    expect(args.p_tasks[1]).toMatchObject({
      title: "Follow up",
      sop_template_id: null,
      sop_version: null,
    });
  });
});

describe("appendCaseTasks stamp round-trip (reapply, F2.2.3)", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    writeAuditMock.mockReset();
  });

  it("writes the stamp pair on appended task rows and NULL/NULL when unstamped", async () => {
    let insertedRows: Array<Record<string, unknown>> = [];
    fromMock.mockImplementation((table: string) => {
      if (table === "credential_cases") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: "case-1", provider_id: "prov-1" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "tasks") {
        return {
          insert: (rows: Array<Record<string, unknown>>) => {
            insertedRows = rows;
            return { select: async () => ({ data: [{ id: "t-1" }, { id: "t-2" }], error: null }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    await appendCaseTasks("case-1", [stampedTask, legacyTask]);
    expect(insertedRows).toHaveLength(2);
    expect(insertedRows[0]).toMatchObject({
      org_id: "org-1",
      case_id: "case-1",
      provider_id: "prov-1",
      sop_template_id: "tpl-humana-ks",
      sop_version: 2,
    });
    expect(insertedRows[1]).toMatchObject({ sop_template_id: null, sop_version: null });
    expect(writeAuditMock).toHaveBeenCalledTimes(1);
  });
});
