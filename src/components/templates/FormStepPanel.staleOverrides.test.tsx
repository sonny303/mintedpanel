import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, PropsWithChildren } from "react";
import type { Portal } from "@/types";

const state = vi.hoisted(() => ({
  portals: [] as unknown[],
  staleOverrides: [] as unknown[],
  reviewClick: null as null | (() => void),
  reviewMutateAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@tanstack/react-router", () => ({ useLocation: () => ({ pathname: "/templates/edit" }) }));
vi.mock("@/lib/auth-store", () => ({ useActiveOrgId: () => "org-1" }));
vi.mock("@/hooks/usePortals", () => {
  const mutation = () => ({ isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) });
  return {
    usePortals: () => ({ data: state.portals }),
    usePortalFieldMaps: () => ({ data: [] }),
    usePortalMappingResetPreview: () => ({ data: 0, isLoading: false, isError: false }),
    useResetPortalMapping: mutation,
    useStaleOrgOverridesForReview: () => ({ data: state.staleOverrides }),
    useReviewOrgPortalFieldMapBase: () => ({
      isPending: false,
      mutateAsync: state.reviewMutateAsync,
    }),
    useCreatePortal: mutation,
  };
});
vi.mock("@/hooks/useAdmin", () => ({
  useSops: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useMappingReview", () => {
  const mutation = () => ({ isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) });
  return {
    useApproveField: mutation,
    useFinishTraining: mutation,
    useManualField: mutation,
    useTokenCatalog: () => ({ data: [] }),
    useReproposeField: mutation,
    useSetFieldMapHardcoded: mutation,
    useSetFieldMapTransform: mutation,
    useUpdateSharedFieldRegistry: mutation,
    useAddSharedRegistryField: mutation,
  };
});
vi.mock("@/hooks/useGlobalAuthoring", () => {
  const mutation = () => ({ isPending: false, mutateAsync: vi.fn().mockResolvedValue(undefined) });
  return { useSetGlobalPortalFlags: mutation, useTrainGlobalFieldMap: mutation };
});
vi.mock("@/hooks/useFormDrift", () => ({ useFormDrift: () => ({ driftByPortal: new Map() }) }));
vi.mock("@/components/PortalDrawer", () => ({ PortalDrawer: () => null }));
vi.mock("@/components/templates/FieldRegistryList", () => ({ FieldRegistryList: () => null }));
vi.mock("@/components/StatusPill", () => ({
  StatusPill: ({ label }: { label: string }) => <span>{label}</span>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, disabled, onClick }: ComponentProps<"button">) => {
    if (children === "Review and retain override") {
      state.reviewClick = onClick ? () => onClick({} as never) : null;
    }
    return (
      <button disabled={disabled} onClick={onClick}>
        {children}
      </button>
    );
  },
}));
vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: PropsWithChildren) => <div>{children}</div>,
  CollapsibleContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("lucide-react", () => ({ CheckCircle2: () => null, ChevronDown: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { FormStepPanel } from "./FormStepPanel";

function portal(overrides: Partial<Portal>): Portal {
  return {
    id: "shared-config",
    orgId: null,
    portalKey: "bcbs-enrollment",
    name: "BCBS Enrollment",
    payerId: "payer-1",
    formUrl: "https://payer.example/form",
    caseType: "enrollment",
    requiresExplicitSelection: true,
    mappingGeneration: 2,
    isVerified: false,
    lastVerifiedAt: null,
    provenAt: null,
    urlChangedAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

const staleReview = {
  map: {
    id: "org-map",
    orgId: "org-1",
    portalKey: "bcbs-enrollment",
    selector: "#npi",
    status: "approved",
    source: "token",
    token: "provider.npi",
    mappingGeneration: 3,
  },
  currentSharedBaseGeneration: 2,
  currentSharedMap: {
    id: "shared-map",
    orgId: null,
    portalKey: "bcbs-enrollment",
    selector: "#npi",
    status: "proposed",
    source: "manual",
    token: null,
  },
};

function renderPanel(isGlobalAuthoring = false) {
  return renderToStaticMarkup(
    <FormStepPanel
      portalKey="bcbs-enrollment"
      templatePayerId="payer-1"
      templateCaseType="enrollment"
      canEdit
      isGlobalAuthoring={isGlobalAuthoring}
      defaultOpen
    />,
  );
}

beforeEach(() => {
  state.reviewClick = null;
  state.reviewMutateAsync.mockClear().mockResolvedValue(undefined);
  state.portals = [
    portal({ id: "shared-config", orgId: null }),
    portal({ id: "org-config", orgId: "org-1", mappingGeneration: 3 }),
  ];
  state.staleOverrides = [staleReview];
});

describe("FormStepPanel stale shared-base review", () => {
  it("renders the org override review for an exact typed org/shared configuration pair", () => {
    const html = renderPanel();

    expect(html).toContain('aria-label="Shared mapping changes need review"');
    expect(html).toContain("Organization decision: Maps to provider.npi");
    expect(html).toContain("Current shared decision: Needs a decision");
    expect(html).toContain("Review and retain override");
    expect(html).toContain("BCBS Enrollment");
  });

  it("uses the reviewed org row generation when global authoring selects a newer shared config", async () => {
    const html = renderPanel(true);
    expect(html).toContain('aria-label="Shared mapping changes need review"');
    expect(state.reviewClick).toBeTypeOf("function");

    state.reviewClick?.();
    await Promise.resolve();

    expect(state.reviewMutateAsync).toHaveBeenCalledWith({
      id: "org-map",
      expectedMappingGeneration: 3,
      expectedSharedBaseGeneration: 2,
    });
  });

  it("continues to use the reviewed org row generation in org authoring", async () => {
    renderPanel(false);
    state.reviewClick?.();
    await Promise.resolve();

    expect(state.reviewMutateAsync).toHaveBeenCalledWith({
      id: "org-map",
      expectedMappingGeneration: 3,
      expectedSharedBaseGeneration: 2,
    });
  });

  it("uses legacy generation one when an old override has no generation metadata", async () => {
    const legacyReview = {
      ...staleReview,
      map: { ...staleReview.map, mappingGeneration: undefined },
    };
    state.staleOverrides = [legacyReview];

    renderPanel(true);
    state.reviewClick?.();
    await Promise.resolve();

    expect(state.reviewMutateAsync).toHaveBeenCalledWith({
      id: "org-map",
      expectedMappingGeneration: 1,
      expectedSharedBaseGeneration: 2,
    });
  });

  it.each([
    ["payer", { payerId: "payer-2" }],
    ["case type", { caseType: "contract" as const }],
    ["explicit-selection marker", { requiresExplicitSelection: false }],
  ])("does not choose a same-key sibling with a different %s", (_reason, override) => {
    state.portals = [
      portal({ id: "shared-config", orgId: null }),
      portal({ id: "org-config", orgId: "org-1", ...override }),
    ];

    const html = renderPanel();

    expect(html).not.toContain('aria-label="Shared mapping changes need review"');
    expect(html).not.toContain("Review and retain override");
  });
});
