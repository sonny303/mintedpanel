// E4.3 TE-15 — the extension quick-card layout preference, read/written through
// GET/PUT /api/me/view-prefs. USER-scoped, not org-scoped: prefs follow the
// user across orgs, so the route runs on authenticateUser (the /api/me/orgs
// precedent) and every query here is scoped by the JWT-verified user id ONLY —
// never a client-supplied id. The service-role client bypasses RLS, so the
// user_id predicate on every statement IS the isolation (like the org guard's
// org_id): caller A can never read or write caller B's row.
//
// Stored in user_table_prefs under page_key EXTENSION_QUICK_CARDS_PAGE_KEY as
// { fields: string[] } — the user's ordered list of closed-catalog field keys.
// Not a PHI read/write (a list of field KEYS, never any provider value) — no
// audit row (TE-15).
//
// Server-only surface (no browser-default ctx) — see caseContext.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { EXTENSION_QUICK_CARDS_PAGE_KEY } from "@/lib/quickCardCatalog";

export interface ViewPrefsServiceCtx {
  db: SupabaseClient<Database>;
  userId: string;
}

/** The saved quick-card layout, or null when nothing has been saved. The
 * envelope's `data` is never null (the route returns `{ fields: null }`), so a
 * fresh user degrades to the client's default layout without an error. */
export async function getExtensionViewPrefs(
  ctx: ViewPrefsServiceCtx,
): Promise<{ fields: string[] | null }> {
  const { data, error } = await ctx.db
    .from("user_table_prefs")
    .select("prefs")
    .eq("user_id", ctx.userId)
    .eq("page_key", EXTENSION_QUICK_CARDS_PAGE_KEY)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { fields: null };
  const prefs = data.prefs as { fields?: unknown } | null;
  const stored = prefs?.fields;
  // A malformed stored value degrades to null (the client falls back to the
  // default layout) rather than throwing — TE-15's "missing/invalid stored
  // JSON" contract. Values written through this service are always valid.
  if (!Array.isArray(stored) || !stored.every((f) => typeof f === "string")) {
    return { fields: null };
  }
  return { fields: stored as string[] };
}

/** Upsert the caller's quick-card layout (validated by the route before it
 * reaches here). Keyed on (user_id, page_key); user_id comes from the verified
 * JWT, never the body. */
export async function putExtensionViewPrefs(
  ctx: ViewPrefsServiceCtx,
  fields: string[],
): Promise<{ fields: string[] }> {
  const { error } = await ctx.db.from("user_table_prefs").upsert(
    {
      user_id: ctx.userId,
      page_key: EXTENSION_QUICK_CARDS_PAGE_KEY,
      prefs: { fields } as unknown as Json,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "user_id,page_key" },
  );
  if (error) throw error;
  return { fields };
}
