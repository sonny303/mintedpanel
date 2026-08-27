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
// The dialog attaches MANY payers in one pass: the picker is a multi-select and
// the review stacks one state table per selected payer. That is a widening of
// the same per-payer logic, not a second rule — reviewAttachSelection maps each
// payer through groupAttachExpansion/reviewExpansion, and planMultiAttachSave
// maps each back through planAttachmentSave, so archive/restore semantics and
// the "already active is never re-written" rule hold identically per payer.
// Selection keys are payer-scoped (attachRowKey) because two payers can propose
// the same group×state row.
//
// The CSV path's row resolution + eligibility validation also live here (pure,
// tested); the import descriptor in src/lib/importSections.ts delegates to
// validatePayerAttachRow so the scan-time errors and the dialog's eligibility
// rule can never drift apart.
import {
  expansionRowKey,
  planAttachmentSave,
  reviewExpansion,
  type AttachmentSavePlan,
  type ExpansionReviewRow,
  type ExpansionRow,
} from "@/lib/payerExpansion";
import type { Facility, Payer, PayerNetworkTarget, ProviderGroup } from "@/types";

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
 * outright (the E4.2 governance rule — a successor is attached instead), and
 * so are ARCHIVED payers (E6.8 F6.8.1 — reactivate before attaching). */
export function splitAttachPicker(
  catalog: readonly Payer[],
  group: Pick<ProviderGroup, "states">,
): AttachPickerSplit {
  const eligible: EligiblePayerRow[] = [];
  const ineligible: Payer[] = [];
  for (const payer of catalog) {
    if (payer.status === "retired" || payer.status === "merged") continue;
    if (payer.archivedAt != null) continue;
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
// Multi-payer attach: one reviewable block per selected payer.
// ---------------------------------------------------------------------------

export interface PayerAttachReview {
  payer: Payer;
  /** The payer's proposed states, annotated against ITS OWN existing targets. */
  rows: ExpansionReviewRow[];
  /** Every proposed state already holds an active target — nothing to save. */
  fullyAttached: boolean;
}

/** A payer-scoped selection key: two payers can propose the same group×state. */
export function attachRowKey(
  payerId: string,
  row: Pick<ExpansionRow, "groupId" | "state">,
): string {
  return `${payerId}|${expansionRowKey(row)}`;
}

/**
 * Payers that already hold ≥1 ACTIVE target for this group. The attach dialog
 * opens with these pre-selected so the coordinator sees what is already on the
 * board and can add more (or finish a partial attach) in the same pass.
 */
export function alreadyAttachedPayerIds(
  existingTargets: readonly PayerNetworkTarget[],
  groupId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const target of existingTargets) {
    if (target.groupId === groupId && target.status === "active") ids.add(target.payerId);
  }
  return ids;
}

/**
 * Review a whole selection at once: one block per payer, name-sorted, each
 * built from the SAME per-payer expansion the single-payer flow used. Targets
 * are partitioned by payer first, so one payer's rows can never annotate
 * another's.
 */
export function reviewAttachSelection(
  payers: readonly Payer[],
  group: Pick<ProviderGroup, "id" | "states">,
  facilities: readonly Facility[],
  existingTargets: readonly PayerNetworkTarget[],
): PayerAttachReview[] {
  const byPayer = new Map<string, PayerNetworkTarget[]>();
  for (const target of existingTargets) {
    if (target.groupId !== group.id) continue;
    const list = byPayer.get(target.payerId);
    if (list) list.push(target);
    else byPayer.set(target.payerId, [target]);
  }
  return [...payers]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((payer) => {
      const rows = reviewExpansion(
        groupAttachExpansion(payer, group, facilities),
        byPayer.get(payer.id) ?? [],
      );
      return {
        payer,
        rows,
        fullyAttached: rows.length > 0 && rows.every((r) => r.existing === "active"),
      };
    });
}

/** The pre-checked keys for a fresh review (the per-row defaultChecked rule). */
export function defaultAttachSelection(reviews: readonly PayerAttachReview[]): Set<string> {
  const checked = new Set<string>();
  for (const review of reviews) {
    for (const row of review.rows) {
      if (row.defaultChecked) checked.add(attachRowKey(review.payer.id, row));
    }
  }
  return checked;
}

export interface PayerAttachPlan {
  payerId: string;
  plan: AttachmentSavePlan;
}

/** Turn the reviewed multi-payer selection into one save plan per payer.
 * Payers with nothing to write are dropped — the caller saves only real work. */
export function planMultiAttachSave(
  reviews: readonly PayerAttachReview[],
  checked: ReadonlySet<string>,
): PayerAttachPlan[] {
  const plans: PayerAttachPlan[] = [];
  for (const review of reviews) {
    // planAttachmentSave keys rows by group|state; re-scope the selection to
    // this payer so its own checks (and only its own) reach the plan.
    const scoped = new Set<string>();
    for (const row of review.rows) {
      if (checked.has(attachRowKey(review.payer.id, row))) scoped.add(expansionRowKey(row));
    }
    const plan = planAttachmentSave(review.rows, scoped);
    if (plan.inserts.length === 0 && plan.restoreIds.length === 0) continue;
    plans.push({ payerId: review.payer.id, plan });
  }
  return plans;
}

/** What the save button promises: how many payers and how many state rows. */
export function attachPlanTotals(plans: readonly PayerAttachPlan[]): {
  payerCount: number;
  stateCount: number;
} {
  return {
    payerCount: plans.length,
    stateCount: plans.reduce((n, p) => n + p.plan.inserts.length + p.plan.restoreIds.length, 0),
  };
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
  /** E6.8 F6.8.1 — archived payers fail the CSV eligibility check. Optional:
   * a context builder that doesn't thread it (the pre-E6.8 board mapping)
   * simply leaves the check inert until the UI slice adds the field. */
  archivedAt?: string | null;
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
  if (payer.archivedAt != null) {
    return {
      error: {
        column: "payer",
        reason: `${payer.name} is archived — reactivate it before attaching`,
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
