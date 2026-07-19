// E6.2 F6.2.3 — the group board's composition hook. Everything derives from
// EXISTING org caches plus the enrollment-facts read: candidates come from the
// SAME useGenerationPreview assembly E6.3's grid consumes (minus live facts —
// the one E6.2 subtraction), the pills from the E6.0 caseRollups derivation
// inside buildPayerBoard, the denial history from the unified ledger's denied
// entries. Nothing is stored, nothing is written — a case set Approved in
// another tab or an expired fact flips the row on the next render.
import { useMemo } from "react";
import { useCaseDenialEntries, useCases, useDenialReasonCodes } from "@/hooks/useCases";
import { useEnrollmentFacts } from "@/hooks/useEnrollmentFacts";
import {
  useCaseGenerationExclusions,
  useGenerationPreview,
} from "@/hooks/useGenerationPreview";
import { usePayerNetworkTargets } from "@/hooks/usePayerNetworkTargets";
import { usePayers } from "@/hooks/useAdmin";
import { useProviderGroupAssignments, useProviders } from "@/hooks/useProviders";
import { groupCandidates, subtractLiveFacts, bufferCause, type BufferCause } from "@/lib/generationBuffer";
import { buildPayerBoard, type BoardDenialEntry, type PayerBoard } from "@/lib/payerNetworkBoard";
import type { GenerationPreviewRow } from "@/lib/generationPreview";
import type { EnrollmentFact } from "@/types";

export interface PayerNetworkBoardData {
  board: PayerBoard | undefined;
  /** The group's buffer slice — count + rows for the banner (= E6.3 math). */
  candidates: GenerationPreviewRow[] | undefined;
  cause: BufferCause | null | undefined;
  facts: EnrollmentFact[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function usePayerNetworkBoard(groupId: string): PayerNetworkBoardData {
  const preview = useGenerationPreview();
  const factsQ = useEnrollmentFacts();
  const casesQ = useCases();
  const targetsQ = usePayerNetworkTargets();
  const exclusionsQ = useCaseGenerationExclusions();
  const payersQ = usePayers();
  const providersQ = useProviders();
  const assignmentsQ = useProviderGroupAssignments();
  const denialsQ = useCaseDenialEntries();
  const reasonsQ = useDenialReasonCodes();

  const sources = [factsQ, casesQ, targetsQ, exclusionsQ, payersQ, providersQ, assignmentsQ];
  const resolved = sources.every((q) => q.data !== undefined) && preview.rows !== undefined;

  const derived = useMemo(() => {
    if (!resolved) return undefined;
    const facts = factsQ.data ?? [];
    const allCandidates = subtractLiveFacts(preview.rows ?? [], facts);
    const candidates = groupCandidates(allCandidates, groupId);

    // Denial history joined to reason labels; latest-first per case (the
    // service read orders changed_at desc).
    const reasonLabelById = new Map((reasonsQ.data ?? []).map((r) => [r.id, r.label]));
    const denialsByCase = new Map<string, BoardDenialEntry[]>();
    for (const entry of denialsQ.data ?? []) {
      const list = denialsByCase.get(entry.caseId) ?? [];
      list.push({
        reasonLabel: entry.reasonCodeId ? (reasonLabelById.get(entry.reasonCodeId) ?? null) : null,
        date: entry.changedAt,
      });
      denialsByCase.set(entry.caseId, list);
    }

    const board = buildPayerBoard({
      groupId,
      targets: targetsQ.data ?? [],
      cases: (casesQ.data ?? []).map((c) => ({
        id: c.id,
        providerId: c.providerId,
        groupId: c.groupId ?? null,
        payerId: c.payerId,
        state: c.state,
        caseStatus: c.caseStatus,
        approvedDate: c.approvedDate ?? null,
      })),
      facts,
      exclusions: exclusionsQ.data ?? [],
      candidates,
      payers: (payersQ.data ?? []).map((p) => ({ id: p.id, name: p.name })),
      providers: (providersQ.data ?? []).map((p) => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`.trim(),
      })),
      denialsByCase,
    });

    const cause = bufferCause(candidates, {
      assignments: (assignmentsQ.data ?? []).map((a) => ({
        providerId: a.providerId,
        groupId: a.groupId,
        startDate: a.startDate,
        createdAt: a.createdAt,
      })),
      targets: (targetsQ.data ?? []).map((t) => ({
        groupId: t.groupId,
        payerId: t.payerId,
        state: t.state,
        createdAt: t.createdAt,
      })),
      facts,
    });

    return { board, candidates, cause };
  }, [
    resolved,
    groupId,
    preview.rows,
    factsQ.data,
    casesQ.data,
    targetsQ.data,
    exclusionsQ.data,
    payersQ.data,
    providersQ.data,
    assignmentsQ.data,
    denialsQ.data,
    reasonsQ.data,
  ]);

  return {
    board: derived?.board,
    candidates: derived?.candidates,
    cause: derived?.cause,
    facts: factsQ.data,
    isLoading: !resolved && sources.some((q) => q.isLoading),
    isError: sources.some((q) => q.isError) || preview.isError,
  };
}
