// Payer quality scorecard: a pure, read-only derivation of per-payer quality
// indicators from rows already fetched by existing hooks (portals, portal field
// maps, cases, status configs, status history, fill sessions). No Supabase
// access here — the UI feeds it raw rows and formats the result. Every
// indicator degrades to `available: false` ("n/a") when its source is empty.
// Tested in payerScorecard.test.ts.
import type {
  CredentialCase,
  FillSession,
  Portal,
  PortalFieldMap,
  StatusConfig,
  StatusHistoryEntry,
} from "@/types";

export interface PayerScorecardInput {
  payerId: string;
  /** All org portals; the payer's portals are those with payerId === this payer. */
  portals: Portal[];
  /** All org + global portal field maps (bare-token normalized upstream). */
  fieldMaps: PortalFieldMap[];
  /** All org cases; the payer's cases are those with payerId === this payer. */
  cases: CredentialCase[];
  /** Credentialing-track status configs, for status → action_bucket mapping. */
  statusConfigs: StatusConfig[];
  /**
   * Status-history rows for the payer's cases. Optional: no bulk reader exists
   * on the browser surface, so when it is absent/empty the time-in-bucket
   * indicator degrades to n/a rather than forcing a heavy per-case query.
   */
  statusHistory?: StatusHistoryEntry[];
  /** Recent org fill sessions; the payer's are those on the payer's cases. */
  fillSessions: FillSession[];
}

export type IndicatorKey = "mapping_coverage" | "first_pass_rate" | "avg_time_in_bucket";

export interface BucketDuration {
  bucket: string;
  avgDays: number;
  intervals: number;
}

export interface ScorecardIndicator {
  key: IndicatorKey;
  /** false => the source data is empty; the UI renders "n/a". */
  available: boolean;
  /** Ratio numerator (e.g. mapped fields); null when n/a or not a ratio. */
  numerator: number | null;
  /** Ratio denominator (e.g. mapped + proposed); null when n/a or not a ratio. */
  denominator: number | null;
  /** numerator / denominator in [0,1]; null when n/a or not a ratio. */
  ratio: number | null;
  /** avg-time-in-bucket only: per-bucket average days, ordered by BUCKET_ORDER. */
  buckets?: BucketDuration[];
  /** avg-time-in-bucket only: mean across all closed intervals; null when n/a. */
  overallAvgDays?: number | null;
}

export interface PayerScorecard {
  indicators: ScorecardIndicator[];
}

const MS_PER_DAY = 86_400_000;

// Home action-engine bucket order (see src/lib/actionState.ts); unknown last.
const BUCKET_ORDER = ["ours", "waiting_payer", "waiting_provider", "complete"];

function bucketRank(bucket: string): number {
  const i = BUCKET_ORDER.indexOf(bucket);
  return i === -1 ? BUCKET_ORDER.length : i;
}

function payerPortalKeys(input: PayerScorecardInput): Set<string> {
  return new Set(input.portals.filter((p) => p.payerId === input.payerId).map((p) => p.portalKey));
}

function payerCaseIds(input: PayerScorecardInput): Set<string> {
  return new Set(input.cases.filter((c) => c.payerId === input.payerId).map((c) => c.id));
}

// Mapping coverage = mapped ÷ (mapped + proposed) over the payer's portals'
// field maps, counted by status (matching admin.portals.tsx): approved =
// mapped, proposed = still-to-review; retired rows are excluded from both.
// Exported (E4.2 TE-16) so the F4.2.2 form-readiness surface reuses the EXACT
// same derivation — no second formula to drift. Only payerId/portals/fieldMaps
// matter for this indicator; the other input fields can be empty.
export function mappingCoverage(input: PayerScorecardInput): ScorecardIndicator {
  const keys = payerPortalKeys(input);
  let mapped = 0;
  let proposed = 0;
  for (const fm of input.fieldMaps) {
    if (!keys.has(fm.portalKey)) continue;
    if (fm.status === "approved") mapped += 1;
    else if (fm.status === "proposed") proposed += 1;
  }
  const denominator = mapped + proposed;
  const available = denominator > 0;
  return {
    key: "mapping_coverage",
    available,
    numerator: available ? mapped : null,
    denominator: available ? denominator : null,
    ratio: available ? mapped / denominator : null,
  };
}

