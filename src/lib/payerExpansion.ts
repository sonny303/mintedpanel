// E1.5 TE-3/TE-7 — the org-intent → group×state expansion as pure logic.
// A group is targeted in a state where it has ≥1 ACTIVE facility AND the
// payer operates in that state (E1.6 states[] metadata). The reviewable
// expansion is how the user keeps row-level control without thinking in
// rows; "new expansion available" is DERIVED by re-running this against
// current facilities and diffing versus existing targets — never a stored
// dirty flag (the E1.0 derived-progress rule).
import type { Facility, PayerNetworkTarget, ProviderGroup } from "@/types";

export interface ExpansionRow {
  groupId: string;
  state: string;
  /** Why this row exists: how many active facilities the group has in state. */
  facilityCount: number;
}

/** Derive the full expansion for one payer: active groups × the states where
 * they have active facilities, intersected with the payer's states[]. */
export function expandTargets(
  payerStates: readonly string[] | null | undefined,
  groups: readonly ProviderGroup[],
  facilities: readonly Facility[],
): ExpansionRow[] {
  const operating = new Set(payerStates ?? []);
  const rows: ExpansionRow[] = [];
  for (const group of groups) {
    if (!group.isActive) continue;
    const counts = new Map<string, number>();
    for (const f of facilities) {
      if (!f.isActive || f.groupId !== group.id || !f.state) continue;
      counts.set(f.state, (counts.get(f.state) ?? 0) + 1);
    }
    for (const [state, facilityCount] of counts) {
      if (operating.has(state)) rows.push({ groupId: group.id, state, facilityCount });
    }
  }
  return rows.sort((a, b) => a.groupId.localeCompare(b.groupId) || a.state.localeCompare(b.state));
}

export type ExistingTargetState = "none" | "active" | "archived";

export interface ExpansionReviewRow extends ExpansionRow {
  existing: ExistingTargetState;
  /** The existing target row id when one exists (for restore). */
  targetId: string | null;
  /** Default review selection: new rows checked; previously archived rows
   * PRE-UNCHECKED (F1.5.3 — an archive is a deliberate exception until the
   * reviewer says otherwise); already-active rows stay attached. */
  defaultChecked: boolean;
}

/** Annotate the expansion against the payer's existing targets for review. */
export function reviewExpansion(
  expansion: readonly ExpansionRow[],
  existingTargets: readonly PayerNetworkTarget[],
): ExpansionReviewRow[] {
  const byKey = new Map(existingTargets.map((t) => [`${t.groupId}|${t.state}`, t]));
  return expansion.map((row) => {
    const match = byKey.get(`${row.groupId}|${row.state}`);
    const existing: ExistingTargetState =
      match === undefined ? "none" : match.status === "active" ? "active" : "archived";
    return {
      ...row,
      existing,
      targetId: match?.id ?? null,
      defaultChecked: existing === "none",
    };
  });
}

/** TE-7: the derived "new expansion available" rows for a payer — expansion
 * rows with NO existing target (active or archived). Empty = nothing new. */
export function newExpansionRows(
  expansion: readonly ExpansionRow[],
  existingTargets: readonly PayerNetworkTarget[],
): ExpansionRow[] {
  const seen = new Set(existingTargets.map((t) => `${t.groupId}|${t.state}`));
  return expansion.filter((row) => !seen.has(`${row.groupId}|${row.state}`));
}

export interface AttachmentSavePlan {
  /** Brand-new rows to insert as active. */
  inserts: Array<{ groupId: string; state: string }>;
  /** Previously archived target ids to flip back to active (restore — never
   * a duplicate insert under the (group, payer, state) unique key). */
  restoreIds: string[];
}

/** Turn the reviewed selection into a save plan. Unchecked rows are simply
 * excluded (the F1.5.2 exception); already-active rows are never re-written. */
export function planAttachmentSave(
  rows: readonly ExpansionReviewRow[],
  checked: ReadonlySet<string>,
): AttachmentSavePlan {
  const inserts: AttachmentSavePlan["inserts"] = [];
  const restoreIds: string[] = [];
  for (const row of rows) {
    if (!checked.has(expansionRowKey(row))) continue;
    if (row.existing === "none") inserts.push({ groupId: row.groupId, state: row.state });
    else if (row.existing === "archived" && row.targetId) restoreIds.push(row.targetId);
  }
  return { inserts, restoreIds };
}

export function expansionRowKey(row: Pick<ExpansionRow, "groupId" | "state">): string {
  return `${row.groupId}|${row.state}`;
}
