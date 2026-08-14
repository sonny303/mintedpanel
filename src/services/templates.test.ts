// E1.7b publish path (TE-9/TE-12): the service calls the RPC bound, maps the
// RPC's optimistic-concurrency RAISE to the friendly SopVersionConflictError,
// and never writes its own audit row (the RPC owns the audit write — a second
// writeAudit call would double it). Version rows are written ONLY inside the
// RPC / creation trigger, which is the TE-4 invariant's write side: this suite
// pins that the browser service performs no direct sop_template_versions
// insert.
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
  writeAudit: writeAuditMock,
}));

import { publishTemplate, authorGlobalSop, SopVersionConflictError } from "./templates";

describe("publishTemplate", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    writeAuditMock.mockReset();
  });

  it("calls the publish RPC with the expected args and returns the new version", async () => {
    rpcMock.mockResolvedValue({ data: { template_id: "t1", version: 3 }, error: null });
    const defs = [{ title: "Task", steps: [{ label: "Step" }] }];
    const result = await publishTemplate("t1", 2, "Humana KS", defs, "in-network procedure");
    expect(result).toEqual({ templateId: "t1", version: 3 });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("publish_sop_template_version", {
      p_template_id: "t1",
      p_expected_version: 2,
      p_name: "Humana KS",
      p_task_definitions: defs,
      p_change_note: "in-network procedure",
      p_required_profile_attributes: [],
    });
  });

  it("maps the RPC's sop_version_conflict RAISE to SopVersionConflictError", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "sop_version_conflict: expected version 1, head is 2" },
    });
    await expect(publishTemplate("t1", 1, "Humana KS", [])).rejects.toBeInstanceOf(
      SopVersionConflictError,
    );
  });

  it("surfaces other RPC errors unchanged", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "Not authorized" } });
    await expect(publishTemplate("t1", 1, "Humana KS", [])).rejects.toMatchObject({
      message: "Not authorized",
    });
  });

  it("never writes a client-side audit row or version insert (the RPC owns both)", async () => {
    rpcMock.mockResolvedValue({ data: { template_id: "t1", version: 2 }, error: null });
    await publishTemplate("t1", 1, "Humana KS", []);
    expect(writeAuditMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("authorGlobalSop", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    writeAuditMock.mockReset();
  });

  const createdRow = {
    id: "tpl-1",
    org_id: null,
    name: "Alignment NC",
    payer_id: "payer-1",
    states: ["NC"],
    state: "NC",
    group_id: null,
    archived: false,
    task_definitions: [],
    required_profile_attributes: [],
  };

  it("creates with a null id and returns the camelized head", async () => {
    rpcMock.mockResolvedValue({ data: createdRow, error: null });
    const result = await authorGlobalSop({
      name: "Alignment NC",
      payerId: "payer-1",
      states: ["NC"],
      groupId: null,
      taskDefinitions: [],
    });
    expect(result.id).toBe("tpl-1");
    expect(result.payerId).toBe("payer-1");
    expect(rpcMock).toHaveBeenCalledWith("author_global_sop", {
      p_id: null,
      p_name: "Alignment NC",
      p_payer_id: "payer-1",
      p_states: ["NC"],
      p_group_id: null,
      p_task_definitions: [],
      p_archived: false,
      p_required_profile_attributes: [],
    });
  });

  it("maps a duplicate-match RAISE even when PostgREST puts it in details", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "", details: "global_sop_duplicate_match: NC", code: "P0001" },
    });
    await expect(
      authorGlobalSop({ name: "Alignment NC", payerId: "payer-1", states: ["NC"] }),
    ).rejects.toThrow(/already covers NC/);
  });

  it("maps PGRST116 (composite return filtered by RLS) to a readable Error", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST116",
        message: "JSON object requested, multiple (or no) rows returned",
        details: "The result contains 0 rows",
      },
    });
    await expect(
      authorGlobalSop({ name: "Alignment NC", payerId: "payer-1", states: ["NC"] }),
    ).rejects.toThrow(/could not be read back/);
  });

  it("wraps a plain PostgREST object so the wizard does not collapse to Save failed", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "column states does not exist", code: "42703" },
    });
    const err = await authorGlobalSop({
      name: "Alignment NC",
      payerId: "payer-1",
      states: ["NC"],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("column states does not exist");
  });
});
