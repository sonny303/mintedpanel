// Generate cases: why an expected provider × payer × state is NOT a row
// (PM brief 2026-10-27, "nothing disappears silently"). Pure, like the
// preview it explains: it never changes candidacy (buildGenerationPreview
// stays the one derivation) and never reads a clock — `today` is passed in.
//
// Two consumers share ONE chain, so the page list and the lookup can never
// disagree about a key:
//   • buildGenerationBlockers — the page's "not on this list" section: the
//     drops buildGenerationSkips does not already name. Three kinds:
//       out_of_state  an active target × group member at a group clinic, with
//                     no clinic or license in the target state;
//       missing setup a payer the group already works with (≥1 active target,
//                     any state), in a state where a member has an active
//                     group clinic and the payer lists that state, but there
//                     is no active target (group_state / target_archived /
//                     no_target). A payer that does not list the state is not
//                     "expected" there and is left to the lookup — otherwise
//                     every state-specific Medicaid would flag every other
//                     clinic state;
//       payer_archived active targets of an archived payer, which the preview
//                     drops before candidacy.
//   • diagnoseGenerationKey — the "Why isn't it here?" lookup: walks the whole
//     chain for one exact key and names the FIRST missing link.
//
// A fix is data (which record to open), never a route — the component maps it
// to a Link, so this module stays router-free.

import { normalizeStateCode } from "@/lib/stateCode";
import {
  buildFootprintIndex,
  providerFootprintFor,
  type FootprintIndex,
} from "@/lib/providerFootprint";
import {
  EXCLUSION_REASON_LABELS,
  existingCaseIndicator,
  type GenerationFacilityAssignmentInput,
  type GenerationFacilityInput,
  type GenerationGroupAssignmentInput,
  type GenerationLicenseInput,
  type GenerationPreviewRow,
  type GenerationRosterProviderInput,
  type GenerationTargetInput,
} from "@/lib/generationPreview";

export type GenerationBlockReason =
  | "provider_inactive"
  | "pending_verification"
  | "not_in_group"
  | "payer_unavailable"
  | "payer_archived"
  | "payer_state"
  | "group_state"
  | "target_archived"
  | "no_target"
  | "no_facility"
  | "out_of_state";

/** Which record holds the fix. `payerSetup` is admin-only to change. */
export type GenerationFix =
  | { kind: "provider"; providerId: string }
  | { kind: "groupFacts"; groupId: string }
  | { kind: "groupPayers"; groupId: string }
  | { kind: "payerSetup"; payerId: string; tab: "overview" | "manage"; edit: boolean };

export interface GenerationBlock {
  reason: GenerationBlockReason;
  /** One plain sentence naming the missing link. */
  message: string;
  fixLabel: string;
  fix: GenerationFix;
}

export interface BlockerPayerInput {
  id: string;
  name: string;
  states?: readonly string[] | null;
  archivedAt?: string | null;
  /** Platform status; absent reads as active. */
  status?: string | null;
  mergedIntoId?: string | null;
}

export interface BlockerGroupInput {
  id: string;
  name: string;
  /** The group's operating states (provider_groups.states). */
  states?: readonly string[] | null;
}

export interface GenerationBlockerInput {
  /** Date-only ISO string (YYYY-MM-DD); never read a clock inside. */
  today: string;
  /** EVERY target row, any status, any payer (archived payers included). */
  targets: readonly GenerationTargetInput[];
  payers: readonly BlockerPayerInput[];
  groups: readonly BlockerGroupInput[];
  groupAssignments: readonly GenerationGroupAssignmentInput[];
  facilityAssignments: readonly GenerationFacilityAssignmentInput[];
  facilities: readonly GenerationFacilityInput[];
  licenses?: readonly GenerationLicenseInput[];
  roster: readonly GenerationRosterProviderInput[];
}

export interface GenerationKey {
  providerId: string;
  groupId: string;
  payerId: string;
  state: string;
}

