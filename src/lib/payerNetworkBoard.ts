// E6.2 F6.2.3 — the Payer Network fulfillment board's row composition as pure
// logic. ONE row per payer targeted on the group; the status pill derives
// through the E6.0 caseRollups groupPayerFulfillment (Targeted / In Progress /
// Active, most-advanced-wins, Active = ≥1 Approved case OR a live enrollment
// fact) — NOTHING here is ever set by a user and nothing here writes (the
// board is entirely derived; setting a case Approved or expiring a fact flips
// the row on the next render with zero board-side writes).
//
// Drill-down rows show, per provider at the payer, each state's evidence: the
// case (with its canonical status + any denial history entries beneath — the
// reapply story stays visible), a live enrollment fact ("Active with zero
// cases"), a standing exclusion (reason + restorable), or an
// awaiting-generation candidate. Excluded combinations stay VISIBLE on their
// payer rows so the board always accounts for every target.
import { groupPayerFulfillment, type PayerFulfillment } from "@/lib/caseRollups";
import type { CaseStatus } from "@/lib/caseStatus";
import { enrollmentFactKey, liveEnrollmentFacts } from "@/lib/enrollmentFacts";
import type { GenerationPreviewRow } from "@/lib/generationPreview";
import type { ExclusionReason } from "@/lib/generationPreview";
import type { CaseGenerationExclusion, EnrollmentFact, PayerNetworkTarget } from "@/types";

export interface BoardCaseInput {
  id: string;
  providerId: string;
  groupId: string | null;
  payerId: string;
  state: string;
  caseStatus: CaseStatus;
  approvedDate: string | null;
}

export interface BoardDenialEntry {
  reasonLabel: string | null;
  date: string | null;
}

export interface BoardLookup {
  id: string;
  name: string;
}

export interface PayerBoardInput {
  groupId: string;
  /** The group's targets — ACTIVE rows drive the board; archived payers have
   * been removed and stop counting (TS-124). */
  targets: readonly PayerNetworkTarget[];
  /** Org cases; group-stamped rows join their pair (legacy NULL-group rows
   * never join a group board — the caseRollups rule). */
  cases: readonly BoardCaseInput[];
  /** Org enrollment facts; live rows at this group count toward Active. */
  facts: readonly EnrollmentFact[];
  /** Standing exclusions (active ones render on their payer rows). */
  exclusions: readonly CaseGenerationExclusion[];
  /** Group-scoped buffer candidates (src/lib/generationBuffer.ts). */
  candidates: readonly GenerationPreviewRow[];
  payers: readonly BoardLookup[];
  providers: readonly BoardLookup[];
  /** Latest-first denial history entries per case id (reason + date). */
  denialsByCase?: ReadonlyMap<string, readonly BoardDenialEntry[]>;
}

export type BoardCellKind = "case" | "fact" | "excluded" | "candidate";

export interface BoardProviderCell {
  state: string;
  kind: BoardCellKind;
  caseId?: string;
  caseStatus?: CaseStatus;
  denials?: readonly BoardDenialEntry[];
  factEffectiveDate?: string | null;
  exclusionId?: string;
  exclusionReason?: ExclusionReason;
  exclusionNote?: string | null;
}

export interface BoardProviderRow {
  providerId: string;
  providerName: string;
  cells: BoardProviderCell[];
}

export interface BoardExcludedEntry {
  exclusionId: string;
  providerId: string;
  providerName: string;
  state: string;
  reason: ExclusionReason;
  note: string | null;
}

export interface PayerBoardRow {
  payerId: string;
  payerName: string;
  fulfillment: PayerFulfillment;
  hasDenial: boolean;
  openCount: number;
  approvedCount: number;
  /** Live facts at the pair — "Active with zero cases" is an honest state. */
  factCount: number;
  targetStates: string[];
  /** Earliest Active evidence: min(approved case approved_date, live fact
   * effective_date); null when Active is undated or the row isn't Active. */
  activeSince: string | null;
  excluded: BoardExcludedEntry[];
  candidateCount: number;
  providers: BoardProviderRow[];
}

export interface PayerBoard {
  rows: PayerBoardRow[];
  /** Distinct payers with ≥1 active target — the "N of N" accounting. */
  targetedPayerCount: number;
}

