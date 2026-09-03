// Form-drift derivation (E6.5 F6.5.4) — the E4.3a broken-mapping contract
// carried forward as a standalone pure module. The Fix-it deck retired with
// E6.5; drift now surfaces as the Sidebar badge count, the Payer Setup funnel's
// per-payer drift column, and the SOP editor's queue-first repair list — all
// derived from the SAME reduction here, nothing stored.
//
// The telemetry contract with minted-extension is LOCKED: the content script
// reports `{ label, reason, mapId?, kind }` entries in fill_sessions
// .fields_skipped (src/background/fill.ts). Drift is still only a
// `kind: "skipped"` entry whose reason is the exact FIELD_NOT_FOUND_REASON
// wording. Off-page misses (DYN-PAGE) use a distinct kind AND reason so the
// extension Fix-it strip (reason-only) and this module (reason+kind) cannot
// confuse them with a broken on-page selector. The E4.2 dry-run shape
// (`{ selector, label, reason: "unmapped" | "empty_token" }`) shares the
// column but never matches either predicate.
import type { FillSession, PortalFieldMap } from "@/types";

// The extension content script's EXACT wording when a trained selector matched
// nothing on the live page — the one signal that a mapping no longer fits the
// form (minted-extension src/content/fillEngine.ts). Any other skip reason
// (no value, manual, file upload, other page) is NOT drift.
export const FIELD_NOT_FOUND_REASON = "field not found on this page";

/** Producer kind for a map that belongs to a different exact URL-page. */
export const OTHER_PAGE_KIND = "other_page";

/** Distinct from FIELD_NOT_FOUND_REASON — the extension Fix-it strip keys on
 * reason alone. Panel-first pin; DYN-PAGE-01 must emit this exact string. */
export const OTHER_PAGE_REASON = "field belongs to another page";

// One parsed entry of a LIVE fill's fields_skipped array.
export interface SkippedEntry {
  label: string;
  reason: string;
  kind: string;
  mapId: string | null;
}

/** Genuine on-page selector miss. Both halves are required. */
export function isOnPageNotFound(entry: Pick<SkippedEntry, "kind" | "reason">): boolean {
  return entry.kind === "skipped" && entry.reason === FIELD_NOT_FOUND_REASON;
}

/** Off-page miss. Kind or reason is enough so a partial producer (kind
 * overwritten to "skipped", or a mismatched reason on the new kind) still
 * cannot become drift or inferred success. */
export function isOtherPageSkip(entry: Pick<SkippedEntry, "kind" | "reason">): boolean {
  return entry.kind === OTHER_PAGE_KIND || entry.reason === OTHER_PAGE_REASON;
}

// fields_skipped is client-supplied jsonb — parse defensively, dropping anything
// that isn't a `{ label, reason }` record. A missing `kind` defaults to
// "skipped" (older telemetry); a non-string mapId becomes null.
export function parseSkippedEntries(raw: unknown): SkippedEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SkippedEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.label !== "string" || typeof r.reason !== "string") continue;
    out.push({
      label: r.label,
      reason: r.reason,
      kind: typeof r.kind === "string" ? r.kind : "skipped",
      mapId: typeof r.mapId === "string" ? r.mapId : null,
    });
  }
  return out;
}

// The reporting label the extension derives from a selector (the label text for
// `label:` selectors, else the selector itself) — the join key for skip reports
// that predate mapId. Mirrors minted-extension's humanLabel.
export function reportLabelOf(map: Pick<PortalFieldMap, "selector">): string {
  return map.selector.startsWith("label:") ? map.selector.slice("label:".length) : map.selector;
}

// The drift signal source: the latest REAL fill per portal. Dry-run (is_test)
// fills never touch the live DOM, so they can't carry drift and must not mask
// a real fill's signal — they are skipped, NOT treated as the portal's latest.
export interface DriftFill {
  portalKey: string;
  // The stored fill_sessions.fields_skipped jsonb, verbatim — parsed defensively.
  fieldsSkipped: unknown;
  /** When the reporting fill started — the repaired-since boundary below. */
  startedAt?: string | null;
}

/** Reduce a newest-first fill list to one DriftFill per portal, excluding
 * dry-run rows. Input order is trusted (the service orders started_at desc). */
export function latestRealFillPerPortal(
  fills: readonly Pick<FillSession, "portalKey" | "fieldsSkipped" | "isTest" | "startedAt">[],
): DriftFill[] {
  const seen = new Set<string>();
  const out: DriftFill[] = [];
  for (const f of fills) {
    if (f.isTest || seen.has(f.portalKey)) continue;
    seen.add(f.portalKey);
    out.push({ portalKey: f.portalKey, fieldsSkipped: f.fieldsSkipped, startedAt: f.startedAt });
  }
  return out;
}

