// Launch-location hooks — slimmed by E6.6 F6.6.2 to the two surviving reads.
// The Launches pages retired (E6.1) and the launch view is now the Reporting
// Center Launches report (date-only, over the shared facilities/assignments/
// cases caches); the launch-specific write hooks and their orphaned modals
// are gone. Launch rows ARE facilities rows, so the list shares the
// facilities cache key.
import { useQuery } from "@tanstack/react-query";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import { useActiveOrgId } from "@/lib/auth-store";
import { listFacilities } from "@/services/orgSettings";
import { getLaunchLocation } from "@/services/launches";

export function useLaunchLocations() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.facilities(orgId),
    queryFn: listFacilities,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

/** Single-location read — providers.new's ?locationId prefill. */
export function useLaunchLocation(id: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.facility(orgId, id ?? "none"),
    queryFn: () => getLaunchLocation(id as string),
    enabled: orgId !== "no-org" && !!id,
  });
}
