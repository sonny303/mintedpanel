// Fix-it queue (Surface 1) data + mutations. The queue is DERIVED from existing
// caches (providers, cases, tasks, payers, status configs, portals, field maps,
// dictionary) via buildFixitQueue — no new server round-trips beyond the portals
// hooks. Mutations persist and invalidate their source queries; the /fix-it deck
// itself is driven from local state so it never reorders under the user.
import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import { useProviders } from "@/hooks/useProviders";
import { useCases } from "@/hooks/useCases";
import { useTasks } from "@/hooks/useTasks";
import { usePayers, useStatusConfigs } from "@/hooks/useAdmin";
import { usePortals, usePortalFieldMaps, useLastFills } from "@/hooks/usePortals";
import { useFieldDictionary } from "@/hooks/useMappingReview";
import { updateProvider, type ProviderInput } from "@/services/providers";
import { reproposeFieldMap } from "@/services/portalFieldMaps";
import { createFollowUpTask } from "@/services/tasks";
import { decideDictionaryEntry } from "@/services/fieldDictionary";
import {
  buildFixitQueue,
  type BrokenOrgRow,
  type FixitCard,
  type OpenCaseLite,
} from "@/lib/fixitQueue";
import type { FieldDictionaryStatus } from "@/types";

export interface UseFixitQueueResult {
  cards: FixitCard[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useFixitQueue(): UseFixitQueueResult {
  const providersQ = useProviders();
  const casesQ = useCases();
  const tasksQ = useTasks();
  const payersQ = usePayers();
  const statusConfigsQ = useStatusConfigs();
  const portalsQ = usePortals();
  const mapsQ = usePortalFieldMaps();
  const dictQ = useFieldDictionary();
  const lastFillsQ = useLastFills();

  // Every query feeds buildFixitQueue, so the deck must not seed until all have
  // loaded — a partial seed would freeze an incomplete deck (missing dictionary
  // cards, "the payer" fallback names, wrong impact order) on a cold deep-load.
  const isLoading =
    providersQ.isLoading ||
    casesQ.isLoading ||
    tasksQ.isLoading ||
    payersQ.isLoading ||
    statusConfigsQ.isLoading ||
    portalsQ.isLoading ||
    mapsQ.isLoading ||
    dictQ.isLoading ||
    lastFillsQ.isLoading;
  const isError = providersQ.isError || casesQ.isError || portalsQ.isError || mapsQ.isError;

  const cards = useMemo(() => {
    const providers = providersQ.data ?? [];
    const cases = casesQ.data ?? [];
    const tasks = tasksQ.data ?? [];
    const payers = payersQ.data ?? [];
    const statusConfigs = statusConfigsQ.data ?? [];
    const portals = portalsQ.data ?? [];
    const maps = mapsQ.data ?? [];
    const dictionary = dictQ.data ?? [];
    const lastFills = [...(lastFillsQ.data?.values() ?? [])].map((f) => ({
      portalKey: f.portalKey,
      fieldsSkipped: f.fieldsSkipped,
    }));
    if (providers.length === 0 && cases.length === 0) return [];

    const statusById = new Map(statusConfigs.map((s) => [s.id, s]));
    const payerNameById = new Map(payers.map((p) => [p.id, p.name]));

    // Earliest open-task due date per case.
    const earliestDueByCase = new Map<string, string | null>();
    for (const t of tasks) {
      if (!t.caseId || t.status === "completed" || !t.dueDate) continue;
      const cur = earliestDueByCase.get(t.caseId) ?? null;
      earliestDueByCase.set(t.caseId, cur == null || t.dueDate < cur ? t.dueDate : cur);
    }

    const openCases: OpenCaseLite[] = [];
    for (const c of cases) {
      const status = c.credentialingStatusId ? statusById.get(c.credentialingStatusId) : undefined;
      const isOpen = (status?.actionBucket ?? null) !== "complete"; // status-less counts as open
      if (!isOpen) continue;
      openCases.push({
        caseId: c.id,
        providerId: c.providerId,
        payerId: c.payerId,
        payerName: payerNameById.get(c.payerId) ?? "the payer",
        state: c.state,
        nextDueDate: earliestDueByCase.get(c.id) ?? c.expectedEffectiveDate ?? null,
      });
    }

    return buildFixitQueue({
      providers,
      openCases,
      portals: portals.map((p) => ({ portalKey: p.portalKey, name: p.name, payerId: p.payerId })),
      fieldMaps: maps,
      dictionary,
      lastFills,
    });
  }, [
    providersQ.data,
    casesQ.data,
    tasksQ.data,
    payersQ.data,
    statusConfigsQ.data,
    portalsQ.data,
    mapsQ.data,
    dictQ.data,
    lastFillsQ.data,
  ]);

  return {
    cards,
    isLoading,
    isError,
    refetch: () => {
      providersQ.refetch();
      casesQ.refetch();
      portalsQ.refetch();
      mapsQ.refetch();
      dictQ.refetch();
      lastFillsQ.refetch();
    },
  };
}

export function useSaveProviderField() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: ({ providerId, patch }: { providerId: string; patch: Partial<ProviderInput> }) =>
      updateProvider(providerId, patch),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: queryKeys.providers(orgId) });
      qc.invalidateQueries({ queryKey: queryKeys.provider(orgId, variables.providerId) });
    },
  });
}

export function useSkipToFollowUp() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: {
      caseId: string;
      providerId: string;
      title: string;
      dueDate: string | null;
    }) => createFollowUpTask(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tasks(orgId) }),
  });
}

export function useDecideDictionary() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: Extract<FieldDictionaryStatus, "confirmed" | "rejected">;
    }) => decideDictionaryEntry(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.fieldDictionary(orgId) }),
  });
}

// Broken-mapping card action: send the org's own rows whose selectors no longer
// match the live form back to proposed, so they re-enter the training deck for
// a re-decision (RLS blocks writes to global rows — those stay informational).
export function useSendBrokenToTraining() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: async (rows: BrokenOrgRow[]) => {
      for (const row of rows) {
        await reproposeFieldMap(row.id, { token: row.token, source: row.source });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.portalFieldMaps(orgId) }),
  });
}
