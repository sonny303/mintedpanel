import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Facility, FacilityAssignment, ProviderGroup } from "@/types";

const state = vi.hoisted(() => ({
  isAdmin: false,
  preopenForm: false,
  nullHookCalls: 0,
  facilities: {
    data: [] as Facility[],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  assignments: {
    data: [] as FacilityAssignment[],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (initial === null && ++state.nullHookCalls === 1 && state.preopenForm) {
        return actual.useState({ facility: null });
      }
      return actual.useState(initial);
    },
  };
});
vi.mock("@/hooks/useLookups", () => ({
  useFacilities: () => state.facilities,
  useProviderGroups: () => ({ data: [] }),
}));
vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));
vi.mock("@/hooks/useProviders", () => ({ useProviderAssignments: () => state.assignments }));
vi.mock("@/hooks/useImportRuns", () => ({ useResumableImportRun: () => undefined }));
vi.mock("@/lib/permissions", () => ({
  useCanWrite: () => true,
  useIsAdmin: () => state.isAdmin,
}));
vi.mock("@/components/onboarding/FacilityForm", () => ({
  FacilityForm: () => <div>Open facility form</div>,
}));
vi.mock("@/components/import/CsvImportPanel", () => ({
  CsvImportPanel: ({ children }: { children: React.ReactNode }) => (
    <div>Facility import panel{children}</div>
  ),
}));
vi.mock("@/components/import/RosterUploader", () => ({ RosterUploader: () => null }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

import { GroupFacilitiesContent } from "./GroupFacilitiesContent";

const group: ProviderGroup = {
  id: "group-1",
  orgId: "org-1",
  name: "North Group",
  tin: null,
  npiType2: null,
  states: ["CO"],
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
};

const facility: Facility = {
  id: "facility-1",
  orgId: "org-1",
  groupId: group.id,
  name: "Denver Clinic",
  street: "Main Street",
  city: "Denver",
  state: "CO",
  zip: null,
  isActive: true,
  statusId: null,
  effectiveDate: null,
  referenceOnly: false,
  createdAt: "2026-01-01T00:00:00Z",
};

const assignment: FacilityAssignment = {
  id: "assignment-1",
  orgId: "org-1",
  providerId: "provider-1",
  facilityId: facility.id,
  isPrimary: true,
  createdAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  state.isAdmin = false;
  state.preopenForm = false;
  state.nullHookCalls = 0;
  state.facilities.data = [];
  state.facilities.isLoading = false;
  state.facilities.isError = false;
  state.facilities.refetch.mockClear();
  state.assignments.data = [];
  state.assignments.isLoading = false;
  state.assignments.isError = false;
  state.assignments.refetch.mockClear();
});

describe("group facilities required reads", () => {
  it("shows facility recovery rather than an empty list after a failed facility read", () => {
    state.facilities.isError = true;
    const html = renderToStaticMarkup(<GroupFacilitiesContent group={group} />);
    expect(html).toContain("Failed to load facilities");
    expect(html).toContain("Retry facilities");
    expect(html).not.toContain("No active locations yet");
    expect(html).not.toContain("Generate cases");
  });

  it("shows assignment recovery without invented zero counts or generation state", () => {
    state.facilities.data = [facility];
    state.assignments.isError = true;
    const html = renderToStaticMarkup(<GroupFacilitiesContent group={group} />);
    expect(html).toContain("Failed to load provider assignments");
    expect(html).toContain("Retry provider assignments");
    expect(html).not.toContain("0 providers");
    expect(html).not.toContain("No providers");
    expect(html).not.toContain("Generate cases");
  });

  it("withholds generation when a failed assignment refresh leaves cached rows", () => {
    state.facilities.data = [facility];
    state.assignments.data = [assignment];
    state.assignments.isError = true;
    const html = renderToStaticMarkup(<GroupFacilitiesContent group={group} />);
    expect(html).toContain("Failed to load provider assignments");
    expect(html).not.toContain("1 provider");
    expect(html).not.toContain("Generate cases");
  });

  it("keeps an open facility form and import panel mounted during a read failure", () => {
    state.facilities.data = [facility];
    state.assignments.isError = true;
    state.isAdmin = true;
    state.preopenForm = true;
    const html = renderToStaticMarkup(<GroupFacilitiesContent group={group} />);
    expect(html).toContain("Failed to load provider assignments");
    expect(html).toContain("Open facility form");
    expect(html).toContain("Facility import panel");
    expect(html).not.toContain("Generate cases");
  });

  it("shows loading for each pending read without showing empty or zero states", () => {
    state.facilities.isLoading = true;
    state.assignments.isLoading = true;
    const html = renderToStaticMarkup(<GroupFacilitiesContent group={group} />);
    expect(html).toContain("Loading facilities");
    expect(html).toContain("Loading provider assignments");
    expect(html).not.toContain("No active locations yet");
    expect(html).not.toContain("0 providers");
  });

  it("preserves the successful list, provider count, and generation link", () => {
    state.facilities.data = [facility];
    state.assignments.data = [assignment];
    const html = renderToStaticMarkup(<GroupFacilitiesContent group={group} />);
    expect(html).toContain("Denver Clinic");
    expect(html).toContain("1 provider");
    expect(html).toContain("Generate cases");
    expect(html).not.toContain("Failed to load");
  });

  it("preserves true empty facilities after both reads succeed", () => {
    const html = renderToStaticMarkup(<GroupFacilitiesContent group={group} />);
    expect(html).toContain("No active locations yet");
  });
});
