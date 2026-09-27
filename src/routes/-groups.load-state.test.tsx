import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lookups = vi.hoisted(() => ({
  groups: {
    data: [] as Array<{
      id: string;
      name: string;
      isActive: boolean;
      tin: string | null;
      states: string[];
    }>,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  facilities: {
    data: [] as Array<{ groupId: string; isActive: boolean }>,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@/hooks/useLookups", () => ({
  useProviderGroups: () => lookups.groups,
  useFacilities: () => lookups.facilities,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({ useParams: () => ({ groupId: "missing" }) }),
  lazyRouteComponent: (component: () => unknown) => component,
  useRouterState: () => "/groups/missing",
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  Navigate: ({ to }: { to: string }) => <span data-redirect={to} />,
  Outlet: () => <span>Group hub</span>,
}));

import { GroupsIndexPage } from "./groups.index";
import { GroupLayout } from "./groups.$groupId";

const groups = [
  { id: "alpha", name: "Alpha", isActive: true, tin: null, states: [] },
  { id: "beta", name: "Beta", isActive: true, tin: null, states: [] },
];

beforeEach(() => {
  lookups.groups.data = [];
  lookups.groups.isLoading = false;
  lookups.groups.isError = false;
  lookups.groups.refetch.mockClear();
  lookups.facilities.data = [];
  lookups.facilities.isLoading = false;
  lookups.facilities.isError = false;
  lookups.facilities.refetch.mockClear();
});

describe("group route load states", () => {
  it("shows recovery instead of empty setup when the group list read fails", () => {
    lookups.groups.isError = true;
    const html = renderToStaticMarkup(<GroupsIndexPage />);
    expect(html).toContain("Failed to load provider groups");
    expect(html).toContain("Retry");
    expect(html).not.toContain("No provider groups yet");
    expect(html).not.toContain("Add a provider group");
  });

  it("keeps the true empty state after a successful read", () => {
    const html = renderToStaticMarkup(<GroupsIndexPage />);
    expect(html).toContain("No provider groups yet");
    expect(html).toContain("Add a provider group");
  });

  it("keeps the successful multi-group list and verified zero counts", () => {
    lookups.groups.data = groups;
    const html = renderToStaticMarkup(<GroupsIndexPage />);
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
    expect(html).toContain("0 facilities");
    expect(html).not.toContain("Failed to load provider groups");
  });

  it("keeps single-group navigation after a successful read", () => {
    lookups.groups.data = [groups[0]];
    const html = renderToStaticMarkup(<GroupsIndexPage />);
    expect(html).toContain('data-redirect="/groups/$groupId"');
    expect(html).not.toContain("No provider groups yet");
  });

  it("shows recovery instead of not found when the group detail read fails", () => {
    lookups.groups.isError = true;
    const html = renderToStaticMarkup(<GroupLayout />);
    expect(html).toContain("Failed to load provider group");
    expect(html).toContain("Retry");
    expect(html).not.toContain("Group not found");
  });

  it("keeps not found after a successful read with no matching group", () => {
    const html = renderToStaticMarkup(<GroupLayout />);
    expect(html).toContain("Group not found");
    expect(html).toContain("Back to Groups");
  });

  it("does not display zero facilities after the facility read fails", () => {
    lookups.groups.data = groups;
    lookups.facilities.isError = true;
    const html = renderToStaticMarkup(<GroupsIndexPage />);
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
    expect(html).toContain("Facility count unavailable");
    expect(html).not.toContain("0 facilities");
  });
});
