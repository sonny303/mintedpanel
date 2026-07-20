// E6.6 F6.6.3 — display assembly + CSV for the denials rollup report. The
// DERIVATION lives in caseRollups.ts (`buildDenialRows` — standing +
// reapplied cycle states from case statuses + denial history entries, the
// same source the provider record's Cases panel reads, so the two agree by
// construction). This module only decorates rows with display names and
// serializes the CSV (touchesExport idiom). Pure, no I/O.
import { caseStatusLabel } from "./caseStatus";
import type { DenialRow } from "./caseRollups";
import type { CsvCell } from "./csv";
import { toCsv } from "./csv";

export interface DenialReportRow extends DenialRow {
  providerName: string;
  payerName: string;
}

/** Attach display names; unknown ids render honestly as "Unknown". Sorted by
 * provider name (the default provider-first read), then payer name, state. */
export function decorateDenialRows(
  rows: readonly DenialRow[],
  providerNameById: ReadonlyMap<string, string>,
  payerNameById: ReadonlyMap<string, string>,
): DenialReportRow[] {
  return rows
    .map((row) => ({
      ...row,
      providerName: providerNameById.get(row.providerId) ?? "Unknown provider",
      payerName: payerNameById.get(row.payerId) ?? "Unknown payer",
    }))
    .sort(
      (a, b) =>
        a.providerName.localeCompare(b.providerName) ||
        a.payerName.localeCompare(b.payerName) ||
        a.state.localeCompare(b.state) ||
        a.caseId.localeCompare(b.caseId),
    );
}

/** The cycle-state cell: "Standing" for a still-Denied case; a reapplied one
 * names where it went ("Reapplied — now Approved"). */
export function cycleStateLabel(row: Pick<DenialRow, "cycleState" | "currentStatus">): string {
  if (row.cycleState === "standing") return "Standing";
  return `Reapplied — now ${caseStatusLabel(row.currentStatus)}`;
}

export const DENIALS_CSV_HEADERS: readonly string[] = [
  "Provider",
  "Payer",
  "State",
  "Reason",
  "Denied on",
  "Cycle",
  "Case id",
];

export function buildDenialsCsvRows(rows: readonly DenialReportRow[]): CsvCell[][] {
  const out: CsvCell[][] = [[...DENIALS_CSV_HEADERS]];
  for (const row of rows) {
    out.push([
      row.providerName,
      row.payerName,
      row.state,
      row.reasonLabel ?? "",
      row.deniedAt ?? "",
      cycleStateLabel(row),
      row.caseId,
    ]);
  }
  return out;
}

export function buildDenialsCsv(rows: readonly DenialReportRow[]): string {
  return toCsv(buildDenialsCsvRows(rows));
}
