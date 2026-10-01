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
import { isAuthorableTransform, validateControlOptionsInput } from "@/lib/controlOptions";
import { normalizeFieldLabel, normalizePortalKey, normalizeTokenKey } from "@/lib/tokenFormat";
import {
  suggestTokenForLabel,
  type DictionaryEntry,
  type LabelSuggestion,
  type ObservedMapping,
} from "@/lib/labelLearning";
import type { CaseType } from "@/lib/caseTypes";
import type { FillMode, PortalFieldMap } from "@/types";

export interface PortalFieldMapServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
}

export interface PortalFieldMapFilters {
  portalKey?: string;
}

export interface EffectivePortalMapContext {
  db: SupabaseClient<Database>;
  /** null is the signed-in global-training scope; it never includes org rows. */
  orgId: string | null;
}

export type EffectivePortalMapType = FillMode | "all";

export interface EffectivePortalMapResolution {
  portalKey: string;
  portalId: string | null;
  ownerScope: "global" | "organization" | null;
  ownerOrgId: string | null;
  caseType: CaseType | null;
  formUrl: string | null;
  payerId: string | null;
  requiresExplicitSelection: boolean;
  mappingGeneration: number | null;
  effectiveMappingFingerprint: string | null;
  maps: PortalFieldMap[];
  activeFieldCount: number;
  isVerified: boolean;
  isReady: boolean;
  status: "ready" | "empty" | "configuration_missing";
}

const PORTAL_FIELD_MAP_COLUMNS =
  "id, org_id, portal_key, url_pattern, page_step, map_type, selector, selector_fallbacks, source, token, hardcoded_value, transform, field_type, notes, status, control_options, mapping_generation, shared_base_generation, created_at, updated_at";
const PORTAL_FIELD_MAP_FILL_COLUMNS = `${PORTAL_FIELD_MAP_COLUMNS}, learned_via`;
const PORTAL_FIELD_MAP_LEARNING_COLUMNS = `${PORTAL_FIELD_MAP_FILL_COLUMNS}, field_label`;
const PORTAL_MAP_CONFIG_COLUMNS =
  "id, org_id, portal_key, name, payer_id, form_url, case_type, requires_explicit_selection, mapping_generation, is_verified, proven_at";

interface EffectivePortalConfig {
  id: string;
  orgId: string | null;
  portalKey: string;
  name: string;
  payerId: string | null;
  formUrl: string | null;
  caseType: CaseType | null;
  requiresExplicitSelection: boolean | null;
  mappingGeneration: number | null;
  isVerified: boolean;
  provenAt: string | null;
}

interface EffectivePortalMapSnapshot {
  configs: EffectivePortalConfig[];
  maps: PortalFieldMap[];
}

function isMissingLearnedViaColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as { code?: unknown; message?: unknown; details?: unknown };
  const missingColumn = [row.message, row.details].some(
    (value) => typeof value === "string" && /learned_via/i.test(value),
  );
  return missingColumn && (row.code === "42703" || row.code === "PGRST204");
}

