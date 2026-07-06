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
import { supabase } from "@/integrations/supabase/externalClient";
import type { Database } from "@/integrations/supabase/types";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import { camelizeRow } from "@/lib/case";
import { normalizeTokenKey } from "@/lib/tokenFormat";
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
  const rows = camelizeRow<PortalFieldMap[]>(data ?? []);
  // DB rows hold whatever form a human pasted ("{{provider.firstName}}" or
  // bare); the endpoint's contract is the bare catalog form so the extension
  // can join token → profile token literally (see lib/tokenFormat.ts).
  return rows.map((row) => ({ ...row, token: normalizeTokenKey(row.token) }));
}

// ---------------------------------------------------------------------------
// Browser path (RLS-guarded) — the cleanup surfaces read/train field maps from
// the app. Distinct from the server ctx path above: this uses the anon client
// and requireActiveOrg(). The SELECT includes the training columns
// (field_label/form_section/confidence) the server contract does not carry.
// ---------------------------------------------------------------------------
const APP_PORTAL_FIELD_MAP_COLUMNS = `${PORTAL_FIELD_MAP_COLUMNS}, field_label, form_section, confidence`;

// Global catalog rows + the caller's own org rows, tokens normalized to bare
// form. Same shape as listPortalFieldMaps but org resolved from the store.
export async function listPortalFieldMapsFromApp(portalKey?: string): Promise<PortalFieldMap[]> {
  const orgId = requireActiveOrg();
  let query = supabase
    .from("portal_field_maps")
    .select(APP_PORTAL_FIELD_MAP_COLUMNS)
    .or(`org_id.is.null,org_id.eq.${orgId}`)
    .order("portal_key", { ascending: true })
    .order("form_section", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });
  if (portalKey) query = query.eq("portal_key", portalKey);
  const { data, error } = await query;
  if (error) throw error;
  const rows = camelizeRow<PortalFieldMap[]>(data ?? []);
  return rows.map((row) => ({ ...row, token: normalizeTokenKey(row.token) }));
}

// --- Mapping review training mutations (Surface 2), org rows only. RLS blocks
// writes to global rows; captured proposed rows are always org-scoped. ---

async function updateFieldMapRow(
  orgId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<PortalFieldMap> {
  const { data, error } = await supabase
    .from("portal_field_maps")
    .update(patch as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select(APP_PORTAL_FIELD_MAP_COLUMNS)
    .single();
  if (error) throw error;
  const row = camelizeRow<PortalFieldMap>(data);
  return { ...row, token: normalizeTokenKey(row.token) };
}

// Approve a proposed row to a token mapping. Token is stored in the bare
// catalog form (the extension join contract).
export async function approveFieldMap(
  id: string,
  token: string,
  fieldLabel?: string | null,
): Promise<PortalFieldMap> {
  const orgId = requireActiveOrg();
  const bare = normalizeTokenKey(token);
  const row = await updateFieldMapRow(orgId, id, {
    status: "approved",
    source: "token",
    token: bare,
  });
  await writeAudit({
    actionType: "UPDATE",
    entityType: "portal_field_map",
    entityId: id,
    after: { token: bare, source: "token", status: "approved" },
    description: `Mapped "${fieldLabel ?? row.fieldLabel ?? id}" → ${bare}`,
  });
  return row;
}

// Approve a proposed row as manual: the extension skips it, and it is counted
// out of auto-fill coverage.
export async function markFieldMapManual(
  id: string,
  fieldLabel?: string | null,
): Promise<PortalFieldMap> {
  const orgId = requireActiveOrg();
  const row = await updateFieldMapRow(orgId, id, {
    status: "approved",
    source: "manual",
    token: null,
  });
  await writeAudit({
    actionType: "UPDATE",
    entityType: "portal_field_map",
    entityId: id,
    after: { source: "manual", status: "approved" },
    description: `Marked "${fieldLabel ?? row.fieldLabel ?? id}" manual`,
  });
  return row;
}

// Restore a decided row to proposed (single-level Undo in the training flow).
export async function reproposeFieldMap(
  id: string,
  previous: { token: string | null; source: PortalFieldMap["source"] },
): Promise<PortalFieldMap> {
  const orgId = requireActiveOrg();
  const row = await updateFieldMapRow(orgId, id, {
    status: "proposed",
    source: previous.source,
    token: previous.token,
  });
  await writeAudit({
    actionType: "UPDATE",
    entityType: "portal_field_map",
    entityId: id,
    after: { status: "proposed", source: previous.source, token: previous.token },
    description: `Reverted field map "${row.fieldLabel ?? id}" to proposed (undo)`,
  });
  return row;
}

export interface BatchApproveItem {
  id: string;
  token: string;
  fieldLabel: string | null;
}

// The confirm-all-N screen: approve the high-confidence batch. One audit row
// for the whole batch (a single human action).
export async function batchApproveFieldMaps(
  items: BatchApproveItem[],
  portalKey: string,
): Promise<number> {
  const orgId = requireActiveOrg();
  let n = 0;
  for (const item of items) {
    await updateFieldMapRow(orgId, item.id, {
      status: "approved",
      source: "token",
      token: normalizeTokenKey(item.token),
    });
    n += 1;
  }
  if (n > 0) {
    await writeAudit({
      actionType: "UPDATE",
      entityType: "portal_field_map",
      entityId: null,
      after: { count: n, portalKey },
      description: `Batch-approved ${n} field map${n === 1 ? "" : "s"} (${portalKey})`,
    });
  }
  return n;
}
