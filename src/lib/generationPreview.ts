// E2.0 TE-5 — the case-generation preview combination computation as pure,
// unit-tested logic (the payerExpansion/enrollmentReadiness pattern): inputs
// are targets, group assignments, facility assignments, exclusions, and
// existing cases; output is typed preview rows with a human-readable
// derivation reason. No Supabase here, no clock reads — `today` is passed in.
//
// Candidacy ([r4-review] Q1, the buildable rule from the epic's Purpose ¶2):
// candidate = TE-4's membership universe (a provider whose
// provider_group_assignments row in the target's group is not end-dated
// before today — the exact E1.8 derivation) FURTHER FILTERED to providers
// holding at least one provider_facility_assignments row at a facility of
// the group. The facility filter is PRESENCE-BASED — that table has no
// end_date/status, and no "active" semantic is invented for it. Because the
// candidate set is a subset of the E1.8 readiness universe, every candidate
// key resolves in the readiness matrix.
//
// Existing-case matching (TE-6, the pre-E2.1 3-part reality): a NULL-group
// case (every legacy row) covers ALL candidate rows at its (provider, payer,
// state) regardless of group; a group-stamped case (post-E2.1) covers only
// its exact 4-part key. Suppression is STATUS-LINKED and derived live from
// the case's credentialing status on every run (Purpose ¶3) — nothing here
// stores anything, and nothing mutates append-only history.

import { canonicalLabel } from "@/lib/canonicalStatuses";
import { DENIED_LABEL } from "@/lib/statusLabels";
import type { CaseGenerationExclusionReason as ExclusionReason } from "@/types";

export type { CaseGenerationExclusionReason as ExclusionReason } from "@/types";

/** UI wording for the four exclusion reasons (F2.0.2). */
export const EXCLUSION_REASON_LABELS: Record<ExclusionReason, string> = {
  already_credentialed: "Already credentialed",
  panel_closed: "Panel closed",
  not_pursuing: "Not pursuing",
  other: "Other",
};

// ---------- inputs (assembled by services/hooks; no Supabase here) ----------

export interface GenerationTargetInput {
  groupId: string;
  payerId: string;
  state: string;
  status: "active" | "archived";
}

export interface GenerationGroupAssignmentInput {
  providerId: string | null;
  groupId: string | null;
  /** E1.3 end-date semantics — membership runs through the end date itself. */
  endDate?: string | null;
}

export interface GenerationFacilityAssignmentInput {
  providerId: string | null;
  facilityId: string | null;
}

export interface GenerationFacilityInput {
  id: string;
  groupId: string | null;
}

export interface GenerationProviderInput {
  providerId: string;
  providerName: string;
}

export interface GenerationLookupInput {
  id: string;
  name: string;
}

export interface GenerationExistingCaseInput {
  id: string;
  providerId: string;
  payerId: string;
  state: string;
  /** NULL for every legacy row until E2.1 adds the column (TE-6). */
  groupId: string | null;
  /** Resolved credentialing status label, null when status-less. */
  statusLabel: string | null;
  /** The status's action_bucket; null/status-less counts as open (TE-7). */
  actionBucket: string | null;
}

export interface GenerationExclusionInput {
  id: string;
  providerId: string;
  groupId: string;
  payerId: string;
  state: string;
  status: "active" | "voided";
  reason: ExclusionReason;
  note: string | null;
}

export interface GenerationPreviewInput {
  /** Date-only ISO string (YYYY-MM-DD); never read a clock inside. */
  today: string;
  targets: readonly GenerationTargetInput[];
  groupAssignments: readonly GenerationGroupAssignmentInput[];
  facilityAssignments: readonly GenerationFacilityAssignmentInput[];
  facilities: readonly GenerationFacilityInput[];
  /** Non-terminated roster (service pre-filters terminated providers). */
  providers: readonly GenerationProviderInput[];
  groups: readonly GenerationLookupInput[];
  payers: readonly GenerationLookupInput[];
  existingCases: readonly GenerationExistingCaseInput[];
  exclusions: readonly GenerationExclusionInput[];
}