async function loadEffectivePortalMapSnapshot(
  ctx: EffectivePortalMapContext,
  portalKey: string | undefined,
  mapColumns: string,
): Promise<EffectivePortalMapSnapshot> {
  const key = portalKey ? (normalizePortalKey(portalKey) ?? undefined) : undefined;
  const loadMaps = async (columns: string) => {
    let query = ctx.db
      .from("portal_field_maps")
      .select(columns)
      .order("portal_key", { ascending: true })
      .order("selector", { ascending: true });
    query = ctx.orgId
      ? query.or(`org_id.is.null,org_id.eq.${ctx.orgId}`)
      : query.is("org_id", null);
    if (key !== undefined) query = query.eq("portal_key", key);
    return query;
  };

  let configQuery = ctx.db
    .from("portals")
    .select(PORTAL_MAP_CONFIG_COLUMNS)
    .order("portal_key", { ascending: true })
    .order("id", { ascending: true });
  configQuery = ctx.orgId
    ? configQuery.or(`org_id.is.null,org_id.eq.${ctx.orgId}`)
    : configQuery.is("org_id", null);
  if (key !== undefined) configQuery = configQuery.eq("portal_key", key);

  const configResult = await configQuery;
  if (configResult.error) throw configResult.error;

  let mapResult = await loadMaps(mapColumns);
  // A staged extension deployment may lack only this provenance column. Keep
  // generation columns required: they are the active-read boundary.
  if (mapResult.error && isMissingLearnedViaColumn(mapResult.error)) {
    mapResult = await loadMaps(
      mapColumns
        .split(",")
        .map((column) => column.trim())
        .filter((column) => column !== "learned_via")
        .join(", "),
    );
  }
  if (mapResult.error) throw mapResult.error;

  const configs = camelizeRow<EffectivePortalConfig[]>(
    Array.isArray(configResult.data) ? configResult.data : [],
  );
  const maps = camelizeRow<PortalFieldMap[]>(
    Array.isArray(mapResult.data) ? mapResult.data : [],
  ).map((row) => ({
    ...row,
    token: normalizeTokenKey(row.token),
  }));
  return { configs, maps };
}

function mapGeneration(config: EffectivePortalConfig | undefined): number {
  return config?.mappingGeneration ?? 1;
}

// These are the executable/configuration fields that change the selected fill
// plan. Timestamps, names and trainer-only labels are intentionally excluded.
function executionMapShape(map: PortalFieldMap) {
  return {
    id: map.id,
    orgId: map.orgId,
    portalKey: map.portalKey,
    mappingGeneration: map.mappingGeneration ?? 1,
    sharedBaseGeneration: map.sharedBaseGeneration ?? null,
    mapType: map.mapType,
    urlPattern: map.urlPattern,
    pageStep: map.pageStep,
    selector: map.selector,
    selectorFallbacks: map.selectorFallbacks ?? null,
    source: map.source,
    token: map.token,
    hardcodedValue: map.hardcodedValue,
    transform: map.transform,
    fieldType: map.fieldType,
    controlOptions: map.controlOptions ?? null,
    status: map.status,
  };
}

async function sha256Fingerprint(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto is required to fingerprint effective portal maps");
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"));
  return `sha256:${hex.join("")}`;
}

function sortEffectiveMaps(maps: PortalFieldMap[]): PortalFieldMap[] {
  const compareCodeUnits = (left: string, right: string) =>
    left < right ? -1 : left > right ? 1 : 0;
  return [...maps].sort(
    (left, right) =>
      compareCodeUnits(left.mapType, right.mapType) ||
      compareCodeUnits(left.pageStep ?? "", right.pageStep ?? "") ||
      compareCodeUnits(left.urlPattern ?? "", right.urlPattern ?? "") ||
      compareCodeUnits(left.selector, right.selector) ||
      compareCodeUnits(left.id, right.id),
  );
}

