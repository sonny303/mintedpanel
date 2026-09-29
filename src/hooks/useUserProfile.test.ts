import { describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => {
  let state = {
    user: { id: "actor-a" },
    authGeneration: 1,
    contextEpoch: 1,
    fullName: "Old Name",
  };
  const queryClient = {
    setQueryData: vi.fn(),
  };
  const getMyProfile = vi.fn();
  const updateMyProfile = vi.fn();
  const toast = {
    success: vi.fn(),
    warning: vi.fn(),
  };
  const authStore = Object.assign(
    vi.fn((selector?: (value: typeof state) => unknown) => (selector ? selector(state) : state)),
    {
      getState: vi.fn(() => state),
      setState: vi.fn((patch: Partial<typeof state>) => {
        state = { ...state, ...patch };
      }),
    },
  );

  return {
    authStore,
    getMyProfile,
    queryClient,
    setState(next: Partial<typeof state>) {
      state = { ...state, ...next };
    },
    state: () => state,
    toast,
    updateMyProfile,
  };
});

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: unknown) => options,
  useQuery: vi.fn(),
  useQueryClient: () => holder.queryClient,
}));
vi.mock("@/services/userProfile", () => ({
  getMyProfile: holder.getMyProfile,
  updateMyProfile: holder.updateMyProfile,
}));
vi.mock("@/lib/auth-store", () => ({ useAuthStore: holder.authStore }));
vi.mock("sonner", () => ({ toast: holder.toast }));

import { useUpdateMyProfile } from "./useUserProfile";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("useUpdateMyProfile completion guards", () => {
  it("writes the fresh same-actor refetch into cache and fullName", async () => {
    holder.setState({
      authGeneration: 1,
      contextEpoch: 1,
      user: { id: "actor-a" },
      fullName: "Old Name",
    });
    holder.getMyProfile.mockReset();
    holder.queryClient.setQueryData.mockReset();
    holder.toast.success.mockReset();
    const fresh = deferred<{ id: string; fullName: string }>();
    holder.getMyProfile.mockReturnValueOnce(fresh.promise);

    const mutation = useUpdateMyProfile() as unknown as {
      onMutate: () => unknown;
      onSuccess: (result: unknown, input: unknown, context: unknown) => void;
    };
    const origin = mutation.onMutate();
    holder.setState({ contextEpoch: 2 });
    mutation.onSuccess(
      {
        id: "actor-a",
        firstName: "New",
        lastName: "Name",
        title: "Title",
        fullName: "New Name",
        email: "actor-a@example.test",
        metadataSync: "synced",
      },
      {},
      origin,
    );

    fresh.resolve({ id: "actor-a", fullName: "New Name" });
    await fresh.promise;
    await vi.waitFor(() => expect(holder.queryClient.setQueryData).toHaveBeenCalledTimes(1));

    expect(holder.queryClient.setQueryData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "actor-a", fullName: "New Name" }),
    );
    expect(holder.state().fullName).toBe("New Name");
    expect(holder.toast.success).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale refetch when the same actor changes epoch while it is pending", async () => {
    holder.setState({
      authGeneration: 1,
      contextEpoch: 1,
      user: { id: "actor-a" },
      fullName: "Old Name",
    });
    holder.getMyProfile.mockReset();
    holder.queryClient.setQueryData.mockReset();
    holder.toast.success.mockReset();
    holder.toast.warning.mockReset();
    const fresh = deferred<{ id: string; fullName: string }>();
    holder.getMyProfile.mockReturnValueOnce(fresh.promise);

    const mutation = useUpdateMyProfile() as unknown as {
      onMutate: () => unknown;
      onSuccess: (result: unknown, input: unknown, context: unknown) => void;
    };
    const origin = mutation.onMutate();
    holder.setState({ contextEpoch: 2 });
    mutation.onSuccess(
      {
        id: "actor-a",
        firstName: "New",
        lastName: "Name",
        title: "Title",
        fullName: "New Name",
        email: "actor-a@example.test",
        metadataSync: "synced",
      },
      {},
      origin,
    );

    holder.setState({ contextEpoch: 3 });
    fresh.resolve({ id: "actor-a", fullName: "New Name" });
    await fresh.promise;
    await Promise.resolve();

    expect(holder.queryClient.setQueryData).not.toHaveBeenCalled();
    expect(holder.state().fullName).toBe("Old Name");
    expect(holder.toast.success).toHaveBeenCalledTimes(1);
  });

  it("does not write or notify when a completion belongs to another actor", () => {
    holder.setState({ authGeneration: 1, contextEpoch: 1, user: { id: "actor-a" } });
    holder.queryClient.setQueryData.mockReset();
    holder.toast.success.mockReset();

    const mutation = useUpdateMyProfile() as unknown as {
      onMutate: () => unknown;
      onSuccess: (result: unknown, input: unknown, context: unknown) => void;
    };
    const origin = mutation.onMutate();
    holder.setState({ user: { id: "actor-b" } });
    mutation.onSuccess(
      {
        id: "actor-a",
        firstName: "New",
        lastName: "Name",
        title: "Title",
        fullName: "New Name",
        email: "actor-a@example.test",
        metadataSync: "synced",
      },
      {},
      origin,
    );

    expect(holder.queryClient.setQueryData).not.toHaveBeenCalled();
    expect(holder.toast.success).not.toHaveBeenCalled();
  });
});
