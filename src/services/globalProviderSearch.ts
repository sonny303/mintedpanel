// Cross-org provider lookup (global provider search spike PoC).
//
// CROSS-ORG by design, like src/services/portfolio.ts and for the same reason:
// the question is "which of my orgs is this provider in", which no single
// active org can answer. So this is the second service that deliberately does
// NOT call requireActiveOrg().
//
// Tenant isolation is unchanged. The browser client runs under RLS, and
// `providers_select` is `org_id IN (SELECT user_org_ids())` — membership, not
// active org. Omitting the org filter therefore widens the read to exactly the
// caller's member orgs and no further; there is no request the browser can
// make that reaches a non-member org's row. The org silo in the rest of the UI
// is an application convention (requireActiveOrg), not the database wall.
//
// `authorizedOrgNames` is a second, independent narrowing applied to the
// result rows (see restrictToAuthorizedOrgs) and the source of the displayed
// org name. It is the caller's own membership list — narrowing only, never
// widening, so it is safe to source from the client.
import { supabase } from "@/integrations/supabase/externalClient";
import {
  GLOBAL_PROVIDER_SEARCH_COLUMNS,
  GLOBAL_SEARCH_FETCH_LIMIT,
  MAX_GLOBAL_SEARCH_RESULTS,
  buildProviderSearchFilter,
  mapProviderSearchRows,
  rankProviderHits,
  restrictToAuthorizedOrgs,
  sanitizeSearchTerm,
  type GlobalProviderHit,
} from "@/lib/globalSearch";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type { GlobalProviderHit } from "@/lib/globalSearch";

// DI seam, matching every other service: browser callers omit it and get the
// anon client under RLS. A server ctx would inject the service-role client —
// at which point RLS is no longer the wall and the caller MUST pass the
// membership set as a real query filter, not only as the display narrowing
// below. See docs/ops/global-provider-search-spike.md §Option B.
export interface GlobalProviderSearchCtx {
  db: SupabaseClient<Database>;
}

function browserCtx(): GlobalProviderSearchCtx {
  return { db: supabase };
}

export async function searchProvidersAcrossOrgs(
  rawTerm: string,
  authorizedOrgNames: ReadonlyMap<string, string>,
  ctx: GlobalProviderSearchCtx = browserCtx(),
): Promise<GlobalProviderHit[]> {
  const term = sanitizeSearchTerm(rawTerm);
  const filter = buildProviderSearchFilter(term);
  // A caller with no memberships has nothing to search; skip the round trip
  // rather than issue a query whose every row would be dropped.
  if (!filter || authorizedOrgNames.size === 0) return [];

  const { data, error } = await ctx.db
    .from("providers")
    .select(GLOBAL_PROVIDER_SEARCH_COLUMNS)
    .or(filter)
    .order("last_name", { ascending: true })
    .limit(GLOBAL_SEARCH_FETCH_LIMIT);
  if (error) throw error;

  const hits = restrictToAuthorizedOrgs(
    mapProviderSearchRows((data ?? []) as unknown as unknown[]),
    authorizedOrgNames,
  );
  return rankProviderHits(hits, term, MAX_GLOBAL_SEARCH_RESULTS);
}