async function resolvePortalMapSnapshot(
  ctx: EffectivePortalMapContext,
  snapshot: EffectivePortalMapSnapshot,
  portalKey: string,
  mapType: EffectivePortalMapType,
): Promise<EffectivePortalMapResolution> {
  const key = normalizePortalKey(portalKey) ?? "";
  const scopedConfigs = snapshot.configs.filter((config) => config.portalKey === key);
  const globalConfig = scopedConfigs.find((config) => config.orgId === null);
  const orgConfig = ctx.orgId
    ? scopedConfigs.find((config) => config.orgId === ctx.orgId)
    : undefined;
  // PDF maps use `payer-form:<family-id>` keys and intentionally have no
  // portals row. Keep their legacy generation-1 reader working while making
  // all registered web/configuration reads depend on an exact portal row.
  const hasLegacyPdfConfig =
    (mapType === "pdf" || mapType === "all") &&
    key.startsWith("payer-form:") &&
    snapshot.maps.some(
      (map) => map.portalKey === key && map.mapType === "pdf" && (map.mappingGeneration ?? 1) === 1,
    );
  const syntheticPdfConfig: EffectivePortalConfig | undefined = hasLegacyPdfConfig
    ? {
        id: `legacy-pdf:${key}`,
        orgId:
          ctx.orgId && snapshot.maps.some((map) => map.portalKey === key && map.orgId === ctx.orgId)
            ? ctx.orgId
            : null,
        portalKey: key,
        name: key,
        payerId: null,
        formUrl: null,
        caseType: null,
        requiresExplicitSelection: false,
        mappingGeneration: 1,
        isVerified: false,
        provenAt: null,
      }
    : undefined;
  const selectedConfig = orgConfig ?? globalConfig ?? syntheticPdfConfig;

  const base = {
    portalKey: key,
    portalId: selectedConfig?.id ?? null,
    ownerScope: selectedConfig ? (selectedConfig.orgId === null ? "global" : "organization") : null,
    ownerOrgId: selectedConfig?.orgId ?? null,
    caseType: selectedConfig?.caseType ?? null,
    formUrl: selectedConfig?.formUrl ?? null,
    payerId: selectedConfig?.payerId ?? null,
    requiresExplicitSelection: selectedConfig?.requiresExplicitSelection ?? false,
    mappingGeneration: selectedConfig ? mapGeneration(selectedConfig) : null,
  } as const;

  if (!selectedConfig) {
    return {
      ...base,
      effectiveMappingFingerprint: null,
      maps: [],
      activeFieldCount: 0,
      isVerified: false,
      isReady: false,
      status: "configuration_missing",
    };
  }

  const sharedGeneration = mapGeneration(globalConfig);
  const orgGeneration = mapGeneration(orgConfig);
  const candidates = snapshot.maps.filter((map) => {
    if (map.portalKey !== key || (mapType !== "all" && map.mapType !== mapType)) return false;
    const generation = map.mappingGeneration ?? 1;
    if (map.orgId === null) {
      return globalConfig !== undefined
        ? generation === sharedGeneration
        : hasLegacyPdfConfig && map.mapType === "pdf" && generation === 1;
    }
    if (!ctx.orgId || map.orgId !== ctx.orgId || generation !== orgGeneration) return false;
    return globalConfig
      ? map.sharedBaseGeneration === sharedGeneration
      : map.sharedBaseGeneration == null;
  });

  // Org rows shadow the shared selector they override. Keeping both means the
  // extension writes the same control twice and can let the shared value win.
  const bySelector = new Map<string, PortalFieldMap>();
  for (const map of candidates.filter((row) => row.orgId === null)) {
    bySelector.set(`${map.mapType}\u0000${map.selector}`, map);
  }
  for (const map of candidates.filter((row) => row.orgId === ctx.orgId && ctx.orgId !== null)) {
    bySelector.set(`${map.mapType}\u0000${map.selector}`, map);
  }
  const maps = sortEffectiveMaps([...bySelector.values()]);
  // Only approved maps are executable by the extension. Proposed/retired rows
  // remain visible to review surfaces but cannot enter the execution hash or
  // make a configuration fill-ready.
  const activeMaps = maps.filter((map) => map.status === "approved");
  const activeFieldCount = activeMaps.length;
  const isVerified = activeFieldCount > 0 && selectedConfig.isVerified;
  const sharedBase =
    globalConfig && selectedConfig.orgId !== null
      ? {
          id: globalConfig.id,
          orgId: null,
          portalKey: globalConfig.portalKey,
          mappingGeneration: sharedGeneration,
          payerId: globalConfig.payerId,
          caseType: globalConfig.caseType,
          formUrl: globalConfig.formUrl,
          requiresExplicitSelection: globalConfig.requiresExplicitSelection ?? false,
        }
      : null;
  const effectiveMappingFingerprint = await sha256Fingerprint({
    version: 1,
    mapType,
    selectedConfig: {
      id: selectedConfig.id,
      orgId: selectedConfig.orgId,
      portalKey: selectedConfig.portalKey,
      mappingGeneration: mapGeneration(selectedConfig),
      payerId: selectedConfig.payerId,
      caseType: selectedConfig.caseType,
      formUrl: selectedConfig.formUrl,
      requiresExplicitSelection: selectedConfig.requiresExplicitSelection ?? false,
    },
    sharedBase,
    maps: activeMaps.map(executionMapShape),
  });

  return {
    ...base,
    effectiveMappingFingerprint,
    maps,
    activeFieldCount,
    isVerified,
    isReady: activeFieldCount > 0,
    status: activeFieldCount > 0 ? "ready" : "empty",
  };
}

