// GET /api/mock-fill-profile — the synthetic token values a DRY RUN fills from.
//
// Why this endpoint exists at all: the extension needs fake values to exercise a
// real payer form without touching a provider, and the app already curates
// exactly those values in src/lib/mockFillProfile.ts for its in-editor dry run.
// Serving them keeps ONE source. The alternative — bundling a copy in the
// extension — is the same mistake as the 75-key quick-card mirror that silently
// drifted from the server's catalog and was deleted in S2.1; two definitions of
// "what a dry run fills" would eventually disagree about what a PASS means.
//
// Response is shaped like /api/providers/:id/profile on purpose, so the
// extension's planFill() consumes it unchanged: `tokens` covers the whole
// catalog, `unresolved` is ALWAYS empty. That emptiness is the load-bearing
// property — mockValueForToken never returns blank, so a dry run can never fail
// for want of a value, and "pass" reduces to exactly "every live mapping has a
// token and the page accepted it". A failure therefore means a MAPPING or
// SELECTOR problem, which is the only thing a dry run is trying to prove.
//
// NOT PHI: every value is visibly fake ("Sample Provider", 555 numbers) and no
// provider/group/facility row is read. Hence no audit row and no role gate
// beyond the guard — billing may dry-run a form.
import { buildMockTokenMap, MOCK_FILL_PROFILE_VERSION } from "@/lib/mockFillProfile";
import { USER_TOKEN_FIELDS } from "@/lib/quickCardCatalog";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ProfileToken, UnresolvedToken } from "@/services/providerProfile";

export interface MockFillProfileCtx {
  db: SupabaseClient<Database>;
}

export interface MockFillProfileResponse {
  /** Bump-tracked so a recorded dry run can be read against the profile that
   * produced it (the app stamps the same version on its own runs). */
  mock_profile_version: number;
  tokens: ProfileToken[];
  /** Always empty — see the note above; kept so the shape matches the real
   * profile response and the extension needs no special case. */
  unresolved: UnresolvedToken[];
}

interface CatalogRow {
  token?: unknown;
}

/** Every token a mapping could legitimately name: the schema-derived catalog
 * (the SAME get_sop_field_tokens() the profile endpoint resolves from) plus the
 * user.* family, which has no schema backing but does appear in field maps. */
export async function listMockProfileTokens(ctx: MockFillProfileCtx): Promise<string[]> {
  const { data, error } = await ctx.db.rpc("get_sop_field_tokens");
  if (error) throw error;
  if (!Array.isArray(data)) {
    throw new Error("get_sop_field_tokens() returned a non-array token catalog");
  }
  const tokens = new Set<string>();
  for (const row of data as CatalogRow[]) {
    if (typeof row?.token === "string" && row.token.trim()) tokens.add(row.token.trim());
  }
  if (tokens.size === 0) {
    throw new Error("get_sop_field_tokens() returned an empty token catalog");
  }
  for (const token of USER_TOKEN_FIELDS) tokens.add(token);
  return [...tokens];
}

export async function getMockFillProfile(
  ctx: MockFillProfileCtx,
): Promise<MockFillProfileResponse> {
  const catalog = await listMockProfileTokens(ctx);
  const values = buildMockTokenMap(catalog);
  return {
    mock_profile_version: MOCK_FILL_PROFILE_VERSION,
    // Sorted so the payload is stable between calls — easier to diff when a
    // dry run misbehaves and someone is comparing two runs by hand.
    tokens: Object.keys(values)
      .sort()
      .map((token) => ({ token, value: values[token] })),
    unresolved: [],
  };
}
