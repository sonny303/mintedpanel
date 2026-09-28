import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CaseDetail, SOPTemplate } from "@/types";

const mockTemplates: SOPTemplate[] = [
  {
    id: "tpl-bh",
    name: "Aetna NC - Behavioral Health",
    payerId: "pay-1",
    states: ["NC"],
    groupId: null,
    archived: false,
    taskDefinitions: [{ id: "t1", title: "BH Intake" }],
  } as unknown as SOPTemplate,
  {
    id: "tpl-recred",
    name: "Aetna NC - Recredentialing",
    payerId: "pay-1",
    states: ["NC"],
    groupId: null,
    archived: false,
    taskDefinitions: [{ id: "t2", title: "Recred Audit" }],
  } as unknown as SOPTemplate,
];

vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));
vi.mock("@/hooks/useAdmin", () => ({
  useSops: () => ({ data: mockTemplates, isLoading: false }),
}));
vi.mock("@/hooks/useCases", () => ({
  useReapplyCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div data-value={value}>{children}</div>
  ),
}));

import { ReapplyCaseAction } from "./ReapplyCaseAction";

describe("ReapplyCaseAction — template selection", () => {
  it("renders the reapply trigger on a denied case", () => {
    const c = {
      id: "case-1",
      caseStatus: "denied",
      payerId: "pay-1",
      state: "NC",
      groupId: null,
    } as unknown as CaseDetail;

    const html = renderToStaticMarkup(<ReapplyCaseAction c={c} canEdit={true} />);
    expect(html).toContain("Reapply");
    expect(html).toContain("This application was denied");
  });
});
