// Type surface for the E1.6 seed pipeline (scripts/payer-catalog-sync.mjs) so
// its vitest suite in src/lib is typechecked. Keep in sync with the .mjs.
export interface CatalogDatasetRow {
  slug: string;
  name: string;
  payerKind: string;
  states: string[];
  aliases: string[];
}

export interface CatalogExistingRow {
  payer_slug?: string | null;
  name: string;
  aliases?: string[] | null;
  states?: string[] | null;
  status?: string | null;
}

export interface CatalogDiff {
  payerSlug: string;
  payerName: string;
  field: string;
  oldValue: string;
  newValue: string;
}

export interface CatalogSlugBackfill {
  slug: string;
  name: string;
}

export interface CatalogSyncPlan {
  inserts: CatalogDatasetRow[];
  diffs: CatalogDiff[];
  slugBackfills: CatalogSlugBackfill[];
  unchanged: number;
  missing: string[];
}

export declare function parseCsv(text: string): string[][];
export declare function collapseKind(kindField: string | null | undefined): string;
export declare function datasetFromCsv(csvText: string): CatalogDatasetRow[];
export declare function planCatalogSync(
  datasetRows: CatalogDatasetRow[],
  existingRows: CatalogExistingRow[],
): CatalogSyncPlan;
export declare function emitSeedSql(plan: CatalogSyncPlan): string;
