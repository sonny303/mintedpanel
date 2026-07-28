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
import { requireActiveOrg, writeAudit, type AuditInput } from "@/lib/audit";
import { camelizeRow } from "@/lib/case";
import { normalizeFieldLabel, normalizePortalKey, normalizeTokenKey } from "@/lib/tokenFormat";
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

// Wire shape of POST /api/portal-field-maps — snake_case per the extension's
// locked body idiom (the touches contract, not the camelCase row payloads).
// Deliberately NO token/source/status: see proposeFieldMap.
export interface ProposeFieldMapInput {
  portal_key: string;
  selector: string;
  field_label?: string | null;
  form_section?: string | null;
  field_type?: string | null;
  url_pattern?: string | null;
  page_step?: string | null;
}

export type ProposeFieldMapResult =
  | { kind: "created"; map: PortalFieldMap }
  | { kind: "existing"; map: PortalFieldMap }
  | { kind: "rejected"; status: 422; message: string };

const PROPOSE_FIELD_TYPES: ReadonlySet<string> = new Set([
  "text",
  "select",
  "radio",
  "checkbox",
  "date",
  "file",
]);

// PROPOSE-ONLY: the extension reports a field it saw on a portal page that
// nothing maps yet. It can never approve one.
//
// Why the write is this narrow:
//   - status is ALWAYS 'proposed' and source ALWAYS 'manual' with a null
//     token, whatever the body says. Approving a mapping is a human act in the
//     SOP editor's trainer (E6.5 FormStepPanel), where a person sees the field
//     in context and picks the token; a client that could write 'approved'
//     would be able to silently redirect what autofills into a payer form.
//     Note the extension fills proposed AND approved maps (only 'retired' is
//     skipped), so this row does become live — but with source 'manual' and no
//     token it fills nothing until a human maps it. That is the point: it
//     surfaces the field in the trainer queue and in mappingCoverage, and
//     changes no existing behaviour.
//   - org_id comes from the guard, never the body, and is ALWAYS set: a global
//     (org_id NULL) row is a platform catalog entry and is not the extension's
//     to mint. RLS would block it from a browser client anyway, but this route
//     runs on the service-role client, so the constraint is enforced here.
//
// Idempotent on (portal_key, selector) so re-observing the same field on every
// page load converges instead of piling up duplicates. The dedupe check spans
// GLOBAL rows too — if the shared catalog already covers this selector there is
// nothing to propose, and the existing row is returned unchanged.
export async function proposeFieldMap(
  ctx: PortalFieldMapServiceCtx & { writeAudit: (input: AuditInput) => Promise<void> },
  input: ProposeFieldMapInput,
): Promise<ProposeFieldMapResult> {
  const portalKey = normalizePortalKey(input?.portal_key ?? "");
  if (!portalKey) return { kind: "rejected", status: 422, message: "portal_key is required" };
  const selector = typeof input.selector === "string" ? input.selector.trim() : "";
  if (!selector) return { kind: "rejected", status: 422, message: "selector is required" };
  const fieldType = input.field_type ?? "text";
  if (typeof fieldType !== "string" || !PROPOSE_FIELD_TYPES.has(fieldType)) {
    return {
      kind: "rejected",
      status: 422,
      message: `field_type must be one of ${[...PROPOSE_FIELD_TYPES].join(", ")}`,
    };
  }
  for (const key of ["field_label", "form_section", "url_pattern", "page_step"] as const) {
    const value = input[key];
    if (value != null && typeof value !== "string") {
      return { kind: "rejected", status: 422, message: `${key} must be a string` };
    }
  }

  // Already known? Global rows count: the shared catalog is authoritative for
  // portal truths, so a selector it already covers needs no org proposal.
  const { data: existing, error: lookupError } = await ctx.db
    .from("portal_field_maps")
    .select(PORTAL_FIELD_MAP_COLUMNS)
    .or(`org_id.is.null,org_id.eq.${ctx.orgId}`)
    .eq("portal_key", portalKey)
    .eq("selector", selector)
    .limit(1);
  if (lookupError) throw lookupError;
  if (existing && existing.length > 0) {
    const row = camelizeRow<PortalFieldMap>(existing[0]);
    return { kind: "existing", map: { ...row, token: normalizeTokenKey(row.token) } };
  }

  const { data, error } = await ctx.db
    .from("portal_field_maps")
    .insert({
      org_id: ctx.orgId,
      portal_key: portalKey,
      selector,
      // Normalized at the write boundary, the same key the field_dictionary
      // learns on — so a proposal joins the dictionary's suggestions.
      field_label: normalizeFieldLabel(input.field_label ?? "") || null,
      form_section: input.form_section?.trim() || null,
      url_pattern: input.url_pattern?.trim() || null,
      page_step: input.page_step?.trim() || null,
      field_type: fieldType,
      map_type: "web",
      status: "proposed",
      source: "manual",
      token: null,
    } as never)
    .select(PORTAL_FIELD_MAP_COLUMNS)
    .single();
  if (error) throw error;
  const map = camelizeRow<PortalFieldMap>(data);

  await ctx.writeAudit({
    actionType: "CREATE",
    entityType: "portal_field_map",
    entityId: map.id,
    after: { portalKey, selector, fieldLabel: map.fieldLabel, status: "proposed" },
    description: `Field proposed by extension on ${portalKey}`,
  });
  return { kind: "created", map: { ...map, token: normalizeTokenKey(map.token) } };
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

// ---------------------------------------------------------------------------
// E6.5 F6.5.6 — the three training shapes applied to a GLOBAL (org_id NULL)
// row via the train_global_field_map RPC. Org rows keep the browser-RLS UPDATE
// path above; global rows were previously platform/MCP-only. NO writeAudit
// (audit_log requires an org_id; the row's updated_at is the trail — interim
// posture, R7 hardens platform governance).
// ---------------------------------------------------------------------------
export interface GlobalTrainPatch {
  status: "proposed" | "approved";
  source: PortalFieldMap["source"];
  token?: string | null;
  fieldLabel?: string | null;
}

export async function trainGlobalFieldMap(
  id: string,
  patch: GlobalTrainPatch,
): Promise<PortalFieldMap> {
  requireActiveOrg();
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("train_global_field_map", {
    p_id: id,
    p_status: patch.status,
    p_source: patch.source,
    p_token: (patch.token ? normalizeTokenKey(patch.token) : null) as unknown as string,
    p_field_label: (patch.fieldLabel ?? null) as unknown as string,
  });
  if (error) throw error;
  const row = camelizeRow<PortalFieldMap>(data);
  return { ...row, token: normalizeTokenKey(row.token) };
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