/** The broken (drifted) LIVE mappings one fill reports for its portal.
 * Join by the reported map id first (exact); fall back to the report-label
 * join ONLY for older telemetry that predates mapId — a reported-but-unmatched
 * id (the mapping was retired/removed) raises nothing. Duplicate reports
 * collapse to one mapping.
 *
 * Repaired-since rule (E6.5): a mapping EDITED after the reporting fill
 * started (updatedAt > startedAt — retrained in the editor) is treated as
 * repaired-pending-verification and drops out of drift; the next real fill
 * either confirms the repair or re-raises it. Without this, a repair could
 * never clear the badge until someone happened to fill the form again. */
export function brokenMapsForFill(
  fill: DriftFill,
  fieldMaps: readonly PortalFieldMap[],
): PortalFieldMap[] {
  const notFound = parseSkippedEntries(fill.fieldsSkipped).filter(isOnPageNotFound);
  if (notFound.length === 0) return [];

  const liveMaps = fieldMaps.filter(
    (m) =>
      m.portalKey === fill.portalKey &&
      m.status !== "retired" &&
      !(fill.startedAt && m.updatedAt > fill.startedAt),
  );
  const byId = new Map(liveMaps.map((m) => [m.id, m]));
  const byReportLabel = new Map(liveMaps.map((m) => [reportLabelOf(m), m]));

  const broken: PortalFieldMap[] = [];
  const seen = new Set<string>();
  for (const e of notFound) {
    const map = e.mapId ? byId.get(e.mapId) : byReportLabel.get(e.label);
    if (!map || seen.has(map.id)) continue;
    seen.add(map.id);
    broken.push(map);
  }
  return broken;
}

/** portalKey → drifted mappings, over the latest real fill per portal. */
export function buildDriftByPortal(
  lastFills: readonly DriftFill[],
  fieldMaps: readonly PortalFieldMap[],
): Map<string, PortalFieldMap[]> {
  const out = new Map<string, PortalFieldMap[]>();
  for (const fill of lastFills) {
    const broken = brokenMapsForFill(fill, fieldMaps);
    if (broken.length > 0) out.set(fill.portalKey, broken);
  }
  return out;
}

/** Total drifted-mapping count — the Sidebar badge number. */
export function totalDriftCount(drift: ReadonlyMap<string, PortalFieldMap[]>): number {
  let n = 0;
  for (const rows of drift.values()) n += rows.length;
  return n;
}

// ---------------------------------------------------------------------------
// S6.4 — the two facts the drift report was missing: WHEN a dead selector last
// worked, and which mappings have a history of breaking.
//
// Both are DERIVED from fill history. No new column, no new ingestion — the
// review's rescoping (finding 2.4) was explicit that drift ingestion already
// works end-to-end and only the reporting was thin.
// ---------------------------------------------------------------------------

/** A historical fill, newest-first, reduced to what dating a break needs. */
export interface FillHistoryEntry {
  portalKey: string;
  startedAt: string | null;
  /** fill_sessions.fields_filled — a COUNT of fields that landed. It is an
   * int4 column, NOT a list of labels: nothing anywhere records WHICH fields
   * filled, which is why lastWorkingAt has to infer success below. */
  fieldsFilled: number | null;
  /** fill_sessions.fields_skipped — the per-field skip reports, verbatim. */
  fieldsSkipped: unknown;
  isTest?: boolean | null;
}

/** Join a skip report to a mapping: mapId first, report label for pre-mapId
 * telemetry. A reported-but-unmatched id does not fall back to the label. */
function skippedEntryMatchesMap(
  entry: SkippedEntry,
  map: Pick<PortalFieldMap, "id" | "selector">,
): boolean {
  return entry.mapId ? entry.mapId === map.id : entry.label === reportLabelOf(map);
}

/** Did this fill report THIS mapping as not-found? Same join as
 * brokenMapsForFill (mapId first, report label for pre-mapId telemetry), but
 * without the repaired-since filter: here we are asking a historical question
 * — "did it break in that fill" — and a later repair does not change the past. */
function fillReportsBroken(
  fill: FillHistoryEntry,
  map: Pick<PortalFieldMap, "id" | "selector">,
): boolean {
  return parseSkippedEntries(fill.fieldsSkipped).some(
    (e) => isOnPageNotFound(e) && skippedEntryMatchesMap(e, map),
  );
}

/** Did this fill report THIS mapping as off-page? That is no evidence it
 * worked and no evidence it broke — the page was not the one being filled. */
