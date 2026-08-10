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
import {
  suggestTokenForLabel,
  type DictionaryEntry,
  type LabelSuggestion,
  type ObservedMapping,
} from "@/lib/labelLearning";
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

/** GET /api/shared-field-maps?portal_key= — the SHARED tier only.
 *
 * The org-scoped read above cannot serve E6.9 Train forms: it needs a resolved
 * `orgId` for its disjunct, and training deliberately names no org. Filtering
 * to `org_id IS NULL` is the whole safety argument — with no org in scope
 * there is nothing to widen the result to, so no org's private overrides can
 * be returned to a caller who never identified one.
 *
 * The registry presentation columns ride along (display_label/section/
 * sort_order) so the trainer can be told what a recognized form already has. */
export async function listSharedFieldMaps(
  db: SupabaseClient<Database>,
  portalKey?: string,
): Promise<PortalFieldMap[]> {
  let query = db
    .from("portal_field_maps")
    .select(APP_PORTAL_FIELD_MAP_COLUMNS)
    .is("org_id", null)
    .order("portal_key", { ascending: true })
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (portalKey) query = query.eq("portal_key", normalizePortalKey(portalKey) ?? "");
  const { data, error } = await query;
  if (error) throw error;
  const rows = camelizeRow<PortalFieldMap[]>(data ?? []);
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
  sort_order?: number | null;
}

export type ProposeFieldMapResult =
  | { kind: "created"; map: PortalFieldMap; suggestion: LabelSuggestion | null }
  | { kind: "existing"; map: PortalFieldMap; suggestion: LabelSuggestion | null }
  | { kind: "rejected"; status: 422; message: string };

/** S5.3 — what this org has already learned about a field label, from its
 * dictionary and from approved mappings on OTHER portals. Read alongside the
 * propose write so a captured field arrives with a suggestion and the evidence
 * behind it, instead of a blank grid. Never a write: approving stays human. */
async function learnedSuggestion(
  ctx: PortalFieldMapServiceCtx,
  label: string,
  portalKey: string,
): Promise<LabelSuggestion | null> {
  if (!label) return null;
  const [dictRes, observedRes] = await Promise.all([
    ctx.db
      .from("field_dictionary")
      .select("label_normalized, token, status")
      .eq("org_id", ctx.orgId)
      .eq("label_normalized", label),
    // Approved, tokened maps carrying this label — global catalog rows plus
    // the org's own, the same shared-catalog read as the list.
    ctx.db
      .from("portal_field_maps")
      .select("portal_key, token, field_label, status")
      .or(`org_id.is.null,org_id.eq.${ctx.orgId}`)
      .eq("field_label", label)
      .eq("status", "approved")
      .not("token", "is", null),
  ]);
  if (dictRes.error) throw dictRes.error;
  if (observedRes.error) throw observedRes.error;

  // Defensive: a non-array payload (a degraded read, a shape change) yields no
  // suggestion rather than throwing — a missing suggestion costs the user a
  // dropdown, a thrown propose costs them the captured field.
  const dictionary: DictionaryEntry[] = (
    (Array.isArray(dictRes.data) ? dictRes.data : []) as Array<{
      label_normalized: string;
      token: string | null;
      status: string;
    }>
  )
    .filter((d) => d.token)
    .map((d) => ({
      label: d.label_normalized,
      token: normalizeTokenKey(d.token) ?? "",
      status: d.status,
    }));

  const observed: ObservedMapping[] = (
    (Array.isArray(observedRes.data) ? observedRes.data : []) as Array<{
      portal_key: string;
      token: string | null;
      field_label: string | null;
    }>
  )
    .filter((r) => r.token && r.field_label)
    .map((r) => ({
      label: r.field_label as string,
      token: normalizeTokenKey(r.token) ?? "",
      portalKey: normalizePortalKey(r.portal_key) ?? "",
    }));

  return suggestTokenForLabel(label, dictionary, observed, portalKey);
}

const PROPOSE_FIELD_TYPES: ReadonlySet<string> = new Set([
  "text",
  "select",
  "radio",
  "checkbox",
  "date",
  "file",
]);