export async function resolveEffectivePortalMaps(
  ctx: EffectivePortalMapContext,
  input: { portalKey: string; mapType: EffectivePortalMapType },
): Promise<EffectivePortalMapResolution> {
  const portalKey = normalizePortalKey(input.portalKey) ?? "";
  const snapshot = await loadEffectivePortalMapSnapshot(
    ctx,
    portalKey,
    PORTAL_FIELD_MAP_FILL_COLUMNS,
  );
  return resolvePortalMapSnapshot(ctx, snapshot, portalKey, input.mapType);
}

async function loadPortalMapResolutionBatch(
  ctx: EffectivePortalMapContext,
  portalKey: string | undefined,
  mapColumns: string,
  mapType: EffectivePortalMapType = "all",
): Promise<{ resolutions: EffectivePortalMapResolution[]; legacyBlockedKeys: Set<string> }> {
  const key = portalKey ? (normalizePortalKey(portalKey) ?? "") : undefined;
  const snapshot = await loadEffectivePortalMapSnapshot(ctx, key, mapColumns);
  const keys =
    key !== undefined
      ? [key]
      : [
          ...new Set([
            ...snapshot.configs.map((config) => config.portalKey),
            ...snapshot.maps
              .filter((map) => map.portalKey.startsWith("payer-form:") && map.mapType === "pdf")
              .map((map) => map.portalKey),
          ]),
        ].sort();
  const resolutions = await Promise.all(
    keys.map((portalKeyValue) => resolvePortalMapSnapshot(ctx, snapshot, portalKeyValue, mapType)),
  );
  const legacyBlockedKeys = new Set(
    snapshot.configs
      .filter((config) => config.requiresExplicitSelection === true)
      .map((config) => config.portalKey),
  );
  return { resolutions, legacyBlockedKeys };
}

async function listResolvedPortalMapSnapshots(
  ctx: EffectivePortalMapContext,
  portalKey: string | undefined,
  mapColumns: string,
  mapType: EffectivePortalMapType = "all",
): Promise<EffectivePortalMapResolution[]> {
  return (await loadPortalMapResolutionBatch(ctx, portalKey, mapColumns, mapType)).resolutions;
}

/** Batch exact-key resolution for handlers that return readiness metadata. */
export function listEffectivePortalMapResolutions(
  ctx: EffectivePortalMapContext,
  filters: { portalKey?: string; mapType?: EffectivePortalMapType } = {},
): Promise<EffectivePortalMapResolution[]> {
  return listResolvedPortalMapSnapshots(
    ctx,
    filters.portalKey,
    PORTAL_FIELD_MAP_FILL_COLUMNS,
    filters.mapType ?? "all",
  );
}

/** Legacy URL-based routes must block a portal_key if any visible tier needs
 * explicit selection. Exact Panel readers keep using the unfiltered resolver. */
export async function listLegacyClientPortalMapResolutions(
  ctx: EffectivePortalMapContext,
  filters: { portalKey?: string; mapType?: EffectivePortalMapType } = {},
): Promise<EffectivePortalMapResolution[]> {
  const { resolutions, legacyBlockedKeys } = await loadPortalMapResolutionBatch(
    ctx,
    filters.portalKey,
    PORTAL_FIELD_MAP_FILL_COLUMNS,
    filters.mapType ?? "all",
  );
  return resolutions.filter((resolution) => !legacyBlockedKeys.has(resolution.portalKey));
}

