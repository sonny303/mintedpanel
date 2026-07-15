// E4.1 F4.1.3 — load the org's next-best-action ranking config once and validate
// it into the shape the pure reducer consumes (resolveQueueRankingConfig). A
// null result is the shipped default. E4.2 F4.2.5 will populate the underlying
// store; this hook and the reducer need no change when it does.
import { useQuery } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { getQueueRankingConfigRaw } from "@/services/queueRankingConfig";
import { resolveQueueRankingConfig, type QueueRankingConfig } from "@/lib/nextBestActions";

export function useQueueRankingConfig() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery<QueueRankingConfig | null>({
    queryKey: ["queue-ranking-config", orgId] as const,
    queryFn: async () => resolveQueueRankingConfig(await getQueueRankingConfigRaw()),
    enabled: orgId !== "no-org",
    staleTime: 5 * 60 * 1000,
  });
}
