// E4.1 Compliance & Retention: CSV export of the touchlog. Reuses the existing
// CSV machinery (src/lib/csv.ts) and carries type / outcome / recipient /
// source / dates / actor. Pure so it is unit-testable; the caller resolves
// coordinator ids to display names (the org-scoped touches it is given are
// already RLS-bounded to the active org).
import type { Touch } from "@/types";
import { toCsv, type CsvCell } from "@/lib/csv";
import { touchTypeLabel } from "@/lib/touchTypes";
import { outcomeLabel } from "@/lib/touchOutcomes";

export const TOUCH_EXPORT_HEADERS: readonly string[] = [
  "Date",
  "Logged at",
  "Entry type",
  "Type",
  "Outcome",
  "Recipient name",
  "Recipient contact",
  "Source",
  "Actor",
  "Notes",
  "Follow-up date",
  "Clears follow-up",
  "Corrects touch id",
  "Touch id",
];

export function buildTouchesCsvRows(
  touches: Touch[],
  authorNameFor: (coordinatorId: string | null) => string,
): CsvCell[][] {
  const rows: CsvCell[][] = [[...TOUCH_EXPORT_HEADERS]];
  for (const t of touches) {
    rows.push([
      t.touchDate,
      t.createdAt,
      t.entryType,
      t.touchType ? touchTypeLabel(t.touchType) : "",
      t.outcome ? outcomeLabel(t.outcome) : "",
      t.recipientName ?? "",
      t.recipientContact ?? "",
      t.source,
      authorNameFor(t.coordinatorId),
      t.notes ?? "",
      t.nextFollowUpDate ?? "",
      t.clearsFollowUp ? "yes" : "",
      t.correctsTouchId ?? "",
      t.id,
    ]);
  }
  return rows;
}

export function buildTouchesCsv(
  touches: Touch[],
  authorNameFor: (coordinatorId: string | null) => string,
): string {
  return toCsv(buildTouchesCsvRows(touches, authorNameFor));
}