function fillReportsOtherPage(
  fill: FillHistoryEntry,
  map: Pick<PortalFieldMap, "id" | "selector">,
): boolean {
  return parseSkippedEntries(fill.fieldsSkipped).some(
    (e) => isOtherPageSkip(e) && skippedEntryMatchesMap(e, map),
  );
}

function isBefore(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  // Unparseable timestamps must not silently order as "before" — treat an
  // undatable fill as no evidence rather than as evidence of working.
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return ta < tb;
}

/** When this mapping last filled successfully. null when we have never seen it
 * work, which is itself worth saying: a selector that never worked is a bad
 * mapping, not drift.
 *
 * This is INFERRED, and it has to be. `fields_filled` is a count, and the
 * extension never reports which selectors succeeded — only which were skipped
 * (fields_skipped). So a mapping counts as having worked in a fill when all of
 * these hold:
 *   - the fill is a REAL one on this mapping's portal (dry runs never touched
 *     the live DOM, same reason drift excludes them);
 *   - the fill landed at least one field, so "no skip report" means something;
 *   - the mapping already existed when the fill ran — otherwise its absence
 *     from the skip list says nothing about it;
 *   - and the fill did NOT report it not-found or off-page.
 *
 * An `other_page` report is explicit no-evidence: walk to an older fill. Do
 * not treat "not reported broken" as success when the fill said the field
 * belonged to another page.
 *
 * The remaining weak link is a mapping that existed but was never attempted
 * and never reported off-page. That would still read as "worked", so this is
 * a floor on staleness, not a precise last-success timestamp. */
export function lastWorkingAt(
  map: Pick<PortalFieldMap, "id" | "portalKey" | "selector" | "createdAt">,
  history: readonly FillHistoryEntry[],
): string | null {
  for (const fill of history) {
    if (fill.isTest || fill.portalKey !== map.portalKey) continue;
    if (!fill.startedAt) continue;
    if ((fill.fieldsFilled ?? 0) <= 0) continue;
    if (map.createdAt && isBefore(fill.startedAt, map.createdAt)) continue;
    if (fillReportsBroken(fill, map)) continue;
    if (fillReportsOtherPage(fill, map)) continue;
    return fill.startedAt;
  }
  return null;
}

/** One row of the S6.4 report: what broke, where, and when it last worked.
 * The coordinator reads this; they are never asked to diagnose it. */
export interface DriftReportRow {
  portalKey: string;
  mapId: string;
  field: string;
  lastWorkingAt: string | null;
  /** True when this mapping has broken before — see fragileMapIds. */
  knownFragile: boolean;
}

/** Mappings that have drifted in ANY fill in the history, not just the latest.
 * A field that breaks, gets repaired, and breaks again is a different problem
 * from one that broke once — the next coverage check should treat it with
 * suspicion (S6.4: "repair marks fields known-fragile"). */
export function fragileMapIds(
  history: readonly FillHistoryEntry[],
  fills: readonly DriftFill[],
  fieldMaps: readonly PortalFieldMap[],
): Set<string> {
  const counts = new Map<string, number>();
  for (const fill of fills) {
    for (const map of brokenMapsForFill(fill, fieldMaps)) {
      counts.set(map.id, (counts.get(map.id) ?? 0) + 1);
    }
  }
  // A mapping is fragile once it has broken at least once AND we have
  // evidence it worked before — i.e. it decayed, rather than never working.
  const fragile = new Set<string>();
  for (const [mapId, breaks] of counts) {
    const map = fieldMaps.find((m) => m.id === mapId);
    if (!map) continue;
    if (breaks >= 1 && lastWorkingAt(map, history) != null) fragile.add(mapId);
  }
  return fragile;
}

/** Assemble the drift report rows for one portal's broken mappings. */
export function buildDriftReport(
  drift: ReadonlyMap<string, PortalFieldMap[]>,
  history: readonly FillHistoryEntry[],
  fragile: ReadonlySet<string>,
): DriftReportRow[] {
  const rows: DriftReportRow[] = [];
  for (const [portalKey, maps] of drift) {
    for (const map of maps) {
      rows.push({
        portalKey,
        mapId: map.id,
        field: map.fieldLabel ?? reportLabelOf(map),
        lastWorkingAt: lastWorkingAt(map, history),
        knownFragile: fragile.has(map.id),
      });
    }
  }
  // Oldest break first: the field that has been broken longest is the one
  // costing the most fills.
  return rows.sort((a, b) => (a.lastWorkingAt ?? "").localeCompare(b.lastWorkingAt ?? ""));
}
