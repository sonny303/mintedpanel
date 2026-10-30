// Mission Control hooks. The platform-admin flag itself lives in the auth store
// (usePlatformAdmin in src/lib/permissions.ts); this file holds the queries
// that only a platform admin runs.
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/queryKeys";
import { usePlatformAdmin } from "@/lib/permissions";
import { getPlatformMetrics } from "@/services/platformAdmin";

const THIRTY_SECONDS = 30 * 1000;

export function usePlatformMetrics() {
  const isPlatformAdmin = usePlatformAdmin();
  return useQuery({
    queryKey: queryKeys.platformMetrics(),
    queryFn: getPlatformMetrics,
    enabled: isPlatformAdmin === true,
    staleTime: THIRTY_SECONDS,
  });
}
