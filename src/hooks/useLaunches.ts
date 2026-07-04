// Launch-location hooks (launch PRD v2.1). Launch rows ARE facilities rows, so
// the list shares the facilities cache key; launch-specific state (provider
// assignments, case generation) lives under its own keys.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FIVE_MINUTES, queryKeys } from "@/hooks/queryKeys";
import { useActiveOrgId } from "@/lib/auth-store";
import { listFacilities } from "@/services/orgSettings";
import {
  assignProviderToFacility,
  generateLaunchCases,
  getLaunchLocation,
  listFacilityAssignments,
  type GenerationEntry,
} from "@/services/launches";
import type { Facility } from "@/types";

export function useLaunchLocations() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.facilities(orgId),
    queryFn: listFacilities,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function useLaunchLocation(id: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.facility(orgId, id ?? "none"),
    queryFn: () => getLaunchLocation(id as string),
    enabled: orgId !== "no-org" && !!id,
  });
}

export function useFacilityAssignments() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.facilityAssignments(orgId),
    queryFn: listFacilityAssignments,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function useAssignProviderToFacility() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: ({ providerId, facilityId }: { providerId: string; facilityId: string }) =>
      assignProviderToFacility(providerId, facilityId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["facility-assignments", orgId] });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

export function useGenerateLaunchCases() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: ({ location, entries }: { location: Facility; entries: GenerationEntry[] }) =>
      generateLaunchCases(location, entries),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cases", orgId] });
      qc.invalidateQueries({ queryKey: ["tasks", orgId] });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}