// ---------- output ----------

export type PreviewDisposition = "proposed" | "existing" | "excluded";

export interface PreviewExistingCase {
  caseId: string;
  statusLabel: string | null;
  /** complete-bucket case (Denied/closed family) vs in-flight (TE-7). */
  complete: boolean;
}

export interface PreviewExclusion {
  exclusionId: string;
  reason: ExclusionReason;
  note: string | null;
}

export interface GenerationPreviewRow {
  providerId: string;
  groupId: string;
  payerId: string;
  state: string;
  providerName: string;
  groupName: string;
  payerName: string;
  disposition: PreviewDisposition;
  /** Human-readable derivation ("Jane works at a Group 1 clinic; Group 1
   * targets BCBS-NC in NC") — why the system proposed this key. */
  reason: string;
  existingCase: PreviewExistingCase | null;
  exclusion: PreviewExclusion | null;
}

/** The 4-part case key as a join string (readiness rows use the same key). */
export function previewRowKey(
  row: Pick<GenerationPreviewRow, "providerId" | "groupId" | "payerId" | "state">,
): string {
  return `${row.providerId}|${row.groupId}|${row.payerId}|${row.state}`;
}

// ---------- derivation ----------

/** Derive the full preview: every candidate provider × group × payer × state
 * exactly once, with its disposition. Delta runs are this same recomputation
 * over current inputs (TE-11) — nothing is stored at preview time. */
export function buildGenerationPreview(input: GenerationPreviewInput): GenerationPreviewRow[] {
  const providerById = new Map(input.providers.map((p) => [p.providerId, p]));
  const groupNameById = new Map(input.groups.map((g) => [g.id, g.name]));
  const payerNameById = new Map(input.payers.map((p) => [p.id, p.name]));

  // Members per group: un-ended provider_group_assignments (the E1.8 rule).
  const membersByGroup = new Map<string, Set<string>>();
  for (const a of input.groupAssignments) {
    if (!a.providerId || !a.groupId) continue;
    if (a.endDate != null && a.endDate.slice(0, 10) < input.today) continue;
    if (!membersByGroup.has(a.groupId)) membersByGroup.set(a.groupId, new Set());
    membersByGroup.get(a.groupId)?.add(a.providerId);
  }

  // Facility filter per group: providers with ≥1 provider_facility_assignments
  // row at a facility of the group (presence-based, [r4-review] Q1).
  const facilityGroupById = new Map(input.facilities.map((f) => [f.id, f.groupId]));
  const clinicProvidersByGroup = new Map<string, Set<string>>();
  for (const fa of input.facilityAssignments) {
    if (!fa.providerId || !fa.facilityId) continue;
    const groupId = facilityGroupById.get(fa.facilityId);
    if (!groupId) continue;
    if (!clinicProvidersByGroup.has(groupId)) clinicProvidersByGroup.set(groupId, new Set());
    clinicProvidersByGroup.get(groupId)?.add(fa.providerId);
  }

  // Existing-case indexes for the TE-6 two-branch match.
  const nullGroupCases = new Map<string, GenerationExistingCaseInput>();
  const groupedCases = new Map<string, GenerationExistingCaseInput>();
  for (const c of input.existingCases) {
    if (c.groupId === null) nullGroupCases.set(`${c.providerId}|${c.payerId}|${c.state}`, c);
    else groupedCases.set(`${c.providerId}|${c.groupId}|${c.payerId}|${c.state}`, c);
  }

  const activeExclusions = new Map<string, GenerationExclusionInput>();
  for (const x of input.exclusions) {
    if (x.status !== "active") continue; // voided rows never suppress (TE-2)
    activeExclusions.set(`${x.providerId}|${x.groupId}|${x.payerId}|${x.state}`, x);
  }

  const rows = new Map<string, GenerationPreviewRow>();
  for (const target of input.targets) {
    if (target.status !== "active") continue; // archived targets produce no rows
    const members = membersByGroup.get(target.groupId);
    const atClinic = clinicProvidersByGroup.get(target.groupId);
    if (!members || !atClinic) continue;

    for (const providerId of members) {
      if (!atClinic.has(providerId)) continue;
      const provider = providerById.get(providerId);
      if (!provider) continue; // terminated / unknown providers never produce rows

      const key = `${providerId}|${target.groupId}|${target.payerId}|${target.state}`;
      if (rows.has(key)) continue; // every valid combination appears exactly once

      const groupName = groupNameById.get(target.groupId) ?? "Unknown group";
      const payerName = payerNameById.get(target.payerId) ?? "Unknown payer";
      const existing =
        groupedCases.get(key) ??
        nullGroupCases.get(`${providerId}|${target.payerId}|${target.state}`) ??
        null;
      const exclusion = existing ? null : (activeExclusions.get(key) ?? null);

      rows.set(key, {
        providerId,
        groupId: target.groupId,
        payerId: target.payerId,
        state: target.state,
        providerName: provider.providerName,
        groupName,
        payerName,
        disposition: existing ? "existing" : exclusion ? "excluded" : "proposed",
        reason: `${provider.providerName} works at a ${groupName} clinic; ${groupName} targets ${payerName} in ${target.state}`,
        existingCase: existing
          ? {
              caseId: existing.id,
              statusLabel: existing.statusLabel,
              // Status-less cases count as open (the providerCases idiom).
              complete: existing.actionBucket === "complete",
            }
          : null,
        exclusion: exclusion
          ? { exclusionId: exclusion.id, reason: exclusion.reason, note: exclusion.note }
          : null,
      });
    }
  }

  return [...rows.values()].sort(
    (a, b) =>
      a.providerName.localeCompare(b.providerName) ||
      a.state.localeCompare(b.state) ||
      a.payerName.localeCompare(b.payerName) ||
      a.groupName.localeCompare(b.groupName),
  );
}

