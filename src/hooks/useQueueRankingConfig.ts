// E4.1 F4.1.3 — load the org's next-best-action ranking config once and validate
// it into the shape the pure reducer consumes (resolveQueueRankingConfig). A
// null result is the shipped default. E4.2 F4.2.5 persists the row; the save/
// reset mutations invalidate this key so every user's queue reranks immediately.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import {
  getQueueRankingConfigRaw,
  resetQueueRankingConfig,
  saveQueueRankingConfig,
} from "@/services/queueRankingConfig";
import {
  resolveQueueRankingConfig,
  type QueueRankingConfig,
  type QueueRankingGroup,
} from "@/lib/nextBestActions";

export function useQueueRankingConfig() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery<QueueRankingConfig | null>({
    queryKey: queryKeys.queueRankingConfig(orgId),
    queryFn: async () => resolveQueueRankingConfig(await getQueueRankingConfigRaw()),
    enabled: orgId !== "no-org",
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveQueueRankingConfig() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (order: QueueRankingGroup[]) => saveQueueRankingConfig(order),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.queueRankingConfig(orgId) }),
  });
}

export function useResetQueueRankingConfig() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: () => resetQueueRankingConfig(),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.queueRankingConfig(orgId) }),
  });
}
