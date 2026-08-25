// Cases Matrix foundation — pure section, row, column, cell, and urgency
// derivation for the read-only active-cases board. Provider drop-off is
// evaluated across the full case set: a provider leaves when no non-terminal
// case remains, matching handoff §9 test 2.
import { differenceInCalendarDays, parseISO } from "date-fns";
import { STALLED_AFTER_DAYS } from "./actionState";
import { CASE_STATUS_BUCKETS } from "./caseStatus";
import {
  EMPTY_FILTERS,
  matchesCaseFilter,
  matchesKpi,
  type CaseViewRow,
  type CasesFilters,
} from "./casesView";
import { isTestProvider, type HasTestProviderFlag } from "./testProvider";
import { US_STATE_NAMES } from "./usStates";
import type {
  CaseGenerationExclusion,
  CredentialCase,
  Payer,
  PayerNetworkTarget,
  Provider,
  ProviderGroup,
} from "@/types";

export type CasesMatrixProvider = Pick<
  Provider,
  "id" | "firstName" | "lastName" | "status" | "referenceOnly" | "verificationState"
> &
  HasTestProviderFlag;

export type CasesMatrixCase = Pick<
  CredentialCase,
  | "id"
  | "providerId"
  | "groupId"
  | "payerId"
  | "state"
  | "caseStatus"
  | "confirmedEffectiveDate"
  | "createdAt"
> & {
  caseNumber?: CredentialCase["caseNumber"];
};

export type CasesMatrixPayer = Pick<Payer, "id" | "name">;
export type CasesMatrixGroup = Pick<ProviderGroup, "id" | "name">;
export type CasesMatrixTarget = Pick<
  PayerNetworkTarget,
  "payerId" | "groupId" | "state" | "status"
>;
export type CasesMatrixExclusion = Pick<
  CaseGenerationExclusion,
  "providerId" | "groupId" | "payerId" | "state" | "reason" | "note" | "status"
>;

export interface CasesMatrixTask {
  caseId: string | null;
  status: string;
  dueDate: string | null;
}

export interface CasesMatrixFollowUp {
  touchDate: string;
}

export interface CasesMatrixInput {
  today: string;
  providers: readonly CasesMatrixProvider[];
  cases: readonly CasesMatrixCase[];
  payers: readonly CasesMatrixPayer[];
  groups: readonly CasesMatrixGroup[];
  targets: readonly CasesMatrixTarget[];
  tasks: readonly CasesMatrixTask[];
  followUps?: ReadonlyMap<string, CasesMatrixFollowUp>;
  exclusions: readonly CasesMatrixExclusion[];
  filters?: CasesFilters;
}

export interface CasesMatrixCaseCell {
  kind: "case";
  case: CasesMatrixCase;
  dimmed: boolean;
  hasOverdueTask: boolean;
  stale: "never" | "quiet" | null;
}

export interface CasesMatrixGapCell {
  kind: "gap";
  dimmed: false;
  isActiveTarget: boolean;
  generation: {
    providerId: string;
    payerId: string;
    groupId: string;
    state: string;
  };
}

export interface CasesMatrixExcludedCell {
  kind: "excluded";
  dimmed: false;
  reason: CasesMatrixExclusion["reason"];
  note: string | null;
}

export type CasesMatrixCell = CasesMatrixCaseCell | CasesMatrixGapCell | CasesMatrixExcludedCell;

export interface CasesMatrixColumn {
  payerId: string;
  payerName: string;
  isActiveTarget: boolean;
}

export interface CasesMatrixRow {
  providerId: string;
  providerName: string;
  cases: CasesMatrixCase[];
  cells: Record<string, CasesMatrixCell>;
}

export interface CasesMatrixSection {
  groupId: string;
  groupName: string;
  state: string;
  stateName: string;
  providerCount: number;
  openCaseCount: number;
  columns: CasesMatrixColumn[];
  rows: CasesMatrixRow[];
}

export interface CasesMatrix {
  sections: CasesMatrixSection[];
  eligibleProviderCount: number;
}

interface MatrixCaseViewRow extends CaseViewRow {
  matrixCase: CasesMatrixCase;
}

function caseKey(providerId: string, groupId: string, payerId: string, state: string): string {
  return `${providerId}|${groupId}|${payerId}|${state}`;
}

function legacyCaseKey(providerId: string, payerId: string, state: string): string {
  return `${providerId}|${payerId}|${state}`;
}

function providerName(provider: CasesMatrixProvider): string {
  return `${provider.firstName} ${provider.lastName}`.trim();
}

function toCaseViewRow(
  matrixCase: CasesMatrixCase,
  provider: CasesMatrixProvider,
  payerName: string,
): MatrixCaseViewRow {
  return {
    matrixCase,
    caseId: matrixCase.id,
    caseNumber: matrixCase.caseNumber ?? null,
    providerId: provider.id,
    providerName: providerName(provider),
    providerCredentials: null,
    payerId: matrixCase.payerId,
    payerName,
    isPreCred: false,
    state: matrixCase.state,
    caseStatus: matrixCase.caseStatus,
    confirmedEffectiveDate: matrixCase.confirmedEffectiveDate,
    lastTouchLabel: "—",
    lastTouchDays: null,
    daysOpen: 0,
    createdAt: matrixCase.createdAt,
  };
}

