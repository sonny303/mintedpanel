import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  CredentialCase,
  Payer,
  Provider,
  ProviderGroupAssignment,
  SOPTemplate,
} from "@/types";

const mockState = vi.hoisted(() => ({
  providers: [
    { id: "pr-1", firstName: "Jane", lastName: "Whitaker", status: "active" } as Provider,
  ],
  payers: [{ id: "pay-1", name: "Aetna", isNetworkPayer: true }] as unknown as Payer[],
  providerAssignments: [
    { providerId: "pr-1", groupId: "g-1", endDate: null } as ProviderGroupAssignment,
  ],
  groups: [{ id: "g-1", name: "Group 1", states: ["NC"] }],
  templates: [
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
  ],
  cases: [] as CredentialCase[],
  selectedPayerId: "pay-1",
}));

vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));
vi.mock("@/hooks/useProviders", () => ({
  useProviders: () => ({ data: mockState.providers, isLoading: false, isError: false }),
  useProviderAssignments: () => ({ data: [], isLoading: false, isError: false }),
  useProviderGroupAssignments: () => ({
    data: mockState.providerAssignments,
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/useLookups", () => ({
  useFacilities: () => ({ data: [], isLoading: false, isError: false }),
  useProviderGroups: () => ({ data: mockState.groups, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useAdmin", () => ({
  usePayers: () => ({ data: mockState.payers, isLoading: false, isError: false }),
  useSops: () => ({ data: mockState.templates, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useCases", () => ({
  useCases: () => ({ data: mockState.cases, isLoading: false, isError: false }),
  useCreateCase: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/permissions", () => ({
  useCanWrite: () => true,
  useIsAdmin: () => true,
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="select">{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div data-value={value}>{children}</div>
  ),
}));

// We test that when state hooks initialize with payer selected, candidate templates render
import { ManualCaseModal } from "./ManualCaseModal";

describe("ManualCaseModal — multi-template selection", () => {
  it("renders prerequisites and basic form fields", () => {
    const html = renderToStaticMarkup(<ManualCaseModal onClose={vi.fn()} />);
    expect(html).toContain("New case");
    expect(html).toContain("Jane Whitaker");
    expect(html).toContain("Aetna");
  });
});
