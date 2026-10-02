import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Portal } from "@/types";

const queryState = vi.hoisted(() => ({ portals: [] as Portal[] }));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/hooks/useAdmin", () => ({
  usePayers: () => ({ data: [{ id: "payer-1", name: "BCBS Kansas" }] }),
  useSops: () => ({ data: [] }),
}));
vi.mock("@/hooks/usePortals", () => ({
  usePortals: () => ({
    data: queryState.portals,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePortalFieldMaps: () => ({ data: [] }),
  useLastFills: () => ({ data: new Map() }),
  useCreatePortal: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdatePortalUrl: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/permissions", () => ({ useIsAdmin: () => false }));

import { PortalsRegistry } from "./PortalsRegistry";

function config(overrides: Partial<Portal>): Portal {
  return {
    id: "portal-1",
    orgId: "org-1",
    portalKey: "bcbs-ks-enrollment-enrollment-123456789abc",
    name: "BCBS Kansas Enrollment",
    payerId: "payer-1",
    formUrl: "https://payer.example/forms",
    caseType: "enrollment",
    requiresExplicitSelection: true,
    mappingGeneration: 1,
    isVerified: false,
    lastVerifiedAt: null,
    provenAt: null,
    urlChangedAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  queryState.portals = [
    config({ id: "portal-enrollment", portalKey: "bcbs-enrollment-key", name: "Enrollment" }),
    config({
      id: "portal-contract",
      portalKey: "bcbs-contract-key",
      name: "Contract",
      caseType: "contract",
    }),
  ];
});

describe("PortalsRegistry independent configurations", () => {
  it("renders same-URL configurations as separate typed rows with empty training state", () => {
    const html = renderToStaticMarkup(<PortalsRegistry />);

    expect((html.match(/<tr\b/g) ?? []).length).toBe(3); // header plus both configs
    expect(html).toContain("bcbs-enrollment-key");
    expect(html).toContain("bcbs-contract-key");
    expect(html).toContain("Enrollment configuration");
    expect(html).toContain("Contract configuration");
    expect((html.match(/Empty · ready to train/g) ?? []).length).toBe(2);
    expect((html.match(/>Train</g) ?? []).length).toBe(2);
    expect(html).toContain("Unverified");
  });
});
