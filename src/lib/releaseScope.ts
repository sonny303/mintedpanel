// E4.2 F4.2.4 / TE-14 — release configuration is a SELECTION LAYER on the E2.0
// preview, not a new generator. The operator's release scope narrows the
// confirmed set passed to the UNCHANGED E2.1 RPC; the E2.4 run record
// additively carries the scope it used; unreleased candidates stay eligible and
// reappear in the next preview via existing dedupe (no case exists → still a
// candidate). No candidate/dedupe/exclusion rule changes here — this only
// filters which already-proposed rows get released in this run.

export type ReleaseScope =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "providers"; providerIds: string[] }
  | { kind: "count"; limit: number }
  | { kind: "location"; facilityId: string };

/** Minimal row shape the release filter needs — a subset of GenerationPreviewRow. */
export interface ReleasableRow {
  providerId: string;
}

export interface ReleaseScopeContext {
  /** provider id → the facility ids they're assigned to (for location scope). */
  providerFacilities?: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Narrow the proposed rows to the released subset for THIS run. Order is
 * preserved (the preview's deterministic sort), so a count cap releases the
 * first N deterministically. Pure. */
export function applyReleaseScope<T extends ReleasableRow>(
  proposed: readonly T[],
  scope: ReleaseScope,
  ctx: ReleaseScopeContext = {},
): T[] {
  switch (scope.kind) {
    case "all":
      return [...proposed];
    case "none":
      return [];
    case "providers": {
      const ids = new Set(scope.providerIds);
      return proposed.filter((r) => ids.has(r.providerId));
    }
    case "count":
      return scope.limit <= 0 ? [] : proposed.slice(0, scope.limit);
    case "location": {
      const map = ctx.providerFacilities;
      if (!map) return [];
      return proposed.filter((r) => map.get(r.providerId)?.has(scope.facilityId) ?? false);
    }
  }
}

export interface ReleaseScopeRecord {
  kind: ReleaseScope["kind"];
  releasedCount: number;
  candidateCount: number;
  providerIds?: string[];
  limit?: number;
  facilityId?: string;
}

/** The additive jsonb stored on the E2.4 run record (`case_generation_runs
 * .release_scope`). Captures WHAT the operator released, not PHI. */
export function releaseScopeRecord(
  scope: ReleaseScope,
  releasedCount: number,
  candidateCount: number,
): ReleaseScopeRecord {
  const base: ReleaseScopeRecord = { kind: scope.kind, releasedCount, candidateCount };
  if (scope.kind === "providers") base.providerIds = [...scope.providerIds];
  if (scope.kind === "count") base.limit = scope.limit;
  if (scope.kind === "location") base.facilityId = scope.facilityId;
  return base;
}

/** Human summary of a stored release scope, for the run-history detail. */
export function describeReleaseScope(record: ReleaseScopeRecord): string {
  switch (record.kind) {
    case "all":
      return `Released all ${record.releasedCount} candidate${record.releasedCount === 1 ? "" : "s"}`;
    case "none":
      return "Released none";
    case "providers":
      return `Released ${record.releasedCount} of ${record.candidateCount} by provider selection`;
    case "count":
      return `Released ${record.releasedCount} of ${record.candidateCount} (cap ${record.limit ?? record.releasedCount})`;
    case "location":
      return `Released ${record.releasedCount} of ${record.candidateCount} for one location`;
    default:
      return `Released ${record.releasedCount} of ${record.candidateCount}`;
  }
}
