// Group Contracts Matrix — the pure derivation behind
// /reporting/contracts-matrix (spec "Group Contracts Matrix: Organization
// View", Oct 29, 2026). The component renders what this returns and derives
// nothing itself.
//
// Shape: one table per specialty (GCM-28), in MATRIX_SPECIALTIES order. A
// table's columns are (group, state) pairs and its rows are payers; a cell is
// the contract record that applies to that specialty at group × payer × state
// (the specialty's own record first, then the group's `all` record, tagged
// shared — resolveContractForSpecialty), an empty cell, or a cell outside the
// payer's service area.
//
// Columns (GCM-30, GCM-5): for each shown group, the states where at least one
// eligible member provider whose taxonomy maps to the specialty has a
// footprint (providerFootprint.ts — an active assigned clinic of that group in
// the state, or a license on file), plus the states where the group holds a
// record keyed to that specialty, plus columns the operator added this
// session. An `all` record that would show in no table (no column, or every
// column holds that specialty's own record for the payer) adds its column to
// each table without an own record, so no saved record is hidden.
//
// Rows (GCM-6, GCM-26): payers with an active network target in a group shown
// in the table, payers with a record that resolves into one of its columns,
// and payers the operator added this session — never the Pre-Credentialing
// sentinel, A–Z. A payer with no cell inside its service area and no record
// drops out of that table.
//
// No I/O and no clock reads: `today` is passed in (it only decides whether a
// group membership has ended).
import { canonicalLabel } from "@/lib/canonicalStatuses";
import {
  CONTRACT_SPECIALTY_KEYS,
  CONTRACT_SPECIALTY_LABELS,
  MATRIX_SPECIALTIES,
  contractSpecialtyForTaxonomy,
  contractSpecialtyKeyOf,
  contractTripleKey,
  indexContractsBySpecialty,
  resolveContractForSpecialty,
  type ContractSpecialty,
} from "@/lib/contractSpecialty";
import { fmtDate } from "@/lib/format";
import { resolveActiveGroupIds } from "@/lib/groupContractsMatrixSelection";
import {
  buildFootprintIndex,
  hasStateFootprint,
  type FootprintFacilityAssignmentInput,
  type FootprintFacilityInput,
  type FootprintLicenseInput,
} from "@/lib/providerFootprint";
import {
  APPLICATION_SUBMITTED_LABEL,
  CONTRACT_SIGNED_LABEL,
  DENIED_APPEALED_LABEL,
  DENIED_LABEL,
  DENIED_REAPPLIED_LABEL,
  IN_NETWORK_LABEL,
  NOT_STARTED_LABEL,
  OUT_OF_NETWORK_LABEL,
  PRE_CRED_PAYER_NAME,
} from "@/lib/statusLabels";
import type {
  ContractSpecialtyKey,
  ContractingStatusLabel,
  ProviderStatus,
  ProviderVerificationState,
} from "@/types";

// ---------- status display ----------

/** Tone key for a cell's status chip. `other` is a status outside the 8
 * governed contracting labels (or a record with no status set). */
export type ContractStatusTone =
  | "in-network"
  | "signed"
  | "submitted"
  | "appealed"
  | "reapplied"
  | "denied"
  | "out-of-network"
  | "not-started"
  | "other";

/** The cell's short label for each governed contracting status (GCM-7, D3).
 * The full label stays in the dialog and the cell's accessible label. */
export const CONTRACT_STATUS_SHORT_LABELS: Readonly<Record<ContractingStatusLabel, string>> = {
  [IN_NETWORK_LABEL]: "In network",
  [CONTRACT_SIGNED_LABEL]: "Signed",
  [APPLICATION_SUBMITTED_LABEL]: "Submitted",
  [DENIED_APPEALED_LABEL]: "Appealed",
  [DENIED_REAPPLIED_LABEL]: "Reapplied",
  [DENIED_LABEL]: "Denied",
  [OUT_OF_NETWORK_LABEL]: "Out of network",
  [NOT_STARTED_LABEL]: "Not started",
};

export const CONTRACT_STATUS_TONES: Readonly<Record<ContractingStatusLabel, ContractStatusTone>> = {
  [IN_NETWORK_LABEL]: "in-network",
  [CONTRACT_SIGNED_LABEL]: "signed",
  [APPLICATION_SUBMITTED_LABEL]: "submitted",
  [DENIED_APPEALED_LABEL]: "appealed",
  [DENIED_REAPPLIED_LABEL]: "reapplied",
  [DENIED_LABEL]: "denied",
  [OUT_OF_NETWORK_LABEL]: "out-of-network",
  [NOT_STARTED_LABEL]: "not-started",
};

