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
}

/** Reduce a newest-first fill list to one DriftFill per portal, excluding
 * dry-run rows. Input order is trusted (the service orders started_at desc). */
export function latestRealFillPerPortal(
  fills: readonly Pick<FillSession, "portalKey" | "fieldsSkipped" | "isTest">[],
): DriftFill[] {
  const seen = new Set<string>();
  const out: DriftFill[] = [];
  for (const f of fills) {
    if (f.isTest || seen.has(f.portalKey)) continue;
    seen.add(f.portalKey);
    out.push({ portalKey: f.portalKey, fieldsSkipped: f.fieldsSkipped });
  }
  return out;
}

/** The broken (drifted) LIVE mappings one fill reports for its portal.
 * Join by the reported map id first (exact); fall back to the report-label
 * join ONLY for older telemetry that predates mapId — a reported-but-unmatched
 * id (the mapping was retired/removed) raises nothing. Duplicate reports
 * collapse to one mapping. */
export function brokenMapsForFill(
  fill: DriftFill,
  fieldMaps: readonly PortalFieldMap[],
): PortalFieldMap[] {
  const notFound = parseSkippedEntries(fill.fieldsSkipped).filter(
    (e) => e.kind === "skipped" && e.reason === FIELD_NOT_FOUND_REASON,
  );
  if (notFound.length === 0) return [];

  const liveMaps = fieldMaps.filter(
    (m) => m.portalKey === fill.portalKey && m.status !== "retired",
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
