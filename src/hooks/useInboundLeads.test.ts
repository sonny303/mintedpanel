import { describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => {
  const loadMemberships = vi.fn();
  let state = {
    user: { id: "actor-a" },
    session: { access_token: "token-a" },
    authGeneration: 1,
    accessContext: { audience: "staff" as const, restrictedExternal: false },
    loadMemberships,
  };
  const queryClient = {
    invalidateQueries: vi.fn(),
  };
  const toast = {
    success: vi.fn(),
    warning: vi.fn(),
  };
  const authStore = Object.assign(
    vi.fn((selector?: (value: typeof state) => unknown) => (selector ? selector(state) : state)),
    {
      getState: vi.fn(() => ({ ...state, loadMemberships })),
    },
  );
  const convertInboundLead = vi.fn();

  return {
    authStore,
    convertInboundLead,
    loadMemberships,
    queryClient,
    setState(next: Partial<typeof state>) {
      state = { ...state, ...next };
    },
    toast,
  };
});

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: unknown) => options,
  useQuery: vi.fn(),
  useQueryClient: () => holder.queryClient,
}));
vi.mock("@/lib/auth-store", () => ({ useAuthStore: holder.authStore }));
vi.mock("@/services/inboundLeads", () => ({
  convertInboundLead: holder.convertInboundLead,
  dismissInboundLead: vi.fn(),
  listInboundLeads: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: holder.toast }));

import { useConvertInboundLead } from "./useInboundLeads";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const lead = {
  id: "lead-1",
  orgName: "Capeside Physical Therapy",
  contactName: "Dawson Leery",
  contactEmail: "dawson@capeside.example.test",
  contactPhone: null,
  status: "new",
  createdAt: "2026-08-01T00:00:00Z",
} as never;

describe("useConvertInboundLead completion guards", () => {
  it("does not refresh B memberships or notify when A changes to B before completion", async () => {
    holder.setState({
      user: { id: "actor-a" },
      session: { access_token: "token-a" },
      authGeneration: 1,
    });
    holder.loadMemberships.mockReset();
    holder.queryClient.invalidateQueries.mockReset();
    holder.toast.success.mockReset();
    const mutation = useConvertInboundLead() as unknown as {
      onMutate: () => unknown;
      onSuccess: (orgId: string, lead: unknown, context: unknown) => Promise<void>;
    };
    const origin = mutation.onMutate();
    holder.setState({
      user: { id: "actor-b" },
      session: { access_token: "token-b" },
      authGeneration: 2,
    });

    await mutation.onSuccess("org-1", lead, origin);

    expect(holder.loadMemberships).not.toHaveBeenCalled();
    expect(holder.queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(holder.toast.success).not.toHaveBeenCalled();
  });

  it("refreshes memberships once and notifies on same-actor success", async () => {
    holder.setState({
      user: { id: "actor-a" },
      session: { access_token: "token-a" },
      authGeneration: 1,
    });
    holder.loadMemberships.mockReset();
    holder.loadMemberships.mockResolvedValueOnce(undefined);
    holder.queryClient.invalidateQueries.mockReset();
    holder.toast.success.mockReset();
    holder.toast.warning.mockReset();
    const mutation = useConvertInboundLead() as unknown as {
      onMutate: () => unknown;
      onSuccess: (orgId: string, lead: unknown, context: unknown) => Promise<void>;
    };
    const origin = mutation.onMutate();

    await mutation.onSuccess("org-1", lead, origin);

    expect(holder.loadMemberships).toHaveBeenCalledTimes(1);
    expect(holder.toast.success).toHaveBeenCalledWith(
      "Created Capeside Physical Therapy as a prospect",
    );
    expect(holder.toast.warning).not.toHaveBeenCalled();
    expect(holder.queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("keeps the committed success distinct when the same actor membership refresh fails", async () => {
    holder.setState({
      user: { id: "actor-a" },
      session: { access_token: "token-a" },
      authGeneration: 1,
    });
    holder.loadMemberships.mockReset();
    holder.loadMemberships.mockRejectedValueOnce(new Error("membership refresh failed"));
    holder.queryClient.invalidateQueries.mockReset();
    holder.toast.success.mockReset();
    holder.toast.warning.mockReset();
    const mutation = useConvertInboundLead() as unknown as {
      onMutate: () => unknown;
      onSuccess: (orgId: string, lead: unknown, context: unknown) => Promise<void>;
    };
    const origin = mutation.onMutate();

    await mutation.onSuccess("org-1", lead, origin);

    expect(holder.toast.success).toHaveBeenCalledWith(
      "Created Capeside Physical Therapy as a prospect",
    );
    expect(holder.toast.warning).toHaveBeenCalledWith(
      "The prospect was created, but your memberships could not refresh. Refresh to see it.",
    );
    expect(holder.loadMemberships).toHaveBeenCalledTimes(1);
    expect(holder.queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("does not invalidate or notify when the actor changes while membership refresh is held", async () => {
    holder.setState({
      user: { id: "actor-a" },
      session: { access_token: "token-a" },
      authGeneration: 1,
    });
    holder.loadMemberships.mockReset();
    const refresh = deferred<void>();
    holder.loadMemberships.mockReturnValueOnce(refresh.promise);
    holder.queryClient.invalidateQueries.mockReset();
    holder.toast.success.mockReset();
    holder.toast.warning.mockReset();
    const mutation = useConvertInboundLead() as unknown as {
      onMutate: () => unknown;
      onSuccess: (orgId: string, lead: unknown, context: unknown) => Promise<void>;
    };
    const origin = mutation.onMutate();
    const completion = mutation.onSuccess("org-1", lead, origin);

    await vi.waitFor(() => expect(holder.loadMemberships).toHaveBeenCalledTimes(1));
    holder.setState({
      user: { id: "actor-b" },
      session: { access_token: "token-b" },
      authGeneration: 2,
    });
    refresh.resolve();
    await completion;

    expect(holder.queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(holder.toast.success).not.toHaveBeenCalled();
    expect(holder.toast.warning).not.toHaveBeenCalled();
  });
});
