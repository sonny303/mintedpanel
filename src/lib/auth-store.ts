// Auth + org state: holds session, memberships, active org, and role selector.
// Persists active org choice in localStorage so the selection survives navigation and reloads.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { QueryClient } from "@tanstack/react-query";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/externalClient";
import { selectActiveOrgId } from "@/lib/landing";
import type { LifecycleState } from "@/types";
import { fetchEnrollmentContext, selectEnrollmentContext } from "@/lib/clientAccessApi";
import {
  beginContextRefresh,
  registerContextRevisionObserver,
  resetContextRevision,
  setContextRevision,
} from "@/lib/contextRevision";
import type { EnrollmentAudience, EnrollmentContext } from "@/services/clientAccess";

let registeredQueryClient: QueryClient | null = null;
let accessContextAbortController: AbortController | null = null;
let passiveAccessContextRefresh: Promise<EnrollmentContext | null> | null = null;
let revisionObserverRegistered = false;
let authStateListenerRegistered = false;
let authCallbackGeneration = 0;
let lifecycleListenersRegistered = false;

function invalidateProtectedWork({
  resetRevision = false,
  clearQueries = true,
}: { resetRevision?: boolean; clearQueries?: boolean } = {}): void {
  accessContextAbortController?.abort();
  accessContextAbortController = null;
  void registeredQueryClient?.cancelQueries();
  if (clearQueries) registeredQueryClient?.clear();
  if (resetRevision) resetContextRevision();
  else beginContextRefresh();
}

export function registerQueryClient(client: QueryClient): void {
  registeredQueryClient = client;
  if (!revisionObserverRegistered) {
    revisionObserverRegistered = true;
    registerContextRevisionObserver((revision) => {
      const state = useAuthStore.getState();
      if (!state.session) {
        return;
      }
      if (revision && state.accessContext?.contextRevision === revision) {
        return;
      }
      void state.loadAccessContext().catch(() => undefined);
    });
  }
}

export type AppRole = "specialist" | "billing" | "admin";

export interface MembershipEntry {
  orgId: string;
  orgName: string;
  role: AppRole;
  // Internal lifecycle + creation order carried alongside the membership so the
  // boot-time active-org validation can be lifecycle-aware (E0.4 TE-2). Never
  // rendered as a status label (E0.0 F0.0.2) — used only for org selection.
  lifecycleState: LifecycleState;
  createdAt: string;
}

export type SignInErrorKind = "invalid" | "network" | "unknown";