/** Prebuilt lookups: build once per derivation, diagnose many keys. */
export interface GenerationBlockerIndex {
  rosterById: ReadonlyMap<string, GenerationRosterProviderInput>;
  payerById: ReadonlyMap<string, BlockerPayerInput>;
  groupById: ReadonlyMap<string, BlockerGroupInput>;
  /** groupId → current members. */
  membersByGroup: ReadonlyMap<string, ReadonlySet<string>>;
  /** groupId → providers with ≥1 facility assignment under the group. */
  atClinicByGroup: ReadonlyMap<string, ReadonlySet<string>>;
  /** `${groupId}|${payerId}|${state}` → "active" | "archived". */
  targetStatus: ReadonlyMap<string, "active" | "archived">;
  footprint: FootprintIndex;
  /** `${providerId}|${groupId}` → states with an ACTIVE group clinic. */
  clinicStates: ReadonlyMap<string, ReadonlySet<string>>;
}

export function buildBlockerIndex(input: GenerationBlockerInput): GenerationBlockerIndex {
  const membersByGroup = new Map<string, Set<string>>();
  for (const a of input.groupAssignments) {
    if (!a.providerId || !a.groupId) continue;
    if (a.endDate != null && a.endDate.slice(0, 10) < input.today) continue;
    if (!membersByGroup.has(a.groupId)) membersByGroup.set(a.groupId, new Set());
    membersByGroup.get(a.groupId)?.add(a.providerId);
  }

  // Same presence rule as the preview's candidacy filter (any facility of the
  // group, active or not), so no_facility here means exactly what it does there.
  const facilityGroupById = new Map(input.facilities.map((f) => [f.id, f.groupId]));
  const atClinicByGroup = new Map<string, Set<string>>();
  for (const fa of input.facilityAssignments) {
    if (!fa.providerId || !fa.facilityId) continue;
    const groupId = facilityGroupById.get(fa.facilityId);
    if (!groupId) continue;
    if (!atClinicByGroup.has(groupId)) atClinicByGroup.set(groupId, new Set());
    atClinicByGroup.get(groupId)?.add(fa.providerId);
  }

  // An active row wins over an archived one at the same key.
  const targetStatus = new Map<string, "active" | "archived">();
  for (const t of input.targets) {
    const key = `${t.groupId}|${t.payerId}|${t.state}`;
    if (targetStatus.get(key) === "active") continue;
    targetStatus.set(key, t.status);
  }

  const footprint = buildFootprintIndex({
    facilities: input.facilities,
    facilityAssignments: input.facilityAssignments,
    licenses: input.licenses,
  });

  return {
    rosterById: new Map(input.roster.map((p) => [p.providerId, p])),
    payerById: new Map(input.payers.map((p) => [p.id, p])),
    groupById: new Map(input.groups.map((g) => [g.id, g])),
    membersByGroup,
    atClinicByGroup,
    targetStatus,
    footprint,
    clinicStates: footprint.clinicStates,
  };
}

function listsState(states: readonly string[] | null | undefined, state: string): boolean {
  return (states ?? []).some((s) => normalizeStateCode(s) === state);
}

function payerName(index: GenerationBlockerIndex, payerId: string): string {
  return index.payerById.get(payerId)?.name ?? "This payer";
}

function groupName(index: GenerationBlockerIndex, groupId: string): string {
  return index.groupById.get(groupId)?.name ?? "This group";
}

function providerName(index: GenerationBlockerIndex, providerId: string): string {
  return index.rosterById.get(providerId)?.providerName ?? "This provider";
}