/** Legend and Status-filter order (spec §6 cell legend). */
export const MATRIX_STATUS_ORDER: readonly ContractingStatusLabel[] = [
  IN_NETWORK_LABEL,
  CONTRACT_SIGNED_LABEL,
  APPLICATION_SUBMITTED_LABEL,
  DENIED_APPEALED_LABEL,
  DENIED_REAPPLIED_LABEL,
  DENIED_LABEL,
  OUT_OF_NETWORK_LABEL,
  NOT_STARTED_LABEL,
];

/** Text shown for a record that carries no status at all. */
export const NO_STATUS_TEXT = "No status";

export function isContractingStatusLabel(label: string): label is ContractingStatusLabel {
  return (MATRIX_STATUS_ORDER as readonly string[]).includes(label);
}

export interface ContractStatusDisplay {
  /** The status's full label as configured, or null when the record has none. */
  label: string | null;
  /** The governed label it matches (through canonicalLabel), if any. */
  canonical: ContractingStatusLabel | null;
  shortLabel: string;
  tone: ContractStatusTone;
}

/** Short label and tone for a status label. A label outside the 8 governed
 * ones (a legacy contracting status) shows in full with the `other` tone. */
export function contractStatusDisplay(label: string | null | undefined): ContractStatusDisplay {
  if (!label) {
    return { label: null, canonical: null, shortLabel: NO_STATUS_TEXT, tone: "other" };
  }
  const canonical = canonicalLabel(label);
  if (isContractingStatusLabel(canonical)) {
    return {
      label,
      canonical,
      shortLabel: CONTRACT_STATUS_SHORT_LABELS[canonical],
      tone: CONTRACT_STATUS_TONES[canonical],
    };
  }
  return { label, canonical: null, shortLabel: label, tone: "other" };
}

/** GCM-8: "Eff MMM d, yyyy" for In-Network with an effective date, otherwise
 * "Tent MMM d, yyyy" when a tentative date is set, otherwise nothing. */
export function contractDateLine(
  contract: { effectiveDate: string | null; tentativeEffectiveDate?: string | null },
  canonical: ContractingStatusLabel | null,
): string | null {
  const effective = canonical === IN_NETWORK_LABEL ? displayDate(contract.effectiveDate) : null;
  if (effective) return `Eff ${effective}`;
  const tentative = displayDate(contract.tentativeEffectiveDate);
  return tentative ? `Tent ${tentative}` : null;
}

function displayDate(value: string | null | undefined): string | null {
  const text = fmtDate(value);
  return text === "—" ? null : text;
}

// ---------- service area ----------

/** GCM-26: does the payer serve this state, per its catalog `states`? A payer
 * with no states on file has no area to shade, so it serves every state. The
 * cells, the row drop-out and the counts all go through this one function. */
export function payerServesState(
  payer: { states?: readonly string[] | null } | undefined,
  state: string,
): boolean {
  const states = payer?.states ?? [];
  if (states.length === 0) return true;
  const wanted = normState(state);
  return states.some((s) => normState(s) === wanted);
}

// ---------- input ----------

export interface ContractsMatrixGroupInput {
  id: string;
  name: string;
  tin: string | null;
  isActive: boolean;
}

export interface ContractsMatrixPayerInput {
  id: string;
  name: string;
  /** Catalog service states (`payers.states`). */
  states?: readonly string[] | null;
  /** Archived payers are not offered by "+ Add payer". */
  archivedAt?: string | null;
}

export interface ContractsMatrixContract {
  id: string;
  groupId: string | null;
  payerId: string | null;
  state: string;
  specialtyKey?: ContractSpecialtyKey | null;
  contractingStatusId: string | null;
  effectiveDate: string | null;
  tentativeEffectiveDate?: string | null;
  notes: string | null;
}

export interface ContractsMatrixTargetInput {
  groupId: string;
  payerId: string;
  state: string;
  status: "active" | "archived";
}

export interface ContractsMatrixStatusInput {
  id: string;
  label: string;
}

export interface ContractsMatrixProviderInput {
  id: string;
  taxonomyCode: string | null;
  /** Terminated providers add no columns. */
  status?: ProviderStatus;
  /** Providers still pending import verification add no columns. */
  verificationState?: ProviderVerificationState;
  /** The designated test provider adds no columns. */
  isTestProvider?: boolean;
}

export interface ContractsMatrixGroupAssignmentInput {
  providerId: string | null;
  groupId: string | null;
  /** A membership that ended before `today` adds no columns. */
  endDate?: string | null;
}

