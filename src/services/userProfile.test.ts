import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => {
  const ACTOR_A = "actor-a";
  const ACTOR_B = "actor-b";
  const session = (id: string, token: string) => ({
    access_token: token,
    refresh_token: `refresh-${token}`,
    expires_at: 9_999_999_999,
    user: { id, email: `${id}@example.test`, user_metadata: { full_name: id } },
  });

  let currentActor = ACTOR_A;
  let authGeneration = 1;
  let releasePatch: (() => void) | null = null;
  let patchStarted: (() => void) | null = null;
  let patchGate: Promise<void>;
  let patchSeen: Promise<void>;
  const resetGates = () => {
    patchGate = new Promise<void>((resolve) => {
      releasePatch = resolve;
    });
    patchSeen = new Promise<void>((resolve) => {
      patchStarted = resolve;
    });
  };
  resetGates();
  const profileRow = {
    id: ACTOR_A,
    first_name: "Sowmya",
    last_name: "Surapureddy",
    title: "Credentialing Manager",
    full_name: "Sowmya Surapureddy",
    email: "actor-a@example.test",
  };
  const profileBuilder: Record<string, unknown> = {};
  profileBuilder.update = vi.fn(() => profileBuilder);
  profileBuilder.eq = vi.fn(() => profileBuilder);
  profileBuilder.select = vi.fn(() => profileBuilder);
  profileBuilder.single = vi.fn(async () => {
    patchStarted?.();
    await patchGate;
    return { data: profileRow, error: null };
  });

  const authFetch = vi.fn();
  const authStore = {
    getState: vi.fn(() => ({
      user: { id: currentActor },
      authGeneration,
    })),
  };
  const applyAuthStateChange = vi.fn(async () => false);
  const supabase = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: session(currentActor, `token-${currentActor}`) },
      })),
      getUser: vi.fn(async () => ({ data: { user: { id: currentActor } } })),
    },
    from: vi.fn(() => profileBuilder),
  };

  return {
    ACTOR_A,
    ACTOR_B,
    authFetch,
    authStore,
    applyAuthStateChange,
    get authGeneration() {
      return authGeneration;
    },
    get currentActor() {
      return currentActor;
    },
    get patchSeen() {
      return patchSeen;
    },
    reset() {
      currentActor = ACTOR_A;
      authGeneration = 1;
      resetGates();
      authFetch.mockReset();
      authStore.getState.mockClear();
      applyAuthStateChange.mockReset();
      applyAuthStateChange.mockResolvedValue(false);
    },
    setActor(actor: string, generation: number) {
      currentActor = actor;
      authGeneration = generation;
    },
    release() {
      releasePatch?.();
    },
    supabase,
  };
});

vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: holder.supabase }));
vi.mock("@/lib/auth-store", () => ({
  applyAuthStateChange: holder.applyAuthStateChange,
  useAuthStore: holder.authStore,
}));

import { updateMyProfile } from "./userProfile";

describe("updateMyProfile actor binding", () => {
  beforeEach(() => {
    holder.reset();
    vi.stubGlobal("fetch", holder.authFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips the metadata mirror when the actor changes during the profile write", async () => {
    const save = updateMyProfile({
      firstName: "Sowmya",
      lastName: "Surapureddy",
      title: "Credentialing Manager",
    });
    await holder.patchSeen;

    holder.setActor(holder.ACTOR_B, 2);
    holder.release();

    await expect(save).resolves.toMatchObject({
      id: holder.ACTOR_A,
      metadataSync: "skipped",
    });
    expect(holder.authFetch).not.toHaveBeenCalled();
    expect(holder.applyAuthStateChange).not.toHaveBeenCalled();
  });

  it("pins the auth request to actor A and refuses to install the response after switching to B", async () => {
    holder.release();
    holder.authFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      holder.setActor(holder.ACTOR_B, 2);
      return new Response(JSON.stringify({ id: holder.ACTOR_A, email: "actor-a@example.test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const save = await updateMyProfile({
      firstName: "Sowmya",
      lastName: "Surapureddy",
      title: "Credentialing Manager",
    });

    expect(save.metadataSync).toBe("skipped");
    expect(holder.authFetch).toHaveBeenCalledTimes(1);
    expect(holder.authFetch.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ authorization: "Bearer token-actor-a" }),
    });
    expect(holder.applyAuthStateChange).toHaveBeenCalledWith(
      "USER_UPDATED",
      expect.objectContaining({ user: expect.objectContaining({ id: holder.ACTOR_A }) }),
      { actorUserId: holder.ACTOR_A, authGeneration: 1 },
    );
  });
});