/** Why the payer generates nothing anywhere, or null when it can. */
function payerBlock(index: GenerationBlockerIndex, payerId: string): GenerationBlock | null {
  const payer = index.payerById.get(payerId);
  const name = payerName(index, payerId);
  const status = payer?.status ?? "active";
  if (!payer || status === "retired" || status === "merged" || payer.mergedIntoId) {
    const successor = payer?.mergedIntoId ? index.payerById.get(payer.mergedIntoId) : undefined;
    return {
      reason: "payer_unavailable",
      message: successor
        ? `${name} was merged into ${successor.name}. Work continues on ${successor.name}.`
        : `${name} is retired from the payer catalog.`,
      fixLabel: successor ? `Open ${successor.name}` : "Open payer",
      fix: {
        kind: "payerSetup",
        payerId: successor?.id ?? payerId,
        tab: "overview",
        edit: false,
      },
    };
  }
  if (payer.archivedAt != null) {
    return {
      reason: "payer_archived",
      message: `${name} is archived, so it generates no cases.`,
      fixLabel: "Reactivate payer",
      fix: { kind: "payerSetup", payerId, tab: "manage", edit: false },
    };
  }
  return null;
}

/** Why (group, payer, state) has no active target, or null when it has one. */
function targetBlock(
  index: GenerationBlockerIndex,
  groupId: string,
  payerId: string,
  state: string,
): GenerationBlock | null {
  const status = index.targetStatus.get(`${groupId}|${payerId}|${state}`);
  if (status === "active") return null;
  const payer = index.payerById.get(payerId);
  const group = index.groupById.get(groupId);
  const pName = payerName(index, payerId);
  const gName = groupName(index, groupId);
  if (!listsState(payer?.states, state)) {
    return {
      reason: "payer_state",
      message: `${pName} doesn't list ${state} in its states.`,
      fixLabel: "Edit payer states",
      fix: { kind: "payerSetup", payerId, tab: "overview", edit: true },
    };
  }
  if (!listsState(group?.states, state)) {
    return {
      reason: "group_state",
      message: `${state} isn't one of ${gName}'s operating states, so ${pName} can't be attached there.`,
      fixLabel: "Edit operating states",
      fix: { kind: "groupFacts", groupId },
    };
  }
  if (status === "archived") {
    return {
      reason: "target_archived",
      message: `${gName}'s ${pName} target in ${state} is archived.`,
      fixLabel: "Restore in payer network",
      fix: { kind: "groupPayers", groupId },
    };
  }
  return {
    reason: "no_target",
    message: `${gName} isn't set up with ${pName} in ${state}.`,
    fixLabel: "Attach payer",
    fix: { kind: "groupPayers", groupId },
  };
}

function outOfStateBlock(
  index: GenerationBlockerIndex,
  providerId: string,
  state: string,
): GenerationBlock {
  return {
    reason: "out_of_state",
    message: `${providerName(index, providerId)} has no clinic or license in ${state}.`,
    fixLabel: "Add a clinic or license",
    fix: { kind: "provider", providerId },
  };
}

/**
 * Walk the whole candidacy chain for one exact key and return the FIRST
 * missing link, or null when the key reaches the preview (where its
 * disposition, template and profile gate take over). Order follows the
 * chain a coordinator fixes: provider → group membership → payer → the
 * group's setup → the provider's clinic → the state footprint.
 */
export function diagnoseGenerationKey(
  index: GenerationBlockerIndex,
  key: GenerationKey,
): GenerationBlock | null {
  const state = normalizeStateCode(key.state);
  const { providerId, groupId, payerId } = key;
  const roster = index.rosterById.get(providerId);
  const pName = providerName(index, providerId);
  const gName = groupName(index, groupId);

  if (!roster || !roster.skipEligible) {
    return {
      reason: "provider_inactive",
      message: `${pName} is terminated, reference-only, or the test provider, so nothing generates for them.`,
      fixLabel: "Open provider",
      fix: { kind: "provider", providerId },
    };
  }
  if (roster.pendingVerification) {
    return {
      reason: "pending_verification",
      message: `${pName} is pending verification and not yet eligible to generate.`,
      fixLabel: "Open provider",
      fix: { kind: "provider", providerId },
    };
  }
  if (!index.membersByGroup.get(groupId)?.has(providerId)) {
    return {
      reason: "not_in_group",
      message: `${pName} isn't a current member of ${gName}.`,
      fixLabel: "Open provider",
      fix: { kind: "provider", providerId },
    };
  }
  const payer = payerBlock(index, payerId);
  if (payer) return payer;
  const target = targetBlock(index, groupId, payerId, state);
  if (target) return target;
  if (!index.atClinicByGroup.get(groupId)?.has(providerId)) {
    return {
      reason: "no_facility",
      message: `${pName} has no clinic assignment under ${gName}.`,
      fixLabel: "Fix facility",
      fix: { kind: "provider", providerId },
    };
  }
  const footprint = providerFootprintFor(index.footprint, providerId, groupId, state);
  if (!footprint.clinic && !footprint.licensed) return outOfStateBlock(index, providerId, state);
  return null;
}

