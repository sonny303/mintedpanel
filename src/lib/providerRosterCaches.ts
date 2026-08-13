// Query keys that must refetch after a provider is created or their
// group / facility / license memberships change. Readiness and generation
// join these org-wide lists; several carry a 5-minute staleTime, so a
// missing invalidation looks like "this provider has no group or payer"
// until a hard refresh.
import type { QueryClient } from "@tanstack/react-query";

export function providerRosterCacheKeys(orgId: string) {
  return [
    ["providers", orgId] as const,
    ["provider-group-assignments", orgId] as const,
    ["org-state-licenses", orgId] as const,
    ["facility-assignments", orgId] as const,
    ["provider-readiness-facts", orgId] as const,
    ["audit-log", orgId] as const,
  ];
}

/** Mark every roster/readiness cache stale and refetch even inactive
 * observers (`refetchType: "all"`). Callers that navigate to the new
 * record must await this so the Cases tab never renders a stale
 * readiness universe that omits the provider they just created. */
export async function invalidateProviderRosterCaches(
  qc: QueryClient,
  orgId: string,
): Promise<void> {
  await Promise.all(
    providerRosterCacheKeys(orgId).map((queryKey) =>
      qc.invalidateQueries({ queryKey, refetchType: "all" }),
    ),
  );
}