interface AuthState {
  session: Session | null;
  user: User | null;
  fullName: string | null;
  memberships: MembershipEntry[];
  membershipsLoading: boolean;
  activeOrgId: string | null;
  initialized: boolean;
  initError: string | null;
  loading: boolean;
  accessContext: EnrollmentContext | null;
  accessContextLoading: boolean;
  accessContextError: string | null;
  contextEpoch: number;
  authGeneration: number;
  selectionHint: { audience: Exclude<EnrollmentAudience, null>; orgId: string } | null;
  init: () => Promise<void>;
  loadMemberships: () => Promise<void>;
  loadAccessContext: (options?: {
    audience?: Exclude<EnrollmentAudience, null>;
    orgId?: string | null;
    expectedRevision?: string;
    preserveCurrentContext?: boolean;
  }) => Promise<EnrollmentContext | null>;
  revalidateAccessContext: () => Promise<EnrollmentContext | null>;
  selectAccessContext: (input: {
    audience: Exclude<EnrollmentAudience, null>;
    orgId: string;
  }) => Promise<EnrollmentContext | null>;
  setActiveOrg: (orgId: string) => void;
  signIn: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null; kind?: SignInErrorKind }>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      user: null,
      fullName: null,
      memberships: [],
      membershipsLoading: false,
      activeOrgId: null,
      initialized: false,
      initError: null,
      loading: false,
      accessContext: null,
      accessContextLoading: false,
      accessContextError: null,
      contextEpoch: 0,
      authGeneration: 0,
      selectionHint: null,

      init: async () => {
        set({ initError: null });
        const bootstrapAuthGeneration = authCallbackGeneration;
        if (!authStateListenerRegistered) {
          authStateListenerRegistered = true;
          supabase.auth.onAuthStateChange((event, session) => {
            // Keep Supabase's auth callback synchronous. Context resolution can
            // call Supabase again and must start after the SDK releases its lock.
            const transition = prepareAuthStateChange(event, session);
            if (!transition) return;
            authCallbackGeneration += 1;
            setTimeout(() => void transition.finish().catch(() => undefined), 0);
          });
        }
        try {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (bootstrapAuthGeneration === authCallbackGeneration) {
            invalidateProtectedWork({ resetRevision: true });
            set({
              session: data.session,
              user: data.session?.user ?? null,
              memberships: [],
              membershipsLoading: Boolean(data.session),
              activeOrgId: data.session ? get().activeOrgId : null,
              fullName: data.session ? get().fullName : null,
              accessContext: null,
              selectionHint: null,
              accessContextError: null,
              accessContextLoading: false,
            });
            if (data.session) {
              let membershipsReady = true;
              try {
                await get().loadMemberships();
              } catch {
                if (bootstrapAuthGeneration === authCallbackGeneration) {
                  set({ initError: "Can't reach Minted Panel. Check your connection." });
                }
                membershipsReady = false;
              }
              if (membershipsReady && bootstrapAuthGeneration === authCallbackGeneration) {
                try {
                  await get().loadAccessContext();
                } catch {
                  // loadAccessContext stores its own explicit retryable error.
                }
              }
            } else {
              set({
                membershipsLoading: false,
                memberships: [],
                activeOrgId: null,
                fullName: null,
              });
            }
          }
        } catch {
          if (bootstrapAuthGeneration === authCallbackGeneration) {
            set({ initError: "Can't reach Minted Panel. Check your connection." });
          }
        } finally {
          set({ initialized: true });
        }

        if (!lifecycleListenersRegistered && typeof window !== "undefined") {
          lifecycleListenersRegistered = true;
          const refresh = () => {
            void useAuthStore
              .getState()
              .revalidateAccessContext()
              .catch(() => undefined);
          };
          window.addEventListener("focus", refresh);
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") refresh();
          });
        }
      },

      loadMemberships: async () => {
        const user = get().user;
        if (!user) return;
        const requestUserId = user.id;
        const requestAuthGeneration = get().authGeneration;
        set({ membershipsLoading: true });
        // Convert any pending_invites matching this user's email into
        // memberships before we read. Errors here are non-fatal.
        try {
          const rpc = supabase.rpc.bind(supabase) as unknown as (name: string) => Promise<{
            data: number | null;
            error: unknown;
          }>;
          await rpc("claim_invites");
        } catch {
          // ignore — user may simply have no pending invites
        }
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", user.id)
          .maybeSingle();
        const { data, error } = await supabase
          .from("memberships")
          .select("org_id, role, organizations(name, lifecycle_state, created_at)")
          .eq("user_id", user.id);
        if (error) {
          if (get().user?.id !== requestUserId) return;
          if (get().authGeneration === requestAuthGeneration) {
            set({ memberships: [], activeOrgId: null, fullName: null, membershipsLoading: false });
          }
          throw error;
        }
        if (get().user?.id !== requestUserId || get().authGeneration !== requestAuthGeneration)
          return;
        if (!data) {
          set({
            memberships: [],
            activeOrgId: null,
            fullName: profile?.full_name ?? null,
            membershipsLoading: false,
            selectionHint: null,
          });
          return;
        }
        const memberships: MembershipEntry[] = data.map((row) => {
          const org = row.organizations as {
            name: string;
            lifecycle_state: string;
            created_at: string;
          } | null;
          return {
            orgId: row.org_id as string,
            orgName: org?.name ?? "Organization",
            role: row.role as AppRole,
            // Anything other than the three known states coerces to 'active' (only
            // 'inactive' changes selection); the DB CHECK guarantees one of three.
            lifecycleState: (org?.lifecycle_state === "prospect" ||
            org?.lifecycle_state === "inactive"
              ? org.lifecycle_state
              : "active") as LifecycleState,
            createdAt: org?.created_at ?? "",
          };
        });
        // E0.4 TE-2: keep the persisted last-active org if it's still a valid,
        // non-inactive membership; otherwise fall back to the most recently created
        // live org (not just the first membership). If every org is inactive,
        // selectActiveOrgId returns null — keep a membership active anyway so the
        // shell has an org context (the landing resolver routes such users to the
        // Portfolio all-inactive fallback).
        const activeOrgId =
          selectActiveOrgId(
            memberships.map((m) => ({
              id: m.orgId,
              lifecycleState: m.lifecycleState,
              createdAt: m.createdAt,
            })),
            get().selectionHint?.orgId ?? get().activeOrgId,
          ) ??
          memberships[0]?.orgId ??
          null;
        set({
          memberships,
          activeOrgId,
          fullName: profile?.full_name ?? null,
          membershipsLoading: false,
          selectionHint: null,
        });
      },

      loadAccessContext: async (options) => {
        const epoch = get().contextEpoch + 1;
        const previous = get().accessContext;
        const selectionHint = get().selectionHint;
        const requestUserId = get().user?.id ?? null;
        const requestAuthGeneration = get().authGeneration;
        const expectedRevision = options?.expectedRevision ?? previous?.contextRevision ?? "";
        const preserveCurrentContext = Boolean(options?.preserveCurrentContext && previous);
        const interruptedActiveQueryKeys = preserveCurrentContext
          ? (
              registeredQueryClient
                ?.getQueryCache()
                .findAll({ type: "active", fetchStatus: "fetching" }) ?? []
            ).map((query) => query.queryKey)
          : [];
        invalidateProtectedWork({ clearQueries: !preserveCurrentContext });
        const controller = new AbortController();
        accessContextAbortController = controller;
        const signal = controller.signal;
        set({
          accessContext: preserveCurrentContext ? previous : null,
          accessContextLoading: true,
          accessContextError: null,
          contextEpoch: epoch,
        });
        try {
          let context: EnrollmentContext;
          if (options?.audience && options.orgId) {
            let revision = expectedRevision;
            if (!revision) {
              const discovery = await fetchEnrollmentContext({ signal });
              revision = discovery.contextRevision;
            }
            context = await selectEnrollmentContext(
              {
                audience: options.audience,
                orgId: options.orgId,
                contextRevision: revision,
              },
              { signal },
            );
          } else {
            const discovery = await fetchEnrollmentContext({ signal });
            const preservedAudience = previous?.audience ?? selectionHint?.audience;
            const preservedOrgId = previous?.selectedOrgId ?? selectionHint?.orgId;
            const canPreserveStaff =
              preservedAudience === "staff" &&
              !!preservedOrgId &&
              discovery.staffOrgs.some((org) => org.orgId === preservedOrgId);
            const canPreserveClient =
              preservedAudience === "client" &&
              !!preservedOrgId &&
              discovery.clientOrgs.some((org) => org.orgId === preservedOrgId);
            if (canPreserveStaff || canPreserveClient) {
              context = await selectEnrollmentContext(
                {
                  audience: preservedAudience as Exclude<EnrollmentAudience, null>,
                  orgId: preservedOrgId as string,
                  contextRevision: discovery.contextRevision,
                },
                { signal },
              );
            } else {
              context = discovery;
            }
          }
          if (get().contextEpoch !== epoch || get().authGeneration !== requestAuthGeneration)
            return null;
          if (requestUserId && context.actorUserId !== requestUserId) {
            throw new Error("The verified account changed while access was being resolved");
          }
          if (
            options?.audience &&
            options.orgId &&
            (context.audience !== options.audience || context.selectedOrgId !== options.orgId)
          ) {
            throw new Error("The selected access context was not returned by the server");
          }
          const sameVerifiedContext = Boolean(
            previous &&
            previous.actorUserId === context.actorUserId &&
            previous.audience === context.audience &&
            previous.selectedOrgId === context.selectedOrgId &&
            previous.contextRevision === context.contextRevision,
          );
          if (preserveCurrentContext && !sameVerifiedContext) {
            registeredQueryClient?.clear();
            await get().loadMemberships();
            if (get().contextEpoch !== epoch || get().authGeneration !== requestAuthGeneration) {
              return null;
            }
          }
          if (accessContextAbortController === controller) accessContextAbortController = null;
          setContextRevision(context.contextRevision);
          set({
            accessContext: context,
            accessContextLoading: false,
            accessContextError: null,
          });
          if (preserveCurrentContext && sameVerifiedContext && interruptedActiveQueryKeys.length) {
            for (const queryKey of interruptedActiveQueryKeys) {
              void registeredQueryClient
                ?.refetchQueries({ queryKey, exact: true, type: "active" })
                .catch(() => undefined);
            }
          }
          return context;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return null;
          if (get().contextEpoch === epoch && get().authGeneration === requestAuthGeneration) {
            if (accessContextAbortController === controller) accessContextAbortController = null;
            registeredQueryClient?.clear();
            set({
              accessContext: null,
              accessContextLoading: false,
              accessContextError:
                error instanceof Error ? error.message : "Unable to resolve access context",
            });
          }
          throw error;
        }
      },

      selectAccessContext: async (input) => {
        return get().loadAccessContext(input);
      },

      revalidateAccessContext: async () => {
        if (passiveAccessContextRefresh) return passiveAccessContextRefresh;
        const current = get();
        if (!current.session || !current.user || current.accessContextLoading) return null;

        const refresh = current.accessContext
          ? current.loadAccessContext({ preserveCurrentContext: true })
          : current.loadAccessContext();
        passiveAccessContextRefresh = refresh;
        try {
          return await refresh;
        } finally {
          if (passiveAccessContextRefresh === refresh) passiveAccessContextRefresh = null;
        }
      },

      setActiveOrg: (orgId) => {
        if (get().memberships.some((m) => m.orgId === orgId) && get().activeOrgId !== orgId) {
          set({ activeOrgId: orgId });
          void registeredQueryClient?.cancelQueries();
          registeredQueryClient?.removeQueries();
          const context = get().accessContext;
          if (
            context?.audience === "staff" &&
            context.staffOrgs.some((org) => org.orgId === orgId)
          ) {
            void get().selectAccessContext({ audience: "staff", orgId });
          }
        }
      },

      signIn: async (email, password) => {
        set({ loading: true });
        try {
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          set({ loading: false });
          if (!error) return { error: null };
          const name = (error as { name?: string }).name ?? "";
          const status = (error as { status?: number }).status;
          if (name === "AuthRetryableFetchError" || status === 0 || typeof status === "undefined") {
            return {
              error: "Can't reach the server. Check your connection and try again.",
              kind: "network",
            };
          }
          if (status === 400 || status === 401 || /invalid/i.test(error.message)) {
            return { error: "Invalid email or password", kind: "invalid" };
          }
          return { error: error.message, kind: "unknown" };
        } catch {
          set({ loading: false });
          return {
            error: "Can't reach the server. Check your connection and try again.",
            kind: "network",
          };
        }
      },

      signOut: async () => {
        invalidateProtectedWork({ resetRevision: true });
        await supabase.auth.signOut();
        set({
          session: null,
          user: null,
          memberships: [],
          membershipsLoading: false,
          activeOrgId: null,
          fullName: null,
          accessContext: null,
          selectionHint: null,
          accessContextError: null,
          accessContextLoading: false,
          contextEpoch: get().contextEpoch + 1,
        });
        await useAuthStore.persist.clearStorage();
      },
    }),
    {
      name: "minted-panel-active-org",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }
        return window.localStorage;
      }),
      partialize: (state) => ({ activeOrgId: state.activeOrgId }),
    },
  ),
);

