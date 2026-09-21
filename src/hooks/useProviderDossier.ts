// On-demand footprint for one Type-1 NPI. The palette typeahead does not call
// this. It runs when the inspector opens, and the cache key is the caller
// plus the NPI — the answer does not depend on which org is active.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth-store";
import { isType1Npi } from "@/lib/providerDossier";
import { queryKeys } from "@/hooks/queryKeys";
import { loadProviderDossier, type ProviderDossier } from "@/services/providerDossier";

const THIRTY_SECONDS = 30 * 1000;

export interface ProviderDossierResult {
  dossier: ProviderDossier | null;
  isFetching: boolean;
  isError: boolean;
  /** True once a 10-digit NPI and at least one membership make a read possible. */
  isReady: boolean;
}

export function useProviderDossier(npi: string | null): ProviderDossierResult {
  const memberships = useAuthStore((s) => s.memberships);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const authorizedOrgNames = useMemo(
    () => new Map(memberships.map((membership) => [membership.orgId, membership.orgName])),
    [memberships],
  );
  const ready = Boolean(userId) && isType1Npi(npi) && authorizedOrgNames.size > 0;

  const query = useQuery({
    queryKey: queryKeys.providerDossier(userId ?? "anon", npi ?? ""),
    queryFn: () => loadProviderDossier(npi ?? "", authorizedOrgNames),
    enabled: ready,
    staleTime: THIRTY_SECONDS,
  });

  return {
    dossier: query.data ?? null,
    isFetching: query.isFetching,
    isError: query.isError,
    isReady: ready,
  };
}
