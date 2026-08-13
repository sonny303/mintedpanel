// Payer & Cases design bundle, screen 1 (Slice A) — pure view logic for the
// single-view Payer Setup page. The page lists the global catalog
// (catalogSetupPayers; archived rows opt-in via Show archived) with FOUR KPI
// filter cards, a search · State · Kind toolbar, and pagination. There is no
// org↔payer assignment — group attach lives on Groups → Payer Network.
//
// Template/form/drift facts are CONSUMED from the E6.5 readiness funnel rows
// (buildPayerReadinessFunnel) — this module never re-derives them, it only
// projects them into the screen's vocabulary:
//   Template status  = Published | Needs template (one badge, no Partial)
//   Form not proven  = published template drives an online form that is not
//                      yet proven by a mock dry run (autofill KPI — not the
//                      Ready gate; Ready = published checklist SOP)
//   Drift detected   = a previously-working form has broken mappings
// Archived rows carry no readiness projection — they render an Archived badge
// plus Reactivate, and they bypass the KPI filter (they are only visible at
// all when Show archived is on) while still honoring search/State/Kind.
import type { ActiveOrgPayer } from "@/lib/payerSetup";
import type { FunnelRow } from "@/lib/payerReadinessFunnel";
import { PAYER_KIND_LABELS } from "@/lib/payerDirectory";
import type { PayerKind } from "@/types";

export type PayerTemplateStatus = "published" | "needs_template";

export type PayerSetupKpiKey = "all" | "needs_template" | "form_not_proven" | "drift";

export interface PayerSetupViewRow {
  payerId: string;
  name: string;
  states: string[];
  kind: PayerKind;
  archived: boolean;
  templateStatus: PayerTemplateStatus;
  /** Published template drives an online form that is not proven yet. */
  formNotProven: boolean;
  driftCount: number;
}

export interface PayerSetupKpiCounts {
  all: number;
  needsTemplate: number;
  formNotProven: number;
  drift: number;
}

export interface PayerSetupFilters {
  kpi: PayerSetupKpiKey;
  search: string;
  /** Two-letter state code, or "all". */
  state: string;
  /** PayerKind, or "all". */
  kind: string;
  showArchived: boolean;
}

export const DEFAULT_PAYER_SETUP_FILTERS: PayerSetupFilters = {
  kpi: "all",
  search: "",
  state: "all",
  kind: "all",
  showArchived: false,
};

/** Rows-per-page ladder (design: 5–100, default 10). */
export const PAYER_SETUP_PAGE_SIZES = [5, 10, 25, 50, 100] as const;
export const DEFAULT_PAYER_SETUP_PAGE_SIZE = 10;

/**
 * Join the included payers (catalogSetupPayers with includeArchived: true) to
 * their funnel rows. A payer with no funnel row (archived rows are excluded
 * from the funnel derivation) projects to needs_template/quiet — the archived
 * branch renders its own badge instead.
 */
export function buildPayerSetupRows(
  included: readonly ActiveOrgPayer[],
  funnelRows: readonly FunnelRow[],
): PayerSetupViewRow[] {
  const funnelByPayer = new Map(funnelRows.map((row) => [row.payerId, row]));
  return included.map(({ payer }) => {
    const funnel = funnelByPayer.get(payer.id);
    const published = funnel?.sopPublished ?? false;
    return {
      payerId: payer.id,
      name: payer.name,
      states: payer.states ?? [],
      kind: payer.payerKind ?? "commercial",
      archived: payer.archivedAt != null,
      templateStatus: published ? "published" : "needs_template",
      formNotProven: Boolean(
        funnel && published && funnel.needsPortal && funnel.formState !== "proven",
      ),
      driftCount: funnel?.driftCount ?? 0,
    };
  });
}

/** KPI counts cover ACTIVE (non-archived) rows only — archive removes a payer
 * from the working set, so it never inflates a readiness count. */
export function countPayerSetupKpis(rows: readonly PayerSetupViewRow[]): PayerSetupKpiCounts {
  const active = rows.filter((row) => !row.archived);
  return {
    all: active.length,
    needsTemplate: active.filter((row) => row.templateStatus === "needs_template").length,
    formNotProven: active.filter((row) => row.formNotProven).length,
    drift: active.filter((row) => row.driftCount > 0).length,
  };
}

function matchesKpi(row: PayerSetupViewRow, kpi: PayerSetupKpiKey): boolean {
  switch (kpi) {
    case "all":
      return true;
    case "needs_template":
      return row.templateStatus === "needs_template";
    case "form_not_proven":
      return row.formNotProven;
    case "drift":
      return row.driftCount > 0;
  }
}

/**
 * Screen-1 filter semantics: search matches the payer NAME only (alias search
 * went with the catalog), State matches states[] membership, Kind matches the
 * payer kind. Archived rows are excluded unless Show archived is on; when
 * shown they BYPASS the KPI filter but still honor search/State/Kind (the
 * design's archived-rows-always-listed rule).
 */
export function filterPayerSetupRows(
  rows: readonly PayerSetupViewRow[],
  filters: PayerSetupFilters,
): PayerSetupViewRow[] {
  const query = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (row.archived && !filters.showArchived) return false;
    if (!row.archived && !matchesKpi(row, filters.kpi)) return false;
    if (query && !row.name.toLowerCase().includes(query)) return false;
    if (filters.state !== "all" && !row.states.includes(filters.state)) return false;
    if (filters.kind !== "all" && row.kind !== filters.kind) return false;
    return true;
  });
}

/** The State dropdown offers only states that actually appear on catalog
 * payers (archived included, so an archived payer stays findable). */
export function payerSetupStateOptions(rows: readonly PayerSetupViewRow[]): string[] {
  const states = new Set<string>();
  for (const row of rows) for (const state of row.states) states.add(state);
  return [...states].sort((a, b) => a.localeCompare(b));
}

/** Kind options present on catalog payers, ordered by display label. */
export function payerSetupKindOptions(rows: readonly PayerSetupViewRow[]): PayerKind[] {
  const kinds = new Set<PayerKind>();
  for (const row of rows) kinds.add(row.kind);
  return [...kinds].sort((a, b) => PAYER_KIND_LABELS[a].localeCompare(PAYER_KIND_LABELS[b]));
}

export interface PayerSetupPageSlice<T> {
  pageRows: T[];
  /** Clamped to [1, totalPages] so a shrinking filter never strands the pager. */
  page: number;
  totalPages: number;
  /** 1-based inclusive range of the visible rows; 0–0 when empty. */
  from: number;
  to: number;
}

export function paginateRows<T>(
  rows: readonly T[],
  page: number,
  pageSize: number,
): PayerSetupPageSlice<T> {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const clamped = Math.min(Math.max(1, page), totalPages);
  const start = (clamped - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  return {
    pageRows,
    page: clamped,
    totalPages,
    from: rows.length === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, rows.length),
  };
}
