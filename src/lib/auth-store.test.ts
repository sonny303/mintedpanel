import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn(),
      signInWithPassword: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));
vi.mock("@/lib/clientAccessApi", () => {
  class ClientAccessApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
      this.name = "ClientAccessApiError";
    }
  }
  return {
    ClientAccessApiError,
    fetchEnrollmentContext: vi.fn(),
    selectEnrollmentContext: vi.fn(),
  };
});
vi.mock("@/lib/contextRevision", () => ({
  beginContextRefresh: vi.fn(),
  registerContextRevisionObserver: vi.fn(),
  resetContextRevision: vi.fn(),
  setContextRevision: vi.fn(),
}));
vi.mock("@/lib/landing", () => ({
  selectActiveOrgId: vi.fn((rows: Array<{ id: string }>, current: string | null) => {
    return current ?? rows[0]?.id ?? null;
  }),
}));

import { fetchEnrollmentContext, selectEnrollmentContext } from "@/lib/clientAccessApi";
import { supabase } from "@/integrations/supabase/externalClient";
import { useAuthStore } from "./auth-store";
import type { EnrollmentContext } from "@/services/clientAccess";

const fetchContextMock = vi.mocked(fetchEnrollmentContext);
const selectContextMock = vi.mocked(selectEnrollmentContext);
const ACTOR = "11111111-1111-4111-8111-111111111111";

function context(revision: string): EnrollmentContext {
  return {
    actorUserId: ACTOR,
    email: "client@example.test",
    audience: "client",
    selectedOrgId: null,
    staffOrgs: [],
    clientOrgs: [],
    globalTraining: false,
    restrictedExternal: true,
    contextRevision: revision,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchContextMock.mockReset();
  selectContextMock.mockReset();
  useAuthStore.setState({
    session: { user: { id: ACTOR } } as never,
    user: { id: ACTOR } as never,
    accessContext: null,
    accessContextLoading: false,
    accessContextError: null,
    contextEpoch: 0,
    membershipsLoading: false,
    selectionHint: null,
  });
});

