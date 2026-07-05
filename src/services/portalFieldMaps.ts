// Portal field maps: the selector catalog the extension fill engine reads.
// Shared-catalog model (locked decision, 2026-07-04): rows with org_id NULL
// are the global catalog (selectors are portal truths, not org truths); rows
// with an org_id are that org's overrides.
//
// Server-only surface: the app UI never reads this table, so unlike the
// provider service there is no browser-default context — every caller must
// inject an explicit ctx (the API route passes the service-role client plus
// the org resolved by the guard).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { camelizeRow } from "@/lib/case";
import type { PortalFieldMap } from "@/types";

export interface PortalFieldMapServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
}

export interface PortalFieldMapFilters {
  portalKey?: string;
}

const PORTAL_FIELD_MAP_COLUMNS =
  "id, org_id, portal_key, url_pattern, page_step, map_type, selector, selector_fallbacks, source, token, hardcoded_value, transform, field_type, notes, status, created_at, updated_at";

// Global catalog rows plus the caller's own org overrides. Another org's
// org-scoped rows can never match the filter.
export async function listPortalFieldMaps(
  ctx: PortalFieldMapServiceCtx,
  filters: PortalFieldMapFilters = {},
): Promise<PortalFieldMap[]> {
  let query = ctx.db
    .from("portal_field_maps")
    .select(PORTAL_FIELD_MAP_COLUMNS)
    .or(`org_id.is.null,org_id.eq.${ctx.orgId}`)
    .order("portal_key", { ascending: true })
    .order("created_at", { ascending: true });
  if (filters.portalKey) query = query.eq("portal_key", filters.portalKey);
  const { data, error } = await query;
  if (error) throw error;
  return camelizeRow<PortalFieldMap[]>(data ?? []);
}
