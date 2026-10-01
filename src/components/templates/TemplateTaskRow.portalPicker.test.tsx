import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Portal } from "@/types";
import type { EditableTask } from "@/components/templates/editableTemplate";

vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));
vi.mock("@/components/templates/FormStepPanel", () => ({ FormStepPanel: () => null }));
vi.mock("@/components/templates/PayerFormStepPanel", () => ({ PayerFormStepPanel: () => null }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div data-value={value}>{children}</div>
  ),
}));

import { TemplateTaskRow, type TemplateTaskRowProps } from "./TemplateTaskRow";

const portals: Portal[] = [
  {
    id: "portal-enrollment-a",
    orgId: "org-1",
    portalKey: "enrollment_a",
    name: "Enrollment A",
    payerId: "payer-1",
    caseType: "enrollment",
    formUrl: "https://payer.example/form",
    isVerified: true,
    lastVerifiedAt: null,
    urlChangedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "portal-enrollment-b",
    orgId: "org-1",
    portalKey: "enrollment_b",
    name: "Enrollment B",
    payerId: "payer-1",
    caseType: "enrollment",
    formUrl: "https://payer.example/form",
    isVerified: true,
    lastVerifiedAt: null,
    urlChangedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "portal-contract",
    orgId: "org-1",
    portalKey: "contract_only",
    name: "Contract portal",
    payerId: "payer-1",
    caseType: "contract",
    formUrl: "https://payer.example/form",
    isVerified: true,
    lastVerifiedAt: null,
    urlChangedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "portal-other-payer",
    orgId: "org-1",
    portalKey: "other_payer",
    name: "Other payer portal",
    payerId: "payer-2",
    caseType: "enrollment",
    formUrl: "https://payer.example/form",
    isVerified: true,
    lastVerifiedAt: null,
    urlChangedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

function task(): EditableTask {
  return {
    id: "task-1",
    title: "Complete enrollment",
    description: "",
    dueOffsetDays: 0,
    executionType: "extension_fill",
    steps: [
      {
        id: "step-1",
        label: "Fill the form",
        detail: "",
        stepType: "online_form",
        emailTemplate: { subject: "", body: "", to: [], cc: [] },
        dataFields: [],
        portalKey: "",
        payerFormFamilyId: "",
        isPayerForm: false,
        expectedTurnaroundDays: null,
        followUpEveryDays: null,
        requiredArtifacts: [],
      },
    ],
  };
}

function renderPicker() {
  const noop = vi.fn();
  const props: TemplateTaskRowProps = {
    task: task(),
    taskIdx: 0,
    taskCount: 1,
    canEdit: true,
    groupedTokens: [],
    portals,
    templatePayerId: "payer-1",
    templateCaseType: "enrollment",
    templateId: null,
    templatePayerName: "Payer One",
    templateStates: ["CO"],
    isGlobalAuthoring: true,
    autoOpenStepId: null,
    dragTaskId: null,
    setDragTaskId: noop,
    dragStep: null,
    setDragStep: noop,
    reorderTasks: noop,
    moveTask: noop,
    updateTask: noop,
    removeTask: noop,
    addStep: noop,
    removeStep: noop,
    updateStep: noop,
    reorderSteps: noop,
    moveStep: noop,
    addDataField: noop,
    updateDataField: noop,
    removeDataField: noop,
  };
  return renderToStaticMarkup(<TemplateTaskRow {...props} />);
}

describe("TemplateTaskRow portal picker", () => {
  it("keeps equal-URL portal keys distinct and filters by payer and case type", () => {
    const html = renderPicker();

    expect(html).toContain('data-value="enrollment_a"');
    expect(html).toContain('data-value="enrollment_b"');
    expect(html).not.toContain('data-value="contract_only"');
    expect(html).not.toContain('data-value="other_payer"');
  });
});