describe("auth-store access context lifecycle", () => {
  it("ignores a stale resolver after a newer context request wins", async () => {
    const first = deferred<EnrollmentContext>();
    fetchContextMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(context("new"));

    const stale = useAuthStore.getState().loadAccessContext();
    const current = useAuthStore.getState().loadAccessContext({ force: true });
    await expect(current).resolves.toMatchObject({ contextRevision: "new" });

    first.resolve(context("old"));
    await expect(stale).resolves.toBeNull();
    expect(useAuthStore.getState().accessContext?.contextRevision).toBe("new");
  });

  it("clears the prior context when the current resolver fails", async () => {
    useAuthStore.setState({ accessContext: context("old") });
    fetchContextMock.mockRejectedValueOnce(new Error("revision unavailable"));

    await expect(useAuthStore.getState().loadAccessContext()).rejects.toThrow(
      "revision unavailable",
    );
    expect(useAuthStore.getState().accessContext).toBeNull();
    expect(useAuthStore.getState().accessContextError).toBe("revision unavailable");
  });

  it("lets the explicit context boundary own initial context failures", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: ACTOR } } },
      error: null,
    } as never);
    vi.mocked(supabase.rpc).mockResolvedValue({ data: 0, error: null } as never);
    vi.mocked(supabase.from).mockImplementation(
      () =>
        ({
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(resolve),
        }) as never,
    );
    fetchContextMock.mockRejectedValueOnce(new Error("context unavailable"));

    await useAuthStore.getState().init();

    expect(useAuthStore.getState().initialized).toBe(true);
    expect(useAuthStore.getState().initError).toBeNull();
    expect(useAuthStore.getState().accessContextError).toBe("context unavailable");
  });

  it("clears stale identity-owned membership state when the refresh fails", async () => {
    useAuthStore.setState({
      memberships: [
        {
          orgId: "old-org",
          orgName: "Old Org",
          role: "admin",
          lifecycleState: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      activeOrgId: "old-org",
      fullName: "Old User",
      membershipsLoading: false,
    });
    vi.mocked(supabase.rpc).mockResolvedValue({ data: 0, error: null } as never);
    vi.mocked(supabase.from).mockImplementation(
      () =>
        ({
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({ data: { full_name: "Old User" }, error: null }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: null, error: new Error("membership refresh failed") }).then(
              resolve,
            ),
        }) as never,
    );

    await expect(useAuthStore.getState().loadMemberships()).rejects.toThrow(
      "membership refresh failed",
    );
    expect(useAuthStore.getState()).toMatchObject({
      memberships: [],
      activeOrgId: null,
      fullName: null,
      membershipsLoading: false,
    });
  });

  it("revalidates a same-actor selection hint after context refresh", async () => {
    const orgId = "22222222-2222-4222-8222-222222222222";
    const discovery = {
      ...context("revision-b"),
      audience: null,
      selectedOrgId: null,
      restrictedExternal: false,
      staffOrgs: [{ orgId, orgName: "Org", role: "admin" as const }],
    } as EnrollmentContext;
    const selected = { ...discovery, audience: "staff" as const, selectedOrgId: orgId };
    useAuthStore.setState({
      accessContext: null,
      selectionHint: { audience: "staff", orgId },
      membershipsLoading: false,
    });
    fetchContextMock.mockResolvedValue(discovery);
    selectContextMock.mockResolvedValue(selected);

    await expect(useAuthStore.getState().loadAccessContext()).resolves.toMatchObject({
      audience: "staff",
      selectedOrgId: orgId,
    });
    expect(selectContextMock).toHaveBeenCalledWith(
      { audience: "staff", orgId, contextRevision: "revision-b" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("keeps the accepted same-actor staff organization active during membership refresh", async () => {
    const selectedOrgId = "33333333-3333-4333-8333-333333333333";
    const previousOrgId = "44444444-4444-4444-8444-444444444444";
    useAuthStore.setState({
      activeOrgId: previousOrgId,
      selectionHint: { audience: "staff", orgId: selectedOrgId },
      membershipsLoading: false,
    });
    vi.mocked(supabase.rpc).mockResolvedValue({ data: 0, error: null } as never);
    const profileBuilder = {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      maybeSingle: async () => ({ data: { full_name: "Current User" }, error: null }),
    };
    const membershipBuilder = {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({
          data: [
            {
              org_id: selectedOrgId,
              role: "admin",
              organizations: {
                name: "Selected Org",
                lifecycle_state: "active",
                created_at: "2026-01-01T00:00:00.000Z",
              },
            },
          ],
          error: null,
        }).then(resolve, reject),
    };
    vi.mocked(supabase.from).mockImplementation(
      (table) => (table === "profiles" ? profileBuilder : membershipBuilder) as never,
    );

    await useAuthStore.getState().loadMemberships();

    expect(useAuthStore.getState()).toMatchObject({
      activeOrgId: selectedOrgId,
      membershipsLoading: false,
      selectionHint: null,
    });
  });
  it("deduplicates concurrent in-flight requests with compatible parameters", async () => {
    const first = deferred<EnrollmentContext>();
    fetchContextMock.mockReturnValueOnce(first.promise);

    const call1 = useAuthStore.getState().loadAccessContext();
    const call2 = useAuthStore.getState().loadAccessContext();

    expect(call1).toBe(call2);
    expect(fetchContextMock).toHaveBeenCalledOnce();

    first.resolve(context("deduped"));
    await expect(call1).resolves.toMatchObject({ contextRevision: "deduped" });
    await expect(call2).resolves.toMatchObject({ contextRevision: "deduped" });
  });

  it("aborts in-flight request on incompatible org switch", async () => {
    const first = deferred<EnrollmentContext>();
    fetchContextMock.mockReturnValueOnce(first.promise);

    const orgA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const orgB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    selectContextMock.mockResolvedValueOnce({
      ...context("org-b"),
      audience: "staff",
      selectedOrgId: orgB,
    });

    const callA = useAuthStore.getState().loadAccessContext({ audience: "staff", orgId: orgA });
    const callB = useAuthStore
      .getState()
      .loadAccessContext({ audience: "staff", orgId: orgB, expectedRevision: "rev-1" });

    expect(callA).not.toBe(callB);
    await expect(callB).resolves.toMatchObject({ contextRevision: "org-b", selectedOrgId: orgB });
    first.resolve(context("org-a"));
    await expect(callA).resolves.toBeNull();
  });

  it("directly selects context when audience, orgId, and expectedRevision are known", async () => {
    const orgId = "55555555-5555-4555-8555-555555555555";
    selectContextMock.mockResolvedValueOnce({
      ...context("rev-direct"),
      audience: "staff",
      selectedOrgId: orgId,
    });

    const result = await useAuthStore.getState().loadAccessContext({
      audience: "staff",
      orgId,
      expectedRevision: "rev-known",
    });

    expect(fetchContextMock).not.toHaveBeenCalled();
    expect(selectContextMock).toHaveBeenCalledWith(
      { audience: "staff", orgId, contextRevision: "rev-known" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toMatchObject({ contextRevision: "rev-direct", selectedOrgId: orgId });
  });

  it("falls back to discovery when direct selection fails with 409 stale revision", async () => {
    const orgId = "66666666-6666-4666-8666-666666666666";
    const { ClientAccessApiError } = await import("@/lib/clientAccessApi");
    selectContextMock
      .mockRejectedValueOnce(new ClientAccessApiError(409, "Access context changed"))
      .mockResolvedValueOnce({
        ...context("rev-fresh"),
        audience: "staff",
        selectedOrgId: orgId,
      });
    fetchContextMock.mockResolvedValueOnce({
      ...context("rev-fresh"),
      staffOrgs: [
        { orgId, orgName: "Org", role: "admin", reportStaff: false, clientManage: false },
      ],
    });

    const result = await useAuthStore.getState().loadAccessContext({
      audience: "staff",
      orgId,
      expectedRevision: "rev-stale",
    });

    expect(fetchContextMock).toHaveBeenCalledOnce();
    expect(selectContextMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ contextRevision: "rev-fresh", selectedOrgId: orgId });
  });

  it("does not consume focus cooldown on a normal context load", async () => {
    const {
      FOCUS_REFRESH_COOLDOWN_MS,
      getLastContextRefreshTime,
      resetContextRefreshCooldownForTest,
    } = await import("./auth-store");
    expect(FOCUS_REFRESH_COOLDOWN_MS).toBe(30_000);
    resetContextRefreshCooldownForTest();
    expect(getLastContextRefreshTime()).toBe(0);

    fetchContextMock.mockResolvedValueOnce(context("rev-1"));
    await useAuthStore.getState().loadAccessContext();
    expect(getLastContextRefreshTime()).toBe(0);
  });
});

describe("auth-store platform-admin flag", () => {
  function mockMembershipReads(rows: unknown[] = []) {
    vi.mocked(supabase.from).mockImplementation(
      () =>
        ({
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({ data: { full_name: "Platform User" }, error: null }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: rows, error: null }).then(resolve),
        }) as never,
    );
  }

  function mockRpc(isPlatformAdmin: () => Promise<unknown>) {
    vi.mocked(supabase.rpc).mockImplementation(((name: string) =>
      name === "is_platform_admin"
        ? isPlatformAdmin()
        : Promise.resolve({ data: 0, error: null })) as never);
  }

  beforeEach(() => {
    useAuthStore.setState({ isPlatformAdmin: null, authGeneration: 0 });
  });

  it("loads true alongside memberships, even with zero memberships", async () => {
    mockMembershipReads([]);
    mockRpc(() => Promise.resolve({ data: true, error: null }));

    await useAuthStore.getState().loadMemberships();

    expect(supabase.rpc).toHaveBeenCalledWith("is_platform_admin");
    expect(useAuthStore.getState()).toMatchObject({ memberships: [], isPlatformAdmin: true });
  });

  it("reads an RPC error, a thrown call, or a non-boolean as false", async () => {
    mockMembershipReads([]);
    for (const answer of [
      () => Promise.resolve({ data: null, error: { message: "function does not exist" } }),
      () => Promise.reject(new Error("network down")),
      () => Promise.resolve({ data: 0, error: null }),
      () => Promise.resolve({ data: "true", error: null }),
    ]) {
      useAuthStore.setState({ isPlatformAdmin: null });
      mockRpc(answer);
      await useAuthStore.getState().loadMemberships();
      expect(useAuthStore.getState().isPlatformAdmin).toBe(false);
    }
  });

  it("drops a stale answer when a newer auth event won the race", async () => {
    mockMembershipReads([]);
    let answer!: (value: unknown) => void;
    mockRpc(() => new Promise((resolve) => (answer = resolve)));

    const load = useAuthStore.getState().loadMemberships();
    await vi.waitFor(() => expect(answer).toBeTypeOf("function"));
    useAuthStore.setState({ authGeneration: useAuthStore.getState().authGeneration + 1 });
    answer({ data: true, error: null });
    await load;

    expect(useAuthStore.getState().isPlatformAdmin).toBeNull();
  });

  it("resets to unknown on sign-out", async () => {
    useAuthStore.setState({ isPlatformAdmin: true });
    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null } as never);

    await useAuthStore.getState().signOut();

    expect(useAuthStore.getState().isPlatformAdmin).toBeNull();
  });
});
