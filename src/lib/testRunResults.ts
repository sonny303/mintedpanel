// E4.2 F4.2.7 / TE-17 — the pure per-field result model for the form test
// runner's dry run, plus a lenient parser for the stored fill-session jsonb.
// Since E6.5 the dry run fills from the versioned SYNTHETIC mock profile
// (mockFillProfile.ts) — the designated-test-provider token seam retired with
// it. Nothing submits; the results ride the existing fill-event payload
// (fields_filled + structured fields_skipped).

import type { FillSkippedField } from "@/types";

export type TestFieldReason = "filled" | "unmapped" | "empty_token";

export interface TestFieldResult {
  selector: string;
  label: string;
  token: string | null;
  reason: TestFieldReason;
}

/** Minimal field-map shape the dry run needs (a subset of PortalFieldMap). */
export interface DryRunFieldMap {
  selector: string;
  token: string | null;
  fieldLabel: string | null;
  status: "proposed" | "approved" | "retired";
}

export interface TestRunComputation {
  results: TestFieldResult[];
  fieldsFilled: number;
  fieldsSkipped: FillSkippedField[];
}

/** Compute a dry run: for each non-retired field map, a mapped token whose
 * resolved value is present → filled; a mapped token that resolves empty →
 * empty_token; no token (manual/unresolved) → unmapped. Pure. */
export function computeTestRun(
  fieldMaps: readonly DryRunFieldMap[],
  resolvedTokens: Readonly<Record<string, string>>,
): TestRunComputation {
  const results: TestFieldResult[] = [];
  for (const fm of fieldMaps) {
    if (fm.status === "retired") continue;
    const label = fm.fieldLabel?.trim() || fm.selector;
    const token = fm.token?.trim() ? fm.token.trim() : null;
    let reason: TestFieldReason;
    if (!token) {
      reason = "unmapped";
    } else {
      const value = resolvedTokens[token];
      reason = value && value.trim() ? "filled" : "empty_token";
    }
    results.push({ selector: fm.selector, label, token, reason });
  }
  const fieldsFilled = results.filter((r) => r.reason === "filled").length;
  const fieldsSkipped: FillSkippedField[] = results
    .filter(
      (r): r is TestFieldResult & { reason: "unmapped" | "empty_token" } => r.reason !== "filled",
    )
    .map((r) => ({ selector: r.selector, label: r.label, reason: r.reason }));
  return { results, fieldsFilled, fieldsSkipped };
}

function isSkippedField(v: unknown): v is FillSkippedField {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.selector === "string" &&
    typeof o.label === "string" &&
    (o.reason === "unmapped" || o.reason === "empty_token")
  );
}

/** Lenient parser for a stored fill_sessions.fields_skipped jsonb — returns the
 * structured shape when it conforms, else null (legacy/opaque payloads). */
export function parseFillSkipped(raw: unknown): FillSkippedField[] | null {
  if (!Array.isArray(raw)) return null;
  const parsed = raw.filter(isSkippedField);
  return parsed.length > 0 ? parsed : null;
}

export interface TestFillSummary {
  filled: number;
  unmapped: FillSkippedField[];
  emptyToken: FillSkippedField[];
}

/** Reduce a fill session's counts + skipped list into the runner's display
 * summary (filled count + the two fix-list buckets). */
export function summarizeTestFill(
  fieldsFilled: number,
  fieldsSkipped: readonly FillSkippedField[] | null,
): TestFillSummary {
  const skipped = fieldsSkipped ?? [];
  return {
    filled: fieldsFilled,
    unmapped: skipped.filter((f) => f.reason === "unmapped"),
    emptyToken: skipped.filter((f) => f.reason === "empty_token"),
  };
}
