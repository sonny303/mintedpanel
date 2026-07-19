// E6.3 F6.3.2/F6.3.3/F6.3.4 — the decoupled generation grid's pure logic:
// every provider × target lands in EXACTLY ONE bucket and the buckets always
// sum (the trust invariant is the product). Buckets over the locked preview
// derivation (which already subtracts nothing — it LABELS existing/excluded)
// plus the E6.2 enrollment-facts overlay:
//   candidate — proposed and not fact-covered; selectable (checked by default)
//   enrolled  — proposed but covered by a LIVE enrollment fact; grayed, never
//               attempted, never casework
//   existing  — a case already occupies the key; grayed with its reason
//   excluded  — a standing reasoned exclusion; visible, restorable
// Selection is row-grain over candidates only. Unchecking is SKIP-FOR-NOW
// (no reason, no ceremony, no persistence — the candidate stays in the buffer
// and reappears checked on the next preview); Exclude… is the deliberate,
// persisted opt-out (the E2.0 store, restorable in one click). No I/O here.
import type { BufferFactInput } from "@/lib/generationBuffer";
import { previewRowKey, type GenerationPreviewRow } from "@/lib/generationPreview";

export type GridBucket = "candidate" | "enrolled" | "existing" | "excluded";

export interface GridRow {
  key: string;
  bucket: GridBucket;
  row: GenerationPreviewRow;
}

/** Assign every preview row its single bucket (the facts overlay wins only
 * over proposed rows — an existing case or standing exclusion stays what it
 * is even when a fact also covers the key). */
export function bucketGridRows(
  rows: readonly GenerationPreviewRow[],
  facts: readonly BufferFactInput[],
): GridRow[] {
  const liveFactKeys = new Set(
    facts
      .filter((f) => f.expiredAt === null)
      .map((f) => `${f.providerId}|${f.groupId}|${f.payerId}|${f.state}`),
  );
  return rows.map((row) => {
    const key = previewRowKey(row);
    const bucket: GridBucket =
      row.disposition === "existing"
        ? "existing"
        : row.disposition === "excluded"
          ? "excluded"
          : liveFactKeys.has(key)
            ? "enrolled"
            : "candidate";
    return { key, bucket, row };
  });
}

export interface GridScope {
  groupId?: string;
  payerId?: string;
  providerId?: string;
  /** Location entry (the retired launch dialog's replacement): keeps only
   * providers assigned to this facility, via the provider → facility map. */
  facilityId?: string;
}

export function filterGridRows(
  rows: readonly GridRow[],
  scope: GridScope,
  providerFacilities?: ReadonlyMap<string, ReadonlySet<string>>,
): GridRow[] {
  return rows.filter(({ row }) => {
    if (scope.groupId && row.groupId !== scope.groupId) return false;
    if (scope.payerId && row.payerId !== scope.payerId) return false;
    if (scope.providerId && row.providerId !== scope.providerId) return false;
    if (scope.facilityId) {
      const set = providerFacilities?.get(row.providerId);
      if (!set || !set.has(scope.facilityId)) return false;
    }
    return true;
  });
}

export type GridPivot = "provider" | "payer";

export interface GridGroup {
  key: string;
  label: string;
  rows: GridRow[];
  /** The group header's check-all operates over these candidate keys. */
  candidateKeys: string[];
}

/** Group rows under provider or payer headers (the pivot), A→Z, rows sorted
 * by the other dimension then state so both pivots read stably. */
export function groupGridRows(rows: readonly GridRow[], pivot: GridPivot): GridGroup[] {
  const groups = new Map<string, GridGroup>();
  for (const gridRow of rows) {
    const { row } = gridRow;
    const key = pivot === "provider" ? row.providerId : row.payerId;
    const label = pivot === "provider" ? row.providerName : row.payerName;
    const group = groups.get(key) ?? { key, label, rows: [], candidateKeys: [] };
    group.rows.push(gridRow);
    if (gridRow.bucket === "candidate") group.candidateKeys.push(gridRow.key);
    groups.set(key, group);
  }
  const sortRows = (a: GridRow, b: GridRow) =>
    pivot === "provider"
      ? a.row.payerName.localeCompare(b.row.payerName) || a.row.state.localeCompare(b.row.state)
      : a.row.providerName.localeCompare(b.row.providerName) ||
        a.row.state.localeCompare(b.row.state);
  const out = [...groups.values()];
  for (const g of out) g.rows.sort(sortRows);
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export interface GridReconciliation {
  create: number;
  skipped: number;
  excluded: number;
  enrolled: number;
  existing: number;
  total: number;
  /** The confirm bar's line — buckets sum to the total on every render. */
  line: string;
}

/** The always-visible accounting: selected candidates create, unselected
 * candidates are skipped-for-now, and every other bucket is named. The sum
 * ALWAYS reconciles because every row has exactly one bucket. */
export function reconcileGrid(
  rows: readonly GridRow[],
  selectedKeys: ReadonlySet<string>,
): GridReconciliation {
  const candidates = rows.filter((r) => r.bucket === "candidate");
  const create = candidates.filter((r) => selectedKeys.has(r.key)).length;
  const skipped = candidates.length - create;
  const excluded = rows.filter((r) => r.bucket === "excluded").length;
  const enrolled = rows.filter((r) => r.bucket === "enrolled").length;
  const existing = rows.filter((r) => r.bucket === "existing").length;
  const total = rows.length;

  const parts = [`Create ${create}`];
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (excluded > 0) parts.push(`${excluded} excluded`);
  if (enrolled > 0) parts.push(`${enrolled} enrolled`);
  if (existing > 0) parts.push(`${existing} existing`);
  const line = `${parts.join(" · ")} — ${total} of ${total} accounted for`;

  return { create, skipped, excluded, enrolled, existing, total, line };
}

export interface GridSelectionSplit {
  /** Selected candidates — the rows the confirm attempts. */
  selectedRows: GenerationPreviewRow[];
  /** Unselected candidates — skip-for-now ledger rows, stay in the buffer. */
  skippedRows: GenerationPreviewRow[];
  enrolledRows: GenerationPreviewRow[];
  existingRows: GenerationPreviewRow[];
  excludedRows: GenerationPreviewRow[];
}

/** Split the grid by bucket + selection into the confirm inputs. */
export function splitGridSelection(
  rows: readonly GridRow[],
  selectedKeys: ReadonlySet<string>,
): GridSelectionSplit {
  const pick = (bucket: GridBucket) => rows.filter((r) => r.bucket === bucket).map((r) => r.row);
  const candidates = rows.filter((r) => r.bucket === "candidate");
  return {
    selectedRows: candidates.filter((r) => selectedKeys.has(r.key)).map((r) => r.row),
    skippedRows: candidates.filter((r) => !selectedKeys.has(r.key)).map((r) => r.row),
    enrolledRows: pick("enrolled"),
    existingRows: pick("existing"),
    excludedRows: pick("excluded"),
  };
}
