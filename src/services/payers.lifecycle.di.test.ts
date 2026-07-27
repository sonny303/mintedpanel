// E6.8 F6.8.4 — the payer-lifecycle service contract at the boundary: the
// three RPCs receive the right params with the active org, successes
// round-trip camelized, and each named RPC error maps to the typed result
// the future Manage tab / Show-archived toggle branch on (open-case count,
// merge case-collision list, the lifecycle guard messages).
//
// The RPCs' DB-level guarantees — all-or-nothing merge, the open-case block
// writing nothing, grant floors — are transactional Postgres properties a JS
// fake can't prove (the repo's documented limitation); they were verified by
// rollback-wrapped probes on hosted, recorded in the PR description. Here we
// pin the service/UI contract that surfaces them.
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

import {
  archivePayer,
  mergePayer,
  PayerArchiveBlockedError,
  PayerMergeConflictError,
  reactivatePayer,
} from "./payers";

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
});

describe("archivePayer — RPC-only, never a table write", () => {
  it("threads the active org + payer id and camelizes the returned row", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "gp-1", org_id: null, name: "Aetna", archived_at: "2026-07-27T12:00:00Z" },
      error: null,
    });
    const archived = await archivePayer("gp-1");
    expect(archived.archivedAt).toBe("2026-07-27T12:00:00Z");
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("archive_payer", {
      p_org_id: "org-1",
      p_payer_id: "gp-1",
    });
  });

  it("maps the open-cases block to the typed error carrying the count", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "payer_archive_open_cases: 3" },
    });
    const failed = archivePayer("gp-1");
    await expect(failed).rejects.toBeInstanceOf(PayerArchiveBlockedError);
    await expect(failed).rejects.toMatchObject({ openCaseCount: 3 });
    await expect(archivePayer("gp-1")).rejects.toThrow("3 open cases");
  });

  it("maps the state guards to friendly messages", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "payer_already_archived" } });
    await expect(archivePayer("gp-1")).rejects.toThrow("This payer is already archived.");
    rpcMock.mockResolvedValue({ data: null, error: { message: "payer_not_editable" } });
    await expect(archivePayer("gp-1")).rejects.toThrow(
      "This payer is retired or merged and can no longer be edited.",
    );
  });
});

describe("reactivatePayer", () => {
  it("threads the params and clears the flag on the returned row", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "gp-1", org_id: null, name: "Aetna", archived_at: null },
      error: null,
    });
    const row = await reactivatePayer("gp-1");
    expect(row.archivedAt).toBeNull();
    expect(rpcMock).toHaveBeenCalledWith("reactivate_payer", {
      p_org_id: "org-1",
      p_payer_id: "gp-1",
    });
  });

  it("maps the not-archived guard", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "payer_not_archived" } });
    await expect(reactivatePayer("gp-1")).rejects.toThrow("This payer isn't archived.");
  });
});

describe("mergePayer — one transaction, typed collision honesty", () => {
  it("threads loser + survivor and returns the camelized receipt", async () => {
    rpcMock.mockResolvedValue({
      data: {
        survivor: { id: "gp-1", org_id: null, name: "Aetna", aliases: ["Aetna Duplicate"] },
        moved_templates: 2,
        moved_targets: 3,
        archived_duplicate_targets: 1,
        moved_facts: 4,
        expired_duplicate_facts: 1,
        moved_open_cases: 2,
        moved_assignments: 1,
        deduped_assignments: 1,
      },
      error: null,
    });
    const result = await mergePayer("gp-dup", "gp-1");
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("merge_payer", {
      p_org_id: "org-1",
      p_loser_id: "gp-dup",
      p_survivor_id: "gp-1",
    });
    expect(result.survivor.aliases).toEqual(["Aetna Duplicate"]);
    expect(result.movedOpenCases).toBe(2);
    expect(result.archivedDuplicateTargets).toBe(1);
  });

  it("maps the 4-part case-key collision to the typed error listing the cases", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message:
          "payer_merge_case_conflict: 2 open case(s) collide with the survivor — C-1001, C-1002",
      },
    });
    const failed = mergePayer("gp-dup", "gp-1");
    await expect(failed).rejects.toBeInstanceOf(PayerMergeConflictError);
    await expect(failed).rejects.toMatchObject({ conflictingCases: ["C-1001", "C-1002"] });
  });

  it("maps each merge guard to its friendly message", async () => {
    const guards: Array<[string, string | RegExp]> = [
      ["payer_merge_self", "A payer can't be merged into itself."],
      ["payer_merge_loser_merged", "This payer was already merged."],
      ["payer_merge_survivor_not_active", "The surviving payer must be an active payer."],
      ["payer_merge_survivor_archived", "The surviving payer is archived — reactivate it first."],
      ["payer_merge_template_conflict", /active template for the same state and group/],
    ];
    for (const [raw, message] of guards) {
      rpcMock.mockReset();
      rpcMock.mockResolvedValue({ data: null, error: { message: raw } });
      await expect(mergePayer("gp-dup", "gp-1")).rejects.toThrow(message);
    }
  });

  it("passes an unknown error through untyped", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "network hiccup" } });
    await expect(mergePayer("gp-dup", "gp-1")).rejects.toThrow("network hiccup");
  });
});
