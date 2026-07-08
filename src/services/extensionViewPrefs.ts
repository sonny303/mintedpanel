// Per-user extension view preferences, for GET/PUT /api/me/view-prefs: which
// profile tokens the extension's provider detail card shows, in order.
// USER-scoped like orgMemberships — stored in public.user_table_prefs keyed by
// (user_id, page_key), the table reserved for the preferences chunk. The
// userId must always come from the guard's UserContext, never from the body.
//
// Server-only surface (no browser-default ctx); its consumer is the extension.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

export interface ExtensionViewPrefsServiceCtx {
  db: SupabaseClient<Database>;
}

// The extension provider-detail card's page key in user_table_prefs.
export const EXTENSION_DETAIL_PAGE_KEY = "extension.providerDetails";

// fields: ordered bare token keys (e.g. "license.licenseNumber"). null =
// nothing saved yet — the extension falls back to its default field set.
export interface ExtensionViewPrefs {
  fields: string[];
}

// Bare catalog token form: prefix.camelName (see src/lib/tokenFormat.ts —
// braced forms are rejected here, the client saves bare keys only).
const TOKEN_KEY_RE = /^[a-zA-Z]+\.[a-zA-Z0-9]+$/;
const MAX_FIELDS = 64;

// Narrow an untrusted body to ExtensionViewPrefs, or null when malformed.
export function parseExtensionViewPrefs(body: unknown): ExtensionViewPrefs | null {
  if (body == null || typeof body !== "object" || Array.isArray(body)) return null;
  const fields = (body as { fields?: unknown }).fields;
  if (!Array.isArray(fields) || fields.length > MAX_FIELDS) return null;
  const parsed: string[] = [];
  for (const field of fields) {
    if (typeof field !== "string" || !TOKEN_KEY_RE.test(field)) return null;
    if (!parsed.includes(field)) parsed.push(field);
  }
  return { fields: parsed };
}

export async function getExtensionViewPrefs(
  ctx: ExtensionViewPrefsServiceCtx,
  userId: string,
): Promise<ExtensionViewPrefs | null> {
  const { data, error } = await ctx.db
    .from("user_table_prefs")
    .select("prefs")
    .eq("user_id", userId)
    .eq("page_key", EXTENSION_DETAIL_PAGE_KEY)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // Re-validate on read: rows are writable by other clients, so a malformed
  // payload degrades to "nothing saved" instead of breaking the panel.
  return parseExtensionViewPrefs(data.prefs);
}

export async function putExtensionViewPrefs(
  ctx: ExtensionViewPrefsServiceCtx,
  userId: string,
  prefs: ExtensionViewPrefs,
): Promise<void> {
  const { error } = await ctx.db.from("user_table_prefs").upsert(
    {
      user_id: userId,
      page_key: EXTENSION_DETAIL_PAGE_KEY,
      prefs: prefs as unknown as Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,page_key" },
  );
  if (error) throw error;
}