// ---------- the page list ----------

/** Out-of-state targets folded per provider × group: one fix, one line. */
export interface OutOfStateBlocker {
  key: string;
  providerId: string;
  providerName: string;
  groupId: string;
  groupName: string;
  /** Target states the provider has no clinic or license in, A→Z. */
  states: string[];
  /** Payers those targets name, A→Z. */
  payerNames: string[];
  /** Exact keys covered (scope filtering + counts). */
  keys: Array<GenerationKey & { payerName: string }>;
  block: GenerationBlock;
}

/** One missing setup link per group × payer × state, with who it affects. */
export interface SetupBlocker {
  key: string;
  groupId: string;
  groupName: string;
  payerId: string;
  payerName: string;
  state: string;
  providerIds: string[];
  providerNames: string[];
  block: GenerationBlock;
}

/** An archived payer's still-active targets, per group. */
export interface ArchivedPayerBlocker {
  key: string;
  groupId: string;
  groupName: string;
  payerId: string;
  payerName: string;
  states: string[];
  block: GenerationBlock;
}

export interface GenerationBlockers {
  outOfState: OutOfStateBlocker[];
  setup: SetupBlocker[];
  archivedPayers: ArchivedPayerBlocker[];
}

/** A provider who can be explained at all: on the roster, active, verified,
 * and at a clinic of the group — earlier drops are buildGenerationSkips' job. */
function explainable(index: GenerationBlockerIndex, providerId: string, groupId: string): boolean {
  const roster = index.rosterById.get(providerId);
  if (!roster || !roster.skipEligible || roster.pendingVerification) return false;
  return index.atClinicByGroup.get(groupId)?.has(providerId) === true;
}

