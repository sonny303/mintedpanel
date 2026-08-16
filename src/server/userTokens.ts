// The {{user.*}} token family — who is filling this form.
//
// R2 locked decision 5 (2026-07-05) resolved these from the caller's JWT / auth
// metadata, because no user-profile columns existed. Since 2026-08-16 they
// resolve from the caller's own `profiles` row (first_name/last_name/title),
// which the /account page writes; auth metadata remains the FALLBACK so a user
// who has not visited /account yet still fills the name they already had.
//
// WHY PROFILES IS PRIMARY. There were two unsynced name stores: profiles
// (everything the app displays — sidebar, Access table, audit actors) and auth
// metadata (what actually typed into a payer form). Editing one never touched
// the other. src/services/userProfile.ts now writes both on every save with
// profiles authoritative, and this reader prefers profiles so the two can only
// converge, never diverge further.
//
// USER-SCOPED READ. The row is fetched by ctx.userId — the JWT-verified caller,
// never a client-supplied id. That scoping IS the isolation here, exactly as in
// extensionViewPrefs.ts: the db client is service-role and bypasses RLS.
//
// user.name      = composed first+last, else profiles.full_name, else auth
//                  metadata full_name/name. The COMPOSITE key — deliberately no
//                  separate `user.fullName`: two catalog keys resolving to one
//                  value let a trained portal mapping pick either, and
//                  `user.name` is a locked wire contract the extension already
//                  joins on.
// user.firstName = profiles.first_name (2026-08-16)
// user.lastName  = profiles.last_name  (2026-08-16)
// user.title     = profiles.title      (2026-08-16)
// user.email     = the JWT email claim, else profiles.email.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ProfileToken } from "@/services/providerProfile";
import { composeFullName } from "@/lib/personName";
import type { AuthContext } from "./guard";

export interface ResolvedUserTokens {
  tokens: ProfileToken[];
  // Non-fatal "resolved to empty" explanations, for the envelope meta.notes.
  notes: string[];
}

interface UserProfileRow {
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  full_name: string | null;
  email: string | null;
}

function metadataString(meta: Record<string, unknown> | null, key: string): string | null {
  const value = meta?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function clean(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Read the caller's own profile row. A failure here is non-fatal: resolution
 * falls back to auth metadata, so a profiles hiccup degrades the preparer name
 * rather than failing the whole PHI-bearing profile response. */
async function readOwnProfile(
  db: SupabaseClient<Database>,
  userId: string,
): Promise<UserProfileRow | null> {
  try {
    const { data, error } = await db
      .from("profiles")
      .select("first_name, last_name, title, full_name, email")
      .eq("id", userId)
      .maybeSingle();
    if (error) return null;
    return (data as UserProfileRow | null) ?? null;
  } catch {
    return null;
  }
}

export async function resolveUserTokens(
  ctx: Pick<AuthContext, "userId" | "email" | "userMetadata" | "db">,
): Promise<ResolvedUserTokens> {
  const notes: string[] = [];
  const profile = await readOwnProfile(ctx.db, ctx.userId);

  const firstName = clean(profile?.first_name);
  const lastName = clean(profile?.last_name);
  const title = clean(profile?.title);

  // Composed parts win; then the stored display name (rows predating the
  // 2026-08-16 split keep theirs, which was never backfilled); then auth
  // metadata, for a user whose profile row is somehow empty.
  const composed = clean(composeFullName({ firstName, lastName }));
  const name =
    composed ??
    clean(profile?.full_name) ??
    metadataString(ctx.userMetadata, "full_name") ??
    metadataString(ctx.userMetadata, "name");
  if (name == null) {
    notes.push("user.name resolved to empty: set your name on the Account page");
  }
  if (firstName == null) {
    notes.push("user.firstName resolved to empty: set your name on the Account page");
  }
  if (lastName == null) {
    notes.push("user.lastName resolved to empty: set your name on the Account page");
  }
  if (title == null) {
    notes.push("user.title resolved to empty: set your title on the Account page");
  }

  const email = clean(ctx.email) ?? clean(profile?.email);
  if (email == null) {
    notes.push("user.email resolved to empty: the JWT carries no email claim");
  }

  return {
    tokens: [
      { token: "user.name", value: name ?? "" },
      { token: "user.firstName", value: firstName ?? "" },
      { token: "user.lastName", value: lastName ?? "" },
      { token: "user.title", value: title ?? "" },
      { token: "user.email", value: email ?? "" },
    ],
    notes,
  };
}