// The note stamped on an extension-proposed row. See the notes_required
// discussion below — this is a schema requirement, not decoration.
export const PROPOSED_BY_EXTENSION_NOTE =
  "Proposed by the extension — seen on the form, not yet mapped to a token.";

// Same constraint, from the trainer's "Manual" button. See markFieldMapManual.
export const MARKED_MANUAL_NOTE = "Marked manual in the trainer — filled by hand.";

// PROPOSE-ONLY: the extension reports a field it saw on a portal page that
// nothing maps yet. It can never approve one.
//
// Why the write is this narrow:
//   - status is ALWAYS 'proposed' and source ALWAYS 'manual' with a null
//     token, whatever the body says. Approving a mapping is a human act in the
//     SOP editor's trainer (E6.5 FormStepPanel), where a person sees the field
//     in context and picks the token; a client that could write 'approved'
//     would be able to silently redirect what autofills into a payer form.
//     Since S5.1 the fill path uses ONLY 'approved' maps, so this row is inert
//     on the form until a human maps it. What it does do is surface the field
//     in the trainer queue and in mappingCoverage — both of which key on
//     status 'proposed', not on source.
//   - `source` is forced to 'manual' by the schema, not by preference: a row
//     with a null token and no hardcoded value fails token_required under
//     'token'/'manual_partial' and hardcoded_required under 'hardcoded'. The
//     price of 'manual' is notes_required (manual ⇒ notes NOT NULL), so the
//     note below is mandatory — omitting it made every propose call 23514.
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
  if (input.sort_order != null && typeof input.sort_order !== "number") {
    return { kind: "rejected", status: 422, message: "sort_order must be a number" };
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
  const fieldLabel = normalizeFieldLabel(input.field_label ?? "") || null;
  if (existing && existing.length > 0) {
    const row = camelizeRow<PortalFieldMap>(existing[0]);
    return {
      kind: "existing",
      map: { ...row, token: normalizeTokenKey(row.token) },
      suggestion: fieldLabel ? await learnedSuggestion(ctx, fieldLabel, portalKey) : null,
    };
  }

  const { data, error } = await ctx.db
    .from("portal_field_maps")
    .insert({
      org_id: ctx.orgId,
      portal_key: portalKey,
      selector,
      // Normalized at the write boundary, the same key the field_dictionary
      // learns on — so a proposal joins the dictionary's suggestions.
      field_label: fieldLabel,
      form_section: input.form_section?.trim() || null,
      url_pattern: input.url_pattern?.trim() || null,
      page_step: input.page_step?.trim() || null,
      sort_order: typeof input.sort_order === "number" ? input.sort_order : null,
      field_type: fieldType,
      map_type: "web",
      status: "proposed",
      source: "manual",
      // Required by portal_field_maps_notes_required (source 'manual' ⇒ notes
      // NOT NULL). Also the honest answer to "why is this row here with no
      // token" for whoever opens the trainer queue. No page content: the label
      // the extension observed is its own column.
      notes: PROPOSED_BY_EXTENSION_NOTE,
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
  return {
    kind: "created",
    map: { ...map, token: normalizeTokenKey(map.token) },
    // S5.3: what the org already knows about this label, with its evidence.
    suggestion: fieldLabel ? await learnedSuggestion(ctx, fieldLabel, portalKey) : null,
  };
}

// ---------------------------------------------------------------------------
// Browser path (RLS-guarded) — the cleanup surfaces read/train field maps from
// the app. Distinct from the server ctx path above: this uses the anon client
// and requireActiveOrg(). The SELECT includes the training columns
// (field_label/form_section/confidence) the server contract does not carry.
// ---------------------------------------------------------------------------
// E6.9 adds the registry trio — the editor reads display name, grouping and
// order off the same row it already loads.
const APP_PORTAL_FIELD_MAP_COLUMNS = `${PORTAL_FIELD_MAP_COLUMNS}, field_label, form_section, confidence, display_label, section, sort_order`;

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
//
// Moving a row TO source 'manual' brings it under notes_required (manual ⇒
// notes NOT NULL), and most rows reach the trainer with null notes — 11 of the
// 18 live 'token' rows do, and any of them can be sent back to proposed by
// Undo. Without a note this update is a 23514, so supply one when the row has
// none. An existing note is a human's and is never overwritten.
export async function markFieldMapManual(
  id: string,
  fieldLabel?: string | null,
): Promise<PortalFieldMap> {
  const orgId = requireActiveOrg();
  const { data: current, error: readError } = await supabase
    .from("portal_field_maps")
    .select("notes")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (readError) throw readError;
  const existingNote = (current?.notes ?? "").trim();
  const row = await updateFieldMapRow(orgId, id, {
    status: "approved",
    source: "manual",
    token: null,
    ...(existingNote ? {} : { notes: MARKED_MANUAL_NOTE }),
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
  /** E6.9 F6.9.4: the fixed-literal decision. Required when
   * `source === 'hardcoded'`; the RPC rejects an empty one. */
  hardcodedValue?: string | null;
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
    p_hardcoded_value: (patch.hardcodedValue ?? null) as unknown as string,
  });
  if (error) throw error;
  const row = camelizeRow<PortalFieldMap>(data);
  return { ...row, token: normalizeTokenKey(row.token) };
}

// ---------------------------------------------------------------------------
// E6.9 F6.9.2 — the rest of the shared-tier (org_id IS NULL) write surface.
//
// Shared rows fail browser RLS for INSERT and UPDATE, so every shared write
// goes through a SECURITY DEFINER RPC. These are the app-side callers; the
// extension reaches the same propose RPC through the /api route, which runs on
// the user-scoped guard because training has no org at all (D10).
// ---------------------------------------------------------------------------

export interface SharedProposeInput {
  portalKey: string;
  selector: string;
  fieldLabel?: string | null;
  formSection?: string | null;
  pageStep?: string | null;
  fieldType?: string | null;
  sortOrder?: number | null;
  notes?: string | null;
}

/** Create (or resolve, if capture already saw it) a shared registry row.
 * Idempotent on the F6.9.1 partial unique index — a repeat capture returns the
 * existing row with its decision intact and refreshes presentation columns
 * (sort order, payer label/section/page) when the DOM drifted. */
export async function proposeSharedFieldMap(input: SharedProposeInput): Promise<PortalFieldMap> {
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("propose_shared_field_map", {
    p_portal_key: input.portalKey,
    p_selector: input.selector,
    p_field_label: (input.fieldLabel ?? null) as unknown as string,
    p_form_section: (input.formSection ?? null) as unknown as string,
    p_page_step: (input.pageStep ?? null) as unknown as string,
    p_field_type: (input.fieldType ?? "text") as unknown as string,
    p_sort_order: (input.sortOrder ?? null) as unknown as number,
    p_notes: (input.notes ?? null) as unknown as string,
  });
  if (error) throw error;
  const row = camelizeRow<PortalFieldMap>(data);
  return { ...row, token: normalizeTokenKey(row.token) };
}

/** A registry metadata edit. A key that is PRESENT and null CLEARS the column;
 * an ABSENT key leaves it untouched — the RPC distinguishes the two with
 * jsonb `?`, which `->>` alone cannot. */
export interface SharedRegistryPatch {
  id: string;
  displayLabel?: string | null;
  section?: string | null;
  sortOrder?: number | null;
}

/** Write display name / section / order on shared rows. Takes a BATCH because
 * re-capture reorders a whole page at once — one transaction, no half-ordered
 * intermediate state (F6.9.5). */
export async function updateSharedFieldRegistry(
  patches: readonly SharedRegistryPatch[],
): Promise<PortalFieldMap[]> {
  if (patches.length === 0) return [];
  const entries = patches.map((patch) => {
    const entry: Record<string, unknown> = { id: patch.id };
    if ("displayLabel" in patch) entry.display_label = patch.displayLabel ?? null;
    if ("section" in patch) entry.section = patch.section ?? null;
    if ("sortOrder" in patch) entry.sort_order = patch.sortOrder ?? null;
    return entry;
  });
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("update_shared_field_registry", {
    p_entries: entries as unknown as string,
  });
  if (error) throw error;
  const rows = (data ?? []) as unknown[];
  return rows.map((raw) => {
    const row = camelizeRow<PortalFieldMap>(raw);
    return { ...row, token: normalizeTokenKey(row.token) };
  });
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
