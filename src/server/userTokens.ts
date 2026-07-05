// The {{user.*}} token family — R2 locked decision 5 (2026-07-05): resolved
// from the caller's JWT / auth metadata, no schema change. Appended to the
// profile response's tokens array so the fill engine can stamp "who is filling
// this form" fields (portal contact name/email) alongside the provider tokens.
//
// user.name  = auth user_metadata full_name, else name; absent -> "" plus a
//              note surfaced in the response meta.
// user.email = the JWT email claim; same empty-plus-note fallback.
import type { ProfileToken } from "@/services/providerProfile";
import type { AuthContext } from "./guard";

export interface ResolvedUserTokens {
  tokens: ProfileToken[];
  // Non-fatal "resolved to empty" explanations, for the envelope meta.notes.
  notes: string[];
}

function metadataString(meta: Record<string, unknown> | null, key: string): string | null {
  const value = meta?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function resolveUserTokens(
  ctx: Pick<AuthContext, "email" | "userMetadata">,
): ResolvedUserTokens {
  const notes: string[] = [];

  const name =
    metadataString(ctx.userMetadata, "full_name") ?? metadataString(ctx.userMetadata, "name");
  if (name == null) {
    notes.push("user.name resolved to empty: auth metadata has no full_name or name");
  }

  const email = ctx.email?.trim() ? ctx.email.trim() : null;
  if (email == null) {
    notes.push("user.email resolved to empty: the JWT carries no email claim");
  }

  return {
    tokens: [
      { token: "user.name", value: name ?? "" },
      { token: "user.email", value: email ?? "" },
    ],
    notes,
  };
}