/** TE-7 + E2.1 F2.1.3 — the status-aware existing-case wording: in-flight
 * cases read "already exists — in progress"; complete-bucket AND denied cases
 * read "already exists" plus the status label and flag the reapply link
 * (Denied sits in action_bucket 'ours', not 'complete' — it is occupied, not
 * in flight, and reapplication continues on that case). */
export function existingCaseIndicator(existing: PreviewExistingCase): {
  label: string;
  reapply: boolean;
} {
  const denied =
    existing.statusLabel !== null && canonicalLabel(existing.statusLabel) === DENIED_LABEL;
  if (!existing.complete && !denied) {
    return { label: "already exists — in progress", reapply: false };
  }
  return {
    label: existing.statusLabel
      ? `already exists — ${existing.statusLabel}`
      : "already exists — closed",
    reapply: true,
  };
}

export interface GenerationPreviewSplit {
  /** Proposed (selectable) + existing (grayed) rows — the main checklist. */
  checklist: GenerationPreviewRow[];
  /** Actively excluded rows — the collapsible "excluded" section. */
  excluded: GenerationPreviewRow[];
}

export function splitGenerationPreview(
  rows: readonly GenerationPreviewRow[],
): GenerationPreviewSplit {
  return {
    checklist: rows.filter((r) => r.disposition !== "excluded"),
    excluded: rows.filter((r) => r.disposition === "excluded"),
  };
}

export interface GenerationPreviewSummary {
  candidates: number;
  proposed: number;
  existing: number;
  excluded: number;
}

export function generationPreviewSummary(
  rows: readonly GenerationPreviewRow[],
): GenerationPreviewSummary {
  return {
    candidates: rows.length,
    proposed: rows.filter((r) => r.disposition === "proposed").length,
    existing: rows.filter((r) => r.disposition === "existing").length,
    excluded: rows.filter((r) => r.disposition === "excluded").length,
  };
}
