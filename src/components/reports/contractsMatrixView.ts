// Display constants shared by the Group Contracts Matrix components. The
// derivation itself lives in src/lib/groupContractsMatrix.ts.
import type { StatusColor } from "@/components/StatusPill";
import type { ContractStatusTone } from "@/lib/groupContractsMatrix";

/** The matrix's tone keys on the shared status-pill tones. The token set has
 * no orange, so Appealed takes the teal "pending" tone (DESIGN-DEBT.md). A
 * status outside the 8 governed labels is neutral. */
export const CONTRACT_TONE_COLORS: Readonly<Record<ContractStatusTone, StatusColor>> = {
  "in-network": "green",
  signed: "amber",
  submitted: "blue",
  appealed: "teal",
  reapplied: "violet",
  denied: "red",
  "out-of-network": "gray",
  "not-started": "neutral",
  other: "neutral",
};

/** The DOM id of a cell, so a case deep link can scroll it into view. */
export function contractsMatrixCellDomId(
  specialty: string,
  columnKey: string,
  payerId: string,
): string {
  return `contracts-matrix-${specialty}-${columnKey}-${payerId}`.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** "1 group", "3 groups". */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