export interface ContractsMatrixInput<C extends ContractsMatrixContract> {
  /** Date-only ISO string (YYYY-MM-DD). Never read a clock inside. */
  today: string;
  groups: readonly ContractsMatrixGroupInput[];
  /** The whole global catalog. */
  payers: readonly ContractsMatrixPayerInput[];
  contracts: readonly C[];
  targets: readonly ContractsMatrixTargetInput[];
  /** Contracting status configs (`useStatusConfigs("contracting")`). */
  statuses: readonly ContractsMatrixStatusInput[];
  facilities: readonly FootprintFacilityInput[];
  facilityAssignments: readonly FootprintFacilityAssignmentInput[];
  licenses: readonly FootprintLicenseInput[];
  providers: readonly ContractsMatrixProviderInput[];
  groupAssignments: readonly ContractsMatrixGroupAssignmentInput[];
}

// ---------- options ----------

export type ContractsMatrixArrangement = "group" | "state";

/** The Status filter's "No record" choice (GCM-14). */
export const NO_RECORD_FILTER = "none";

/** One governed label, "No record", or null for every status. */
export type ContractsMatrixStatusFilter = ContractingStatusLabel | typeof NO_RECORD_FILTER | null;

/** A column added with "+ Add state" this session (GCM-33). */
export interface ContractsMatrixAddedColumn {
  specialty: ContractSpecialty;
  groupId: string;
  state: string;
}

export interface ContractsMatrixOptions {
  /** Specialty chips that are on; null/absent = every MATRIX_SPECIALTIES table. */
  specialties?: readonly ContractSpecialty[] | null;
  /** Groups filter; null/absent = the default (every active group). */
  selectedGroupIds?: readonly string[] | null;
  /** States filter; null/absent = every state. */
  selectedStates?: readonly string[] | null;
  statusFilter?: ContractsMatrixStatusFilter;
  payerSearch?: string;
  arrange?: ContractsMatrixArrangement;
  /** Payers added with "+ Add payer" this session (GCM-6). */
  addedPayerIds?: readonly string[];
  addedColumns?: readonly ContractsMatrixAddedColumn[];
  /** The deep link's group (GCM-20). While the Groups filter is untouched it
   * is added to the default selection, even when inactive; it never narrows. */
  contextGroupId?: string | null;
}

// ---------- output ----------

export interface ContractsMatrixGroup {
  id: string;
  name: string;
  tin: string | null;
  isActive: boolean;
  selected: boolean;
}

export interface ContractsMatrixColumn {
  /** `${groupId}|${state}` — see matrixColumnKey. */
  key: string;
  groupId: string;
  groupName: string;
  groupTin: string | null;
  state: string;
  /** Second header row: the state (By group) or the group name (By state). */
  headerLabel: string;
  /** First column of a top-header segment: draw the heavier divider before it. */
  segmentStart: boolean;
}

/** Top header row (GCM-2 By group, GCM-15 By state). Spans add up to the
 * column count, in column order. */
export type ContractsMatrixHeaderSegment =
  | {
      kind: "group";
      key: string;
      groupId: string;
      groupName: string;
      groupTin: string | null;
      span: number;
    }
  | { kind: "state"; key: string; state: string; groupCount: number; span: number };

interface ContractsMatrixCellBase {
  columnKey: string;
  groupId: string;
  payerId: string;
  state: string;
  /** GCM-23, e.g. "Payer 1, Nutrition, Group Name 2, MO: Application Submitted". */
  ariaLabel: string;
  /** A Status filter is on and this cell does not match it (GCM-14). */
  dimmed: boolean;
}

export interface ContractsMatrixRecordCell<C> extends ContractsMatrixCellBase {
  kind: "record";
  contract: C;
  /** The group's all-specialties record, shown with the "All" tag (GCM-31). */
  shared: boolean;
  /** Full status label, or null when the record has no status. */
  statusLabel: string | null;
  canonicalStatus: ContractingStatusLabel | null;
  shortLabel: string;
  tone: ContractStatusTone;
  dateLine: string | null;
  inNetwork: boolean;
  hasNote: boolean;
  note: string | null;
  /** The record sits in a state the catalog does not list for this payer. It
   * still shows (GCM-26); the UI may say so. */
  outsideArea: boolean;
}

export interface ContractsMatrixEmptyCell extends ContractsMatrixCellBase {
  kind: "empty";
}

/** Not in the plan's area: shaded, not clickable, out of the totals. */
export interface ContractsMatrixOutsideCell extends ContractsMatrixCellBase {
  kind: "outside";
}

export type ContractsMatrixCell<C> =
  ContractsMatrixRecordCell<C> | ContractsMatrixEmptyCell | ContractsMatrixOutsideCell;

export interface ContractsMatrixRow<C> {
  payerId: string;
  payerName: string;
  addedInSession: boolean;
  /** One cell per column, in column order. */
  cells: ContractsMatrixCell<C>[];
}

export interface ContractsMatrixTableCounts {
  groups: number;
  states: number;
  payers: number;
  records: number;
  inNetwork: number;
}

export interface ContractsMatrixTable<C> {
  specialty: ContractSpecialty;
  label: string;
  columns: ContractsMatrixColumn[];
  headerSegments: ContractsMatrixHeaderSegment[];
  rows: ContractsMatrixRow<C>[];
  counts: ContractsMatrixTableCounts;
}

