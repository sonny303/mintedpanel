// M4 launches hooks (sanctioned): reads, the provider-to-launch link mutation
// (through the existing provider update service so audit rows are uniform),
// and the generate-cases mutation.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/queryKeys";
import { useActiveOrgId } from "@/lib/auth-store";
import {
  generateLaunchCases,
  getLaunch,
  listLaunches,
  type GenerationEntry,
} from "@/services/launches";
import { updateProvider } from "@/services/providers";
import type { Launch } from "@/types";

const FIVE_MINUTES = 5 * 60 * 1000;

export function useLaunches() {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.launches(orgId),
    queryFn: listLaunches,
    enabled: orgId !== "no-org",
    staleTime: FIVE_MINUTES,
  });
}

export function useLaunch(id: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.launch(orgId, id ?? "none"),
    queryFn: () => getLaunch(id as string),
    enabled: orgId !== "no-org" && !!id,
  });
}

export function useAttachProviderToLaunch() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: ({ providerId, launchId }: { providerId: string; launchId: string | null }) =>
      updateProvider(providerId, { launchId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers", orgId] });
      qc.invalidateQueries({ queryKey: ["launches", orgId] });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

export function useGenerateLaunchCases() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: ({ launch, entries }: { launch: Launch; entries: GenerationEntry[] }) =>
      generateLaunchCases(launch, entries),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cases", orgId] });
      qc.invalidateQueries({ queryKey: ["tasks", orgId] });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}