function activeExclusion(
  exclusions: readonly CasesMatrixExclusion[],
  providerId: string,
  groupId: string,
  payerId: string,
  state: string,
): CasesMatrixExclusion | undefined {
  return exclusions.find(
    (exclusion) =>
      exclusion.status === "active" &&
      exclusion.providerId === providerId &&
      exclusion.groupId === groupId &&
      exclusion.payerId === payerId &&
      exclusion.state === state,
  );
}

function urgencyFor(
  matrixCase: CasesMatrixCase,
  today: string,
  tasksByCase: ReadonlyMap<string, readonly CasesMatrixTask[]>,
  followUps: ReadonlyMap<string, CasesMatrixFollowUp>,
): Pick<CasesMatrixCaseCell, "hasOverdueTask" | "stale"> {
  const hasOverdueTask = (tasksByCase.get(matrixCase.id) ?? []).some(
    (task) =>
      task.status !== "completed" &&
      task.dueDate != null &&
      differenceInCalendarDays(parseISO(today), parseISO(task.dueDate)) >= 0,
  );
  const followUp = followUps.get(matrixCase.id);
  const anchor = followUp?.touchDate ?? matrixCase.createdAt;
  const isStale = differenceInCalendarDays(parseISO(today), parseISO(anchor)) >= STALLED_AFTER_DAYS;
  return {
    hasOverdueTask,
    stale: isStale ? (followUp ? "quiet" : "never") : null,
  };
}

function isEligibleProvider(provider: CasesMatrixProvider): boolean {
  return (
    provider.status !== "terminated" &&
    !provider.referenceOnly &&
    !isTestProvider(provider) &&
    provider.verificationState !== "pending_verification"
  );
}

function isOpenCase(matrixCase: CasesMatrixCase): boolean {
  return CASE_STATUS_BUCKETS[matrixCase.caseStatus] !== "complete";
}

function matrixFilters(filters: CasesFilters | undefined): CasesFilters {
  return filters ?? EMPTY_FILTERS;
}

function sectionKey(groupId: string, state: string): string {
  return `${groupId}|${state}`;
}

