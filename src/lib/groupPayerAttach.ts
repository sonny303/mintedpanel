// E6.2 F6.2.4 — eligibility-filtered attach TO THE GROUP. The picker offers
// only catalog payers whose covered states intersect the GROUP'S OPERATING
// STATES (a deliberate change of basis from E1.5's facility-state expansion:
// selection-step eligibility is the group's footprint; facility counts stay a
// per-row "why" annotation). Proposed states per payer = payer states ∩ group
// operating states, always user-reviewed before save. The review/save plan
// REUSES src/lib/payerExpansion verbatim (reviewExpansion/planAttachmentSave)
// so archive/restore semantics are untouched: archived rows arrive
// pre-unchecked, restore is a status flip, never a duplicate insert.
//
// The CSV path's row resolution + eligibility validation also live here (pure,
// tested); the import descriptor in src/lib/importSections.ts delegates to
// validatePayerAttachRow so the scan-time errors and the dialog's eligibility
// rule can never drift apart.
import type { ExpansionRow } from "@/lib/payerExpansion";
import type { Facility, Payer, ProviderGroup } from "@/types";

/** States both the payer and the group operate in, sorted A→Z. */
export function proposedAttachStates(
  payer: Pick<Payer, "states">,
  group: Pick<ProviderGroup, "states">,
): string[] {
  const groupStates = new Set(group.states ?? []);
  return (payer.states ?? []).filter((s) => groupStates.has(s)).sort();
}

export interface EligiblePayerRow {
  payer: Payer;
  /** The non-empty payer ∩ group state overlap that makes it eligible. */
  overlap: string[];
}

export interface AttachPickerSplit {
  eligible: EligiblePayerRow[];
  /** Catalog payers with zero state overlap — named in the explainer, never
   * offered (F6.2.4: the picker never offers a zero-overlap payer). */
  ineligible: Payer[];
}

/** Split the ACTIVE catalog for one group. Retired/merged payers are excluded
 * outright (the E4.2 governance rule — a successor is attached instead). */
export function splitAttachPicker(
  catalog: readonly Payer[],
  group: Pick<ProviderGroup, "states">,
): AttachPickerSplit {
  const eligible: EligiblePayerRow[] = [];
  const ineligible: Payer[] = [];
  for (const payer of catalog) {
    if (payer.status === "retired" || payer.status === "merged") continue;
    const overlap = proposedAttachStates(payer, group);
    if (overlap.length > 0) eligible.push({ payer, overlap });
    else ineligible.push(payer);
  }
  eligible.sort((a, b) => a.payer.name.localeCompare(b.payer.name));
  ineligible.sort((a, b) => a.name.localeCompare(b.name));
  return { eligible, ineligible };
}

/**
 * The reviewable expansion for a group-basis attach: one row per proposed
 * state, carrying the group's active-facility count in that state as context
 * (0 is allowed — group-basis eligibility does not require a facility, unlike
 * E1.5's expansion). Shape-compatible with reviewExpansion/planAttachmentSave.
 */
export function groupAttachExpansion(
  payer: Pick<Payer, "states">,
  group: Pick<ProviderGroup, "id" | "states">,
  facilities: readonly Facility[],
): ExpansionRow[] {
  const counts = new Map<string, number>();
  for (const f of facilities) {
    if (!f.isActive || f.groupId !== group.id || !f.state) continue;
    counts.set(f.state, (counts.get(f.state) ?? 0) + 1);
  }
  return proposedAttachStates(payer, group).map((state) => ({
    groupId: group.id,
    state,
    facilityCount: counts.get(state) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// CSV row resolution + eligibility (the descriptor's context scan).
// ---------------------------------------------------------------------------

export interface AttachContextGroup {
  id: string;
  name: string;
  tin: string | null;
  states: string[] | null;
}

export interface AttachContextPayer {
  id: string;
  name: string;
  payerSlug?: string | null;
  aliases?: string[] | null;
  states?: string[] | null;
  status?: string | null;
}

export interface PayerAttachScanContext {
  groups: readonly AttachContextGroup[];
  payers: readonly AttachContextPayer[];
}

const bareTin = (tin: string): string => tin.replace(/-/g, "").trim();

/** Group resolution mirrors the facility import rule: TIN first, then a
 * case-insensitive name match. */
export function resolveAttachGroup(
  groups: readonly AttachContextGroup[],
  groupName: string | null,
  groupTin: string | null,
): AttachContextGroup | null {
  if (groupTin) {
    const wanted = bareTin(groupTin);
    const byTin = groups.find((g) => g.tin !== null && bareTin(g.tin) === wanted);
    if (byTin) return byTin;
  }
  if (groupName) {
    const wanted = groupName.trim().toLowerCase();
    const byName = groups.find((g) => g.name.trim().toLowerCase() === wanted);
    if (byName) return byName;
  }
  return null;
}

/** Payer resolution: canonical slug first, then name, then aliases — all
 * case-insensitive (the catalog's own identity order). */
export function resolveAttachPayer(
  payers: readonly AttachContextPayer[],
  text: string,
): AttachContextPayer | null {
  const wanted = text.trim().toLowerCase();
  if (!wanted) return null;
  return (
    payers.find((p) => (p.payerSlug ?? "").toLowerCase() === wanted) ??
    payers.find((p) => p.name.trim().toLowerCase() === wanted) ??
    payers.find((p) => (p.aliases ?? []).some((a) => a.trim().toLowerCase() === wanted)) ??
    null
  );
}

export type PayerAttachRowResult =
  | { ok: { groupId: string; payerId: string; states: string[] } }
  | { error: { column: string | null; reason: string } };

/**
 * Resolve + eligibility-validate one CSV row (F6.2.4 "same eligibility
 * validation at scan time"): the group and payer must resolve, the payer must
 * be attachable (not retired/merged), and every requested state must sit in
 * payer states ∩ group operating states — errors name the offending column and
 * the specific rule, per row.
 */
export function validatePayerAttachRow(
  row: { groupName: string | null; groupTin: string | null; payer: string; states: string[] },
  context: PayerAttachScanContext,
): PayerAttachRowResult {
  const group = resolveAttachGroup(context.groups, row.groupName, row.groupTin);
  if (!group) {
    return {
      error: {
        column: "group_name",
        reason: `No provider group matches ${row.groupTin ? `TIN "${row.groupTin}"` : `"${row.groupName ?? ""}"`}`,
      },
    };
  }
  const payer = resolveAttachPayer(context.payers, row.payer);
  if (!payer) {
    return {
      error: { column: "payer", reason: `No catalog payer matches "${row.payer}"` },
    };
  }
  if (payer.status === "retired" || payer.status === "merged") {
    return {
      error: {
        column: "payer",
        reason: `${payer.name} is ${payer.status} — attach its canonical successor instead`,
      },
    };
  }
  const payerStates = new Set(payer.states ?? []);
  const groupStates = new Set(group.states ?? []);
  for (const state of row.states) {
    if (!payerStates.has(state)) {
      return {
        error: { column: "states", reason: `${payer.name} does not cover ${state}` },
      };
    }
    if (!groupStates.has(state)) {
      return {
        error: {
          column: "states",
          reason: `${state} is not one of ${group.name}'s operating states`,
        },
      };
    }
  }
  if (row.states.length === 0) {
    return { error: { column: "states", reason: "states is required" } };
  }
  return { ok: { groupId: group.id, payerId: payer.id, states: row.states } };
}
