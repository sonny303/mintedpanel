// Pure decisions behind the contract dialog: which "Covers" choice it offers
// (GCM-32, D13), the sentences that explain that choice, and which records a
// save writes, including "Also apply this status and these dates" to the
// payer's other states for the same group (GCM-27, D10). No I/O.
import {
  CONTRACT_SPECIALTY_LABELS,
  contractSpecialtyKeyOf,
  type ContractSpecialty,
  type ContractSpecialtyKey,
} from "@/lib/contractSpecialty";

/** How the dialog presents "Covers".
 * - `none`: opened with no specialty table (a legacy mount); no Covers row.
 * - `fixed`: a specialty's own record; Covers is read-only.
 * - `choice`: an all-specialties record seen from a specialty's table, or a new
 *   record; the operator picks All specialties or `<Specialty>` only. */
export type ContractCoversMode =
  | { kind: "none"; key: ContractSpecialtyKey }
  | { kind: "fixed"; key: ContractSpecialtyKey }
  | {
      kind: "choice";
      specialty: ContractSpecialty;
      initial: ContractSpecialtyKey;
      /** False when a new record could not become an `all` record because the
       * group already holds one for this payer and state. */
      allowAll: boolean;
      /** True when the record being edited is the shared `all` record. */
      shared: boolean;
    };

export function contractCoversMode(input: {
  specialty: ContractSpecialty | null | undefined;
  contract: { specialtyKey?: string | null } | null;
  /** The group already holds an `all` record for this payer and state. */
  allRecordExists: boolean;
}): ContractCoversMode {
  const { specialty, contract } = input;
  const recordKey = contract ? contractSpecialtyKeyOf(contract) : null;
  if (!specialty) return { kind: "none", key: recordKey ?? "all" };
  if (recordKey === "all") {
    return { kind: "choice", specialty, initial: "all", allowAll: true, shared: true };
  }
  if (recordKey) return { kind: "fixed", key: recordKey };
  // D13: a new record started from a specialty's table is that specialty only.
  return {
    kind: "choice",
    specialty,
    initial: specialty,
    allowAll: !input.allRecordExists,
    shared: false,
  };
}

/** "Physical therapy only", or "All specialties". */
export function contractCoversLabel(key: ContractSpecialtyKey): string {
  return key === "all" ? CONTRACT_SPECIALTY_LABELS.all : `${CONTRACT_SPECIALTY_LABELS[key]} only`;
}

function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** The sentence under the Covers choice for what is selected, or null when
 * nothing needs explaining. `sharedElsewhere` is the other specialty tables
 * that currently show the shared record (specialtiesShowingContract minus
 * this table), so the dialog never claims a table that does not show it. */
export function contractCoversExplanation(input: {
  mode: ContractCoversMode;
  selected: ContractSpecialtyKey;
  groupName: string;
  state: string;
  sharedElsewhere?: readonly ContractSpecialty[];
}): string | null {
  const { mode, selected, groupName, state } = input;
  if (mode.kind !== "choice") return null;
  const label = CONTRACT_SPECIALTY_LABELS[mode.specialty];
  const others = [...new Set(input.sharedElsewhere ?? [])]
    .filter((other) => other !== mode.specialty)
    .map((other) => CONTRACT_SPECIALTY_LABELS[other]);
  const othersText = joinLabels(others);
  const keep = others.length === 1 ? "keeps" : "keep";
  if (mode.shared && selected === "all") {
    if (others.length === 0) {
      return `This agreement covers every specialty of ${groupName} in ${state}. Saving changes it for every specialty.`;
    }
    const tables = others.length === 1 ? "table" : "tables";
    return `This agreement covers every specialty for ${groupName} in ${state}, so it also shows in the ${othersText} ${tables}. Saving changes it there too. Choose ${label} only to record ${label} separately; ${othersText} ${keep} this agreement.`;
  }
  if (mode.shared) {
    return `Saving creates a separate ${label} record with these details. ${
      others.length > 0
        ? `${othersText} ${keep} the shared agreement, unchanged.`
        : "The shared agreement stays unchanged."
    }`;
  }
  if (selected === "all") {
    return `Saving creates one agreement for every specialty of ${groupName} in ${state}. It shows in each specialty's table.`;
  }
  if (!mode.allowAll) {
    return `${groupName} already has an all-specialties agreement with this payer in ${state}, so this record covers ${label} only.`;
  }
  return null;
}