// First-pass submission rate = fraction of the payer's cases that were filled
// exactly once (no re-fill). A case with two or more fill sessions needed a
// correction, so it is not first-pass. Denominator = the payer's cases that
// have at least one fill session; cases never filled don't count either way.
function firstPassRate(input: PayerScorecardInput): ScorecardIndicator {
  const caseIds = payerCaseIds(input);
  const fillsByCase = new Map<string, number>();
  for (const fs of input.fillSessions) {
    // E4.2 TE-17 — dry-run test fills never count toward first-pass rate.
    if (fs.isTest) continue;
    if (!caseIds.has(fs.caseId)) continue;
    fillsByCase.set(fs.caseId, (fillsByCase.get(fs.caseId) ?? 0) + 1);
  }
  const casesWithFills = fillsByCase.size;
  let firstPass = 0;
  for (const count of fillsByCase.values()) if (count === 1) firstPass += 1;
  const available = casesWithFills > 0;
  return {
    key: "first_pass_rate",
    available,
    numerator: available ? firstPass : null,
    denominator: available ? casesWithFills : null,
    ratio: available ? firstPass / casesWithFills : null,
  };
}

// Average time-in-bucket: for each of the payer's cases, the durations between
// consecutive credentialing status changes are attributed to the bucket of the
// status being left, then averaged per bucket (and overall). The final, still-
// open interval (no next change) is not counted. Unknown statuses, non-
// credentialing rows, and non-monotonic timestamps are ignored.
function avgTimeInBucket(input: PayerScorecardInput): ScorecardIndicator {
  const caseIds = payerCaseIds(input);
  const bucketByStatus = new Map(input.statusConfigs.map((s) => [s.id, s.actionBucket]));

  const historyByCase = new Map<string, StatusHistoryEntry[]>();
  for (const h of input.statusHistory ?? []) {
    if (h.track !== "credentialing") continue;
    if (h.caseId == null || !caseIds.has(h.caseId)) continue;
    const list = historyByCase.get(h.caseId) ?? [];
    list.push(h);
    historyByCase.set(h.caseId, list);
  }

  const sums = new Map<string, { total: number; count: number }>();
  let overallTotal = 0;
  let overallCount = 0;
  for (const entries of historyByCase.values()) {
    const sorted = [...entries].sort((a, b) => Date.parse(a.changedAt) - Date.parse(b.changedAt));
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const statusId = sorted[i].toStatusId;
      if (statusId == null) continue;
      const bucket = bucketByStatus.get(statusId);
      if (bucket == null) continue;
      const ms = Date.parse(sorted[i + 1].changedAt) - Date.parse(sorted[i].changedAt);
      if (!Number.isFinite(ms) || ms < 0) continue;
      const days = ms / MS_PER_DAY;
      const acc = sums.get(bucket) ?? { total: 0, count: 0 };
      acc.total += days;
      acc.count += 1;
      sums.set(bucket, acc);
      overallTotal += days;
      overallCount += 1;
    }
  }

  const buckets: BucketDuration[] = [...sums.entries()]
    .map(([bucket, { total, count }]) => ({ bucket, avgDays: total / count, intervals: count }))
    .sort((a, b) => bucketRank(a.bucket) - bucketRank(b.bucket));

  const available = overallCount > 0;
  return {
    key: "avg_time_in_bucket",
    available,
    numerator: null,
    denominator: null,
    ratio: null,
    buckets,
    overallAvgDays: available ? overallTotal / overallCount : null,
  };
}

export function computePayerScorecard(input: PayerScorecardInput): PayerScorecard {
  return {
    indicators: [mappingCoverage(input), firstPassRate(input), avgTimeInBucket(input)],
  };
}
