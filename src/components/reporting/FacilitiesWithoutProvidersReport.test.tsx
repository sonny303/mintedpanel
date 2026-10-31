import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Facility, ProviderGroup } from "@/types";

const state = vi.hoisted(() => ({
  groups: [] as ProviderGroup[],
  facilities: [] as Facility[],
}));

vi.mock("@/lib/auth-store", () => ({ useActiveOrgId: () => "org-1" }));
vi.mock("@/hooks/useLookups", () => ({
  useFacilities: () => ({ data: state.facilities, isLoading: false }),
  useProviderGroups: () => ({ data: state.groups, isLoading: false }),
}));
vi.mock("@/hooks/useProviders", () => ({
  useProviderAssignments: () => ({ data: [], isLoading: false }),
  useProviders: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/useEnrollmentReadiness", () => ({ localTodayIso: () => "2026-10-30" }));
// Resolves the typed `to` + `params` into the href the router would build.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params = {},
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => (
    <a href={Object.entries(params).reduce((href, [k, v]) => href.replace(`$${k}`, v), to)}>
      {children}
    </a>
  ),
}));

import { FacilitiesWithoutProvidersReport } from "./FacilitiesWithoutProvidersReport";

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

const facility = (id: string, name: string, groupId: string | null): Facility => ({
  id,
  orgId: "org-1",
  groupId,
  name,
  street: null,
  city: "Denver",
  state: "CO",
  zip: null,
  isActive: true,
  statusId: null,
  effectiveDate: null,
  referenceOnly: false,
  createdAt: "2026-01-01T00:00:00Z",
});

function links(html: string): [string, string][] {
  return Array.from(html.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g), (m) => [m[1], m[2]]);
}

beforeEach(() => {
  state.groups = [group];
  state.facilities = [];
});

describe("Facilities Without Providers record links (MINT-101)", () => {
  it("links the facility to its group's Facilities area and the group to its hub", () => {
    state.facilities = [facility("facility-1", "Denver Clinic", "group-1")];
    const html = renderToStaticMarkup(<FacilitiesWithoutProvidersReport />);
    expect(links(html)).toEqual([
      ["/groups/group-1/facilities", "Denver Clinic"],
      ["/groups/group-1", "North Group"],
    ]);
  });

  it("renders plain text when the facility has no group or the group is not resolvable", () => {
    state.facilities = [
      facility("facility-2", "Aurora Clinic", null),
      facility("facility-3", "Boulder Clinic", "group-missing"),
    ];
    const html = renderToStaticMarkup(<FacilitiesWithoutProvidersReport />);
    expect(html).toContain("Aurora Clinic");
    expect(html).toContain("Boulder Clinic");
    expect(links(html)).toEqual([]);
  });
});