export function buildCasesMatrix(input: CasesMatrixInput): CasesMatrix {
  const filters = matrixFilters(input.filters);
  const providersById = new Map(input.providers.map((provider) => [provider.id, provider]));
  const payersById = new Map(input.payers.map((payer) => [payer.id, payer]));
  const groupsById = new Map(input.groups.map((group) => [group.id, group]));
  const eligibleProviders = input.providers.filter(isEligibleProvider);
  const eligibleProviderIds = new Set(eligibleProviders.map((provider) => provider.id));
  const casesByProvider = new Map<string, CasesMatrixCase[]>();

  for (const matrixCase of input.cases) {
    if (!eligibleProviderIds.has(matrixCase.providerId)) continue;
    const providerCases = casesByProvider.get(matrixCase.providerId) ?? [];
    providerCases.push(matrixCase);
    casesByProvider.set(matrixCase.providerId, providerCases);
  }

  const keptProviderIds = new Set(
    eligibleProviders
      .filter((provider) => {
        const providerCases = casesByProvider.get(provider.id) ?? [];
        return providerCases.length > 0 && providerCases.some(isOpenCase);
      })
      .map((provider) => provider.id),
  );
  const visibleCases = input.cases.filter(
    (matrixCase) =>
      keptProviderIds.has(matrixCase.providerId) &&
      matrixCase.groupId !== null &&
      providersById.has(matrixCase.providerId),
  );
  const bySection = new Map<string, CasesMatrixCase[]>();
  for (const matrixCase of visibleCases) {
    const key = sectionKey(matrixCase.groupId as string, matrixCase.state);
    const sectionCases = bySection.get(key) ?? [];
    sectionCases.push(matrixCase);
    bySection.set(key, sectionCases);
  }

  const tasksByCase = new Map<string, CasesMatrixTask[]>();
  for (const task of input.tasks) {
    if (task.caseId === null) continue;
    const caseTasks = tasksByCase.get(task.caseId) ?? [];
    caseTasks.push(task);
    tasksByCase.set(task.caseId, caseTasks);
  }
  const followUps = input.followUps ?? new Map<string, CasesMatrixFollowUp>();
  const exactCases = new Map<string, CasesMatrixCase>();
  const legacyCases = new Map<string, CasesMatrixCase>();
  for (const matrixCase of input.cases) {
    if (matrixCase.groupId === null) {
      legacyCases.set(
        legacyCaseKey(matrixCase.providerId, matrixCase.payerId, matrixCase.state),
        matrixCase,
      );
    } else {
      exactCases.set(
        caseKey(matrixCase.providerId, matrixCase.groupId, matrixCase.payerId, matrixCase.state),
        matrixCase,
      );
    }
  }

  const sections: CasesMatrixSection[] = [];
  for (const [key, sectionCases] of bySection) {
    const [groupId, state] = key.split("|");
    const group = groupsById.get(groupId);
    const groupName = group?.name ?? "Unknown group";
    const payerIds = new Set(
      input.targets
        .filter(
          (target) =>
            target.status === "active" && target.groupId === groupId && target.state === state,
        )
        .map((target) => target.payerId),
    );
    for (const matrixCase of sectionCases) payerIds.add(matrixCase.payerId);
    const sectionProviderIds = new Set(sectionCases.map((matrixCase) => matrixCase.providerId));
    for (const matrixCase of input.cases) {
      if (
        matrixCase.groupId === null &&
        matrixCase.state === state &&
        sectionProviderIds.has(matrixCase.providerId) &&
        keptProviderIds.has(matrixCase.providerId)
      ) {
        payerIds.add(matrixCase.payerId);
      }
    }
    const columns = [...payerIds]
      .map((payerId) => ({
        payerId,
        payerName: payersById.get(payerId)?.name ?? "Unknown payer",
        isActiveTarget: input.targets.some(
          (target) =>
            target.status === "active" &&
            target.groupId === groupId &&
            target.state === state &&
            target.payerId === payerId,
        ),
      }))
      .sort((a, b) => a.payerName.localeCompare(b.payerName) || a.payerId.localeCompare(b.payerId));

    const providerIds = new Set(sectionCases.map((matrixCase) => matrixCase.providerId));
    const rows: CasesMatrixRow[] = [];
    for (const providerId of providerIds) {
      const provider = providersById.get(providerId);
      if (!provider) continue;
      const providerCases = sectionCases.filter(
        (matrixCase) => matrixCase.providerId === providerId,
      );
      const resolvedCasesByPayer = new Map<string, CasesMatrixCase>();
      for (const column of columns) {
        const exact = exactCases.get(caseKey(providerId, groupId, column.payerId, state));
        const matrixCase =
          exact ?? legacyCases.get(legacyCaseKey(providerId, column.payerId, state));
        if (matrixCase) resolvedCasesByPayer.set(column.payerId, matrixCase);
      }
      const rowCases = [
        ...new Map(
          [...providerCases, ...resolvedCasesByPayer.values()].map((matrixCase) => [
            matrixCase.id,
            matrixCase,
          ]),
        ).values(),
      ];
      const fullyVisibleCases = rowCases.filter((matrixCase) =>
        matchesCaseFilter(
          toCaseViewRow(
            matrixCase,
            provider,
            payersById.get(matrixCase.payerId)?.name ?? "Unknown payer",
          ),
          filters,
        ),
      );
      if (fullyVisibleCases.length === 0) continue;
      const cells: Record<string, CasesMatrixCell> = {};
      for (const column of columns) {
        const matrixCase = resolvedCasesByPayer.get(column.payerId);
        if (matrixCase) {
          const row = toCaseViewRow(
            matrixCase,
            provider,
            payersById.get(matrixCase.payerId)?.name ?? "Unknown payer",
          );
          const dimmed = !matchesCaseFilter(row, filters);
          const urgency =
            matrixCase.caseStatus === "approved" || dimmed
              ? { hasOverdueTask: false, stale: null }
              : urgencyFor(matrixCase, input.today, tasksByCase, followUps);
          cells[column.payerId] = {
            kind: "case",
            case: matrixCase,
            dimmed,
            ...urgency,
          };
          continue;
        }
        const exclusion = activeExclusion(
          input.exclusions,
          providerId,
          groupId,
          column.payerId,
          state,
        );
        cells[column.payerId] = exclusion
          ? {
              kind: "excluded",
              dimmed: false,
              reason: exclusion.reason,
              note: exclusion.note,
            }
          : {
              kind: "gap",
              dimmed: false,
              isActiveTarget: column.isActiveTarget,
              generation: {
                providerId,
                payerId: column.payerId,
                groupId,
                state,
              },
            };
      }
      rows.push({
        providerId,
        providerName: providerName(provider),
        cases: rowCases,
        cells,
      });
    }
    rows.sort(
      (a, b) =>
        a.providerName.localeCompare(b.providerName) || a.providerId.localeCompare(b.providerId),
    );
    if (rows.length === 0) continue;
    const displayedCases = rows.flatMap((row) => row.cases);
    const openCaseCount = displayedCases.filter(
      (matrixCase) =>
        isOpenCase(matrixCase) &&
        matchesKpi(
          toCaseViewRow(
            matrixCase,
            providersById.get(matrixCase.providerId) as CasesMatrixProvider,
            payersById.get(matrixCase.payerId)?.name ?? "Unknown payer",
          ),
          filters.kpi,
        ),
    ).length;
    sections.push({
      groupId,
      groupName,
      state,
      stateName: US_STATE_NAMES[state as keyof typeof US_STATE_NAMES] ?? state,
      providerCount: rows.length,
      openCaseCount,
      columns,
      rows,
    });
  }
  sections.sort(
    (a, b) =>
      a.stateName.localeCompare(b.stateName) ||
      a.groupName.localeCompare(b.groupName) ||
      a.groupId.localeCompare(b.groupId),
  );
  return { sections, eligibleProviderCount: keptProviderIds.size };
}
