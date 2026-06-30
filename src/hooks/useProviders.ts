// Providers query hooks: filter by active org; invalidate on mutations.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveOrgId } from '@/lib/auth-store';
import { queryKeys } from '@/hooks/queryKeys';
import {
  createProvider,
  getProvider,
  getProviders,
  terminateProvider,
  updateProvider,
  updateProviderWithLicenses,
  type ProviderFilters,
  type ProviderInput,
  type TerminateProviderInput,
  type UpdateProviderWithLicensesInput,
} from '@/services/providers';



export function useProviders(filters: ProviderFilters = {}) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: queryKeys.providers(orgId, filters),
    queryFn: () => getProviders(filters),
    enabled: orgId !== 'no-org',
  });
}

export function useProvider(id: string | undefined) {
  const orgId = useActiveOrgId() ?? 'no-org';
  return useQuery({
    queryKey: queryKeys.provider(orgId, id ?? ''),
    queryFn: () => getProvider(id as string),
    enabled: orgId !== 'no-org' && Boolean(id),
  });
}

export function useCreateProvider() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (input: ProviderInput) => createProvider(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers', orgId] });
    },
  });
}

export function useUpdateProvider(id: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (patch: Partial<ProviderInput>) => updateProvider(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers', orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.provider(orgId, id) });
    },
  });
}

export function useTerminateProvider(id: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? 'no-org';
  return useMutation({
    mutationFn: (input: Omit<TerminateProviderInput, 'providerId'>) =>
      terminateProvider({ ...input, providerId: id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers', orgId] });
      qc.invalidateQueries({ queryKey: queryKeys.provider(orgId, id) });
      qc.invalidateQueries({ queryKey: ['cases', orgId] });
      qc.invalidateQueries({ queryKey: ['tasks', orgId] });
      qc.invalidateQueries({ queryKey: ['audit-log', orgId] });
    },
  });
}
