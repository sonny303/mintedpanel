import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Facility, ProviderGroup } from "@/types";

const state = vi.hoisted(() => ({
  groups: [] as ProviderGroup[],
  facilities: { data: [] as Facility[] | undefined, isError: false },
}));

vi.mock("@/hooks/useLookups", () => ({
  useProviderGroups: () => ({ data: state.groups }),
  useFacilities: () => state.facilities,
}));
vi.mock("@/hooks/usePayerNetworkTargets", () => ({
  usePayerNetworkTargets: () => ({ data: [] }),
}));
vi.mock("@/lib/permissions", () => ({ useCanWrite: () => false }));
vi.mock("@/components/groups/GroupFactsCard", () => ({ GroupFactsCard: () => null }));
vi.mock("@/components/groups/InsurancePanel", () => ({ InsurancePanel: () => null }));
vi.mock("@/components/documents/DocumentsPanel", () => ({ DocumentsPanel: () => null }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({ useParams: () => ({ groupId: "group-1" }) }),
  lazyRouteComponent: (component: () => unknown) => component,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

import { GroupHubPage } from "./groups.$groupId.index";

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

beforeEach(() => {
  state.groups = [group];
  state.facilities.data = [];
  state.facilities.isError = false;
});

describe("group hub facility count", () => {
  it("shows unavailable instead of zero after a failed facility read", () => {
    state.facilities.isError = true;
    const html = renderToStaticMarkup(<GroupHubPage />);
    expect(html).toContain("Location count unavailable");
    expect(html).not.toContain("0 active locations");
    expect(html).toContain("Facilities");
  });

  it("shows loading instead of zero before the facility read finishes", () => {
    state.facilities.data = undefined;
    const html = renderToStaticMarkup(<GroupHubPage />);
    expect(html).toContain("Loading location count");
    expect(html).not.toContain("0 active locations");
  });

  it("keeps the verified location count", () => {
    state.facilities.data = [facility];
    const html = renderToStaticMarkup(<GroupHubPage />);
    expect(html).toContain("1 active location");
    expect(html).not.toContain("Location count unavailable");
  });
});
