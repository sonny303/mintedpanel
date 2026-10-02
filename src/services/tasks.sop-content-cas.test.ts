import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, writeAuditMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  writeAuditMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: fromMock },
}));
vi.mock("@/lib/audit", () => ({
  currentUserId: () => "user-1",
  requireActiveOrg: () => "org-1",
  writeAudit: (...args: unknown[]) => writeAuditMock(...args),
}));
vi.mock("@/services/taskSteps", () => ({ completeTaskStep: vi.fn() }));
vi.mock("@/services/touches", () => ({ logNote: vi.fn() }));

import { attachStepArtifact, detachStepArtifact, removePayerFormFromCase } from "./tasks";
import type { Task } from "@/types";

const existingTask = {
  id: "task-1",
  org_id: "org-1",
  case_id: "case-1",
  provider_id: "provider-1",
  title: "Send payer form",
  description: null,
  sop_content: [
    {
      id: "step-1",
      label: "Submit form",
      order: 1,
      isCompleted: false,
      attachments: [
        {
          documentId: "document-1",
          artifactName: "Payer form",
          fileName: "form.pdf",
          uploadedAt: "2026-10-01T00:00:00.000Z",
          uploadedBy: "user-1",
          kind: "filled_form",
        },
      ],
    },
  ],
  sop_content_revision: 7,
  status: "in_progress",
  sort_order: 1,
  due_date: null,
  completed_date: null,
  is_auto_generated: true,
  sop_template_id: null,
  sop_version: null,
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
};

function mockReadThenConflict() {
  const equalityFilters: Array<[string, unknown]> = [];
  fromMock.mockImplementation(() => {
    let isUpdate = false;
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.update = vi.fn(() => {
      isUpdate = true;
      return builder;
    });
    builder.eq = vi.fn((column: string, value: unknown) => {
      equalityFilters.push([column, value]);
      return builder;
    });
    builder.maybeSingle = vi.fn(async () =>
      isUpdate ? { data: null, error: null } : { data: existingTask, error: null },
    );
    return builder;
  });
  return equalityFilters;
}

describe("full-array SOP task writes use optimistic revisions", () => {
  beforeEach(() => {
    fromMock.mockReset();
    writeAuditMock.mockReset();
  });

  it.each([
    [
      "attach",
      () =>
        attachStepArtifact("task-1", "step-1", {
          documentId: "document-2",
          artifactName: "Payer form",
          fileName: "new-form.pdf",
          uploadedAt: "2026-10-01T00:00:00.000Z",
          uploadedBy: "user-1",
          kind: "filled_form",
        }),
    ],
    ["detach", () => detachStepArtifact("task-1", "step-1", "document-1")],
    [
      "payer-form removal",
      () => removePayerFormFromCase({ id: "task-1", title: "Send payer form" } as Task, null),
    ],
  ])("rejects a stale %s array before auditing it", async (_name, write) => {
    const equalityFilters = mockReadThenConflict();

    await expect(write()).rejects.toThrow(
      "Task changed while you were editing it. Reload and retry.",
    );

    expect(equalityFilters).toContainEqual(["sop_content_revision", 7]);
    expect(writeAuditMock).not.toHaveBeenCalled();
  });
});