export function buildGenerationBlockers(
  index: GenerationBlockerIndex,
  targets: readonly GenerationTargetInput[],
): GenerationBlockers {
  const outOfState = new Map<string, OutOfStateBlocker>();
  const setup = new Map<string, SetupBlocker>();
  const archived = new Map<string, ArchivedPayerBlocker>();
  // groupId → payers it works with somewhere (active target, live payer).
  const groupPayers = new Map<string, Set<string>>();

  for (const target of targets) {
    if (target.status !== "active") continue;
    const state = normalizeStateCode(target.state);
    const payer = payerBlock(index, target.payerId);
    if (payer?.reason === "payer_unavailable") continue;
    if (payer?.reason === "payer_archived") {
      const key = `${target.groupId}|${target.payerId}`;
      const entry = archived.get(key) ?? {
        key,
        groupId: target.groupId,
        groupName: groupName(index, target.groupId),
        payerId: target.payerId,
        payerName: payerName(index, target.payerId),
        states: [],
        block: payer,
      };
      if (!entry.states.includes(state)) entry.states.push(state);
      archived.set(key, entry);
      continue;
    }

    if (!groupPayers.has(target.groupId)) groupPayers.set(target.groupId, new Set());
    groupPayers.get(target.groupId)?.add(target.payerId);

    for (const providerId of index.membersByGroup.get(target.groupId) ?? []) {
      if (!explainable(index, providerId, target.groupId)) continue;
      const footprint = providerFootprintFor(index.footprint, providerId, target.groupId, state);
      if (footprint.clinic || footprint.licensed) continue;
      const key = `${providerId}|${target.groupId}`;
      const entry = outOfState.get(key) ?? {
        key,
        providerId,
        providerName: providerName(index, providerId),
        groupId: target.groupId,
        groupName: groupName(index, target.groupId),
        states: [],
        payerNames: [],
        keys: [],
        block: outOfStateBlock(index, providerId, state),
      };
      const pName = payerName(index, target.payerId);
      if (!entry.states.includes(state)) entry.states.push(state);
      if (!entry.payerNames.includes(pName)) entry.payerNames.push(pName);
      entry.keys.push({
        providerId,
        groupId: target.groupId,
        payerId: target.payerId,
        state,
        payerName: pName,
      });
      outOfState.set(key, entry);
    }
  }

  // Missing setup: the group's payers × the states its members have clinics in.
  for (const [groupId, payerIds] of groupPayers) {
    for (const providerId of index.membersByGroup.get(groupId) ?? []) {
      if (!explainable(index, providerId, groupId)) continue;
      for (const state of index.clinicStates.get(`${providerId}|${groupId}`) ?? []) {
        for (const payerId of payerIds) {
          const block = targetBlock(index, groupId, payerId, state);
          if (!block || block.reason === "payer_state") continue;
          const key = `${groupId}|${payerId}|${state}`;
          const entry = setup.get(key) ?? {
            key,
            groupId,
            groupName: groupName(index, groupId),
            payerId,
            payerName: payerName(index, payerId),
            state,
            providerIds: [],
            providerNames: [],
            block,
          };
          if (!entry.providerIds.includes(providerId)) {
            entry.providerIds.push(providerId);
            entry.providerNames.push(providerName(index, providerId));
          }
          setup.set(key, entry);
        }
      }
    }
  }

  for (const entry of outOfState.values()) {
    entry.states.sort();
    entry.payerNames.sort((a, b) => a.localeCompare(b));
    entry.block = {
      ...entry.block,
      message: `${entry.providerName} has no clinic or license in ${entry.states.join(", ")}.`,
    };
  }
  for (const entry of setup.values()) entry.providerNames.sort((a, b) => a.localeCompare(b));
  for (const entry of archived.values()) entry.states.sort();

  return {
    outOfState: [...outOfState.values()].sort(
      (a, b) =>
        a.providerName.localeCompare(b.providerName) || a.groupName.localeCompare(b.groupName),
    ),
    setup: [...setup.values()].sort(
      (a, b) =>
        a.groupName.localeCompare(b.groupName) ||
        a.payerName.localeCompare(b.payerName) ||
        a.state.localeCompare(b.state),
    ),
    archivedPayers: [...archived.values()].sort(
      (a, b) => a.payerName.localeCompare(b.payerName) || a.groupName.localeCompare(b.groupName),
    ),
  };
}

export interface BlockerScope {
  groupId?: string;
  payerId?: string;
  providerId?: string;
  /** Keeps only providers assigned to this facility (provider → facility map). */
  facilityId?: string;
}