/** True when saving would split a shared record: "<Specialty> only" chosen on
 * the group's all-specialties record. The new record does not exist until the
 * save, so nothing (such as a contract SOP) can be attached to it before. */
export function contractSaveSplitsShared(
  mode: ContractCoversMode,
  selected: ContractSpecialtyKey,
): boolean {
  return mode.kind === "choice" && mode.shared && selected !== "all";
}

export interface ContractDraft {
  contractingStatusId: string | null;
  tentativeEffectiveDate: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  notes: string | null;
}

/** One upsert: the record at (group, payer, state, specialtyKey). Matches the
 * contracts service's input shape. */
export interface ContractSaveInput {
  groupId: string;
  payerId: string;
  state: string;
  specialtyKey: ContractSpecialtyKey;
  contractingStatusId: string | null;
  tentativeEffectiveDate: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  notes?: string | null;
}

export interface ContractSavePlan {
  primary: ContractSaveInput;
  /** One upsert per ticked state: the same status and dates, each its own
   * record with its own audit row and status history. Notes stay per record. */
  alsoApply: ContractSaveInput[];
}

/** What another state's cell in the same table shows now (GCM-27): this
 * specialty's own record, the group's shared all-specialties record, or no
 * record. */
export type AlsoApplyCellState = "own" | "shared" | "empty";

export interface AlsoApplyTarget {
  state: string;
  current: AlsoApplyCellState;
}

/** Which record "Also apply" writes in another state so that state's cell in
 * THIS table changes:
 * - own record → that record (the table's specialty);
 * - shared record → the shared record when Covers is All specialties, or a new
 *   record for the table's specialty when Covers is `<Specialty> only` (a
 *   split; the other tables keep the shared record);
 * - no record → the dialog's Covers choice.
 * With no table specialty (a legacy mount) every state takes Covers. */
export function alsoApplySpecialtyKey(
  target: AlsoApplyTarget,
  covers: ContractSpecialtyKey,
  tableSpecialty: ContractSpecialty | null | undefined,
): ContractSpecialtyKey {
  if (!tableSpecialty) return covers;
  if (target.current === "own") return tableSpecialty;
  if (target.current === "shared") return covers === "all" ? "all" : tableSpecialty;
  return covers;
}

/** True when "Also apply" would split that state's shared record. */
export function alsoApplySplitsShared(
  target: AlsoApplyTarget,
  covers: ContractSpecialtyKey,
  tableSpecialty: ContractSpecialty | null | undefined,
): boolean {
  return (
    Boolean(tableSpecialty) &&
    target.current === "shared" &&
    alsoApplySpecialtyKey(target, covers, tableSpecialty) !== "all"
  );
}

export function planContractSaves(input: {
  groupId: string;
  payerId: string;
  state: string;
  /** The dialog's Covers choice: the key of the record it saves. */
  specialtyKey: ContractSpecialtyKey;
  /** The specialty table the dialog was opened from, if any. */
  tableSpecialty?: ContractSpecialty | null;
  draft: ContractDraft;
  /** The ticked states, each with what its cell shows now. */
  alsoApply: readonly AlsoApplyTarget[];
}): ContractSavePlan {
  const { groupId, payerId, specialtyKey, draft } = input;
  const state = input.state.toUpperCase();
  const fields = {
    groupId,
    payerId,
    contractingStatusId: draft.contractingStatusId,
    tentativeEffectiveDate: draft.tentativeEffectiveDate,
    effectiveDate: draft.effectiveDate,
    expirationDate: draft.expirationDate,
  };
  const seen = new Set<string>([state]);
  const alsoApply: ContractSaveInput[] = [];
  for (const target of input.alsoApply) {
    const other = target.state.toUpperCase();
    if (seen.has(other)) continue;
    seen.add(other);
    alsoApply.push({
      ...fields,
      state: other,
      specialtyKey: alsoApplySpecialtyKey(target, specialtyKey, input.tableSpecialty),
    });
  }
  return {
    primary: { ...fields, state, specialtyKey, notes: draft.notes },
    alsoApply,
  };
}

/** "KS", "KS and MO", "KS, MO and NE". */
export function joinStates(states: readonly string[]): string {
  return joinLabels(states);
}
