// Form-drift derivation (E6.5 F6.5.4) — the E4.3a broken-mapping contract
// carried forward as a standalone pure module. The Fix-it deck retired with
// E6.5; drift now surfaces as the Sidebar badge count, the Payer Setup funnel's
// per-payer drift column, and the SOP editor's queue-first repair list — all
// derived from the SAME reduction here, nothing stored.
//
// The telemetry contract with minted-extension is LOCKED: the content script
// reports `{ label, reason, mapId?, kind }` entries in fill_sessions
// .fields_skipped (src/background/fill.ts), and only a `kind: "skipped"` entry
// whose reason is the exact FIELD_NOT_FOUND_REASON wording counts as drift.
// The E4.2 dry-run shape (`{ selector, label, reason: "unmapped" |
// "empty_token" }`) shares the column but never matches either predicate.
import type { FillSession, PortalFieldMap } from "@/types";

// The extension content script's EXACT wording when a trained selector matched
// nothing on the live page — the one signal that a mapping no longer fits the
// form (minted-extension src/content/fillEngine.ts). Any other skip reason
// (no value, manual, file upload) is NOT drift.
export const FIELD_NOT_FOUND_REASON = "field not found on this page";

// One parsed entry of a LIVE fill's fields_skipped array.
export interface SkippedEntry {
  label: string;
  reason: string;
  kind: string;
  mapId: string | null;
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
  const notFound = parseSkippedEntries(fill.fieldsSkipped).filter(
    (e) => e.kind === "skipped" && e.reason === FIELD_NOT_FOUND_REASON,
  );
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

/** Did this fill leave THIS mapping unfilled, for ANY reason?
 *
 * Deliberately not limited to the not-found (drift) reason. `fields_skipped`
 * is the extension's COMPLETE record of what it did not fill: minted-extension
 * src/background/fill.ts:286-289 posts
 *   [...pageResult.skipped (kind "skipped"), ...manual (kind "manual")]
 * where `manual` collects everything it never attempted — file uploads, fields
 * with no value to write (`no_value`), unmapped fields. Those entries carry a
 * mapId just like drift entries do.
 *
 * An earlier cut of this matched only kind "skipped" + FIELD_NOT_FOUND_REASON,
 * which meant a mapping the fill never even attempted read as "worked" — the
 * most common non-fill outcome silently becoming positive evidence. Anything
 * named in this array did not fill; only silence means it did. */
function fillLeftUnfilled(
  fill: FillHistoryEntry,
  map: Pick<PortalFieldMap, "id" | "selector">,
): boolean {
  const label = reportLabelOf(map);
  return parseSkippedEntries(fill.fieldsSkipped).some((e) =>
    e.mapId ? e.mapId === map.id : e.label === label,
  );
}

/** True only when both timestamps parse AND a is strictly before b. An
 * undatable timestamp returns false from BOTH orderings, so callers must treat
 * "not before" as "no usable evidence" rather than as a positive. */
function isStrictlyBefore(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return ta < tb;
}

/** When this mapping last filled successfully. null when we have never seen it
 * work, which is itself worth saying: a selector that never worked is a bad
 * mapping, not drift.
 *
 * This is INFERRED, by elimination, because no column records which selectors
 * succeeded: `fields_filled` is an int4 count. (The extension DOES compute the
 * list — minted-extension fill.ts posts `fieldsFilled: pageResult.filled
 * .length` — so the honest long-term fix is to widen that wire contract and
 * read the real thing. Until then, this.)
 *
 * A mapping counts as having worked in a fill when ALL hold:
 *   - the fill is a REAL one on this mapping's portal (dry runs never touched
 *     the live DOM, same reason drift excludes them);
 *   - the fill landed at least one field, so silence means something;
 *   - the fill is datable and ran at or after the mapping's createdAt —
 *     otherwise its silence about the mapping says nothing;
 *   - and the fill did not name the mapping in fields_skipped AT ALL, for any
 *     reason (see fillLeftUnfilled: "never attempted" lives in that same array
 *     and must not read as success).
 *
 * Residual imprecision, stated rather than hidden: a mapping on a page the
 * fill never reached is neither filled nor reported, so it reads as "worked".
 * This is a floor on staleness, not a precise last-success timestamp. */
export function lastWorkingAt(
  map: Pick<PortalFieldMap, "id" | "portalKey" | "selector" | "createdAt">,
  history: readonly FillHistoryEntry[],
): string | null {
  for (const fill of history) {
    if (fill.isTest || fill.portalKey !== map.portalKey) continue;
    if (!fill.startedAt) continue;
    if ((fill.fieldsFilled ?? 0) <= 0) continue;
    // Undatable fills are no evidence: without a usable timestamp we can
    // neither order them against createdAt nor return them as an answer.
    if (Number.isNaN(Date.parse(fill.startedAt))) continue;
    if (map.createdAt && isStrictlyBefore(fill.startedAt, map.createdAt)) continue;
    if (fillLeftUnfilled(fill, map)) continue;
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

/** Mappings that DECAYED: broken in one of the supplied fills, and with
 * evidence they worked before. That distinguishes a mapping that rotted from
 * one that never fitted the form (S6.4: "repair marks fields known-fragile").
 *
 * Scope note, because the obvious reading is wrong: this counts breaks across
 * whatever `fills` it is GIVEN, and today the only producer of that argument
 * is latestRealFillPerPortal, which reduces to ONE fill per portal. So "broke
 * repeatedly over time" is not currently computable — the break count can
 * never exceed 1 — and callers should read this as "drifted in the latest fill
 * AND has worked before", nothing stronger. Making it a true repeat-offender
 * signal means passing several fills per portal, which no caller does yet. */
export function fragileMapIds(
  history: readonly FillHistoryEntry[],
  fills: readonly DriftFill[],
  fieldMaps: readonly PortalFieldMap[],
): Set<string> {
  const broken = new Set<string>();
  for (const fill of fills) {
    for (const map of brokenMapsForFill(fill, fieldMaps)) broken.add(map.id);
  }
  const fragile = new Set<string>();
  for (const mapId of broken) {
    const map = fieldMaps.find((m) => m.id === mapId);
    if (!map) continue;
    // The "worked before" half is the whole signal: without it this would just
    // be drift again. (The old `breaks >= 1` guard was vacuous — every entry in
    // the count map is >= 1 by construction — so it is gone rather than kept
    // as decoration.)
    if (lastWorkingAt(map, history) != null) fragile.add(mapId);
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