/**
 * Apply the app-owned effects of an auth identity update. The SDK normally
 * invokes this through onAuthStateChange; profile metadata writes that use a
 * captured actor-bound request call the same routine after the response is
 * verified, without installing that response into the SDK client.
 */
type PreparedAuthTransition = { finish: () => Promise<boolean> };

function prepareAuthStateChange(
  event: AuthChangeEvent,
  session: Session | null,
  expected?: { actorUserId: string; authGeneration: number },
): PreparedAuthTransition | null {
  if (
    event !== "SIGNED_IN" &&
    event !== "SIGNED_OUT" &&
    event !== "USER_UPDATED" &&
    event !== "TOKEN_REFRESHED"
  ) {
    return null;
  }

  const current = useAuthStore.getState();
  if (
    expected &&
    (current.user?.id !== expected.actorUserId ||
      current.authGeneration !== expected.authGeneration)
  ) {
    return null;
  }

  const nextUserId = session?.user?.id ?? null;
  if (
    session &&
    current.user?.id === nextUserId &&
    (event === "TOKEN_REFRESHED" || event === "SIGNED_IN")
  ) {
    useAuthStore.setState({ session, user: session.user });
    const actorUserId = nextUserId;
    const authGeneration = current.authGeneration;
    return {
      finish: async () => {
        const latest = useAuthStore.getState();
        if (latest.user?.id !== actorUserId || latest.authGeneration !== authGeneration)
          return false;
        await latest.revalidateAccessContext();
        return true;
      },
    };
  }

  invalidateProtectedWork({ resetRevision: true });
  const previousUserId = current.user?.id ?? null;
  const sameActor = Boolean(previousUserId && nextUserId && previousUserId === nextUserId);
  const previousContext = current.accessContext;
  const selectionHint =
    sameActor && previousContext?.audience && previousContext.selectedOrgId
      ? {
          audience: previousContext.audience,
          orgId: previousContext.selectedOrgId,
        }
      : null;
  const eventEpoch = current.contextEpoch + 1;
  const authGeneration = current.authGeneration + 1;
  useAuthStore.setState({
    session,
    user: session?.user ?? null,
    memberships: [],
    membershipsLoading: Boolean(session),
    activeOrgId: null,
    fullName: null,
    initError: null,
    accessContext: null,
    selectionHint,
    accessContextError: null,
    accessContextLoading: false,
    contextEpoch: eventEpoch,
    authGeneration,
  });
  return {
    finish: async () => {
      if (useAuthStore.getState().authGeneration !== authGeneration) return false;
      if (session) {
        // Start context resolution before membership I/O can yield. A later auth
        // event aborts this request, and actor/generation guards prevent stale
        // results from committing.
        const contextPromise = useAuthStore
          .getState()
          .loadAccessContext()
          .catch(() => undefined);
        let membershipsReady = true;
        try {
          await useAuthStore.getState().loadMemberships();
        } catch {
          if (useAuthStore.getState().authGeneration === authGeneration) {
            useAuthStore.setState({
              initError: "Can't reach Minted Panel. Check your connection.",
            });
          }
          membershipsReady = false;
        }
        if (membershipsReady && useAuthStore.getState().authGeneration === authGeneration) {
          await contextPromise;
          if (useAuthStore.getState().authGeneration === authGeneration) {
            useAuthStore.setState({ initError: null });
          }
        }
      } else {
        useAuthStore.setState({
          memberships: [],
          membershipsLoading: false,
          activeOrgId: null,
          fullName: null,
          initError: null,
          accessContext: null,
          accessContextError: null,
          accessContextLoading: false,
        });
        // Event-driven sign-outs must drop the previous principal's cache just
        // like signOut() does; invalidateProtectedWork already cleared it.
      }
      return true;
    },
  };
}

export async function applyAuthStateChange(
  event: AuthChangeEvent,
  session: Session | null,
  expected?: { actorUserId: string; authGeneration: number },
): Promise<boolean> {
  const transition = prepareAuthStateChange(event, session, expected);
  if (!transition) return false;
  return transition.finish();
}

export function useActiveMembership(): MembershipEntry | null {
  return useAuthStore((s) => s.memberships.find((m) => m.orgId === s.activeOrgId) ?? null);
}

export function useRole(): AppRole | null {
  return useActiveMembership()?.role ?? null;
}

export function useActiveOrgId(): string | null {
  return useAuthStore((s) => s.activeOrgId);
}