export interface ContractsMatrixNote<C> {
  contract: C;
  specialtyKey: ContractSpecialtyKey;
  shared: boolean;
  payerName: string;
  /** "Physical therapy", or "All specialties" for a shared record. */
  specialtyLabel: string;
  groupName: string;
  state: string;
  /** "Payer 2 · Nutrition · Group Name 2 · KS" (GCM-34). */
  label: string;
  note: string;
}

export interface ContractsMatrixCounts {
  groups: number;
  specialties: number;
  states: number;
  payers: number;
  /** Each record once, even when an `all` record shows in two tables. */
  records: number;
  inNetwork: number;
}

export interface ContractsMatrix<C> {
  /** The Groups filter after defaulting (every active group). */
  selectedGroupIds: string[];
  /** Every group A–Z, for the Groups filter. */
  groupOptions: ContractsMatrixGroup[];
  /** Selected groups with no column in any specialty table (GCM-4 "Not
   * shown: …"). Independent of the Specialties and States filters. */
  groupsWithoutColumns: ContractsMatrixGroup[];
  /** States in the shown tables before the States filter (GCM-13). */
  stateOptions: string[];
  tables: ContractsMatrixTable<C>[];
  counts: ContractsMatrixCounts;
  notes: ContractsMatrixNote<C>[];
  /** Catalog payers "+ Add payer" can offer: not archived, not the sentinel,
   * and missing from a shown table where they serve at least one column. */
  addablePayers: { id: string; name: string }[];
  /** Records of selected groups that no specialty table can show: only a
   * record keyed to a specialty outside MATRIX_SPECIALTIES (ot, slp, chiro).
   * An `all` record always shows in some table unless every specialty table
   * holds its own record for that payer there (see supersededSharedRecords). */
  unplacedRecords: C[];
  /** `all` records of selected groups that no table shows because every
   * MATRIX_SPECIALTIES specialty has its own record at that group, payer and
   * state. They still decide readiness for providers of other specialties,
   * so the page names them. `label` is "Payer · Group · State"; sorted. */
  supersededSharedRecords: { contract: C; label: string }[];
}

export interface ContractsMatrixLink {
  groupId: string;
  payerId: string;
  state: string;
  /** The case's specialty, when known: that table is preferred. */
  specialty?: ContractSpecialty | null;
}

export interface ContractsMatrixCellLocation {
  specialty: ContractSpecialty;
  specialtyLabel: string;
  columnKey: string;
  groupId: string;
  groupName: string;
  payerId: string;
  payerName: string;
  state: string;
}

// ---------- helpers ----------

const UNKNOWN_PAYER_NAME = "Unknown payer";
const NO_RECORD_TEXT = "No contract record";
const OUTSIDE_AREA_TEXT = "Not in the plan's area";

function normState(state: string): string {
  return state.trim().toUpperCase();
}

export function matrixColumnKey(groupId: string, state: string): string {
  return `${groupId}|${normState(state)}`;
}

function byName<T extends { name: string; id: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function isEligibleProvider(provider: ContractsMatrixProviderInput): boolean {
  return (
    provider.status !== "terminated" &&
    provider.verificationState !== "pending_verification" &&
    provider.isTestProvider !== true
  );
}

function membershipCurrent(endDate: string | null | undefined, today: string): boolean {
  return endDate == null || endDate.slice(0, 10) >= today;
}

function addToSetMap<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const set = map.get(key) ?? new Set<V>();
  set.add(value);
  map.set(key, set);
}

/** specialty → groupId → states, before the States filter. */
type StructuralColumns = Map<ContractSpecialty, Map<string, Set<string>>>;

