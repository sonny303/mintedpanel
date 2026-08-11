// E6.9 — the field registry's pure rules.
//
// ONE exhaustive `(status, source)` classifier is the single source for the
// editor list, the dry run, and the coverage read-out (F6.9.4). Before this,
// the dry run filtered `source !== 'manual'` BEFORE looking at status — and
// capture writes `status='proposed', source='manual'`, so every undecided
// captured row silently vanished from the run that was supposed to surface it.
// A filter on one axis of a two-axis state can always do that; the fix is to
// classify the pair, exhaustively, in one place.

import type { PortalFieldMap } from "@/types";

/** What a human decided about a field — the vocabulary the editor renders. */
export type FieldDecision =
  /** Captured or added, no decision yet. Blocks a clean dry run. */
  | "undecided"
  /** Mapped to a catalog token; autofills. */
  | "token"
  /** Mapped to a fixed literal; autofills. */
  | "fixed"
  /** Decided: a person types this one. Never autofills, never counts as mapped. */
  | "human"
  /** The payer's form no longer shows this field (drift). */
  | "stale"
  /** The row's (status, source, payload) triple is not a state we define. */
  | "invalid";

export interface FieldClassification {
  decision: FieldDecision;
  /** Counts toward "N of M mapped". */
  mapped: boolean;
  /** The fill engine will put a value in this box. */
  autofillable: boolean;
  /** Blocks a clean dry run — undecided or invalid. */
  needsDecision: boolean;
  /** Human-readable, for the dry-run report. */
  reason: string;
}

const RESULT = (
  decision: FieldDecision,
  mapped: boolean,
  autofillable: boolean,
  needsDecision: boolean,
  reason: string,
): FieldClassification => ({ decision, mapped, autofillable, needsDecision, reason });

/** The row shape the classifier needs — a subset of PortalFieldMap so the
 * extension-facing and browser-facing row types both satisfy it. */
export interface ClassifiableFieldMap {
  status: PortalFieldMap["status"];
  source: PortalFieldMap["source"];
  token: string | null;
  hardcodedValue?: string | null;
}

