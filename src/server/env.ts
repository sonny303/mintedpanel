// Server-only Supabase env resolution.
//
// The generated `src/integrations/supabase/client.server.ts` hard-requires the
// non-prefixed `SUPABASE_URL`. On Vercel the URL/anon key are commonly present
// under their `VITE_`-prefixed names (baked for the client and also visible to
// serverless functions), while the service-role key is set server-only as
// `SUPABASE_SERVICE_ROLE_KEY`. Resolve all three with sensible fallbacks so the
// API layer works regardless of which naming the project uses.
function pick(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

export interface ServerSupabaseEnv {
  url?: string;
  anonKey?: string;
  serviceKey?: string;
}

export function resolveServerSupabaseEnv(): ServerSupabaseEnv {
  return {
    url: pick("SUPABASE_URL", "VITE_SUPABASE_URL"),
    anonKey: pick("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"),
    serviceKey: pick("SUPABASE_SERVICE_ROLE_KEY"),
  };
}
