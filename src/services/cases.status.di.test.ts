// E6.0 — the set_case_status service contract at the boundary: the RPC
// receives the right snake_case params, a success round-trips camelized (with
// the caseStatus boundary default), and each named RPC error maps to the
// typed CaseStatusError the UI keys on (the invalid-edge, evidence-required,
// admin-only-correction, and concurrency-conflict paths).
//
// The RPC's DB-level guarantees — a rejected transition writes ZERO history
// rows (one transaction, any RAISE rolls back), the admin-only correction
// gate, and the legacy-mirror lockstep — are transactional Postgres
// properties a JS fake can't prove (the repo's documented "CI-Postgres
// integration test isn't feasible" limitation; hosted apply is an operator
// step for E6.0). Here we pin the service/UI contract that surfaces them.
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

import { setCaseStatus, CaseStatusError } from "./cases";

function rpcArgs() {
  const [fn, args] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
  return { fn, args };
}

describe("setCaseStatus — params", () => {
  beforeEach(() => rpcMock.mockReset());

  it("threads a plain forward transition with the expected status", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "case-1", case_status: "submitted" },
      error: null,
    });
    const result = await setCaseStatus({
      caseId: "case-1",
      toStatus: "submitted",
      expectedStatus: "in_progress",
    });
    expect(result.caseStatus).toBe("submitted");
    const { fn, args } = rpcArgs();
    expect(fn).toBe("set_case_status");
    expect(args).toMatchObject({
      p_case_id: "case-1",
      p_to_status: "submitted",
      p_expected_status: "in_progress",
      p_reason_code_id: null,
      p_note: null,
      p_is_correction: false,
      p_effective_date: null,
      p_individual_provider_id: null,
      p_group_provider_id: null,
      p_contract_executed_date: null,
      p_evidence_touch_id: null,
    });
  });

  it("threads the approval facts — effective date, both IDs, contract date", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "case-1", case_status: "approved" },
      error: null,
    });
    await setCaseStatus({
      caseId: "case-1",
      toStatus: "approved",
      expectedStatus: "in_review",
      effectiveDate: "2026-08-01",
      individualProviderId: "PTAN-449",
      groupProviderId: "GRP-2210",
      contractExecutedDate: "2026-07-15",
    });
    const { args } = rpcArgs();
    expect(args).toMatchObject({
      p_to_status: "approved",
      p_effective_date: "2026-08-01",
      p_individual_provider_id: "PTAN-449",
      p_group_provider_id: "GRP-2210",
      p_contract_executed_date: "2026-07-15",
    });
  });

  it("threads the denial reason + the Add-touch evidence link", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "case-1", case_status: "denied" },
      error: null,
    });
    await setCaseStatus({
      caseId: "case-1",
      toStatus: "denied",
      expectedStatus: "in_review",
      reasonCodeId: "reason-panel-closed",
      evidenceTouchId: "touch-9",
    });
    const { args } = rpcArgs();
    expect(args).toMatchObject({
      p_reason_code_id: "reason-panel-closed",
      p_evidence_touch_id: "touch-9",
    });
  });

  it("threads a correction with its note", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "case-1", case_status: "in_review" },
      error: null,
    });
    await setCaseStatus({
      caseId: "case-1",
      toStatus: "in_review",
      expectedStatus: "approved",
      isCorrection: true,
      note: "approval letter was for the sibling case",
    });
    const { args } = rpcArgs();
    expect(args).toMatchObject({
      p_is_correction: true,
      p_note: "approval letter was for the sibling case",
    });
  });

  it("the Add-touch bump passes NO expected status (auto triggers may have advanced)", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "case-1", case_status: "submitted" },
      error: null,
    });
    await setCaseStatus({ caseId: "case-1", toStatus: "submitted" });
    const { args } = rpcArgs();
    expect(args).toMatchObject({ p_expected_status: null });
  });

  it("defaults a missing case_status on the returned row from the pipeline mirror", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "case-1", payer_pipeline_state: "in_review" },
      error: null,
    });
    const result = await setCaseStatus({
      caseId: "case-1",
      toStatus: "in_review",
      expectedStatus: "submitted",
    });
    expect(result.caseStatus).toBe("in_review");
  });
});

describe("setCaseStatus — error mapping", () => {
  beforeEach(() => rpcMock.mockReset());

  async function expectCode(raw: string, code: string) {
    rpcMock.mockResolvedValue({ data: null, error: { message: raw } });
    try {
      await setCaseStatus({ caseId: "c", toStatus: "submitted", expectedStatus: "in_progress" });
      throw new Error("expected a CaseStatusError");
    } catch (e) {
      expect(e).toBeInstanceOf(CaseStatusError);
      expect((e as CaseStatusError).code).toBe(code);
    }
  }

  it("maps the invalid-edge RAISE", () =>
    expectCode("case_status_invalid_transition", "case_status_invalid_transition"));

  it("maps the admin-only correction gate", () =>
    expectCode("case_status_admin_only", "case_status_admin_only"));

  it("maps every evidence-required RAISE", async () => {
    await expectCode("case_status_denied_needs_reason", "case_status_denied_needs_reason");
    rpcMock.mockReset();
    await expectCode(
      "case_status_approved_needs_effective_date",
      "case_status_approved_needs_effective_date",
    );
    rpcMock.mockReset();
    await expectCode(
      "case_status_approved_needs_provider_id",
      "case_status_approved_needs_provider_id",
    );
    rpcMock.mockReset();
    await expectCode("case_status_not_pursuing_needs_note", "case_status_not_pursuing_needs_note");
    rpcMock.mockReset();
    await expectCode("case_status_evidence_invalid", "case_status_evidence_invalid");
  });

  it("parses the concurrency conflict's true current status", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "case_status_conflict:approved" },
    });
    try {
      await setCaseStatus({ caseId: "c", toStatus: "submitted", expectedStatus: "in_progress" });
      throw new Error("expected a CaseStatusError");
    } catch (e) {
      expect(e).toBeInstanceOf(CaseStatusError);
      expect((e as CaseStatusError).code).toBe("case_status_conflict");
      expect((e as CaseStatusError).conflictStatus).toBe("approved");
    }
  });

  it("passes an unknown error message through untyped", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "network hiccup" } });
    await expect(
      setCaseStatus({ caseId: "c", toStatus: "submitted", expectedStatus: "in_progress" }),
    ).rejects.toThrow("network hiccup");
  });
});
