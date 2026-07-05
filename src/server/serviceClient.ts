// Server-only Supabase clients.
//
// This module lives under src/server/, which matches the vite import-protection
// glob (`**/server/**`) configured in vite.config.ts — so it can never be pulled
// into a browser bundle. The service-role client bypasses RLS; org/role scoping
// is enforced in code by the guard (see ./guard.ts), never by the database here.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { resolveServerSupabaseEnv } from "./env";

let cachedAdmin: SupabaseClient<Database> | undefined;

// Service-role client (RLS-bypassing). Cached per server instance.
export function getServiceClient(): SupabaseClient<Database> {
  if (cachedAdmin) return cachedAdmin;
  const { url, serviceKey } = resolveServerSupabaseEnv();
  if (!url || !serviceKey) {
    throw new Error(
      "Server Supabase not configured: need SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  cachedAdmin = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAdmin;
}

// Anon client bound to the caller's JWT — used only to verify the token via
// getClaims (the same technique as the generated auth-middleware.ts). Not cached
// because it carries a per-request Authorization header.
export function getAuthClient(token: string): SupabaseClient<Database> {
  const { url, anonKey } = resolveServerSupabaseEnv();
  if (!url || !anonKey) {
    throw new Error(
      "Server Supabase not configured: need SUPABASE_URL (or VITE_SUPABASE_URL) and an anon/publishable key",
    );
  }
  return createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