function structuralColumns<C extends ContractsMatrixContract>(
  input: ContractsMatrixInput<C>,
  selected: ReadonlySet<string>,
  addedColumns: readonly ContractsMatrixAddedColumn[],
): StructuralColumns {
  const out: StructuralColumns = new Map(
    MATRIX_SPECIALTIES.map((specialty) => [specialty, new Map<string, Set<string>>()]),
  );
  const add = (specialty: ContractSpecialtyKey | null, groupId: string, state: string) => {
    if (!specialty || specialty === "all") return;
    const byGroup = out.get(specialty);
    const code = normState(state);
    if (!byGroup || !code) return;
    addToSetMap(byGroup, groupId, code);
  };

  // (a) footprint of eligible member providers of that specialty.
  const footprint = buildFootprintIndex({
    facilities: input.facilities,
    facilityAssignments: input.facilityAssignments,
    licenses: input.licenses,
  });
  const specialtyByProvider = new Map<string, ContractSpecialty>();
  for (const provider of input.providers) {
    if (!isEligibleProvider(provider)) continue;
    const specialty = contractSpecialtyForTaxonomy(provider.taxonomyCode);
    if (specialty && MATRIX_SPECIALTIES.includes(specialty)) {
      specialtyByProvider.set(provider.id, specialty);
    }
  }
  const facilityStatesByGroup = new Map<string, Set<string>>();
  for (const facility of input.facilities) {
    const state = facility.state?.trim();
    if (facility.groupId && state) addToSetMap(facilityStatesByGroup, facility.groupId, state);
  }
  const licenseStatesByProvider = new Map<string, Set<string>>();
  for (const license of input.licenses) {
    const state = license.state.trim();
    if (license.providerId && state)
      addToSetMap(licenseStatesByProvider, license.providerId, state);
  }
  for (const membership of input.groupAssignments) {
    const { providerId, groupId } = membership;
    if (!providerId || !groupId || !selected.has(groupId)) continue;
    if (!membershipCurrent(membership.endDate, input.today)) continue;
    const specialty = specialtyByProvider.get(providerId);
    if (!specialty) continue;
    const candidates = new Set([
      ...(facilityStatesByGroup.get(groupId) ?? []),
      ...(licenseStatesByProvider.get(providerId) ?? []),
    ]);
    for (const state of candidates) {
      if (hasStateFootprint(footprint, providerId, groupId, state)) add(specialty, groupId, state);
    }
  }

  // (b) records keyed to the specialty (`all` records are step d).
  for (const contract of input.contracts) {
    if (!contract.groupId || !selected.has(contract.groupId)) continue;
    add(contractSpecialtyKeyOf(contract), contract.groupId, contract.state);
  }

  // (c) columns added this session.
  for (const column of addedColumns) {
    if (selected.has(column.groupId)) add(column.specialty, column.groupId, column.state);
  }

  // (d) an `all` record must show somewhere (GCM-5): it covers every
  // specialty, and a contract signed before the first clinician starts, or
  // one a specialty has split away from, must not vanish. It is visible in a
  // table that has its (group, state) column and no record of that table's
  // own specialty for the same payer there. When no table qualifies, its
  // column is added to every table without such an own record, where it then
  // shows as shared. Decided against every MATRIX_SPECIALTIES table (not the
  // Specialties chips, so a chip never changes the other tables) and against
  // the columns as they stand before this step (so record order is moot).
  const ownRecords = new Set<string>();
  for (const contract of input.contracts) {
    const key = contractSpecialtyKeyOf(contract);
    if (key !== "all") ownRecords.add(`${contractTripleKey(contract)}|${key}`);
  }
  const additions: { specialty: ContractSpecialty; groupId: string; state: string }[] = [];
  for (const contract of input.contracts) {
    const { groupId } = contract;
    if (!groupId || !selected.has(groupId)) continue;
    if (contractSpecialtyKeyOf(contract) !== "all") continue;
    const state = normState(contract.state);
    if (!state) continue;
    const triple = contractTripleKey(contract);
    const open = MATRIX_SPECIALTIES.filter(
      (specialty) => !ownRecords.has(`${triple}|${specialty}`),
    );
    const visible = open.some((specialty) => out.get(specialty)?.get(groupId)?.has(state));
    if (!visible) {
      for (const specialty of open) additions.push({ specialty, groupId, state });
    }
  }
  for (const { specialty, groupId, state } of additions) add(specialty, groupId, state);
  return out;
}

function arrangeColumns(
  groups: readonly ContractsMatrixGroupInput[],
  statesByGroup: ReadonlyMap<string, ReadonlySet<string>>,
  stateFilter: ReadonlySet<string> | null,
  arrange: ContractsMatrixArrangement,
): { columns: ContractsMatrixColumn[]; headerSegments: ContractsMatrixHeaderSegment[] } {
  const pairs: { group: ContractsMatrixGroupInput; state: string }[] = [];
  for (const group of groups) {
    for (const state of statesByGroup.get(group.id) ?? []) {
      if (!stateFilter || stateFilter.has(state)) pairs.push({ group, state });
    }
  }
  if (arrange === "state") {
    pairs.sort((a, b) => a.state.localeCompare(b.state) || byName(a.group, b.group));
  } else {
    pairs.sort((a, b) => byName(a.group, b.group) || a.state.localeCompare(b.state));
  }

  const columns: ContractsMatrixColumn[] = [];
  const headerSegments: ContractsMatrixHeaderSegment[] = [];
  for (const { group, state } of pairs) {
    const segmentKey = arrange === "state" ? state : group.id;
    const last = headerSegments[headerSegments.length - 1];
    const segmentStart = !last || last.key !== segmentKey;
    if (segmentStart) {
      headerSegments.push(
        arrange === "state"
          ? { kind: "state", key: state, state, groupCount: 1, span: 1 }
          : {
              kind: "group",
              key: group.id,
              groupId: group.id,
              groupName: group.name,
              groupTin: group.tin,
              span: 1,
            },
      );
    } else {
      last.span += 1;
      if (last.kind === "state") last.groupCount += 1;
    }
    columns.push({
      key: matrixColumnKey(group.id, state),
      groupId: group.id,
      groupName: group.name,
      groupTin: group.tin,
      state,
      headerLabel: arrange === "state" ? group.name : state,
      segmentStart,
    });
  }
  return { columns, headerSegments };
}