function orderMapsForReader(
  maps: PortalFieldMap[],
  order: "created" | "registry" | "section",
): PortalFieldMap[] {
  return [...maps].sort((left, right) => {
    const keyOrder = left.portalKey.localeCompare(right.portalKey);
    if (keyOrder !== 0) return keyOrder;
    if (order === "registry") {
      const sortOrder =
        (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER);
      if (sortOrder !== 0) return sortOrder;
    }
    if (order === "section") {
      const sectionOrder = (left.formSection ?? "").localeCompare(right.formSection ?? "");
      if (sectionOrder !== 0) return sectionOrder;
    }
    return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
  });
}

// The extension-facing map API is legacy URL selection. Only current maps
// from unflagged configurations cross this boundary. Panel callers use the
// exact resolver and can still access explicitly selected configurations.
export async function listPortalFieldMaps(
  ctx: PortalFieldMapServiceCtx,
  filters: PortalFieldMapFilters = {},
): Promise<PortalFieldMap[]> {
  const resolutions = await listLegacyClientPortalMapResolutions(ctx, filters);
  return orderMapsForReader(
    resolutions
      .filter((resolution) => resolution.status !== "configuration_missing")
      .flatMap((resolution) => resolution.maps),
    "created",
  );
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
  const resolutions = await loadPortalMapResolutionBatch(
    { db, orgId: null },
    portalKey,
    APP_PORTAL_FIELD_MAP_COLUMNS,
  );
  return orderMapsForReader(
    resolutions.resolutions
      .filter((resolution) => resolution.status !== "configuration_missing")
      .filter((resolution) => !resolutions.legacyBlockedKeys.has(resolution.portalKey))
      .flatMap((resolution) => resolution.maps),
    "registry",
  );
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
  /** E6.10 — captured option vocabulary. Snake_case wire. */
  control_options?: unknown;
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
  const [dictRes, currentResolutions] = await Promise.all([
    ctx.db
      .from("field_dictionary")
      .select("label_normalized, token, status")
      .eq("org_id", ctx.orgId)
      .eq("label_normalized", label),
    listResolvedPortalMapSnapshots(ctx, undefined, PORTAL_FIELD_MAP_LEARNING_COLUMNS),
  ]);
  if (dictRes.error) throw dictRes.error;

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

  const observed: ObservedMapping[] = currentResolutions
    .flatMap((resolution) => resolution.maps)
    .filter((row) => row.status === "approved" && row.token && row.fieldLabel === label)
    .map((row) => ({
      label,
      token: normalizeTokenKey(row.token) ?? "",
      portalKey: normalizePortalKey(row.portalKey) ?? "",
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
  const optionsCheck = validateControlOptionsInput(
    input.control_options === undefined ? null : input.control_options,
  );
  if (optionsCheck.kind === "rejected") {
    return { kind: "rejected", status: 422, message: optionsCheck.message };
  }
  // Empty list is ignored (AJAX select not loaded); null = key absent.
  const controlOptions =
    optionsCheck.options && optionsCheck.options.length > 0 ? optionsCheck.options : null;

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
    const prior = existing[0] as { id: string; org_id: string | null };
    // Re-capture on an OWN org row refreshes a non-empty vocabulary without
    // touching the decision. A global hit is returned as-is (shared catalog).
    if (prior.org_id === ctx.orgId && controlOptions) {
      const { data: refreshed, error: refreshErr } = await ctx.db
        .from("portal_field_maps")
        .update({ control_options: controlOptions } as never)
        .eq("id", prior.id)
        .eq("org_id", ctx.orgId)
        .select(PORTAL_FIELD_MAP_COLUMNS)
        .maybeSingle();
      if (refreshErr) throw refreshErr;
      if (refreshed) {
        const row = camelizeRow<PortalFieldMap>(refreshed);
        return {
          kind: "existing",
          map: { ...row, token: normalizeTokenKey(row.token) },
          suggestion: fieldLabel ? await learnedSuggestion(ctx, fieldLabel, portalKey) : null,
        };
      }
    }
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
      control_options: controlOptions,
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
  const resolutions = await listResolvedPortalMapSnapshots(
    { db: supabase, orgId },
    portalKey,
    APP_PORTAL_FIELD_MAP_COLUMNS,
  );
  return orderMapsForReader(
    resolutions.flatMap((resolution) => resolution.maps),
    "section",
  );
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
    hardcoded_value: null,
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
    transform: null,
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

/** E6.10 F6.10.4 — org-tier fixed value. Shared rows use train_global_field_map. */
export async function setFieldMapHardcoded(
  id: string,
  value: string,
  fieldLabel?: string | null,
): Promise<PortalFieldMap> {
  const orgId = requireActiveOrg();
  const literal = value.trim();
  if (!literal) throw new Error("A fixed value cannot be empty");
  const row = await updateFieldMapRow(orgId, id, {
    status: "approved",
    source: "hardcoded",
    token: null,
    hardcoded_value: literal,
    transform: null,
  });
  await writeAudit({
    actionType: "UPDATE",
    entityType: "portal_field_map",
    entityId: id,
    after: { source: "hardcoded", status: "approved", hardcodedValue: literal },
    description: `Set fixed value on "${fieldLabel ?? row.fieldLabel ?? id}"`,
  });
  return row;
}

/** E6.10 F6.10.5 — org-tier transform on a token-mapped row. */
export async function setFieldMapTransform(
  id: string,
  transform: string | null,
): Promise<PortalFieldMap> {
  const orgId = requireActiveOrg();
  const next = transform?.trim() || null;
  if (next && !isAuthorableTransform(next)) throw new Error("Invalid transform");
  const row = await updateFieldMapRow(orgId, id, { transform: next });
  await writeAudit({
    actionType: "UPDATE",
    entityType: "portal_field_map",
    entityId: id,
    after: { transform: next },
    description: `Set value shaping on "${row.fieldLabel ?? id}"`,
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
    transform: null,
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
  /** A value-shaping transform supported by both web and PDF fill paths. */
  transform?: string | null;
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
    p_transform: (patch.transform ?? null) as unknown as string,
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
  controlOptions?: { value: string; label: string }[] | null;
  /** E6.11 — the tier the row belongs to. Omitted means `'web'`, which is what
   * the RPC defaults to, so the argument is SENT ONLY for a PDF import: a
   * hosted signature without the E6.11 migration keeps serving web capture
   * (an unknown named arg is a PGRST202 400, not an ignored extra). */
  mapType?: "web" | "pdf";
}

/** Create (or resolve, if capture already saw it) a shared registry row.
 * Idempotent on the F6.9.1 partial unique index — a repeat capture returns the
 * existing row with its decision intact and refreshes presentation columns
 * (sort order, payer label/section/page) when the DOM drifted. */
export async function proposeSharedFieldMap(input: SharedProposeInput): Promise<PortalFieldMap> {
  const rpc = supabase.rpc.bind(supabase);
  const pdfArg = input.mapType === "pdf" ? { p_map_type: "pdf" } : {};
  const { data, error } = await rpc("propose_shared_field_map", {
    ...pdfArg,
    p_portal_key: input.portalKey,
    p_selector: input.selector,
    p_field_label: (input.fieldLabel ?? null) as unknown as string,
    p_form_section: (input.formSection ?? null) as unknown as string,
    p_page_step: (input.pageStep ?? null) as unknown as string,
    p_field_type: (input.fieldType ?? "text") as unknown as string,
    p_sort_order: (input.sortOrder ?? null) as unknown as number,
    p_notes: (input.notes ?? null) as unknown as string,
    p_control_options: (input.controlOptions && input.controlOptions.length > 0
      ? input.controlOptions
      : null) as unknown as string,
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