/** Narrow the page list to the grid's scope (the same four filters). */
export function scopeGenerationBlockers(
  blockers: GenerationBlockers,
  scope: BlockerScope,
  providerFacilities?: ReadonlyMap<string, ReadonlySet<string>>,
): GenerationBlockers {
  const providerOk = (providerId: string) => {
    if (scope.providerId && providerId !== scope.providerId) return false;
    if (scope.facilityId && !providerFacilities?.get(providerId)?.has(scope.facilityId)) {
      return false;
    }
    return true;
  };
  const groupOk = (groupId: string) => !scope.groupId || groupId === scope.groupId;
  const payerOk = (payerId: string) => !scope.payerId || payerId === scope.payerId;
  const narrowProviders = !scope.providerId && !scope.facilityId;

  const outOfState = blockers.outOfState.flatMap((entry) => {
    if (!groupOk(entry.groupId) || !providerOk(entry.providerId)) return [];
    if (!scope.payerId) return [entry];
    const keys = entry.keys.filter((k) => k.payerId === scope.payerId);
    if (keys.length === 0) return [];
    const states = [...new Set(keys.map((k) => k.state))].sort();
    return [
      {
        ...entry,
        keys,
        states,
        payerNames: [...new Set(keys.map((k) => k.payerName))].sort((a, b) => a.localeCompare(b)),
        block: {
          ...entry.block,
          message: `${entry.providerName} has no clinic or license in ${states.join(", ")}.`,
        },
      },
    ];
  });

  const setup = blockers.setup.flatMap((entry) => {
    if (!groupOk(entry.groupId) || !payerOk(entry.payerId)) return [];
    if (narrowProviders) return [entry];
    const kept = entry.providerIds
      .map((id, i) => ({ id, name: entry.providerNames[i] ?? "" }))
      .filter((p) => providerOk(p.id));
    if (kept.length === 0) return [];
    return [
      { ...entry, providerIds: kept.map((p) => p.id), providerNames: kept.map((p) => p.name) },
    ];
  });

  const archivedPayers = blockers.archivedPayers.filter(
    (entry) => groupOk(entry.groupId) && payerOk(entry.payerId),
  );

  return { outOfState, setup, archivedPayers };
}

// ---------- the lookup's full verdict ----------

/** Everything the "Why isn't it here?" lookup can say about one exact key:
 * a pre-candidacy block, or what the preview did with the row. */
export type GenerationPairVerdict =
  | { kind: "blocked"; block: GenerationBlock }
  | { kind: "not_in_preview" }
  | { kind: "create" }
  | { kind: "existing"; caseId: string; label: string }
  | { kind: "excluded"; reasonLabel: string; note: string | null }
  | { kind: "enrolled" }
  | { kind: "no_template" }
  | { kind: "tied_templates" }
  | { kind: "missing_attributes"; labels: string[] };

export interface GenerationPairFacts {
  /** The preview row at this key, if candidacy produced one. */
  row: GenerationPreviewRow | undefined;
  /** A live enrollment fact covers the key. */
  enrolled: boolean;
  noTemplate: boolean;
  tiedTemplates: boolean;
  /** Unmet required profile attributes (empty = gate passed or no gate). */
  missingAttributes: readonly string[];
}

export function generationPairVerdict(
  index: GenerationBlockerIndex,
  key: GenerationKey,
  facts: GenerationPairFacts,
): GenerationPairVerdict {
  const block = diagnoseGenerationKey(index, key);
  if (block) return { kind: "blocked", block };
  const { row } = facts;
  // The chain passed but the preview holds no row: a source read changed
  // between the two. Say so instead of claiming either outcome.
  if (!row) return { kind: "not_in_preview" };
  if (row.disposition === "existing" && row.existingCase) {
    return {
      kind: "existing",
      caseId: row.existingCase.caseId,
      label: existingCaseIndicator(row.existingCase).label,
    };
  }
  if (row.disposition === "excluded" && row.exclusion) {
    return {
      kind: "excluded",
      reasonLabel: EXCLUSION_REASON_LABELS[row.exclusion.reason],
      note: row.exclusion.note,
    };
  }
  if (facts.enrolled) return { kind: "enrolled" };
  if (facts.noTemplate) return { kind: "no_template" };
  if (facts.tiedTemplates) return { kind: "tied_templates" };
  if (facts.missingAttributes.length > 0) {
    return { kind: "missing_attributes", labels: [...facts.missingAttributes] };
  }
  return { kind: "create" };
}

/** The groups a provider currently belongs to — the lookup asks per group. */
export function currentGroupsForProvider(
  index: GenerationBlockerIndex,
  providerId: string,
): BlockerGroupInput[] {
  const out: BlockerGroupInput[] = [];
  for (const [groupId, members] of index.membersByGroup) {
    if (!members.has(providerId)) continue;
    out.push(index.groupById.get(groupId) ?? { id: groupId, name: "Unknown group" });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