function cellMatchesFilter<C>(
  cell: ContractsMatrixCell<C>,
  filter: ContractsMatrixStatusFilter,
): boolean {
  if (filter === null) return true;
  if (filter === NO_RECORD_FILTER) return cell.kind === "empty";
  return cell.kind === "record" && cell.canonicalStatus === filter;
}

function countRecords<C extends ContractsMatrixContract>(
  rows: readonly ContractsMatrixRow<C>[],
  records: Map<string, ContractsMatrixRecordCell<C>>,
): void {
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.kind === "record" && !records.has(cell.contract.id)) {
        records.set(cell.contract.id, cell);
      }
    }
  }
}

const SPECIALTY_SORT: ReadonlyMap<ContractSpecialtyKey, number> = new Map(
  CONTRACT_SPECIALTY_KEYS.map((key, index) => [key, index]),
);

// ---------- the derivation ----------

export function buildContractsMatrix<C extends ContractsMatrixContract>(
  input: ContractsMatrixInput<C>,
  options: ContractsMatrixOptions = {},
): ContractsMatrix<C> {
  const arrange = options.arrange ?? "group";
  const statusFilter = options.statusFilter ?? null;
  const search = (options.payerSearch ?? "").trim().toLocaleLowerCase();
  const stateFilter = options.selectedStates
    ? new Set(options.selectedStates.map(normState))
    : null;
  const addedPayerIds = new Set(options.addedPayerIds ?? []);

  const sortedGroups = [...input.groups].sort(byName);
  const selectedGroupIds = resolveActiveGroupIds({
    groups: input.groups,
    selectedGroupIds: options.selectedGroupIds ?? null,
    includeGroupId: options.contextGroupId ?? null,
  });
  const selected = new Set(selectedGroupIds);
  const groupOptions: ContractsMatrixGroup[] = sortedGroups.map((group) => ({
    id: group.id,
    name: group.name,
    tin: group.tin,
    isActive: group.isActive,
    selected: selected.has(group.id),
  }));
  const selectedGroups = sortedGroups.filter((group) => selected.has(group.id));
  const groupById = new Map(input.groups.map((group) => [group.id, group]));
  const payerById = new Map(input.payers.map((payer) => [payer.id, payer]));
  const statusLabelById = new Map(input.statuses.map((status) => [status.id, status.label]));
  const contractIndex = indexContractsBySpecialty(input.contracts);

  const structural = structuralColumns(input, selected, options.addedColumns ?? []);

  const groupsWithoutColumns = groupOptions.filter(
    (group) =>
      group.selected &&
      MATRIX_SPECIALTIES.every(
        (specialty) => (structural.get(specialty)?.get(group.id)?.size ?? 0) === 0,
      ),
  );

  const shownSpecialties = MATRIX_SPECIALTIES.filter(
    (specialty) => !options.specialties || options.specialties.includes(specialty),
  );
  const stateOptions = new Set<string>();
  for (const specialty of shownSpecialties) {
    for (const states of structural.get(specialty)?.values() ?? []) {
      for (const state of states) stateOptions.add(state);
    }
  }

  const unplacedRecords = input.contracts.filter((contract) => {
    if (!contract.groupId || !selected.has(contract.groupId)) return false;
    const key = contractSpecialtyKeyOf(contract);
    return key !== "all" && !MATRIX_SPECIALTIES.includes(key);
  });

  const payerName = (payerId: string) => payerById.get(payerId)?.name ?? UNKNOWN_PAYER_NAME;
  const isSentinel = (payerId: string) => payerById.get(payerId)?.name === PRE_CRED_PAYER_NAME;

  const ownRecordKeys = new Set(
    input.contracts
      .filter((contract) => contractSpecialtyKeyOf(contract) !== "all")
      .map((contract) => `${contractTripleKey(contract)}|${contractSpecialtyKeyOf(contract)}`),
  );
  const groupNameById = new Map(input.groups.map((group) => [group.id, group.name]));
  const supersededSharedRecords = input.contracts
    .filter((contract) => {
      if (!contract.groupId || !contract.payerId || !selected.has(contract.groupId)) return false;
      if (contractSpecialtyKeyOf(contract) !== "all") return false;
      const triple = contractTripleKey(contract);
      return MATRIX_SPECIALTIES.every((specialty) => ownRecordKeys.has(`${triple}|${specialty}`));
    })
    .map((contract) => ({
      contract,
      label: `${payerName(contract.payerId ?? "")} · ${groupNameById.get(contract.groupId ?? "") ?? ""} · ${normState(contract.state)}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const tables: ContractsMatrixTable<C>[] = [];
  const addable = new Map<string, string>();
  for (const specialty of shownSpecialties) {
    const specialtyLabel = CONTRACT_SPECIALTY_LABELS[specialty];
    const { columns, headerSegments } = arrangeColumns(
      selectedGroups,
      structural.get(specialty) ?? new Map(),
      stateFilter,
      arrange,
    );
    if (columns.length === 0) continue;
    const columnKeys = new Set(columns.map((column) => column.key));
    const tableGroupIds = new Set(columns.map((column) => column.groupId));

    // Candidate payers: targets of a shown group, records in a shown column,
    // and session additions. Unknown payers come in only through a record.
    const candidates = new Set<string>();
    for (const target of input.targets) {
      if (target.status !== "active" || !tableGroupIds.has(target.groupId)) continue;
      if (payerById.has(target.payerId)) candidates.add(target.payerId);
    }
    for (const contract of input.contracts) {
      if (!contract.groupId || !contract.payerId) continue;
      const key = contractSpecialtyKeyOf(contract);
      if (key !== specialty && key !== "all") continue;
      if (columnKeys.has(matrixColumnKey(contract.groupId, contract.state))) {
        candidates.add(contract.payerId);
      }
    }
    for (const payerId of addedPayerIds) {
      if (payerById.has(payerId)) candidates.add(payerId);
    }

    const structuralRows: ContractsMatrixRow<C>[] = [];
    for (const payerId of candidates) {
      if (isSentinel(payerId)) continue;
      const payer = payerById.get(payerId);
      const name = payerName(payerId);
      const cells = columns.map((column): ContractsMatrixCell<C> => {
        const where = `${name}, ${specialtyLabel}, ${column.groupName}, ${column.state}`;
        const base = {
          columnKey: column.key,
          groupId: column.groupId,
          payerId,
          state: column.state,
          dimmed: false,
        };
        const serves = payerServesState(payer, column.state);
        const resolved = resolveContractForSpecialty(
          contractIndex,
          { groupId: column.groupId, payerId, state: column.state },
          specialty,
        );
        if (!resolved) {
          return serves
            ? { ...base, kind: "empty", ariaLabel: `${where}: ${NO_RECORD_TEXT}` }
            : { ...base, kind: "outside", ariaLabel: `${where}: ${OUTSIDE_AREA_TEXT}` };
        }
        const { contract, shared } = resolved;
        const status = contractStatusDisplay(
          contract.contractingStatusId ? statusLabelById.get(contract.contractingStatusId) : null,
        );
        const note = contract.notes?.trim() ? contract.notes.trim() : null;
        return {
          ...base,
          kind: "record",
          contract,
          shared,
          statusLabel: status.label,
          canonicalStatus: status.canonical,
          shortLabel: status.shortLabel,
          tone: status.tone,
          dateLine: contractDateLine(contract, status.canonical),
          inNetwork: status.canonical === IN_NETWORK_LABEL,
          hasNote: note !== null,
          note,
          outsideArea: !serves,
          ariaLabel: `${where}: ${status.label ?? NO_STATUS_TEXT}${shared ? ` (${CONTRACT_SPECIALTY_LABELS.all})` : ""}`,
        };
      });
      // GCM-26: no open cell and no record in this table → the payer drops out.
      if (cells.every((cell) => cell.kind === "outside")) continue;
      structuralRows.push({
        payerId,
        payerName: name,
        addedInSession: addedPayerIds.has(payerId),
        cells,
      });
    }

    const inTable = new Set(structuralRows.map((row) => row.payerId));
    const columnStates = [...new Set(columns.map((column) => column.state))];
    for (const payer of input.payers) {
      if (inTable.has(payer.id) || payer.archivedAt != null) continue;
      if (payer.name === PRE_CRED_PAYER_NAME) continue;
      if (columnStates.some((state) => payerServesState(payer, state))) {
        addable.set(payer.id, payer.name);
      }
    }

    const rows: ContractsMatrixRow<C>[] = [];
    for (const row of structuralRows) {
      if (search && !row.payerName.toLocaleLowerCase().includes(search)) continue;
      if (statusFilter === null) {
        rows.push(row);
        continue;
      }
      const cells = row.cells.map((cell) => ({
        ...cell,
        dimmed: !cellMatchesFilter(cell, statusFilter),
      }));
      if (cells.some((cell) => !cell.dimmed)) rows.push({ ...row, cells });
    }
    rows.sort(
      (a, b) => a.payerName.localeCompare(b.payerName) || a.payerId.localeCompare(b.payerId),
    );

    const tableRecords = new Map<string, ContractsMatrixRecordCell<C>>();
    countRecords(rows, tableRecords);
    tables.push({
      specialty,
      label: specialtyLabel,
      columns,
      headerSegments,
      rows,
      counts: {
        groups: tableGroupIds.size,
        states: columnStates.length,
        payers: rows.length,
        records: tableRecords.size,
        inNetwork: [...tableRecords.values()].filter((cell) => cell.inNetwork).length,
      },
    });
  }

  // Page-level counts and notes: each record once across tables (GCM-36).
  const records = new Map<string, ContractsMatrixRecordCell<C>>();
  const shownGroupIds = new Set<string>();
  const shownStates = new Set<string>();
  const shownPayerIds = new Set<string>();
  for (const table of tables) {
    for (const column of table.columns) {
      shownGroupIds.add(column.groupId);
      shownStates.add(column.state);
    }
    for (const row of table.rows) shownPayerIds.add(row.payerId);
    countRecords(table.rows, records);
  }

  const notes: ContractsMatrixNote<C>[] = [];
  for (const cell of records.values()) {
    if (!cell.note) continue;
    const specialtyKey = contractSpecialtyKeyOf(cell.contract);
    const name = payerName(cell.payerId);
    const specialtyLabel = CONTRACT_SPECIALTY_LABELS[specialtyKey];
    const groupName = groupById.get(cell.groupId)?.name ?? "";
    notes.push({
      contract: cell.contract,
      specialtyKey,
      shared: cell.shared,
      payerName: name,
      specialtyLabel,
      groupName,
      state: cell.state,
      label: [name, specialtyLabel, groupName, cell.state].join(" · "),
      note: cell.note,
    });
  }
  notes.sort(
    (a, b) =>
      a.payerName.localeCompare(b.payerName) ||
      (SPECIALTY_SORT.get(a.specialtyKey) ?? 0) - (SPECIALTY_SORT.get(b.specialtyKey) ?? 0) ||
      a.groupName.localeCompare(b.groupName) ||
      a.state.localeCompare(b.state) ||
      a.contract.id.localeCompare(b.contract.id),
  );

  return {
    selectedGroupIds,
    groupOptions,
    groupsWithoutColumns,
    stateOptions: [...stateOptions].sort(),
    tables,
    counts: {
      groups: shownGroupIds.size,
      specialties: tables.length,
      states: shownStates.size,
      payers: shownPayerIds.size,
      records: records.size,
      inNetwork: [...records.values()].filter((cell) => cell.inNetwork).length,
    },
    notes,
    addablePayers: [...addable].map(([id, name]) => ({ id, name })).sort(byName),
    unplacedRecords,
    supersededSharedRecords,
  };
}

/** GCM-20: where a case deep link (`?groupId&payerId&state`) lands. When the
 * case's specialty is given and its table holds both the column and the
 * payer's row, that table's cell; otherwise the first table (in
 * MATRIX_SPECIALTIES order) holding both. Null when no shown table has both. */
export function locateMatrixCell<C>(
  matrix: Pick<ContractsMatrix<C>, "tables">,
  target: ContractsMatrixLink,
): ContractsMatrixCellLocation | null {
  if (!target.groupId || !target.payerId || !target.state) return null;
  const columnKey = matrixColumnKey(target.groupId, target.state);
  const locate = (table: ContractsMatrixTable<C>): ContractsMatrixCellLocation | null => {
    const column = table.columns.find((candidate) => candidate.key === columnKey);
    const row = table.rows.find((candidate) => candidate.payerId === target.payerId);
    if (!column || !row) return null;
    return {
      specialty: table.specialty,
      specialtyLabel: table.label,
      columnKey,
      groupId: column.groupId,
      groupName: column.groupName,
      payerId: row.payerId,
      payerName: row.payerName,
      state: column.state,
    };
  };
  const preferred = target.specialty
    ? matrix.tables.find((table) => table.specialty === target.specialty)
    : undefined;
  const exact = preferred ? locate(preferred) : null;
  if (exact) return exact;
  for (const table of matrix.tables) {
    const found = locate(table);
    if (found) return found;
  }
  return null;
}

/** The specialties whose table currently shows this record in some cell, in
 * table order — what the dialog names when it says where a shared record
 * appears. Follows every filter, since it reads the derived tables. */
export function specialtiesShowingContract<C extends ContractsMatrixContract>(
  matrix: ContractsMatrix<C>,
  contractId: string,
): ContractSpecialty[] {
  return matrix.tables
    .filter((table) =>
      table.rows.some((row) =>
        row.cells.some((cell) => cell.kind === "record" && cell.contract.id === contractId),
      ),
    )
    .map((table) => table.specialty);
}
