import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authStoreState = vi.hoisted(() => ({
  session: null as unknown,
  accessContext: null as unknown,
  accessContextLoading: false,
  membershipsLoading: false,
  accessContextError: null as string | null,
  loadAccessContext: vi.fn(),
  selectAccessContext: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/auth-store", () => ({
  useAuthStore: (selector: (state: typeof authStoreState) => unknown) => selector(authStoreState),
}));

import { AccessContextBoundary } from "./AccessContextBoundary";
import type { EnrollmentContext } from "@/services/clientAccess";

const sampleStaffContext: EnrollmentContext = {
  actorUserId: "11111111-1111-4111-8111-111111111111",
  email: "staff@example.test",
  audience: "staff",
  selectedOrgId: "org-1",
  staffOrgs: [
    {
      orgId: "org-1",
      orgName: "Staff Org",
      role: "admin",
      reportStaff: true,
      clientManage: true,
    },
  ],
  clientOrgs: [],
  globalTraining: false,
  restrictedExternal: false,
  contextRevision: "rev-1",
};

describe("AccessContextBoundary", () => {
  beforeEach(() => {
    authStoreState.session = null;
    authStoreState.accessContext = null;
    authStoreState.accessContextLoading = false;
    authStoreState.membershipsLoading = false;
    authStoreState.accessContextError = null;
  });

  it("renders children directly if there is no authenticated session", () => {
    const markup = renderToStaticMarkup(
      <AccessContextBoundary>
        <div id="test-child">Child Content</div>
      </AccessContextBoundary>,
    );
    expect(markup).toContain("Child Content");
  });

  it("renders loading state on initial load when session exists but context is null", () => {
    authStoreState.session = { user: { id: "11111111-1111-4111-8111-111111111111" } };
    authStoreState.accessContext = null;
    authStoreState.accessContextLoading = true;

    const markup = renderToStaticMarkup(
      <AccessContextBoundary>
        <div id="test-child">Child Content</div>
      </AccessContextBoundary>,
    );
    expect(markup).toContain("Resolving your access context…");
    expect(markup).not.toContain("Child Content");
  });

  it("keeps children mounted during background revalidation when context is already loaded", () => {
    authStoreState.session = { user: { id: "11111111-1111-4111-8111-111111111111" } };
    authStoreState.accessContext = sampleStaffContext;
    authStoreState.accessContextLoading = true; // background revalidation in-flight
    authStoreState.membershipsLoading = true;

    const markup = renderToStaticMarkup(
      <AccessContextBoundary>
        <div id="test-child">Child Content</div>
      </AccessContextBoundary>,
    );
    expect(markup).toContain("Child Content");
    expect(markup).not.toContain("Resolving your access context…");
  });

  it("renders failure state when access context has an error", () => {
    authStoreState.session = { user: { id: "11111111-1111-4111-8111-111111111111" } };
    authStoreState.accessContext = null;
    authStoreState.accessContextError = "Network connection refused";

    const markup = renderToStaticMarkup(
      <AccessContextBoundary>
        <div id="test-child">Child Content</div>
      </AccessContextBoundary>,
    );
    expect(markup).toContain("Access context unavailable");
    expect(markup).toContain("Network connection refused");
    expect(markup).not.toContain("Child Content");
  });
});
