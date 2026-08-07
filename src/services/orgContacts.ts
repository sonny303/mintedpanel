// Org contact token resolution for the fill payload (decisions D9–D11).
//
// SERVER-ONLY, like extensionViewPrefs/nextBestAction: it runs on the guard ctx
// (service-role client already scoped to the caller's org). The browser reads
// contacts through src/services/parties.ts under RLS instead.
//
// Scope note (D11): unlike payer.*/mso.*/contract.*, these are NOT case-scoped.
// The org is on the ctx, so they resolve at profile time with no case context —
// which is why the profile endpoint can carry them at all.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Party, PartyRoleKey } from "@/types";
import { camelizeRow } from "@/lib/case";
import {
  CONTACT_TOKEN_FAMILIES,
  resolveOrgContactTokens,
  type ResolvedToken,
  type UnresolvedToken,
} from "@/lib/orgContactTokens";

export interface OrgContactCtx {
  db: SupabaseClient<Database>;
  orgId: string;
}

interface AssignmentRow {
  role_key: string;
  parties: unknown;
}

/**
 * The org's DEFAULT holder per contact role (D1) — one query over
 * party_role_assignments, filtered to `is_default`, embedding the party.
 *
 * A role with no default holder is simply absent from the map; the pure
 * resolver turns that into null tokens with an honest reason rather than
 * silently omitting the keys.
 */
export async function getOrgContactDefaults(
  ctx: OrgContactCtx,
): Promise<Map<PartyRoleKey, Party | null>> {
  const roleKeys = CONTACT_TOKEN_FAMILIES.map((f) => f.roleKey);
  const { data, error } = await ctx.db
    .from("party_role_assignments")
    .select("role_key, parties(*)")
    .eq("org_id", ctx.orgId)
    .eq("is_default", true)
    .in("role_key", roleKeys);
  if (error) throw error;

  const map = new Map<PartyRoleKey, Party | null>();
  for (const row of (data ?? []) as AssignmentRow[]) {
    if (!row.parties) continue;
    map.set(row.role_key as PartyRoleKey, camelizeRow<Party>(row.parties));
  }
  return map;
}

/** The contact families as profile tokens + their unresolved reasons. */
export async function resolveOrgContactProfileTokens(ctx: OrgContactCtx): Promise<{
  tokens: ResolvedToken[];
  unresolved: UnresolvedToken[];
}> {
  const defaults = await getOrgContactDefaults(ctx);
  return resolveOrgContactTokens(defaults);
}
