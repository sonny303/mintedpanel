// The closed token catalog the Mapping review picker offers (Surface 2).
// get_sop_field_tokens() is the server-resolved catalog of 132 tokens across 9
// tables ([{ table, token, column }]); we append the {{user.*}} family the API
// route adds at read time (no schema backing) so the picker offers the full set
// the fill engine can resolve. Tokens are the BARE catalog form.
import { supabase } from "@/integrations/supabase/externalClient";

export interface TokenCatalogEntry {
  token: string;
  table: string;
  column: string;
}

// Mirrors src/server/userTokens.ts — KEEP THE TWO IN LOCKSTEP: a key offered
// here that the server does not resolve maps a payer field to a permanent
// blank. Since 2026-08-16 the name/title tokens resolve from the caller's own
// `profiles` row (set on /account), with auth metadata as the fallback;
// user.email still prefers the JWT claim.
//
// No `user.fullName`: `user.name` IS the composite, and two keys resolving to
// one value would let a trained mapping pick either.
const USER_TOKENS: TokenCatalogEntry[] = [
  { token: "user.name", table: "profiles", column: "full_name" },
  { token: "user.firstName", table: "profiles", column: "first_name" },
  { token: "user.lastName", table: "profiles", column: "last_name" },
  { token: "user.title", table: "profiles", column: "title" },
  { token: "user.email", table: "auth", column: "jwt.email" },
];

export async function listTokenCatalog(): Promise<TokenCatalogEntry[]> {
  const { data, error } = await supabase.rpc("get_sop_field_tokens" as never);
  if (error) throw error;
  const catalog = ((data ?? []) as TokenCatalogEntry[]).filter((e) => Boolean(e?.token));
  return [...catalog, ...USER_TOKENS];
}
