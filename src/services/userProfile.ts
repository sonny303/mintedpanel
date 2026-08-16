// The signed-in user's own profile — name, title (2026-08-16).
//
// HISTORY. A narrower version of this file existed until PR #228 (2026-07-21),
// which removed the "Your name" card from Org Detail by user request: a
// personal setting had no business on an org page. That version wrote ONLY
// auth user_metadata.full_name. It is restored here behind a real /account
// page, and widened — see the next paragraph, which is the reason this file is
// worth reading.
//
// TWO NAME STORES, NOW RECONCILED. `profiles.full_name` and auth
// `user_metadata.full_name` are separate stores that were never synced:
//   - profiles.full_name  -> the sidebar, Org Detail's Access table, audit_log
//                            actor names, case provenance, touch authors.
//   - user_metadata       -> what the server resolved {{user.name}} from, i.e.
//                            what actually types into a payer form.
// So editing your name in the old panel changed what filled into forms and NOT
// what the app displayed, or the reverse, depending on which door you came
// through. PROFILES IS NOW THE SOURCE OF TRUTH: every save writes the profiles
// row and mirrors the composed name into auth metadata in the same action, and
// src/server/userTokens.ts reads profiles first. The metadata write is kept so
// that anything still reading the JWT (an older deployed server, a cached
// session) sees the same value rather than a stale one.
//
// NO ORG SCOPING AND NO AUDIT ROW, DELIBERATELY. This is user-level identity,
// not tenant data: it is not scoped by org, and audit_log.org_id is NOT NULL —
// there is no org this event belongs to. RLS is the whole enforcement story
// (profiles_update_self: `id = auth.uid()`), which is why nothing here accepts
// a user id from the caller.
import { supabase } from "@/integrations/supabase/externalClient";
import { composeFullName } from "@/lib/personName";

export interface UserProfile {
  id: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  /** Display name; the frozen mirror of first+last for rows saved since the
   * split, or the original single-field value for rows that predate it. */
  fullName: string | null;
  email: string | null;
}

export interface UserProfileInput {
  firstName: string;
  lastName: string;
  title: string;
}

const COLUMNS = "id, first_name, last_name, title, full_name, email";

interface ProfileRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  full_name: string | null;
  email: string | null;
}

function toProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    title: row.title,
    fullName: row.full_name,
    email: row.email,
  };
}

/** The caller's own profile row. Scoped by the authenticated user id read from
 * the session — never a parameter, so there is no shape of this call that reads
 * somebody else's row. */
export async function getMyProfile(): Promise<UserProfile | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("profiles")
    .select(COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toProfile(data as ProfileRow) : null;
}

/**
 * Save the caller's name and title.
 *
 * Writes profiles (first/last/title plus the composed full_name mirror) and
 * then mirrors the same composed name into auth user_metadata, so the display
 * name and the {{user.name}} form-fill value can no longer disagree.
 *
 * Blank title is stored as NULL rather than "" — an empty string would resolve
 * as a present-but-empty token instead of an honest "no title on file".
 */
export async function updateMyProfile(input: UserProfileInput): Promise<UserProfile> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not signed in");

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const title = input.title.trim();
  const fullName = composeFullName({ firstName, lastName });

  const { data, error } = await supabase
    .from("profiles")
    .update({
      first_name: firstName || null,
      last_name: lastName || null,
      title: title || null,
      // The frozen mirror. Only overwritten when the user actually supplied a
      // name — otherwise a save that clears both fields would wipe the display
      // name every audit row and the Access table render from.
      ...(fullName ? { full_name: fullName } : {}),
    })
    .eq("id", userId)
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  // Keep auth metadata in step. A failure here is NOT fatal: the profiles row
  // is the source of truth and userTokens.ts reads it first, so a stale
  // metadata copy degrades to "the fallback is out of date", never to a lost
  // save. Surfacing it as an error would tell the user their save failed when
  // it did not.
  if (fullName) {
    try {
      await supabase.auth.updateUser({ data: { full_name: fullName } });
    } catch {
      // ignore — profiles already holds the authoritative value
    }
  }

  return toProfile(data as ProfileRow);
}