export function buildPayerBoard(input: PayerBoardInput): PayerBoard {
  const activeTargets = input.targets.filter(
    (t) => t.groupId === input.groupId && t.status === "active",
  );
  const groupCases = input.cases.filter((c) => c.groupId === input.groupId);
  const liveFacts = liveEnrollmentFacts(input.facts).filter((f) => f.groupId === input.groupId);
  const activeExclusions = input.exclusions.filter(
    (x) => x.groupId === input.groupId && x.status === "active",
  );
  const payerNameById = new Map(input.payers.map((p) => [p.id, p.name]));
  const providerNameById = new Map(input.providers.map((p) => [p.id, p.name]));
  const denialsByCase = input.denialsByCase ?? new Map<string, readonly BoardDenialEntry[]>();

  const rollup = groupPayerFulfillment(
    activeTargets.map((t) => ({ groupId: t.groupId, payerId: t.payerId, state: t.state })),
    groupCases.map((c) => ({
      groupId: c.groupId,
      payerId: c.payerId,
      state: c.state,
      status: c.caseStatus,
    })),
    liveFacts.map((f) => ({ groupId: f.groupId, payerId: f.payerId, state: f.state })),
  );

  const rows: PayerBoardRow[] = rollup.map((r) => {
    const pairCases = groupCases.filter((c) => c.payerId === r.payerId);
    const pairFacts = liveFacts.filter((f) => f.payerId === r.payerId);
    const pairExclusions = activeExclusions.filter((x) => x.payerId === r.payerId);
    const pairCandidates = input.candidates.filter(
      (c) => c.groupId === input.groupId && c.payerId === r.payerId,
    );

    const active = r.fulfillment === "active";
    const activeDates = active
      ? [
          ...pairCases
            .filter((c) => c.caseStatus === "approved" && c.approvedDate)
            .map((c) => c.approvedDate as string),
          ...pairFacts.filter((f) => f.effectiveDate).map((f) => f.effectiveDate as string),
        ]
      : [];
    const activeSince = activeDates.length > 0 ? activeDates.sort()[0] : null;

    // Drill-down: one row per provider with any evidence at the pair.
    const providerIds = new Set<string>([
      ...pairCases.map((c) => c.providerId),
      ...pairFacts.map((f) => f.providerId),
      ...pairExclusions.map((x) => x.providerId),
      ...pairCandidates.map((c) => c.providerId),
    ]);
    const caseByProviderState = new Map(pairCases.map((c) => [`${c.providerId}|${c.state}`, c]));
    const factByProviderState = new Map(pairFacts.map((f) => [`${f.providerId}|${f.state}`, f]));
    const exclusionByProviderState = new Map(
      pairExclusions.map((x) => [`${x.providerId}|${x.state}`, x]),
    );

    const providerRows: BoardProviderRow[] = [...providerIds]
      .map((providerId) => {
        const states = new Set<string>();
        for (const c of pairCases) if (c.providerId === providerId) states.add(c.state);
        for (const f of pairFacts) if (f.providerId === providerId) states.add(f.state);
        for (const x of pairExclusions) if (x.providerId === providerId) states.add(x.state);
        for (const c of pairCandidates) if (c.providerId === providerId) states.add(c.state);

        const cells: BoardProviderCell[] = [...states].sort().map((state) => {
          const key = `${providerId}|${state}`;
          const caseRow = caseByProviderState.get(key);
          if (caseRow) {
            return {
              state,
              kind: "case",
              caseId: caseRow.id,
              caseStatus: caseRow.caseStatus,
              denials: denialsByCase.get(caseRow.id) ?? [],
            };
          }
          const fact = factByProviderState.get(key);
          if (fact) return { state, kind: "fact", factEffectiveDate: fact.effectiveDate };
          const exclusion = exclusionByProviderState.get(key);
          if (exclusion) {
            return {
              state,
              kind: "excluded",
              exclusionId: exclusion.id,
              exclusionReason: exclusion.reason,
              exclusionNote: exclusion.note,
            };
          }
          // Reaching here means the state came from the candidate set.
          return { state, kind: "candidate" };
        });

        return {
          providerId,
          providerName:
            providerNameById.get(providerId) ??
            pairCandidates.find((c) => c.providerId === providerId)?.providerName ??
            "Unknown provider",
          cells,
        };
      })
      .sort((a, b) => a.providerName.localeCompare(b.providerName));

    const excluded: BoardExcludedEntry[] = pairExclusions
      .map((x) => ({
        exclusionId: x.id,
        providerId: x.providerId,
        providerName: providerNameById.get(x.providerId) ?? "Unknown provider",
        state: x.state,
        reason: x.reason,
        note: x.note,
      }))
      .sort((a, b) => a.providerName.localeCompare(b.providerName) || a.state.localeCompare(b.state));

    return {
      payerId: r.payerId,
      payerName: payerNameById.get(r.payerId) ?? "Unknown payer",
      fulfillment: r.fulfillment,
      hasDenial: r.hasDenial,
      openCount: r.openCount,
      approvedCount: r.approvedCount,
      factCount: pairFacts.length,
      targetStates: r.targetStates,
      activeSince,
      excluded,
      candidateCount: pairCandidates.length,
      providers: providerRows,
    };
  });

  rows.sort((a, b) => a.payerName.localeCompare(b.payerName));

  return {
    rows,
    targetedPayerCount: new Set(activeTargets.map((t) => t.payerId)).size,
  };
}

/** Re-exported for callers joining facts by key (drill-down helpers). */
export { enrollmentFactKey };
