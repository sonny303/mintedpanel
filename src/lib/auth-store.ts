// Auth + org state: holds session, memberships, active org, and role selector.
// Persists active org choice in localStorage so the selection survives navigation and reloads.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/externalClient";

export type AppRole = "specialist" | "billing" | "admin";

export interface MembershipEntry {
  orgId: string;
  orgName: string;
  role: AppRole;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  fullName: string | null;
  memberships: MembershipEntry[];
  activeOrgId: string | null;
  initialized: boolean;
  loading: boolean;
  init: () => Promise<void>;
  loadMemberships: () => Promise<void>;
  setActiveOrg: (orgId: string) => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  fullName: null,
  memberships: [],
  activeOrgId: null,
  initialized: false,
  loading: false,

  init: async () => {
    const { data } = await supabase.auth.getSession();
    set({ session: data.session, user: data.session?.user ?? null });
    if (data.session) await get().loadMemberships();
    set({ initialized: true });

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      set({ session, user: session?.user ?? null });
      if (session) {
        await get().loadMemberships();
      } else {
        set({ memberships: [], activeOrgId: null, fullName: null });
      }
    });
  },

  loadMemberships: async () => {
    const user = get().user;
    if (!user) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    const { data, error } = await supabase
      .from("memberships")
      .select("org_id, role, organizations(name)")
      .eq("user_id", user.id);
    if (error || !data) {
      set({ memberships: [], activeOrgId: null });
      return;
    }
    const memberships: MembershipEntry[] = data.map((row) => ({
      orgId: row.org_id as string,
      orgName: (row.organizations as { name: string } | null)?.name ?? "Organization",
      role: row.role as AppRole,
    }));
    const current = get().activeOrgId;
    const activeOrgId = current && memberships.some((m) => m.orgId === current)
      ? current
      : (memberships[0]?.orgId ?? null);
    set({ memberships, activeOrgId, fullName: profile?.full_name ?? null });
  },

  setActiveOrg: (orgId) => {
    if (get().memberships.some((m) => m.orgId === orgId)) set({ activeOrgId: orgId });
  },

  signIn: async (email, password) => {
    set({ loading: true });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    set({ loading: false });
    if (error) return { error: error.message };
    return { error: null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, memberships: [], activeOrgId: null, fullName: null });
  },
}));

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