const nonEmpty = (value: string | null | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Classify one registry row. Exhaustive over `(status, source)`, and every
 * unsupported or payload-invalid pair FAILS CLOSED as `invalid` — a row we
 * cannot explain must never be counted as mapped or quietly skipped.
 *
 * `stale` is passed in rather than derived: staleness is a fact about the last
 * real fill (the field was not found on the page at fill time), which lives in
 * the drift layer, not on the row.
 */
export function classifyFieldMap(
  map: ClassifiableFieldMap,
  options: { stale?: boolean } = {},
): FieldClassification {
  if (map.status === "retired") {
    return RESULT("stale", false, false, false, "Retired");
  }
  if (options.stale) {
    return RESULT("stale", false, false, false, "Not found in the latest fill");
  }

  // Undecided is a STATUS fact and is checked first, whatever the source. This
  // ordering is the bug fix: capture's canonical shape is (proposed, manual),
  // and a source-first filter dropped exactly those rows.
  if (map.status === "proposed") {
    return RESULT("undecided", false, false, true, "Needs a decision");
  }

  if (map.status === "approved") {
    switch (map.source) {
      case "token":
      case "manual_partial":
        return nonEmpty(map.token)
          ? RESULT("token", true, true, false, `Fills from ${map.token}`)
          : RESULT("invalid", false, false, true, "Mapped to a token but no token is set");
      case "hardcoded":
        return nonEmpty(map.hardcodedValue)
          ? RESULT("fixed", true, true, false, `Fills the fixed value “${map.hardcodedValue}”`)
          : RESULT("invalid", false, false, true, "Fixed value is empty");
      case "manual":
        // Decided, deliberately unmapped. Not a failure and not a gap.
        return RESULT("human", false, false, false, "A person fills this");
      default:
        return RESULT("invalid", false, false, true, "Unrecognized source");
    }
  }

  return RESULT("invalid", false, false, true, "Unrecognized status");
}

// ---------------------------------------------------------------------------
// Grouping + ordering (F6.9.5)
// ---------------------------------------------------------------------------

export const DEFAULT_SECTION = "Fields";

export interface RegistryRow extends ClassifiableFieldMap {
  id: string;
  displayLabel?: string | null;
  fieldLabel?: string | null;
  section?: string | null;
  formSection?: string | null;
  pageStep?: string | null;
  sortOrder?: number | null;
  selector: string;
}

/** What the editor shows as the field's name: the admin's rename if there is
 * one, else the payer's raw captured text. `fieldLabel` is never overwritten
 * by a rename (D6), so the raw text stays available as secondary evidence. */
export function displayNameOf(row: RegistryRow): string {
  const renamed = row.displayLabel?.trim();
  if (renamed) return renamed;
  const raw = row.fieldLabel?.trim();
  if (raw) return raw;
  return row.selector;
}

/** The locked grouping fallback: admin section → captured heading → page → the
 * catch-all bucket. */
export function sectionNameOf(row: RegistryRow): string {
  return row.section?.trim() || row.formSection?.trim() || row.pageStep?.trim() || DEFAULT_SECTION;
}

export interface RegistrySection {
  name: string;
  rows: RegistryRow[];
  mapped: number;
  total: number;
}

/**
 * Group rows into sections in capture order.
 *
 * Section order follows the first row of each section in `sort_order`, so the
 * page's own top-to-bottom shape drives the list — a decision never reorders
 * anything (F6.9.5). Rows with no `sort_order` sort last but keep a stable
 * order by id, so the list never shuffles between renders.
 */
export function groupRegistryRows(
  rows: readonly RegistryRow[],
  staleIds: ReadonlySet<string> = new Set(),
): RegistrySection[] {
  const ordered = [...rows].sort(compareRows);
  const sections = new Map<string, RegistrySection>();
  for (const row of ordered) {
    const name = sectionNameOf(row);
    let section = sections.get(name);
    if (!section) {
      section = { name, rows: [], mapped: 0, total: 0 };
      sections.set(name, section);
    }
    section.rows.push(row);
    section.total += 1;
    if (classifyFieldMap(row, { stale: staleIds.has(row.id) }).mapped) section.mapped += 1;
  }
  return [...sections.values()];
}

function compareRows(a: RegistryRow, b: RegistryRow): number {
  const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return a.id.localeCompare(b.id);
}

export interface RegistryCoverage {
  mapped: number;
  total: number;
  pages: number;
  needsDecision: number;
}

/**
 * The informational read-out: `4 of 23 mapped · 5 pages captured`.
 *
 * DISPLAY ONLY — it carries no readiness semantics (D13). The Proven machinery
 * is untouched by this epic, so nothing here gates anything.
 */
export function registryCoverage(
  rows: readonly RegistryRow[],
  staleIds: ReadonlySet<string> = new Set(),
): RegistryCoverage {
  let mapped = 0;
  let needsDecision = 0;
  const pages = new Set<string>();
  for (const row of rows) {
    const c = classifyFieldMap(row, { stale: staleIds.has(row.id) });
    if (c.mapped) mapped += 1;
    if (c.needsDecision) needsDecision += 1;
    const page = row.pageStep?.trim();
    if (page) pages.add(page);
  }
  return { mapped, total: rows.length, pages: pages.size, needsDecision };
}

// ---------------------------------------------------------------------------
// Manual rows (F6.9.6)
// ---------------------------------------------------------------------------

export const MANUAL_SELECTOR_PREFIX = "manual:";

/** A reference row the admin added by hand, not something capture saw on the
 * page. The fill engine and drift repair both skip these — there is no such
 * element to fill or to miss. */
export function isManualSelector(selector: string | null | undefined): boolean {
  return typeof selector === "string" && selector.startsWith(MANUAL_SELECTOR_PREFIX);
}

/**
 * Mint a selector for a newly added manual row.
 *
 * `portal_field_maps.selector` is NOT NULL and stays that way (additive rule),
 * so a row with no page element still needs one. Randomness is correct HERE:
 * a new row has no prior identity to be idempotent against, and the F6.9.1
 * unique index makes collision the only risk, which a UUID removes.
 *
 * The F6.9.6 data migration deliberately does NOT use this — it derives its
 * selectors deterministically in SQL from `(template, step, field)` so that
 * re-running it is a no-op under the same unique index.
 */
export function newManualSelector(): string {
  return `${MANUAL_SELECTOR_PREFIX}${crypto.randomUUID()}`;
}
