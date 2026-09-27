import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));
vi.mock("@/lib/clientAccessApi", () => ({
  fetchEnrollmentContext: vi.fn(),
  selectEnrollmentContext: vi.fn(),
}));
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

import { supabase } from "@/integrations/supabase/externalClient";
import { fetchEnrollmentContext, selectEnrollmentContext } from "@/lib/clientAccessApi";
import { applyAuthStateChange, registerQueryClient, useAuthStore } from "./auth-store";
import type { EnrollmentContext } from "@/services/clientAccess";

const fetchContextMock = vi.mocked(fetchEnrollmentContext);
const selectContextMock = vi.mocked(selectEnrollmentContext);
const authStateChangeMock = vi.mocked(supabase.auth.onAuthStateChange);
const ACTOR_A = "11111111-1111-4111-8111-111111111111";
const ACTOR_B = "22222222-2222-4222-8222-222222222222";
const ORG_A = "33333333-3333-4333-8333-333333333333";
const ORG_B = "44444444-4444-4444-8444-444444444444";

const session = (id: string, email: string) =>
  ({
    access_token: `token-${id}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 9999999999,
    refresh_token: `refresh-${id}`,
    user: {
      id,
      aud: "authenticated",
      role: "authenticated",
      email,
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: "2026-07-09T00:00:00Z",
    },
  }) as never;

function context(actorUserId: string, revision: string, selectedOrgId: string | null = null) {
  return {
    actorUserId,
    email: `${actorUserId}@example.test`,
    audience: "client",
    selectedOrgId,
    staffOrgs: [],
    clientOrgs: [
      {
        orgId: ORG_A,
        orgName: "Client A",
        groups: [{ groupId: "55555555-5555-4555-8555-555555555555", groupName: "Group A" }],
      },
    ],
    globalTraining: false,
    restrictedExternal: true,
    contextRevision: revision,
  } satisfies EnrollmentContext;
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

let authListener: ((event: string, nextSession: unknown) => Promise<void> | void) | undefined;

beforeAll(async () => {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null });
  authStateChangeMock.mockImplementation((callback) => {
    authListener = callback as typeof authListener;
    return { data: { subscription: { unsubscribe: vi.fn() } } } as never;
  });
  await useAuthStore.getState().init();
  useAuthStore.setState({ loadMemberships: vi.fn().mockResolvedValue(undefined) });
});

beforeEach(() => {
  fetchContextMock.mockReset();
  selectContextMock.mockReset();
  useAuthStore.setState({
    session: session(ACTOR_A, "a@example.test"),
    user: { id: ACTOR_A, email: "a@example.test" } as never,
    memberships: [],
    membershipsLoading: false,
    activeOrgId: null,
    accessContext: null,
    accessContextLoading: false,
    accessContextError: null,
    contextEpoch: 0,
    authGeneration: 0,
    selectionHint: null,
  });
});

describe("E6.12 auth lifecycle", () => {
  it("sends the previously resolved revision with an explicit audience/org selection", async () => {
    useAuthStore.setState({ accessContext: context(ACTOR_A, "rev-before") });
    selectContextMock.mockResolvedValueOnce(context(ACTOR_A, "rev-after", ORG_A));

    await useAuthStore.getState().selectAccessContext({ audience: "client", orgId: ORG_A });

    expect(selectContextMock).toHaveBeenCalledWith(
      {
        audience: "client",
        orgId: ORG_A,
        contextRevision: "rev-before",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("clears query state before a replacement context becomes usable", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["cases", ORG_A], [{ id: "old-case" }]);
    const { registerQueryClient } = await import("./auth-store");
    registerQueryClient(queryClient);
    useAuthStore.setState({ accessContext: context(ACTOR_A, "rev-old", ORG_A) });
    fetchContextMock.mockResolvedValueOnce(context(ACTOR_A, "rev-new"));
    selectContextMock.mockResolvedValueOnce(context(ACTOR_A, "rev-new", ORG_A));

    await useAuthStore.getState().loadAccessContext();

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(useAuthStore.getState().accessContext?.contextRevision).toBe("rev-new");
  });

  it("rejects a delayed response from account A after account B becomes current", async () => {
    const oldContext = deferred<EnrollmentContext>();
    fetchContextMock
      .mockReturnValueOnce(oldContext.promise)
      .mockResolvedValueOnce(context(ACTOR_B, "rev-b", ORG_B));

    expect(authListener).toBeDefined();
    const oldTransition = authListener!("SIGNED_IN", session(ACTOR_A, "a@example.test"));
    const nextTransition = authListener!("SIGNED_IN", session(ACTOR_B, "b@example.test"));
    try {
      await expect(
        Promise.race([
          nextTransition,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("account B auth transition did not finish within 250ms")),
              250,
            ),
          ),
        ]),
      ).resolves.toBeUndefined();
    } finally {
      oldContext.resolve(context(ACTOR_A, "rev-a", ORG_A));
    }

    await expect(oldTransition).resolves.toBeUndefined();
    expect(useAuthStore.getState().user).toMatchObject({ id: ACTOR_B });
    expect(useAuthStore.getState().accessContext).toMatchObject({
      actorUserId: ACTOR_B,
      selectedOrgId: ORG_B,
    });
  });

  it("sign-out invalidates old context work before its late response can commit", async () => {
    const delayed = deferred<EnrollmentContext>();
    fetchContextMock.mockReturnValueOnce(delayed.promise);
    const queryClient = new QueryClient();
    queryClient.setQueryData(["cases", ORG_A], [{ id: "stale" }]);
    const { registerQueryClient } = await import("./auth-store");
    registerQueryClient(queryClient);

    const oldLoad = useAuthStore.getState().loadAccessContext();
    await authListener?.("SIGNED_OUT", null);
    delayed.resolve(context(ACTOR_A, "rev-late", ORG_A));
    await expect(oldLoad).resolves.toBeNull();

    expect(useAuthStore.getState()).toMatchObject({
      session: null,
      user: null,
      accessContext: null,
      accessContextError: null,
    });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("refreshes context for TOKEN_REFRESHED and keeps the new identity epoch", async () => {
    fetchContextMock.mockResolvedValueOnce(context(ACTOR_A, "rev-refreshed", ORG_A));

    await authListener?.("TOKEN_REFRESHED", session(ACTOR_A, "a@example.test"));

    expect(fetchContextMock).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().accessContext?.contextRevision).toBe("rev-refreshed");
  });

  it("preserves a valid secondary client org across refresh, then drops it after revocation", async () => {
    const secondary = {
      orgId: ORG_B,
      orgName: "Client B",
      groups: [{ groupId: "66666666-6666-4666-8666-666666666666", groupName: "Group B" }],
    };
    const primary = {
      orgId: ORG_A,
      orgName: "Client A",
      groups: [{ groupId: "55555555-5555-4555-8555-555555555555", groupName: "Group A" }],
    };
    const current = {
      ...context(ACTOR_A, "rev-current", ORG_B),
      clientOrgs: [primary, secondary],
    } satisfies EnrollmentContext;
    const discoveryWithSecondary = {
      ...current,
      audience: null,
      selectedOrgId: null,
      contextRevision: "rev-discovery-1",
    } satisfies EnrollmentContext;
    const selectedSecondary = {
      ...current,
      contextRevision: "rev-selected-secondary",
    } satisfies EnrollmentContext;
    const discoveryAfterRevocation = {
      ...current,
      audience: null,
      selectedOrgId: null,
      clientOrgs: [primary],
      contextRevision: "rev-discovery-2",
    } satisfies EnrollmentContext;
    const membershipFor = (orgId: string, orgName: string) => ({
      orgId,
      orgName,
      role: "admin" as const,
      lifecycleState: "active" as const,
      createdAt: "2026-07-01T00:00:00Z",
    });
    let membershipCall = 0;
    const loadMemberships = vi.fn(async () => {
      const hasSecondary = membershipCall++ === 0;
      const memberships = hasSecondary
        ? [membershipFor(ORG_A, "Client A"), membershipFor(ORG_B, "Client B")]
        : [membershipFor(ORG_A, "Client A")];
      useAuthStore.setState({
        memberships,
        activeOrgId: hasSecondary ? ORG_B : ORG_A,
        membershipsLoading: false,
      });
    });
    useAuthStore.setState({
      accessContext: current,
      activeOrgId: ORG_B,
      loadMemberships,
    });
    fetchContextMock
      .mockResolvedValueOnce(discoveryWithSecondary)
      .mockResolvedValueOnce(discoveryAfterRevocation);
    selectContextMock.mockResolvedValueOnce(selectedSecondary);

    await authListener?.("TOKEN_REFRESHED", session(ACTOR_A, "a@example.test"));

    expect(selectContextMock).toHaveBeenCalledWith(
      {
        audience: "client",
        orgId: ORG_B,
        contextRevision: "rev-discovery-1",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(useAuthStore.getState().accessContext).toMatchObject({
      audience: "client",
      selectedOrgId: ORG_B,
    });
    expect(useAuthStore.getState().activeOrgId).toBe(ORG_B);

    await authListener?.("TOKEN_REFRESHED", session(ACTOR_A, "a@example.test"));

    expect(selectContextMock).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().accessContext).toMatchObject({
      audience: null,
      selectedOrgId: null,
      contextRevision: "rev-discovery-2",
    });
    expect(useAuthStore.getState().activeOrgId).toBe(ORG_A);
  });

  it("commits fast account B context before deferred B memberships and never restores A state", async () => {
    const delayedMemberships = deferred<void>();
    useAuthStore.setState({
      session: session(ACTOR_A, "a@example.test"),
      user: { id: ACTOR_A, email: "a@example.test" } as never,
      memberships: [
        {
          orgId: ORG_A,
          orgName: "Account A Org",
          role: "admin",
          lifecycleState: "active",
          createdAt: "2026-07-01T00:00:00Z",
        },
      ],
      activeOrgId: ORG_A,
      fullName: "Account A",
      accessContext: context(ACTOR_A, "rev-a", ORG_A),
      loadMemberships: vi.fn(() => delayedMemberships.promise),
    });
    fetchContextMock.mockResolvedValueOnce(context(ACTOR_B, "rev-b", ORG_B));

    const transition = authListener!("SIGNED_IN", session(ACTOR_B, "b@example.test"));
    await vi.waitFor(() => {
      expect(useAuthStore.getState().accessContext?.actorUserId).toBe(ACTOR_B);
    });

    expect(useAuthStore.getState()).toMatchObject({
      user: { id: ACTOR_B },
      memberships: [],
      activeOrgId: null,
      fullName: null,
      accessContext: expect.objectContaining({ actorUserId: ACTOR_B }),
    });
    expect(useAuthStore.getState().accessContext).not.toMatchObject({
      actorUserId: ACTOR_A,
      selectedOrgId: ORG_A,
    });

    delayedMemberships.resolve();
    await expect(transition).resolves.toBeUndefined();
  });

  it("rejects an expected actor/generation mismatch without clearing state or query cache", async () => {
    const queryClient = new QueryClient();
    registerQueryClient(queryClient);
    queryClient.setQueryData(["cases", ORG_A], [{ id: "case-a" }]);
    useAuthStore.setState({
      user: { id: ACTOR_A, email: "a@example.test" } as never,
      session: session(ACTOR_A, "a@example.test"),
      authGeneration: 4,
      contextEpoch: 7,
      memberships: [],
      accessContext: context(ACTOR_A, "rev-a", ORG_A),
    });
    const before = useAuthStore.getState();

    await expect(
      applyAuthStateChange("USER_UPDATED", session(ACTOR_B, "b@example.test"), {
        actorUserId: ACTOR_B,
        authGeneration: 9,
      }),
    ).resolves.toBe(false);

    expect(useAuthStore.getState()).toMatchObject({
      user: { id: before.user?.id },
      authGeneration: before.authGeneration,
      contextEpoch: before.contextEpoch,
    });
    expect(queryClient.getQueryData(["cases", ORG_A])).toEqual([{ id: "case-a" }]);
  });

  it("rejects an expected generation mismatch for the same actor without clearing state", async () => {
    const queryClient = new QueryClient();
    registerQueryClient(queryClient);
    queryClient.setQueryData(["cases", ORG_A], [{ id: "case-a" }]);
    useAuthStore.setState({
      user: { id: ACTOR_A, email: "a@example.test" } as never,
      session: session(ACTOR_A, "a@example.test"),
      authGeneration: 4,
      contextEpoch: 7,
      memberships: [],
      accessContext: context(ACTOR_A, "rev-a", ORG_A),
    });
    const before = useAuthStore.getState();

    await expect(
      applyAuthStateChange("USER_UPDATED", session(ACTOR_A, "a-new-token@example.test"), {
        actorUserId: ACTOR_A,
        authGeneration: 9,
      }),
    ).resolves.toBe(false);

    expect(useAuthStore.getState()).toMatchObject({
      user: { id: before.user?.id },
      authGeneration: before.authGeneration,
      contextEpoch: before.contextEpoch,
    });
    expect(queryClient.getQueryData(["cases", ORG_A])).toEqual([{ id: "case-a" }]);
  });
});
