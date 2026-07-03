// Auth + org state: holds session, memberships, active org, and role selector.
// Persists active org choice in localStorage so the selection survives navigation and reloads.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { QueryClient } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/externalClient";

let registeredQueryClient: QueryClient | null = null;
export function registerQueryClient(client: QueryClient): void {
  registeredQueryClient = client;
}

export type AppRole = "specialist" | "billing" | "admin";

export interface MembershipEntry {
  orgId: string;
  orgName: string;
  role: AppRole;
}

export type SignInErrorKind = "invalid" | "network" | "unknown";

interface AuthState {
  session: Session | null;
  user: User | null;
  fullName: string | null;
  memberships: MembershipEntry[];
  activeOrgId: string | null;
  initialized: boolean;
  initError: string | null;
  loading: boolean;
  init: () => Promise<void>;
  loadMemberships: () => Promise<void>;
  setActiveOrg: (orgId: string) => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null; kind?: SignInErrorKind }>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      user: null,
      fullName: null,
      memberships: [],
      activeOrgId: null,
      initialized: false,
      initError: null,
      loading: false,

      init: async () => {
        set({ initError: null });
        try {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          set({ session: data.session, user: data.session?.user ?? null });
          if (data.session) {
            try {
              await get().loadMemberships();
            } catch {
              set({ initError: "Can't reach Minted Panel. Check your connection." });
            }
          }
        } catch {
          set({ initError: "Can't reach Minted Panel. Check your connection." });
        } finally {
          set({ initialized: true });
        }

        supabase.auth.onAuthStateChange(async (event, session) => {
          if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
          set({ session, user: session?.user ?? null });
          if (session) {
            try {
              await get().loadMemberships();
              set({ initError: null });
            } catch {
              set({ initError: "Can't reach Minted Panel. Check your connection." });
            }
          } else {
            set({ memberships: [], activeOrgId: null, fullName: null, initError: null });
          }
        });
      },

      loadMemberships: async () => {
        const user = get().user;
        if (!user) return;
        // Convert any pending_invites matching this user's email into
        // memberships before we read. Errors here are non-fatal.
        try {
          const rpc = supabase.rpc as unknown as (name: string) => Promise<{
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
          .select("org_id, role, organizations(name)")
          .eq("user_id", user.id);
        if (error) {
          set({ fullName: profile?.full_name ?? null });
          throw error;
        }
        if (!data) {
          set({ memberships: [], activeOrgId: null, fullName: profile?.full_name ?? null });
          return;
        }
        const memberships: MembershipEntry[] = data.map((row) => ({
          orgId: row.org_id as string,
          orgName: (row.organizations as { name: string } | null)?.name ?? "Organization",
          role: row.role as AppRole,
        }));
        const current = get().activeOrgId;
        const hasValidCurrent = current !== null && memberships.some((m) => m.orgId === current);
        const activeOrgId = hasValidCurrent ? current : (memberships[0]?.orgId ?? null);
        set({ memberships, activeOrgId, fullName: profile?.full_name ?? null });
      },

      setActiveOrg: (orgId) => {
        if (get().memberships.some((m) => m.orgId === orgId) && get().activeOrgId !== orgId) {
          set({ activeOrgId: orgId });
          registeredQueryClient?.removeQueries();
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
            return { error: "Can't reach the server. Check your connection and try again.", kind: "network" };
          }
          if (status === 400 || status === 401 || /invalid/i.test(error.message)) {
            return { error: "Invalid email or password", kind: "invalid" };
          }
          return { error: error.message, kind: "unknown" };
        } catch {
          set({ loading: false });
          return { error: "Can't reach the server. Check your connection and try again.", kind: "network" };
        }
      },

      signOut: async () => {
        await supabase.auth.signOut();
        set({ session: null, user: null, memberships: [], activeOrgId: null, fullName: null });
        registeredQueryClient?.clear();
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

export function useActiveMembership(): MembershipEntry | null {
  return useAuthStore((s) =>
    s.memberships.find((m) => m.orgId === s.activeOrgId) ?? null,
  );
}

export function useRole(): AppRole | null {
  return useActiveMembership()?.role ?? null;
}

export function useActiveOrgId(): string | null {
  return useAuthStore((s) => s.activeOrgId);
}

