// 2026-07-22 Cases page redesign — the pure view logic behind /cases (the
// Flat / By provider / By payer views, the KPI cards, and the filters). No
// I/O: the route builds CaseViewRow[] from its hooks and feeds them here.
//
// KPI cards are DERIVED FILTERS, not statuses (the canonical 8-state machine
// in caseStatus.ts is the only status vocabulary — CaseStatusPill renders it):
//   Total               — every case
//   In progress         — case_status = in_progress
//   Awaiting effective  — Approved AND no confirmed effective date yet
//   Denied / appeal     — case_status = denied
import { CASE_STATUSES, CASE_STATUS_BUCKETS, type CaseStatus } from "./caseStatus";

export type CasesKpi = "total" | "inprog" | "awaiting" | "denied";

export const CASES_KPIS: readonly CasesKpi[] = ["total", "inprog", "awaiting", "denied"];

export type FlatSortKey =
  | "default"
  | "caseNumber"
  | "provider"
  | "payer"
  | "state"
  | "status"
  | "lastTouch"
  | "daysOpen";

export type SortDir = "asc" | "desc";

/** One row per case — the shared shape the route hands the pure transforms. */
export interface CaseViewRow {
  caseId: string;
  caseNumber: number | null;
  providerId: string | null;
  providerName: string;
  providerCredentials: string | null;
  payerId: string;
  payerName: string;
  isPreCred: boolean;
  state: string;
  caseStatus: CaseStatus;
  confirmedEffectiveDate: string | null;
  /** Human label ("2d ago", "today", "—"). */
  lastTouchLabel: string;
  /** Days since the last touch; null = never touched (sorts last). */
  lastTouchDays: number | null;
  /** Whole days the case has been open (0 for a never-worked case). */
  daysOpen: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// KPI cards (derived filters)
// ---------------------------------------------------------------------------

export function matchesKpi(row: CaseViewRow, kpi: CasesKpi): boolean {
  switch (kpi) {
    case "total":
      return true;
    case "inprog":
      return row.caseStatus === "in_progress";
    case "awaiting":
      return row.caseStatus === "approved" && !row.confirmedEffectiveDate;
    case "denied":
      return row.caseStatus === "denied";
  }
}

export function kpiCounts(rows: readonly CaseViewRow[]): Record<CasesKpi, number> {
  return {
    total: rows.length,
    inprog: rows.filter((r) => matchesKpi(r, "inprog")).length,
    awaiting: rows.filter((r) => matchesKpi(r, "awaiting")).length,
    denied: rows.filter((r) => matchesKpi(r, "denied")).length,
  };
}

// ---------------------------------------------------------------------------
// Filters (KPI + State + Case Status + search) — composed with AND
// ---------------------------------------------------------------------------

export interface CasesFilters {
  kpi: CasesKpi;
  state: string; // "all" or a two-letter state
  status: CaseStatus | "all";
  search: string;
}

export const EMPTY_FILTERS: CasesFilters = { kpi: "total", state: "all", status: "all", search: "" };

export function rowMatchesSearch(row: CaseViewRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [row.providerName, row.payerName].some((h) => h.toLowerCase().includes(needle));
}

export function filterRows(rows: readonly CaseViewRow[], filters: CasesFilters): CaseViewRow[] {
  return rows.filter(
    (r) =>
      matchesKpi(r, filters.kpi) &&
      (filters.state === "all" || r.state === filters.state) &&
      (filters.status === "all" || r.caseStatus === filters.status) &&
      rowMatchesSearch(r, filters.search),
  );
}

/** Distinct states present, alphabetical — for the State dropdown. */
export function statesInRows(rows: readonly CaseViewRow[]): string[] {
  return Array.from(new Set(rows.map((r) => r.state))).sort();
}

// ---------------------------------------------------------------------------
// Flat sort — default is the E2.3 deadline ranking; a column header switches
// to that column's sort. The rank map is one entry per OPEN case (from the
// next-best-action queue); ranked cases come first in queue order, unranked
// (terminal) cases follow, newest-created first.
// ---------------------------------------------------------------------------

function providerSortName(r: CaseViewRow): string {
  return r.providerName.toLowerCase();
}

function compareDefault(a: CaseViewRow, b: CaseViewRow, rank: Map<string, number>): number {
  const ra = rank.get(a.caseId);
  const rb = rank.get(b.caseId);
  if (ra !== undefined && rb !== undefined) return ra - rb;
  if (ra !== undefined) return -1; // ranked (open) before unranked (terminal)
  if (rb !== undefined) return 1;
  // both terminal/unranked — newest created first, stable id tiebreak
  return b.createdAt.localeCompare(a.createdAt) || a.caseId.localeCompare(b.caseId);
}

export function sortFlatRows(
  rows: readonly CaseViewRow[],
  key: FlatSortKey,
  dir: SortDir,
  rankByCaseId: Map<string, number>,
): CaseViewRow[] {
  const out = [...rows];
  if (key === "default") {
    out.sort((a, b) => compareDefault(a, b, rankByCaseId));
    return out;
  }
  const mul = dir === "asc" ? 1 : -1;
  const tiebreak = (a: CaseViewRow, b: CaseViewRow) => a.caseId.localeCompare(b.caseId);
  out.sort((a, b) => {
    let c = 0;
    switch (key) {
      case "caseNumber":
        c = (a.caseNumber ?? 0) - (b.caseNumber ?? 0);
        break;
      case "provider":
        c = providerSortName(a).localeCompare(providerSortName(b));
        break;
      case "payer":
        c = a.payerName.toLowerCase().localeCompare(b.payerName.toLowerCase());
        break;
      case "state":
        c = a.state.localeCompare(b.state);
        break;
      case "status":
        // Spine order (README): the canonical CASE_STATUSES index.
        c = CASE_STATUSES.indexOf(a.caseStatus) - CASE_STATUSES.indexOf(b.caseStatus);
        break;
      case "lastTouch": {
        // Never-touched sorts last regardless of direction.
        const av = a.lastTouchDays;
        const bv = b.lastTouchDays;
        if (av === null && bv === null) c = 0;
        else if (av === null) return 1;
        else if (bv === null) return -1;
        else c = av - bv;
        break;
      }
      case "daysOpen":
        c = a.daysOpen - b.daysOpen;
        break;
    }
    return c !== 0 ? c * mul : tiebreak(a, b);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Grouping — By provider / By payer. Consistent vocabulary across views:
// needsAction = open cases whose status bucket is "ours" (the ball is in our
// court: not_started / in_progress / action_required); approved = terminal wins.
// ---------------------------------------------------------------------------

export interface CaseGroupView {
  id: string;
  title: string;
  subtitle: string | null;
  isPreCred: boolean;
  rows: CaseViewRow[];
  total: number;
  approved: number;
  needsAction: number;
}

export function needsAction(row: CaseViewRow): boolean {
  return CASE_STATUS_BUCKETS[row.caseStatus] === "ours";
}

export interface GroupMeta {
  /** Subtitle for a group key (NPI + facility for providers; kind + states for payers). */
  subtitleFor: (key: string) => string | null;
}

export function groupRows(
  rows: readonly CaseViewRow[],
  by: "provider" | "payer",
  meta: GroupMeta,
): CaseGroupView[] {
  const byKey = new Map<string, CaseGroupView>();
  for (const r of rows) {
    const key = by === "provider" ? (r.providerId ?? "unknown-provider") : r.payerId;
    let g = byKey.get(key);
    if (!g) {
      g = {
        id: key,
        title: by === "provider" ? r.providerName : r.payerName,
        subtitle: meta.subtitleFor(key),
        isPreCred: by === "payer" && r.isPreCred,
        rows: [],
        total: 0,
        approved: 0,
        needsAction: 0,
      };
      byKey.set(key, g);
    }
    g.rows.push(r);
  }
  const groups = [...byKey.values()].map((g) => {
    g.rows.sort(
      (a, b) => CASE_STATUSES.indexOf(a.caseStatus) - CASE_STATUSES.indexOf(b.caseStatus),
    );
    g.total = g.rows.length;
    g.approved = g.rows.filter((r) => r.caseStatus === "approved").length;
    g.needsAction = g.rows.filter((r) => r.caseStatus !== "approved" && needsAction(r)).length;
    return g;
  });
  // Pre-cred payer group pinned last; otherwise most-needing-action first, then A→Z.
  groups.sort((a, b) => {
    if (a.isPreCred !== b.isPreCred) return a.isPreCred ? 1 : -1;
    return b.needsAction - a.needsAction || a.title.localeCompare(b.title);
  });
  return groups;
}

// ---------------------------------------------------------------------------
// Pagination — shared by the Flat rows and the grouped cards.
// ---------------------------------------------------------------------------

export function paginate<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
