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

// Mirrors src/server/userTokens.ts: user.name from auth user_metadata, user.email
// from the JWT claim. Shown in the picker so a form's name/email fields map to
// the signed-in user, matching the profile endpoint.
const USER_TOKENS: TokenCatalogEntry[] = [
  { token: "user.name", table: "auth", column: "user_metadata.full_name" },
  { token: "user.email", table: "auth", column: "jwt.email" },
];

export async function listTokenCatalog(): Promise<TokenCatalogEntry[]> {
  const { data, error } = await supabase.rpc("get_sop_field_tokens" as never);
  if (error) throw error;
  const catalog = ((data ?? []) as TokenCatalogEntry[]).filter((e) => Boolean(e?.token));
  return [...catalog, ...USER_TOKENS];
}
