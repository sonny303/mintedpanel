// E4.0 TE-8 — the advance_payer_pipeline service contract at the boundary: the
// RPC receives the right snake_case params, a success round-trips camelized, and
// each named RPC error maps to the typed PipelineTransitionError the UI keys on
// (the invalid-edge, admin-only-correction, and concurrency-conflict paths).
//
// The RPC's DB-level guarantees — a rejected edge writes ZERO history rows (one
// transaction, any RAISE rolls back) and the admin-only correction gate — are
// transactional Postgres properties a JS fake can't prove; they were verified
// live via a rolled-back simulation against the hosted function (the repo's
// documented "CI-Postgres integration test isn't feasible" limitation). Here we
// pin the service/UI contract that surfaces those errors.
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

import { advancePayerPipeline, PipelineTransitionError } from "./cases";

function rpcArgs() {
  const [fn, args] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
  return { fn, args };
}

describe("advancePayerPipeline — params", () => {
  beforeEach(() => rpcMock.mockReset());

  it("threads a plain forward transition with the expected state", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "case-1", payer_pipeline_state: "assigned" },
      error: null,
    });
    const result = await advancePayerPipeline({
      caseId: "case-1",
      toState: "assigned",
      expectedState: "not_started",
    });
    expect(result.payerPipelineState).toBe("assigned");
    const { fn, args } = rpcArgs();
    expect(fn).toBe("advance_payer_pipeline");
    expect(args).toMatchObject({
      p_case_id: "case-1",
      p_to_state: "assigned",
      p_expected_state: "not_started",
      p_reason_code_id: null,
      p_justification: null,
      p_is_correction: false,
      p_effective_date: null,
      p_individual_provider_id: null,
      p_group_provider_id: null,
    });
  });

  it("threads the two approval identifiers + effective date", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "case-1", payer_pipeline_state: "approved" },
      error: null,
    });
    await advancePayerPipeline({
      caseId: "case-1",
      toState: "approved",
      expectedState: "in_review",
      effectiveDate: "2026-08-01",
      individualProviderId: "HUM-449",
      groupProviderId: "GRP-2210",
    });
    const { args } = rpcArgs();
    expect(args).toMatchObject({
      p_to_state: "approved",
      p_effective_date: "2026-08-01",
      p_individual_provider_id: "HUM-449",
      p_group_provider_id: "GRP-2210",
    });
  });

  it("threads a correction with justification", async () => {
    rpcMock.mockResolvedValue({
      data: { id: "case-1", payer_pipeline_state: "in_review" },
      error: null,
    });
    await advancePayerPipeline({
      caseId: "case-1",
      toState: "in_review",
      expectedState: "approved",
      isCorrection: true,
      justification: "payer rescinded",
    });
    const { args } = rpcArgs();
    expect(args).toMatchObject({
      p_is_correction: true,
      p_justification: "payer rescinded",
    });
  });
});

describe("advancePayerPipeline — error mapping", () => {
  beforeEach(() => rpcMock.mockReset());

  async function expectError(message: string): Promise<PipelineTransitionError> {
    rpcMock.mockResolvedValue({ data: null, error: { message } });
    try {
      await advancePayerPipeline({
        caseId: "case-1",
        toState: "approved",
        expectedState: "not_started",
      });
    } catch (e) {
      return e as PipelineTransitionError;
    }
    throw new Error("expected a rejection");
  }

  it("maps an illegal edge to a typed PipelineTransitionError", async () => {
    const e = await expectError("pipeline_invalid_transition");
    expect(e).toBeInstanceOf(PipelineTransitionError);
    expect(e.code).toBe("pipeline_invalid_transition");
  });

  it("maps the admin-only correction gate", async () => {
    const e = await expectError("pipeline_admin_only");
    expect(e.code).toBe("pipeline_admin_only");
  });

  it("maps denied-without-reason and other-without-context", async () => {
    expect((await expectError("pipeline_denied_needs_reason")).code).toBe(
      "pipeline_denied_needs_reason",
    );
    expect((await expectError("pipeline_other_needs_context")).code).toBe(
      "pipeline_other_needs_context",
    );
  });

  it("parses the concurrency conflict's true current state for the refresh prompt", async () => {
    const e = await expectError("pipeline_state_conflict:in_review");
    expect(e.code).toBe("pipeline_state_conflict");
    expect(e.conflictState).toBe("in_review");
    expect(e.message).toMatch(/refresh/i);
  });
});
