import { beforeEach, describe, expect, it, vi } from "vitest";

const completeTaskStepMock = vi.fn();
const currentUserIdMock = vi.fn(() => "user-1");
const requireActiveOrgMock = vi.fn(() => "org-1");

vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));
vi.mock("@/lib/audit", () => ({
  currentUserId: () => currentUserIdMock(),
  requireActiveOrg: () => requireActiveOrgMock(),
  writeAudit: vi.fn(),
}));
vi.mock("@/services/taskSteps", () => ({
  completeTaskStep: (...args: unknown[]) => completeTaskStepMock(...args),
}));
vi.mock("@/services/touches", () => ({ logNote: vi.fn() }));
vi.mock("@/lib/payerForms", () => ({ markPayerFormRemoved: vi.fn() }));

import { completeSOPStep } from "./tasks";

describe("Panel SOP step completion", () => {
  beforeEach(() => {
    completeTaskStepMock.mockReset();
    currentUserIdMock.mockReturnValue("user-1");
    requireActiveOrgMock.mockReturnValue("org-1");
  });

  it("routes the browser flow through the atomic task-step service", async () => {
    const task = { id: "task-1", status: "completed" };
    completeTaskStepMock.mockResolvedValue({ kind: "ok", task, allDone: true });

    await expect(completeSOPStep("task-1", "step-1")).resolves.toBe(task);

    expect(completeTaskStepMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        userId: "user-1",
        source: "panel",
      }),
      "task-1",
      "step-1",
    );
  });

  it("surfaces the RPC's ordering conflict without attempting direct writes", async () => {
    completeTaskStepMock.mockResolvedValue({
      kind: "rejected",
      status: 409,
      message: 'Complete "Upload W-9" first',
    });

    await expect(completeSOPStep("task-1", "step-2")).rejects.toThrow(
      'Complete "Upload W-9" first',
    );
    expect(completeTaskStepMock).toHaveBeenCalledTimes(1);
  });

  it("does not call the RPC without an authenticated actor", async () => {
    currentUserIdMock.mockReturnValue(null as never);

    await expect(completeSOPStep("task-1", "step-1")).rejects.toThrow(
      "An authenticated actor is required",
    );
    expect(completeTaskStepMock).not.toHaveBeenCalled();
  });
});
